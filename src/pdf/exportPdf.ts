import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import type { Field } from '../types';

const INK = rgb(0.05, 0.1, 0.35);

function dataUrlBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Maps a field's top-left fractional box on the *displayed* page (which
 * pdf.js shows with /Rotate applied) to an unrotated PDF-space rectangle.
 */
export function toPdfRect(
  f: Pick<Field, 'x' | 'y' | 'w' | 'h'>,
  box: { x: number; y: number; width: number; height: number },
  rotation: number,
) {
  const r = ((rotation % 360) + 360) % 360;
  const { x: bx, y: by, width: W, height: H } = box;
  switch (r) {
    case 90: // displayed width spans the page height
      return { x: bx + f.y * W, y: by + f.x * H, width: f.h * W, height: f.w * H };
    case 180:
      return { x: bx + (1 - f.x - f.w) * W, y: by + f.y * H, width: f.w * W, height: f.h * H };
    case 270:
      return { x: bx + (1 - f.y - f.h) * W, y: by + (1 - f.x - f.w) * H, width: f.h * W, height: f.w * H };
    default:
      return { x: bx + f.x * W, y: by + (1 - f.y - f.h) * H, width: f.w * W, height: f.h * H };
  }
}

/** Stamps the fields onto the original PDF and returns the new file's bytes. */
export async function exportSignedPdf(original: Uint8Array, fields: Field[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(original, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const images = new Map<string, Awaited<ReturnType<typeof doc.embedPng>>>();

  for (const f of fields) {
    const page = pages[f.page];
    if (!page || !f.value) continue;
    const rotation = page.getRotation().angle;
    const rect = toPdfRect(f, page.getCropBox(), rotation);
    // Content is drawn upright relative to how the page is displayed.
    const rot = degrees(((rotation % 360) + 360) % 360);
    const upright = rotation % 180 === 0;
    const boxW = upright ? rect.width : rect.height;
    const boxH = upright ? rect.height : rect.width;
    const origin = uprightOrigin(rect, rotation);

    if (f.kind === 'signature' || f.kind === 'initials') {
      let img = images.get(f.value);
      if (!img) {
        img = await doc.embedPng(dataUrlBytes(f.value));
        images.set(f.value, img);
      }
      const scale = Math.min(boxW / img.width, boxH / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      const p = offset(origin, (boxW - w) / 2, (boxH - h) / 2, rotation);
      page.drawImage(img, { x: p.x, y: p.y, width: w, height: h, rotate: rot });
    } else {
      let size = boxH * 0.7;
      const textW = font.widthOfTextAtSize(f.value, size);
      if (textW > boxW) size *= boxW / textW;
      const p = offset(origin, 1, (boxH - size) / 2 + size * 0.22, rotation);
      page.drawText(f.value, { x: p.x, y: p.y, size, font, color: INK, rotate: rot });
    }
  }
  return doc.save();
}

/** The PDF-space point that is the bottom-left corner of the box as displayed. */
function uprightOrigin(rect: { x: number; y: number; width: number; height: number }, rotation: number) {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { x: rect.x + rect.width, y: rect.y };
    case 180:
      return { x: rect.x + rect.width, y: rect.y + rect.height };
    case 270:
      return { x: rect.x, y: rect.y + rect.height };
    default:
      return { x: rect.x, y: rect.y };
  }
}

/** Moves (dx right, dy up) in display space, expressed in PDF space. */
function offset(o: { x: number; y: number }, dx: number, dy: number, rotation: number) {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { x: o.x - dy, y: o.y + dx };
    case 180:
      return { x: o.x - dx, y: o.y - dy };
    case 270:
      return { x: o.x + dy, y: o.y - dx };
    default:
      return { x: o.x + dx, y: o.y + dy };
  }
}
