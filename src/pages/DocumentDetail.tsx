import { useCallback, useEffect, useState } from 'react';
import { BUCKET, callFunction, supabase, type EnvelopeSummary, type RecipientSummary } from '../lib/supabase';
import { Shell, formatDate, statusLabel } from '../components/Shell';
import { navigate } from '../lib/router';

interface AuditRow {
  id: number;
  event: string;
  actor_email: string | null;
  ip: string | null;
  created_at: string;
}

export function DocumentDetail({ id }: { id: string }) {
  const [env, setEnv] = useState<EnvelopeSummary | null>(null);
  const [recipients, setRecipients] = useState<RecipientSummary[]>([]);
  const [events, setEvents] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const db = supabase!;
    const [e, r, a] = await Promise.all([
      db.from('envelopes').select('*').eq('id', id).maybeSingle(),
      db
        .from('recipients')
        .select('id, name, email, routing_order, status, signed_at, declined_reason')
        .eq('envelope_id', id)
        .order('routing_order')
        .order('created_at'),
      db.from('audit_events').select('id, event, actor_email, ip, created_at').eq('envelope_id', id).order('created_at'),
    ]);
    if (e.error || !e.data) {
      setError(e.error?.message ?? 'Document not found.');
      return;
    }
    setEnv(e.data as EnvelopeSummary);
    setRecipients((r.data ?? []) as RecipientSummary[]);
    setEvents((a.data ?? []) as AuditRow[]);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const download = async (path: string, name: string) => {
    const { data, error } = await supabase!.storage.from(BUCKET).download(path);
    if (error || !data) return setError(error?.message ?? 'Download failed.');
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const sendDraft = async () => {
    setBusy(true);
    setError(null);
    try {
      await callFunction('send-envelope', { envelopeId: id });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sending failed.');
    }
    setBusy(false);
  };

  const deleteDraft = async () => {
    if (!env || !confirm('Delete this draft?')) return;
    await supabase!.storage.from(BUCKET).remove([env.original_path]);
    const { error } = await supabase!.from('envelopes').delete().eq('id', id);
    if (error) setError(error.message);
    else navigate('/documents');
  };

  if (!env) {
    return <Shell signedIn>{error ? <p className="error-text">{error}</p> : 'Loading…'}</Shell>;
  }

  const fileBase = env.title.replace(/[^\w\- ]+/g, '').trim() || 'document';

  return (
    <Shell signedIn>
      <p>
        <a href="#/documents">← My documents</a>
      </p>
      <div className="page-head">
        <h1>{env.title}</h1>
        <span className={`badge badge-${env.status}`}>{statusLabel(env.status)}</span>
      </div>
      {error && <p className="error-text">{error}</p>}

      <div className="row">
        {env.final_path && (
          <button className="primary" onClick={() => download(env.final_path!, `${fileBase} (signed).pdf`)}>
            Download signed PDF
          </button>
        )}
        <button onClick={() => download(env.original_path, `${fileBase}.pdf`)}>Download original</button>
        {env.status === 'draft' && (
          <>
            <button className="primary" disabled={busy} onClick={sendDraft}>
              {busy ? 'Sending…' : 'Send now'}
            </button>
            <button onClick={deleteDraft}>Delete draft</button>
          </>
        )}
        <button onClick={load}>Refresh</button>
      </div>

      <h2>Signers</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Signer</th>
            <th>Status</th>
            <th>Signed</th>
          </tr>
        </thead>
        <tbody>
          {recipients.map((r) => (
            <tr key={r.id}>
              <td>
                {r.name}
                <div className="muted">{r.email}</div>
              </td>
              <td>
                {statusLabel(r.status)}
                {r.declined_reason && <div className="muted">“{r.declined_reason}”</div>}
              </td>
              <td>{formatDate(r.signed_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Audit trail</h2>
      {events.length === 0 ? (
        <p className="muted">Nothing yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>What</th>
              <th>Who</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td>{formatDate(e.created_at)}</td>
                <td>{e.event}</td>
                <td>{e.actor_email}</td>
                <td className="muted">{e.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(env.original_sha256 || env.final_sha256) && (
        <div className="hashes muted">
          {env.original_sha256 && <div>Original SHA-256: {env.original_sha256}</div>}
          {env.final_sha256 && <div>Signed PDF SHA-256: {env.final_sha256}</div>}
        </div>
      )}
    </Shell>
  );
}
