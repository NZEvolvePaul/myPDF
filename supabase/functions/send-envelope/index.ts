// Sends a draft envelope: fingerprints the original and emails the first signers.
import {
  HttpError,
  adminClient,
  audit,
  clientIp,
  json,
  notifyCurrentRound,
  originalBytes,
  recipientsOf,
  serve,
  type EnvelopeRow,
} from '../_shared/server.ts';
import { sha256Hex } from '../_shared/crypto.ts';

serve(async (req) => {
  const db = adminClient();
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  const { data: auth } = await db.auth.getUser(jwt);
  if (!auth.user) throw new HttpError(401, 'Please sign in again.');

  const { envelopeId } = await req.json();
  const { data: envelope } = await db.from('envelopes').select('*').eq('id', envelopeId).maybeSingle<EnvelopeRow>();
  if (!envelope || envelope.owner_id !== auth.user.id) throw new HttpError(404, 'Document not found.');
  if (envelope.status !== 'draft') throw new HttpError(409, 'This document has already been sent.');

  const recipients = await recipientsOf(db, envelope.id);
  if (recipients.length === 0) throw new HttpError(400, 'Add at least one signer.');
  const { data: fields, error } = await db.from('fields').select('recipient_id, kind').eq('envelope_id', envelope.id);
  if (error) throw error;
  const missing = recipients.filter((r) => !fields?.some((f) => f.recipient_id === r.id && f.kind === 'signature'));
  if (missing.length) {
    throw new HttpError(400, `Place a signature field for ${missing.map((r) => r.name).join(', ')}.`);
  }

  const originalSha = await sha256Hex(await originalBytes(db, envelope));
  const sentAt = new Date().toISOString();
  const { data: updated, error: updateError } = await db
    .from('envelopes')
    .update({ status: 'sent', sent_at: sentAt, original_sha256: originalSha })
    .eq('id', envelope.id)
    .eq('status', 'draft')
    .select('*')
    .maybeSingle<EnvelopeRow>();
  if (updateError) throw updateError;
  if (!updated) throw new HttpError(409, 'This document has already been sent.');

  await audit(db, {
    envelope_id: envelope.id,
    actor_email: auth.user.email,
    event: 'created and sent',
    ip: clientIp(req),
    user_agent: req.headers.get('user-agent'),
    details: { original_sha256: originalSha, recipients: recipients.length },
  });
  await notifyCurrentRound(db, updated);
  return json({ ok: true });
});
