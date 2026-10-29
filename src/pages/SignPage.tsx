import { useEffect, useRef, useState } from 'react';
import { PdfPage } from '../components/PdfPage';
import { SignaturePad } from '../components/SignaturePad';
import { fitScale, loadPdf, type LoadedPdf } from '../pdf/loadPdf';
import { callFunction, supabase } from '../lib/supabase';
import { loadMark, saveMark, type MarkKind } from '../storage';
import type { Field } from '@shared/types.ts';

interface SignerField extends Field {
  mine: boolean;
  required: boolean;
}

interface Session {
  envelope: { id: string; title: string; message: string | null; status: string };
  sender: { name: string; email: string };
  recipient: { name: string; email: string; status: string };
  pdfUrl: string;
  fields: SignerField[];
}

const today = () => new Date().toLocaleDateString();

export function SignPage({ token }: { token: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [fields, setFields] = useState<SignerField[]>([]);
  const [consent, setConsent] = useState(false);
  const [padFor, setPadFor] = useState<MarkKind | null>(null);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<'signed' | 'declined' | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await callFunction<Session>('signing', { token, action: 'load' });
        setSession(s);
        setFields(s.fields.map((f) => ({ ...f, value: f.mine ? (f.kind === 'date' ? today() : '') : f.value ?? '' })));
        if (s.envelope.status === 'sent' && ['sent', 'viewed'].includes(s.recipient.status)) {
          const bytes = new Uint8Array(await (await fetch(s.pdfUrl)).arrayBuffer());
          const loaded = await loadPdf(bytes);
          setPdf(loaded);
          requestAnimationFrame(() => setScale(fitScale(loaded.sizes, viewerRef.current?.clientWidth ?? window.innerWidth)));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'This link could not be opened.');
      }
    })();
  }, [token]);

  const mine = fields.filter((f) => f.mine);
  const remaining = mine.filter((f) => f.required && !f.value.trim());

  const applyMark = (kind: MarkKind, url: string) => {
    saveMark(kind, url);
    setFields((all) => all.map((f) => (f.mine && f.kind === kind ? { ...f, value: url } : f)));
    setPadFor(null);
  };

  const activate = (f: Field) => {
    const field = f as SignerField;
    if (!field.mine || (field.kind !== 'signature' && field.kind !== 'initials')) return;
    const saved = loadMark(field.kind);
    // First tap reuses a signature saved on this device; tapping again lets them redo it.
    if (saved && !field.value) applyMark(field.kind, saved);
    else setPadFor(field.kind);
  };

  const scrollToNext = () => {
    const next = remaining[0];
    if (!next) return;
    const pages = viewerRef.current?.querySelectorAll('.page');
    (pages?.[next.page] as HTMLElement | undefined)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const finish = async () => {
    if (!consent) return setError('Please tick the box to agree to sign electronically.');
    if (remaining.length) {
      setError(`Please complete ${remaining.length} more field${remaining.length === 1 ? '' : 's'}.`);
      scrollToNext();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const values = Object.fromEntries(mine.filter((f) => f.value.trim()).map((f) => [f.id, f.value]));
      await callFunction('signing', { token, action: 'sign', consent: true, values });
      setDone('signed');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Signing failed. Please try again.');
    }
    setBusy(false);
  };

  const decline = async () => {
    const reason = prompt('Why are you declining? (optional, shared with the sender)');
    if (reason === null) return;
    setBusy(true);
    try {
      await callFunction('signing', { token, action: 'decline', reason });
      setDone('declined');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
    setBusy(false);
  };

  if (!supabase) return <Notice title="Signing isn't set up on this server yet." />;
  if (done === 'signed') {
    return (
      <Notice title="Thanks, you've signed.">
        You'll get the completed document by email once everyone has signed.
      </Notice>
    );
  }
  if (done === 'declined') return <Notice title="You declined to sign.">We've let the sender know.</Notice>;
  if (error && !session) return <Notice title="We couldn't open this document.">{error}</Notice>;
  if (!session) return <Notice title="Loading…" />;

  const { envelope, sender, recipient } = session;
  if (recipient.status === 'signed') {
    return (
      <Notice title="You've already signed this document.">
        {envelope.status === 'completed'
          ? 'Everyone has signed. The completed copy was emailed to you.'
          : "You'll get the completed copy by email once everyone has signed."}
      </Notice>
    );
  }
  if (envelope.status !== 'sent' || recipient.status === 'declined') {
    return (
      <Notice title="This document is no longer open for signing.">
        Contact {sender.name} if you think this is a mistake.
      </Notice>
    );
  }

  return (
    <div className="app">
      <header className="toolbar">
        <div className="group">
          <strong className="brand">MyPDF</strong>
          <span>{envelope.title}</span>
        </div>
        <div className="group push-right">
          <button aria-label="Zoom out" onClick={() => setScale((s) => Math.max(0.3, s / 1.2))}>−</button>
          <button aria-label="Zoom in" onClick={() => setScale((s) => Math.min(4, s * 1.2))}>+</button>
          <button disabled={busy} onClick={decline}>Decline</button>
          <button className="primary" disabled={busy} onClick={finish}>
            {busy ? 'Signing…' : 'Finish'}
          </button>
        </div>
      </header>
      <div className="consent">
        <p>
          <strong>{sender.name}</strong> ({sender.email}) asked you, {recipient.name}, to sign this document.
          {envelope.message && <span className="sender-message"> “{envelope.message}”</span>}
        </p>
        <label className="check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          I agree to sign this document electronically, and that my electronic signature is as valid as signing on
          paper.
        </label>
        <p className="muted">
          {remaining.length
            ? `${remaining.length} field${remaining.length === 1 ? '' : 's'} left to fill. Tap the highlighted boxes.`
            : 'All fields are filled. Press Finish to sign.'}{' '}
          {remaining.length > 0 && (
            <button className="link" onClick={scrollToNext}>
              Go to next
            </button>
          )}
        </p>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <main ref={viewerRef} className="viewer">
        {pdf?.sizes.map((size, i) => (
          <PdfPage
            key={i}
            doc={pdf.doc}
            index={i}
            size={size}
            scale={scale}
            fields={fields.filter((f) => f.page === i)}
            selectedId={null}
            placing={false}
            onPlace={() => undefined}
            onChange={(f) => setFields((all) => all.map((x) => (x.id === f.id ? { ...x, value: f.value } : x)))}
            onSelect={() => undefined}
            onDelete={() => undefined}
            movable={() => false}
            typable={(f) => (f as SignerField).mine}
            onActivate={activate}
            look={(f) => {
              const sf = f as SignerField;
              if (!sf.mine) return {};
              const label = { signature: 'Tap to sign', initials: 'Initial', date: 'Date', text: 'Type here' }[sf.kind];
              return { label: sf.required ? label : `${label} (optional)`, attention: sf.required && !sf.value.trim() };
            }}
          />
        ))}
      </main>
      {padFor && (
        <SignaturePad
          title={padFor === 'signature' ? 'Your signature' : 'Your initials'}
          compact={padFor === 'initials'}
          onSave={(url) => applyMark(padFor, url)}
          onCancel={() => setPadFor(null)}
        />
      )}
    </div>
  );
}

function Notice({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="app">
      <header className="toolbar">
        <strong className="brand">MyPDF</strong>
      </header>
      <main className="content">
        <div className="card narrow">
          <h1>{title}</h1>
          {children && <p>{children}</p>}
        </div>
      </main>
    </div>
  );
}
