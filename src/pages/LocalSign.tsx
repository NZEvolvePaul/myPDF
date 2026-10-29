import { useCallback, useEffect, useRef, useState } from 'react';
import { openPdf, type PDFDocumentProxy } from '../pdf/pdfjs';
import { stampFields } from '@shared/stamp.ts';
import { PdfPage } from '../components/PdfPage';
import { SignaturePad } from '../components/SignaturePad';
import { loadMark, saveMark, type MarkKind } from '../storage';
import type { Field, FieldKind, PageSize } from '@shared/types.ts';

// Default field sizes in PDF points.
const DEFAULT_SIZE: Record<FieldKind, { w: number; h: number }> = {
  signature: { w: 170, h: 48 },
  initials: { w: 60, h: 36 },
  date: { w: 90, h: 18 },
  text: { w: 160, h: 18 },
};

const TOOLS: { kind: FieldKind; label: string }[] = [
  { kind: 'signature', label: 'Signature' },
  { kind: 'initials', label: 'Initials' },
  { kind: 'date', label: 'Date' },
  { kind: 'text', label: 'Text' },
];

const today = () => new Date().toLocaleDateString();
const newId = () => Math.random().toString(36).slice(2, 10);

export function LocalSign() {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState('document.pdf');
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [scale, setScale] = useState(1);
  const [fields, setFields] = useState<Field[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<FieldKind | null>(null);
  const [marks, setMarks] = useState<Record<MarkKind, string | null>>({
    signature: loadMark('signature'),
    initials: loadMark('initials'),
  });
  const [editing, setEditing] = useState<MarkKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const viewerRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const fitWidth = useCallback((pageSizes: PageSize[]) => {
    const avail = (viewerRef.current?.clientWidth ?? window.innerWidth) - 32;
    const widest = Math.max(...pageSizes.map((s) => s.width));
    setScale(Math.min(1.5, Math.max(0.3, avail / widest)));
  }, []);

  const loadFile = useCallback(
    async (file: File) => {
      setError(null);
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        const pdf = await openPdf(data);
        const pageSizes: PageSize[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const vp = (await pdf.getPage(i)).getViewport({ scale: 1 });
          pageSizes.push({ width: vp.width, height: vp.height });
        }
        doc?.destroy();
        setBytes(data);
        setFileName(file.name);
        setDoc(pdf);
        setSizes(pageSizes);
        setFields([]);
        setSelectedId(null);
        fitWidth(pageSizes);
        viewerRef.current?.scrollTo(0, 0);
      } catch (e) {
        console.error(e);
        setError(`Couldn't open "${file.name}". Is it a PDF? Password-protected files aren't supported yet.`);
      }
    },
    [doc, fitWidth],
  );

  // Installed app: open PDFs handed over by the operating system.
  useEffect(() => {
    const lq = (window as unknown as { launchQueue?: { setConsumer: (cb: (p: { files: FileSystemFileHandle[] }) => void) => void } }).launchQueue;
    lq?.setConsumer(async ({ files }) => {
      if (files[0]) loadFile(await files[0].getFile());
    });
  }, [loadFile]);

  const updateField = (f: Field) => setFields((all) => all.map((x) => (x.id === f.id ? f : x)));
  const deleteField = (id: string) => {
    setFields((all) => all.filter((x) => x.id !== id));
    setSelectedId(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) deleteField(selectedId);
      if (e.key === 'Escape') {
        setTool(null);
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId]);

  const chooseTool = (kind: FieldKind) => {
    if ((kind === 'signature' || kind === 'initials') && !marks[kind]) {
      setEditing(kind);
    }
    setTool((t) => (t === kind ? null : kind));
  };

  const place = (page: number, cx: number, cy: number) => {
    if (!tool) return;
    const value = tool === 'date' ? today() : tool === 'text' ? '' : marks[tool];
    if (value === null) {
      setEditing(tool as MarkKind);
      return;
    }
    const size = sizes[page];
    const w = DEFAULT_SIZE[tool].w / size.width;
    const h = DEFAULT_SIZE[tool].h / size.height;
    const field: Field = {
      id: newId(),
      kind: tool,
      page,
      w,
      h,
      x: Math.min(Math.max(0, cx - w / 2), 1 - w),
      y: Math.min(Math.max(0, cy - h / 2), 1 - h),
      value,
    };
    setFields((all) => [...all, field]);
    setSelectedId(field.id);
    // Keep the tool armed for repeated initials; one-offs return to select mode.
    if (tool !== 'initials') setTool(null);
  };

  const saveNewMark = (kind: MarkKind, url: string) => {
    saveMark(kind, url);
    setMarks((m) => ({ ...m, [kind]: url }));
    // Refresh any of this kind already placed.
    setFields((all) => all.map((f) => (f.kind === kind ? { ...f, value: url } : f)));
    setEditing(null);
  };

  const download = async () => {
    if (!bytes) return;
    setBusy(true);
    try {
      const out = await stampFields(bytes, fields);
      const blob = new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
      const name = fileName.replace(/\.pdf$/i, '') + '-signed.pdf';
      const file = new File([blob], name, { type: 'application/pdf' });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      const isTouch = window.matchMedia('(pointer: coarse)').matches;
      if (isTouch && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: name }).catch(() => undefined);
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    } catch (e) {
      console.error(e);
      setError("Couldn't save the signed PDF. Some encrypted or damaged PDFs can't be edited.");
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  };

  return (
    <div
      className={`app ${dragOver ? 'drag-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <header className="toolbar">
        <div className="group">
          <a className="brand" href="#/">MyPDF</a>
          <button onClick={() => fileInput.current?.click()}>Open</button>
          <a className="button" href="#/documents">Send for signature</a>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) loadFile(f);
              e.target.value = '';
            }}
          />
        </div>

        {doc && (
          <>
            <div className="group tools" role="toolbar" aria-label="Add to page">
              {TOOLS.map((t) => (
                <button key={t.kind} className={tool === t.kind ? 'active' : ''} onClick={() => chooseTool(t.kind)}>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="group">
              <button aria-label="Zoom out" onClick={() => setScale((s) => Math.max(0.3, s / 1.2))}>−</button>
              <span className="zoom">{Math.round(scale * 100)}%</span>
              <button aria-label="Zoom in" onClick={() => setScale((s) => Math.min(4, s * 1.2))}>+</button>
              <button onClick={() => fitWidth(sizes)}>Fit</button>
            </div>
            <div className="group">
              <button onClick={() => setEditing('signature')}>My signature</button>
              <button onClick={() => setEditing('initials')}>My initials</button>
              <button className="primary" disabled={busy} onClick={download}>
                {busy ? 'Saving…' : 'Download'}
              </button>
            </div>
          </>
        )}
      </header>

      {tool && (
        <div className="hint">
          Tap the page to place {tool === 'initials' ? 'initials (stays on for more pages)' : `the ${tool}`}.{' '}
          <button className="link" onClick={() => setTool(null)}>Done</button>
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          {error} <button className="link" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <main ref={viewerRef} className="viewer">
        {!doc && (
          <div className="empty">
            <h1>Open a PDF to read, sign or initial it</h1>
            <p>Drop a file here, or</p>
            <button className="primary big" onClick={() => fileInput.current?.click()}>
              Choose a PDF
            </button>
            <p className="muted">Your files stay on this device.</p>
          </div>
        )}
        {doc &&
          sizes.map((size, i) => (
            <PdfPage
              key={`${fileName}-${i}`}
              doc={doc}
              index={i}
              size={size}
              scale={scale}
              fields={fields.filter((f) => f.page === i)}
              selectedId={selectedId}
              placing={tool !== null}
              onPlace={place}
              onChange={updateField}
              onSelect={setSelectedId}
              onDelete={deleteField}
            />
          ))}
      </main>

      {editing && (
        <SignaturePad
          title={editing === 'signature' ? 'Create your signature' : 'Create your initials'}
          compact={editing === 'initials'}
          onSave={(url) => saveNewMark(editing, url)}
          onCancel={() => {
            if (!marks[editing] && tool === editing) setTool(null);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
