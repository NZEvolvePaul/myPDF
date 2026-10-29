import { useRef, useState } from 'react';
import { PdfPage } from '../components/PdfPage';
import { Shell } from '../components/Shell';
import { fitScale, loadPdf, type LoadedPdf } from '../pdf/loadPdf';
import { BUCKET, callFunction, supabase } from '../lib/supabase';
import { navigate } from '../lib/router';
import { signerColor } from '../lib/colors';
import type { Field, FieldKind } from '@shared/types.ts';

interface Signer {
  id: string;
  name: string;
  email: string;
}

// Default field sizes in PDF points.
const DEFAULT_SIZE: Record<FieldKind, { w: number; h: number }> = {
  signature: { w: 170, h: 48 },
  initials: { w: 60, h: 36 },
  date: { w: 90, h: 18 },
  text: { w: 160, h: 18 },
};
const KIND_LABEL: Record<FieldKind, string> = { signature: 'Signature', initials: 'Initials', date: 'Date', text: 'Text' };

const newSigner = (): Signer => ({ id: crypto.randomUUID(), name: '', email: '' });

export function NewDocument() {
  const [step, setStep] = useState<'setup' | 'place'>('setup');
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [inOrder, setInOrder] = useState(false);
  const [signers, setSigners] = useState<Signer[]>([newSigner()]);
  const [fields, setFields] = useState<Field[]>([]);
  const [activeSigner, setActiveSigner] = useState(0);
  const [tool, setTool] = useState<FieldKind | null>('signature');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const viewerRef = useRef<HTMLDivElement>(null);

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const loaded = await loadPdf(data);
      pdf?.doc.destroy();
      setBytes(data);
      setPdf(loaded);
      setFields([]);
      if (!title) setTitle(file.name.replace(/\.pdf$/i, ''));
    } catch {
      setError(`Couldn't open "${file.name}". Is it a PDF?`);
    }
  };

  const updateSigner = (i: number, patch: Partial<Signer>) =>
    setSigners((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const removeSigner = (i: number) => {
    const id = signers[i].id;
    setSigners((all) => all.filter((_, j) => j !== i));
    setFields((all) => all.filter((f) => f.recipientId !== id));
  };

  const validSigners = signers.every((s) => s.name.trim() && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.email.trim()));
  const emails = signers.map((s) => s.email.trim().toLowerCase());
  const duplicate = emails.some((e, i) => e && emails.indexOf(e) !== i);

  const goPlace = () => {
    if (!pdf) return setError('Choose a PDF first.');
    if (!title.trim()) return setError('Give the document a title.');
    if (!validSigners) return setError("Enter each signer's name and a valid email.");
    if (duplicate) return setError('Each signer needs a different email address.');
    setError(null);
    setStep('place');
    setActiveSigner(0);
    requestAnimationFrame(() => setScale(fitScale(pdf.sizes, viewerRef.current?.clientWidth ?? window.innerWidth)));
  };

  const place = (page: number, cx: number, cy: number) => {
    if (!tool || !pdf) return;
    const size = pdf.sizes[page];
    const w = DEFAULT_SIZE[tool].w / size.width;
    const h = DEFAULT_SIZE[tool].h / size.height;
    const field: Field = {
      id: crypto.randomUUID(),
      kind: tool,
      page,
      w,
      h,
      x: Math.min(Math.max(0, cx - w / 2), 1 - w),
      y: Math.min(Math.max(0, cy - h / 2), 1 - h),
      value: '',
      recipientId: signers[activeSigner].id,
    };
    setFields((all) => [...all, field]);
    setSelectedId(field.id);
  };

  const missingSignature = signers.filter((s) => !fields.some((f) => f.recipientId === s.id && f.kind === 'signature'));

  const send = async () => {
    if (!bytes || !supabase) return;
    if (missingSignature.length) {
      setError(`Place a signature field for ${missingSignature.map((s) => s.name).join(', ')}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user!.id;
      const envelopeId = crypto.randomUUID();
      const path = `${uid}/${envelopeId}/original.pdf`;

      const up = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: 'application/pdf' });
      if (up.error) throw up.error;
      const env = await supabase
        .from('envelopes')
        .insert({ id: envelopeId, title: title.trim(), message: message.trim() || null, original_path: path });
      if (env.error) throw env.error;
      const rec = await supabase.from('recipients').insert(
        signers.map((s, i) => ({
          id: s.id,
          envelope_id: envelopeId,
          name: s.name.trim(),
          email: s.email.trim(),
          routing_order: inOrder ? i + 1 : 1,
        })),
      );
      if (rec.error) throw rec.error;
      const fl = await supabase.from('fields').insert(
        fields.map((f) => ({
          id: f.id,
          envelope_id: envelopeId,
          recipient_id: f.recipientId,
          kind: f.kind,
          page: f.page,
          x: f.x,
          y: f.y,
          w: f.w,
          h: f.h,
          required: f.kind !== 'text',
        })),
      );
      if (fl.error) throw fl.error;

      await callFunction('send-envelope', { envelopeId });
      navigate(`/documents/${envelopeId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sending failed.');
      setBusy(false);
    }
  };

  if (step === 'setup') {
    return (
      <Shell signedIn>
        <h1>New document to sign</h1>
        <div className="card form">
          <label>
            PDF
            <input type="file" accept="application/pdf,.pdf" onChange={(e) => pickFile(e.target.files?.[0])} />
          </label>
          {pdf && <p className="muted">{pdf.sizes.length} page{pdf.sizes.length === 1 ? '' : 's'}</p>}
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </label>
          <label>
            Message to signers (optional)
            <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} />
          </label>

          <h2>Signers</h2>
          {signers.map((s, i) => (
            <div className="signer-row" key={s.id}>
              <span className="dot" style={{ background: signerColor(i) }} aria-hidden />
              {inOrder && <span className="order">{i + 1}</span>}
              <input placeholder="Name" aria-label="Signer name" value={s.name} onChange={(e) => updateSigner(i, { name: e.target.value })} />
              <input
                placeholder="Email"
                aria-label="Signer email"
                type="email"
                value={s.email}
                onChange={(e) => updateSigner(i, { email: e.target.value })}
              />
              {signers.length > 1 && (
                <button className="link" onClick={() => removeSigner(i)} aria-label={`Remove signer ${i + 1}`}>
                  Remove
                </button>
              )}
            </div>
          ))}
          <div className="row">
            <button onClick={() => setSigners((all) => [...all, newSigner()])}>Add signer</button>
            {signers.length > 1 && (
              <label className="check">
                <input type="checkbox" checked={inOrder} onChange={(e) => setInOrder(e.target.checked)} />
                Sign in this order (each signer is emailed after the previous one signs)
              </label>
            )}
          </div>

          {error && <p className="error-text">{error}</p>}
          <div className="row end">
            <a className="button" href="#/documents">Cancel</a>
            <button className="primary" onClick={goPlace}>
              Next: place fields
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <div className="app">
      <header className="toolbar">
        <div className="group">
          <button onClick={() => setStep('setup')}>Back</button>
          <strong>{title}</strong>
        </div>
        <div className="group" role="radiogroup" aria-label="Placing fields for">
          {signers.map((s, i) => (
            <button
              key={s.id}
              className={`signer-chip ${i === activeSigner ? 'active' : ''}`}
              style={{ borderColor: signerColor(i), ...(i === activeSigner ? { background: signerColor(i) } : {}) }}
              onClick={() => setActiveSigner(i)}
              aria-pressed={i === activeSigner}
            >
              {s.name}
            </button>
          ))}
        </div>
        <div className="group tools" role="toolbar" aria-label="Add field">
          {(Object.keys(KIND_LABEL) as FieldKind[]).map((k) => (
            <button key={k} className={tool === k ? 'active' : ''} onClick={() => setTool(tool === k ? null : k)}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <div className="group">
          <button aria-label="Zoom out" onClick={() => setScale((s) => Math.max(0.3, s / 1.2))}>−</button>
          <button aria-label="Zoom in" onClick={() => setScale((s) => Math.min(4, s * 1.2))}>+</button>
          <button className="primary" disabled={busy} onClick={send}>
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </header>
      <div className="hint">
        {tool
          ? `Tap the page to add a ${KIND_LABEL[tool].toLowerCase()} field for ${signers[activeSigner].name}.`
          : 'Pick a field type above, then tap the page.'}{' '}
        Drag to move, use the corner to resize.
        {missingSignature.length > 0 && ` Still needs a signature field: ${missingSignature.map((s) => s.name).join(', ')}.`}
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
            selectedId={selectedId}
            placing={tool !== null}
            onPlace={place}
            onChange={(f) => setFields((all) => all.map((x) => (x.id === f.id ? f : x)))}
            onSelect={setSelectedId}
            onDelete={(id) => setFields((all) => all.filter((x) => x.id !== id))}
            typable={() => false}
            look={(f) => {
              const idx = signers.findIndex((s) => s.id === f.recipientId);
              return { color: signerColor(idx), label: `${KIND_LABEL[f.kind]} · ${signers[idx]?.name ?? ''}` };
            }}
          />
        ))}
      </main>
    </div>
  );
}
