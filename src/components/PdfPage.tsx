import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from '../pdf/pdfjs';
import type { Field, PageSize } from '../types';

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
}

const MIN = 0.01;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function PdfPage({ doc, index, size, scale, fields, selectedId, placing, onPlace, onChange, onSelect, onDelete }: Props) {
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
      {fields.map((f) => (
        <div
          key={f.id}
          className={`field field-${f.kind} ${f.id === selectedId ? 'selected' : ''}`}
          style={{ left: f.x * width, top: f.y * height, width: f.w * width, height: f.h * height }}
          onPointerDown={(e) => startDrag(e, f, 'move')}
        >
          {f.kind === 'signature' || f.kind === 'initials' ? (
            <img src={f.value} alt={f.kind} draggable={false} />
          ) : (
            <input
              value={f.value}
              autoFocus={f.id === selectedId && f.kind === 'text' && !f.value}
              style={{ fontSize: f.h * height * 0.7 }}
              onPointerDown={(e) => {
                e.stopPropagation();
                onSelect(f.id);
              }}
              onChange={(e) => onChange({ ...f, value: e.target.value })}
            />
          )}
          {f.id === selectedId && (
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
      ))}
    </div>
  );
}
