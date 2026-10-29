import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export interface CertificateSigner {
  name: string;
  email: string;
  consentedAt: string;
  signedAt: string;
  ip: string;
  userAgent: string;
}

export interface CertificateEvent {
  at: string;
  event: string;
  who: string;
  ip?: string | null;
}

export interface CertificateInfo {
  envelopeId: string;
  title: string;
  senderName: string;
  senderEmail: string;
  originalSha256: string;
  sentAt: string;
  completedAt: string;
  signers: CertificateSigner[];
  events: CertificateEvent[];
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 50;
const GREY = rgb(0.4, 0.42, 0.47);

/** pdf-lib's standard fonts only cover WinAnsi; replace anything else. */
export function winAnsiSafe(s: string): string {
  return s.replace(/[^\x20-\x7E -ÿ]/g, '?');
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const para of winAnsiSafe(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      // Hard-break words longer than a line (hashes, user agents).
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width) {
        let n = rest.length;
        while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > width) n--;
        lines.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

/** Appends a certificate-of-completion section to the end of the document. */
export async function appendCertificate(doc: PDFDocument, info: CertificateInfo): Promise<void> {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const width = A4[0] - MARGIN * 2;
  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - MARGIN;

  const ensure = (needed: number) => {
    if (y - needed < MARGIN) {
      page = doc.addPage(A4);
      y = A4[1] - MARGIN;
    }
  };
  const text = (s: string, opts: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; indent?: number } = {}) => {
    const size = opts.size ?? 10;
    const f = opts.f ?? font;
    for (const line of wrap(s, f, size, width - (opts.indent ?? 0))) {
      ensure(size + 4);
      page.drawText(line, { x: MARGIN + (opts.indent ?? 0), y: y - size, size, font: f, color: opts.color });
      y -= size + 4;
    }
  };
  const gap = (n = 8) => {
    y -= n;
  };

  text('Certificate of Completion', { size: 20, f: bold });
  gap(4);
  text('This page records how this document was signed electronically with MyPDF.', { color: GREY });
  gap(12);

  text('Document', { size: 13, f: bold });
  text(`Title: ${info.title}`);
  text(`Envelope ID: ${info.envelopeId}`);
  text(`Sent by: ${info.senderName} <${info.senderEmail}>`);
  text(`Sent: ${info.sentAt}`);
  text(`Completed: ${info.completedAt}`);
  text(`Original document SHA-256: ${info.originalSha256}`);
  gap(12);

  text('Signers', { size: 13, f: bold });
  for (const s of info.signers) {
    gap(4);
    text(`${s.name} <${s.email}>`, { f: bold });
    text(`Agreed to sign electronically: ${s.consentedAt}`, { indent: 12 });
    text(`Signed: ${s.signedAt}`, { indent: 12 });
    text(`IP address: ${s.ip}`, { indent: 12 });
    text(`Device: ${s.userAgent}`, { indent: 12, size: 8, color: GREY });
  }
  gap(12);

  text('Activity', { size: 13, f: bold });
  for (const e of info.events) {
    text(`${e.at}  ${e.event}  ${e.who}${e.ip ? `  (${e.ip})` : ''}`, { size: 9 });
  }
  gap(12);
  text(
    'Each signer was sent a unique link by email and agreed to use electronic signatures before signing, ' +
      'consistent with Part 4 of the Contract and Commercial Law Act 2017 (New Zealand). ' +
      'The SHA-256 fingerprint of the completed file is kept by the sender and included in the completion email.',
    { size: 8, color: GREY },
  );
}
