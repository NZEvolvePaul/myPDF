import { describe, expect, it } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import { exportSignedPdf, toPdfRect } from './exportPdf';

const box = { x: 0, y: 0, width: 600, height: 800 };
const f = { x: 0.1, y: 0.2, w: 0.3, h: 0.05 };
const round = (r: Record<string, number>) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v * 1000) / 1000]));

describe('toPdfRect', () => {
  it('flips the y axis for unrotated pages', () => {
    expect(round(toPdfRect(f, box, 0))).toEqual({ x: 60, y: 600, width: 180, height: 40 });
  });

  it('honours a crop box offset', () => {
    const r = toPdfRect(f, { ...box, x: 10, y: 20 }, 0);
    expect(r.x).toBe(70);
    expect(r.y).toBe(620);
  });

  it('maps displayed boxes on rotated pages back into page space', () => {
    // At 90 degrees the displayed width runs along the page's height.
    expect(round(toPdfRect(f, box, 90))).toEqual({ x: 120, y: 80, width: 30, height: 240 });
    expect(round(toPdfRect(f, box, 180))).toEqual({ x: 360, y: 160, width: 180, height: 40 });
    expect(round(toPdfRect(f, box, 270))).toEqual({ x: 450, y: 480, width: 30, height: 240 });
  });
});

describe('exportSignedPdf', () => {
  it('writes text and keeps the page count', async () => {
    const src = await PDFDocument.create();
    src.addPage([600, 800]);
    src.addPage([600, 800]).setRotation(degrees(90));
    const bytes = await src.save();

    const out = await exportSignedPdf(bytes, [
      { id: 'a', kind: 'text', page: 0, ...f, value: 'Paul' },
      { id: 'b', kind: 'date', page: 1, ...f, value: '2026-10-29' },
    ]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(2);
    expect(out.length).toBeGreaterThan(bytes.length);
  });
});
