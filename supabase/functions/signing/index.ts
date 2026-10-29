// Everything a signer does, authorised by the secret token in their link.
import {
  BUCKET,
  HttpError,
  adminClient,
  allRecipientsSigned,
  audit,
  clientIp,
  finalize,
  json,
  notifyCurrentRound,
  notifyDeclined,
  recipientsOf,
  senderOf,
  serve,
  type EnvelopeRow,
  type RecipientRow,
} from '../_shared/server.ts';
import { sha256Hex } from '../_shared/crypto.ts';

const MAX_IMAGE_CHARS = 700_000; // ~500 KB of PNG as a data URL
const MAX_TEXT = 500;

serve(async (req) => {
  const db = adminClient();
  const body = await req.json();
  const token = typeof body.token === 'string' ? body.token : '';
  if (token.length < 20) throw new HttpError(404, 'This signing link is not valid.');

  const { data: recipient } = await db
    .from('recipients')
    .select('id, envelope_id, name, email, routing_order, status, consented_at, signed_at, signed_ip, signed_user_agent')
    .eq('token_hash', await sha256Hex(token))
    .maybeSingle<RecipientRow>();
  if (!recipient) throw new HttpError(404, 'This signing link is not valid or has expired.');
  const { data: envelope } = await db.from('envelopes').select('*').eq('id', recipient.envelope_id).single<EnvelopeRow>();
  if (!envelope) throw new HttpError(404, 'This document no longer exists.');

  const ip = clientIp(req);
  const userAgent = req.headers.get('user-agent') ?? '';
  const who = { envelope_id: envelope.id, recipient_id: recipient.id, actor_email: recipient.email, ip, user_agent: userAgent };

  switch (body.action) {
    case 'load': {
      if (envelope.status === 'sent' && recipient.status === 'sent') {
        const { data: first } = await db
          .from('recipients')
          .update({ status: 'viewed' })
          .eq('id', recipient.id)
          .eq('status', 'sent')
          .select('id')
          .maybeSingle();
        if (first) await audit(db, { ...who, event: 'opened the document' });
        recipient.status = 'viewed';
      }
      const [{ data: fields }, sender, { data: url }] = await Promise.all([
        db.from('fields').select('id, recipient_id, kind, page, x, y, w, h, required, value').eq('envelope_id', envelope.id),
        senderOf(db, envelope.owner_id),
        db.storage.from(BUCKET).createSignedUrl(envelope.original_path, 3600),
      ]);
      return json({
        envelope: { id: envelope.id, title: envelope.title, message: envelope.message, status: envelope.status },
        sender: { name: sender.name, email: sender.email },
        recipient: { name: recipient.name, email: recipient.email, status: recipient.status },
        pdfUrl: url?.signedUrl,
        // The signer's own fields to fill, plus anything others have already signed.
        fields: (fields ?? [])
          .filter((f) => f.recipient_id === recipient.id || f.value)
          .map((f) => ({ ...f, mine: f.recipient_id === recipient.id, value: f.recipient_id === recipient.id ? null : f.value })),
      });
    }

    case 'sign': {
      requireOpen(envelope, recipient);
      if (body.consent !== true) throw new HttpError(400, 'Please agree to sign electronically first.');
      const values: Record<string, unknown> = body.values ?? {};
      const { data: mine, error } = await db.from('fields').select('id, kind, required').eq('recipient_id', recipient.id);
      if (error) throw error;

      const updates: { id: string; value: string }[] = [];
      for (const f of mine ?? []) {
        const v = values[f.id];
        if (typeof v !== 'string' || !v.trim()) {
          if (f.required) throw new HttpError(400, 'Please complete every required field.');
          continue;
        }
        const isImage = f.kind === 'signature' || f.kind === 'initials';
        if (isImage && (!v.startsWith('data:image/png;base64,') || v.length > MAX_IMAGE_CHARS)) {
          throw new HttpError(400, 'That signature image could not be used. Please try again.');
        }
        if (!isImage && v.length > MAX_TEXT) throw new HttpError(400, 'Some text is too long.');
        updates.push({ id: f.id, value: v });
      }

      const now = new Date().toISOString();
      // Claim the signature first so a double submit can't sign twice.
      const { data: claimed } = await db
        .from('recipients')
        .update({ status: 'signed', consented_at: now, signed_at: now, signed_ip: ip, signed_user_agent: userAgent })
        .eq('id', recipient.id)
        .in('status', ['sent', 'viewed'])
        .select('id')
        .maybeSingle();
      if (!claimed) throw new HttpError(409, 'You have already signed this document.');
      for (const u of updates) {
        const { error: e } = await db.from('fields').update({ value: u.value }).eq('id', u.id).eq('recipient_id', recipient.id);
        if (e) throw e;
      }
      await audit(db, { ...who, event: 'agreed to sign electronically' });
      await audit(db, { ...who, event: 'signed', details: { fields: updates.length } });

      const recipients = await recipientsOf(db, envelope.id);
      if (allRecipientsSigned(recipients)) {
        await finalize(db, envelope);
        return json({ ok: true, completed: true });
      }
      await notifyCurrentRound(db, envelope);
      return json({ ok: true, completed: false });
    }

    case 'decline': {
      requireOpen(envelope, recipient);
      const reason = typeof body.reason === 'string' ? body.reason.slice(0, MAX_TEXT) : null;
      const { data: claimed } = await db
        .from('recipients')
        .update({ status: 'declined', declined_reason: reason })
        .eq('id', recipient.id)
        .in('status', ['sent', 'viewed'])
        .select('id')
        .maybeSingle();
      if (!claimed) throw new HttpError(409, 'You have already responded to this document.');
      await db.from('envelopes').update({ status: 'declined' }).eq('id', envelope.id).eq('status', 'sent');
      await audit(db, { ...who, event: 'declined', details: { reason } });
      await notifyDeclined(db, envelope, recipient.name, reason);
      return json({ ok: true });
    }

    default:
      throw new HttpError(400, 'Unknown action.');
  }
});

function requireOpen(envelope: EnvelopeRow, recipient: RecipientRow) {
  if (envelope.status === 'completed') throw new HttpError(409, 'This document has already been completed.');
  if (envelope.status !== 'sent') throw new HttpError(409, 'This document is no longer open for signing.');
  if (recipient.status === 'signed') throw new HttpError(409, 'You have already signed this document.');
  if (recipient.status === 'declined') throw new HttpError(409, 'You declined this document.');
}
