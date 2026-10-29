import { openPdf, type PDFDocumentProxy } from './pdfjs';
import type { PageSize } from '@shared/types.ts';

export interface LoadedPdf {
  doc: PDFDocumentProxy;
  sizes: PageSize[];
}

/** Opens a PDF and measures each page as displayed (rotation applied). */
export async function loadPdf(bytes: Uint8Array): Promise<LoadedPdf> {
  const doc = await openPdf(bytes);
  const sizes: PageSize[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const vp = (await doc.getPage(i)).getViewport({ scale: 1 });
    sizes.push({ width: vp.width, height: vp.height });
  }
  return { doc, sizes };
}

/** A zoom that fits the widest page into the given width. */
export function fitScale(sizes: PageSize[], available: number): number {
  const widest = Math.max(...sizes.map((s) => s.width));
  return Math.min(1.5, Math.max(0.3, (available - 32) / widest));
}
