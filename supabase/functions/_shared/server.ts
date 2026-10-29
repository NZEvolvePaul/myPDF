// Edge-function helpers (Deno only).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PDFDocument } from 'pdf-lib';
import { stampFields } from './stamp.ts';
import { appendCertificate } from './certificate.ts';
import { randomToken, sha256Hex } from './crypto.ts';
import { allSigned, toNotify } from './routing.ts';
import { completedEmail, declinedEmail, sendEmail, signRequestEmail, type Email } from './email.ts';
import type { Field } from './types.ts';

export const BUCKET = 'documents';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

/** Wraps a handler with CORS preflight and error-to-JSON handling. */
export function serve(handler: (req: Request) => Promise<Response>) {
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    try {
      return await handler(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Something went wrong. Please try again.' }, 500);
    }
  });
}

export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
}

export function appUrl(): string {
  return (Deno.env.get('APP_URL') ?? 'http://localhost:5173').replace(/\/$/, '');
}

function emailEnv() {
  return { apiKey: Deno.env.get('RESEND_API_KEY'), from: Deno.env.get('EMAIL_FROM') ?? 'MyPDF <onboarding@resend.dev>' };
}

export function send(email: Email) {
  return sendEmail(email, emailEnv());
}

export function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
}

export interface AuditInput {
  envelope_id: string;
  recipient_id?: string | null;
  actor_email?: string | null;
  event: string;
  ip?: string | null;
  user_agent?: string | null;
  details?: Record<string, unknown>;
}

export async function audit(db: SupabaseClient, row: AuditInput) {
  const { error } = await db.from('audit_events').insert(row);
  if (error) throw error;
}

export interface EnvelopeRow {
  id: string;
  owner_id: string;
  title: string;
  message: string | null;
  status: string;
  original_path: string;
  original_sha256: string | null;
  sent_at: string | null;
}

export interface RecipientRow {
  id: string;
  envelope_id: string;
  name: string;
  email: string;
  routing_order: number;
  status: 'pending' | 'sent' | 'viewed' | 'signed' | 'declined';
  consented_at: string | null;
  signed_at: string | null;
  signed_ip: string | null;
  signed_user_agent: string | null;
}

export async function senderOf(db: SupabaseClient, ownerId: string) {
  const { data, error } = await db.auth.admin.getUserById(ownerId);
  if (error || !data.user) throw error ?? new Error('Sender not found');
  const email = data.user.email ?? '';
  const name = (data.user.user_metadata?.full_name as string | undefined) || email;
  return { email, name };
}

export async function recipientsOf(db: SupabaseClient, envelopeId: string): Promise<RecipientRow[]> {
  const { data, error } = await db
    .from('recipients')
    .select('id, envelope_id, name, email, routing_order, status, consented_at, signed_at, signed_ip, signed_user_agent')
    .eq('envelope_id', envelopeId)
    .order('routing_order')
    .order('created_at');
  if (error) throw error;
  return data as RecipientRow[];
}

/** Emails a fresh signing link to everyone whose turn it now is. */
export async function notifyCurrentRound(db: SupabaseClient, envelope: EnvelopeRow) {
  const sender = await senderOf(db, envelope.owner_id);
  for (const r of toNotify(await recipientsOf(db, envelope.id))) {
    const token = randomToken();
    const { error } = await db
      .from('recipients')
      .update({ token_hash: await sha256Hex(token), status: 'sent' })
      .eq('id', r.id)
      .eq('status', 'pending');
    if (error) throw error;
    await send(
      signRequestEmail({
        to: r.email,
        signerName: r.name,
        senderName: sender.name,
        title: envelope.title,
        message: envelope.message,
        link: `${appUrl()}/#/sign/${token}`,
      }),
    );
    await audit(db, { envelope_id: envelope.id, recipient_id: r.id, actor_email: sender.email, event: `emailed signing link to ${r.email}` });
  }
}

async function download(db: SupabaseClient, path: string): Promise<Uint8Array> {
  const { data, error } = await db.storage.from(BUCKET).download(path);
  if (error || !data) throw error ?? new Error(`Missing ${path}`);
  return new Uint8Array(await data.arrayBuffer());
}

export async function originalBytes(db: SupabaseClient, envelope: EnvelopeRow) {
  return download(db, envelope.original_path);
}

function base64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const iso = (s: string | null | undefined) => (s ? new Date(s).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC') : '');

/**
 * Called once every recipient has signed: stamps all fields onto the original,
 * appends the certificate, stores the final file and emails it to everyone.
 */
export async function finalize(db: SupabaseClient, envelope: EnvelopeRow) {
  // Claim the envelope so two last signers can't both finalise it.
  const { data: claimed, error: claimError } = await db
    .from('envelopes')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', envelope.id)
    .eq('status', 'sent')
    .select('completed_at')
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return;

  try {
    const [original, recipients, sender] = await Promise.all([
      originalBytes(db, envelope),
      recipientsOf(db, envelope.id),
      senderOf(db, envelope.owner_id),
    ]);
    const { data: fieldRows, error: fieldError } = await db.from('fields').select('*').eq('envelope_id', envelope.id);
    if (fieldError) throw fieldError;
    const { data: events, error: eventError } = await db
      .from('audit_events')
      .select('created_at, event, actor_email, ip')
      .eq('envelope_id', envelope.id)
      .order('created_at');
    if (eventError) throw eventError;

    const stamped = await stampFields(original, (fieldRows ?? []).filter((f) => f.value) as Field[]);
    const doc = await PDFDocument.load(stamped);
    await appendCertificate(doc, {
      envelopeId: envelope.id,
      title: envelope.title,
      senderName: sender.name,
      senderEmail: sender.email,
      originalSha256: envelope.original_sha256 ?? '',
      sentAt: iso(envelope.sent_at),
      completedAt: iso(claimed.completed_at),
      signers: recipients.map((r) => ({
        name: r.name,
        email: r.email,
        consentedAt: iso(r.consented_at),
        signedAt: iso(r.signed_at),
        ip: r.signed_ip ?? '',
        userAgent: r.signed_user_agent ?? '',
      })),
      events: (events ?? []).map((e) => ({ at: iso(e.created_at), event: e.event, who: e.actor_email ?? '', ip: e.ip })),
    });
    doc.setTitle(envelope.title);
    doc.setProducer('MyPDF');
    const finalBytes = await doc.save();
    const finalSha = await sha256Hex(finalBytes);
    const finalPath = envelope.original_path.replace(/original\.pdf$/, 'completed.pdf');

    const { error: uploadError } = await db.storage
      .from(BUCKET)
      .upload(finalPath, finalBytes, { contentType: 'application/pdf', upsert: true });
    if (uploadError) throw uploadError;
    const { error: updateError } = await db
      .from('envelopes')
      .update({ final_path: finalPath, final_sha256: finalSha })
      .eq('id', envelope.id);
    if (updateError) throw updateError;
    await audit(db, { envelope_id: envelope.id, event: 'completed', details: { final_sha256: finalSha } });

    const pdfBase64 = base64(finalBytes);
    const filename = `${envelope.title.replace(/[^\w\- ]+/g, '').trim() || 'document'} (signed).pdf`;
    const people = [{ email: sender.email, name: sender.name }, ...recipients.map((r) => ({ email: r.email, name: r.name }))];
    const seen = new Set<string>();
    for (const p of people) {
      if (seen.has(p.email.toLowerCase())) continue;
      seen.add(p.email.toLowerCase());
      await send(completedEmail({ to: p.email, name: p.name, title: envelope.title, sha256: finalSha, pdfBase64, filename }));
    }
  } catch (e) {
    // Hand the envelope back so the next attempt can finish it.
    await db.from('envelopes').update({ status: 'sent', completed_at: null }).eq('id', envelope.id);
    throw e;
  }
}

export async function notifyDeclined(db: SupabaseClient, envelope: EnvelopeRow, signerName: string, reason: string | null) {
  const sender = await senderOf(db, envelope.owner_id);
  await send(declinedEmail({ to: sender.email, senderName: sender.name, signerName, title: envelope.title, reason }));
}

export function allRecipientsSigned(recipients: RecipientRow[]) {
  return allSigned(recipients);
}
