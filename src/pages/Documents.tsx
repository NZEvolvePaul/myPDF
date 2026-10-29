import { useEffect, useState } from 'react';
import { supabase, type EnvelopeSummary } from '../lib/supabase';
import { Shell, formatDate, statusLabel } from '../components/Shell';

type Row = EnvelopeSummary & { recipients: { status: string }[] };

export function Documents() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase!
      .from('envelopes')
      .select('id, title, status, created_at, sent_at, completed_at, recipients(status)')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setRows(data as unknown as Row[]);
      });
  }, []);

  return (
    <Shell signedIn>
      <div className="page-head">
        <h1>My documents</h1>
        <a className="button primary" href="#/documents/new">New document to sign</a>
      </div>
      {error && <p className="error-text">{error}</p>}
      {rows && rows.length === 0 && <p className="muted">Nothing sent yet. Upload a PDF, add signers and send it.</p>}
      {rows && rows.length > 0 && (
        <ul className="doc-list">
          {rows.map((r) => {
            const signed = r.recipients.filter((x) => x.status === 'signed').length;
            return (
              <li key={r.id}>
                <a href={`#/documents/${r.id}`}>
                  <span className="doc-title">{r.title}</span>
                  <span className={`badge badge-${r.status}`}>{statusLabel(r.status)}</span>
                  <span className="muted">
                    {r.status === 'draft' ? `Created ${formatDate(r.created_at)}` : `${signed} of ${r.recipients.length} signed`}
                    {r.completed_at ? ` · ${formatDate(r.completed_at)}` : ''}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </Shell>
  );
}
