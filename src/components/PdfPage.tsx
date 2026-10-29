import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from '../pdf/pdfjs';
import type { Field, PageSize } from '@shared/types.ts';

export interface FieldLook {
  /** Shown inside an empty field, e.g. "Sign here" or a signer's name. */
  label?: string;
  color?: string;
  /** Highlight fields the viewer still has to fill. */
  attention?: boolean;
}

interface Props {
  doc: PDFDocumentProxy;
  index: number;
  size: PageSize;
  scale: number;
  fields: Field[];
  selectedId: string | null;
  placing: boolean;
  onPlace: (page: number, x: number, y: number) => void;
  onChange: (field: Field) => void;
  onSelect: (id: string | null) => void;
  onDelete: (id: string) => void;
  /** Whether a field can be moved, resized and removed. Defaults to all. */
  movable?: (f: Field) => boolean;
  /** Whether a date/text field's value can be typed. Defaults to all. */
  typable?: (f: Field) => boolean;
  /** Clicked a field that isn't movable (e.g. a signer tapping "Sign here"). */
  onActivate?: (f: Field) => void;
  look?: (f: Field) => FieldLook;
}

const MIN = 0.01;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const always = () => true;
const plain = (): FieldLook => ({});

export function PdfPage({
  doc,
  index,
  size,
  scale,
  fields,
  selectedId,
  placing,
  onPlace,
  onChange,
  onSelect,
  onDelete,
  movable = always,
  typable = always,
  onActivate,
  look = plain,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const width = size.width * scale;
  const height = size.height * scale;

  // Only render pages near the viewport so long documents stay fast.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    (async () => {
      const page = await doc.getPage(index + 1);
      if (cancelled) return;
      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: scale * dpr });
      const canvas = canvasRef.current!;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      task = page.render({ canvasContext: canvas.getContext('2d')!, viewport });
      await task.promise.catch(() => undefined);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, index, scale, visible]);

  const handlePageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget && e.target !== canvasRef.current) return;
    if (!placing) {
      onSelect(null);
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    onPlace(index, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  };

  /** Drag to move (handle = 'move') or resize from the bottom-right corner. */
  const startDrag = (e: React.PointerEvent, field: Field, handle: 'move' | 'resize') => {
    if ((e.target as HTMLElement).tagName === 'INPUT' && handle === 'move') return;
    if (!movable(field)) {
      e.stopPropagation();
      onActivate?.(field);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    onSelect(field.id);
    const startX = e.clientX;
    const startY = e.clientY;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / width;
      const dy = (ev.clientY - startY) / height;
      if (handle === 'move') {
        onChange({ ...field, x: clamp(field.x + dx, 0, 1 - field.w), y: clamp(field.y + dy, 0, 1 - field.h) });
      } else {
        onChange({ ...field, w: clamp(field.w + dx, MIN, 1 - field.x), h: clamp(field.h + dy, MIN, 1 - field.y) });
      }
    };
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  return (
    <div
      ref={wrapRef}
      className={`page ${placing ? 'placing' : ''}`}
      style={{ width, height }}
      onClick={handlePageClick}
      aria-label={`Page ${index + 1}`}
    >
      <canvas ref={canvasRef} className="page-canvas" style={{ width, height }} />
      {fields.map((f) => {
        const l = look(f);
        const canMove = movable(f);
        const isImage = f.kind === 'signature' || f.kind === 'initials';
        return (
          <div
            key={f.id}
            className={`field field-${f.kind} ${f.id === selectedId ? 'selected' : ''} ${canMove ? '' : 'fixed'} ${
              l.attention ? 'attention' : ''
            } ${onActivate && !canMove ? 'clickable' : ''}`}
            style={{
              left: f.x * width,
              top: f.y * height,
              width: f.w * width,
              height: f.h * height,
              ...(l.color ? { borderColor: l.color, background: `${l.color}1f` } : {}),
            }}
            onPointerDown={(e) => startDrag(e, f, 'move')}
          >
            {isImage && f.value ? (
              <img src={f.value} alt={f.kind} draggable={false} />
            ) : !isImage && typable(f) ? (
              <input
                value={f.value}
                placeholder={l.label}
                aria-label={l.label ?? f.kind}
                style={{ fontSize: f.h * height * 0.7 }}
                autoFocus={canMove && f.id === selectedId && f.kind === 'text' && !f.value}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSelect(f.id);
                }}
                onChange={(e) => onChange({ ...f, value: e.target.value })}
              />
            ) : f.value ? (
              <span className="field-text-value" style={{ fontSize: f.h * height * 0.7 }}>
                {f.value}
              </span>
            ) : (
              <span className="field-label" style={l.color ? { color: l.color } : undefined}>
                {l.label ?? f.kind}
              </span>
            )}
            {canMove && f.id === selectedId && (
              <>
                <button
                  className="field-delete"
                  aria-label="Remove"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(f.id);
                  }}
                >
                  ×
                </button>
                <span className="field-resize" onPointerDown={(e) => startDrag(e, f, 'resize')} />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
