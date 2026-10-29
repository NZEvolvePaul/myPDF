import { useEffect, useRef, useState } from 'react';

type Mode = 'draw' | 'type' | 'upload';

interface Props {
  title: string;
  /** Initials get a shorter, squarer canvas. */
  compact?: boolean;
  onSave: (pngDataUrl: string) => void;
  onCancel: () => void;
}

const INK = '#0d1a59';
const SCRIPT_FONT = '"Segoe Script", "Brush Script MT", "Snell Roundhand", cursive';

/** Crops transparent margins so the mark fills the box it is placed in. */
function trimCanvas(src: HTMLCanvasElement): string | null {
  const ctx = src.getContext('2d')!;
  const { width, height } = src;
  const data = ctx.getImageData(0, 0, width, height).data;
  let top = height, left = width, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return null;
  const pad = 4;
  left = Math.max(0, left - pad);
  top = Math.max(0, top - pad);
  const w = Math.min(width, right + pad) - left;
  const h = Math.min(height, bottom + pad) - top;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d')!.drawImage(src, left, top, w, h, 0, 0, w, h);
  return out.toDataURL('image/png');
}

export function SignaturePad({ title, compact, onSave, onCancel }: Props) {
  const [mode, setMode] = useState<Mode>('draw');
  const [typed, setTyped] = useState('');
  const [uploaded, setUploaded] = useState<string | null>(null);
  const [hasInk, setHasInk] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);

  const cssW = compact ? 240 : 480;
  const cssH = compact ? 120 : 160;

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = cssW * dpr;
    c.height = cssH * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    setHasInk(false);
  }, [mode, cssW, cssH]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * cssW, y: ((e.clientY - r.top) / r.height) * cssH };
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    last.current = point(e);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!last.current) return;
    const p = point(e);
    const ctx = e.currentTarget.getContext('2d')!;
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    setHasInk(true);
  };
  const up = () => {
    last.current = null;
  };

  const clear = () => {
    const c = canvasRef.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  };

  const renderTyped = (): string | null => {
    if (!typed.trim()) return null;
    const c = document.createElement('canvas');
    const size = 96;
    const ctx = c.getContext('2d')!;
    ctx.font = `${size}px ${SCRIPT_FONT}`;
    c.width = Math.ceil(ctx.measureText(typed).width) + 40;
    c.height = size * 1.6;
    ctx.font = `${size}px ${SCRIPT_FONT}`;
    ctx.fillStyle = INK;
    ctx.textBaseline = 'middle';
    ctx.fillText(typed, 20, c.height / 2);
    return trimCanvas(c);
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // Re-encode as PNG so every upload embeds the same way.
      const c = document.createElement('canvas');
      const scale = Math.min(1, 1200 / img.width);
      c.width = img.width * scale;
      c.height = img.height * scale;
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      setUploaded(trimCanvas(c) ?? c.toDataURL('image/png'));
    };
    img.src = url;
  };

  const save = () => {
    let result: string | null = null;
    if (mode === 'draw' && canvasRef.current) result = trimCanvas(canvasRef.current);
    if (mode === 'type') result = renderTyped();
    if (mode === 'upload') result = uploaded;
    if (result) onSave(result);
  };

  const ready = (mode === 'draw' && hasInk) || (mode === 'type' && typed.trim()) || (mode === 'upload' && uploaded);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <div className="tabs">
          {(['draw', 'type', 'upload'] as Mode[]).map((m) => (
            <button key={m} className={m === mode ? 'active' : ''} onClick={() => setMode(m)}>
              {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>

        {mode === 'draw' && (
          <div className="pad-wrap">
            <canvas
              ref={canvasRef}
              className="pad"
              style={{ width: cssW, height: cssH }}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
            />
            <button className="link" onClick={clear}>Clear</button>
          </div>
        )}

        {mode === 'type' && (
          <div className="pad-wrap">
            <input
              autoFocus
              placeholder={compact ? 'Your initials' : 'Your full name'}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
            <div className="typed-preview" style={{ fontFamily: SCRIPT_FONT, color: INK }}>
              {typed || ' '}
            </div>
          </div>
        )}

        {mode === 'upload' && (
          <div className="pad-wrap">
            <input type="file" accept="image/png,image/jpeg" onChange={(e) => onFile(e.target.files?.[0])} />
            {uploaded && <img className="upload-preview" src={uploaded} alt="Uploaded signature" />}
          </div>
        )}

        <div className="modal-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" disabled={!ready} onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
