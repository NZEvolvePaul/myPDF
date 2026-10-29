import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PDFDocumentProxy = pdfjs.PDFDocumentProxy;
export type PDFPageProxy = pdfjs.PDFPageProxy;

/** Opens a PDF for viewing. pdf.js takes ownership of the buffer, so pass it a copy. */
export function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument({ data: bytes.slice() }).promise;
}
