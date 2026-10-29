import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { allSigned, currentRound, toNotify, type RoutedRecipient } from './routing.ts';
import { randomToken, sha256Hex } from './crypto.ts';
import { appendCertificate, winAnsiSafe } from './certificate.ts';
import { escapeHtml, signRequestEmail } from './email.ts';

const r = (id: string, routing_order: number, status: RoutedRecipient['status']): RoutedRecipient => ({ id, routing_order, status });

describe('routing', () => {
  it('notifies everyone at once when they share an order', () => {
    expect(toNotify([r('a', 1, 'pending'), r('b', 1, 'pending')]).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('waits for the earlier round before notifying the next', () => {
    const list = [r('a', 1, 'viewed'), r('b', 2, 'pending')];
    expect(toNotify(list)).toEqual([]);
    expect(currentRound(list).map((x) => x.id)).toEqual(['a']);
    expect(toNotify([r('a', 1, 'signed'), r('b', 2, 'pending')]).map((x) => x.id)).toEqual(['b']);
  });

  it('is complete only when everyone has signed', () => {
    expect(allSigned([r('a', 1, 'signed'), r('b', 2, 'signed')])).toBe(true);
    expect(allSigned([r('a', 1, 'signed'), r('b', 2, 'viewed')])).toBe(false);
    expect(allSigned([])).toBe(false);
  });
});

describe('crypto', () => {
  it('hashes known input', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('makes long, URL-safe, unique tokens', () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(a);
  });
});

describe('certificate', () => {
  it('appends pages without throwing on long or non-Latin text', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    await appendCertificate(doc, {
      envelopeId: 'e1',
      title: 'Lease — Māori names 😀',
      senderName: 'Paul',
      senderEmail: 'paul@example.com',
      originalSha256: 'a'.repeat(64),
      sentAt: '2026-10-29 01:00:00 UTC',
      completedAt: '2026-10-29 02:00:00 UTC',
      signers: [
        { name: 'Ana', email: 'ana@example.com', consentedAt: 'x', signedAt: 'y', ip: '1.2.3.4', userAgent: 'Mozilla/5.0 '.repeat(30) },
      ],
      events: Array.from({ length: 80 }, (_, i) => ({ at: 't', event: `event ${i}`, who: 'ana@example.com', ip: '1.2.3.4' })),
    });
    expect(doc.getPageCount()).toBeGreaterThan(2);
    expect(winAnsiSafe('Māori 😀')).toBe('M?ori ??');
  });
});

describe('email', () => {
  it('escapes user text in the HTML', () => {
    const e = signRequestEmail({
      to: 'a@b.co',
      signerName: '<script>',
      senderName: 'Paul & Co',
      title: '"Lease"',
      message: 'hi\nthere',
      link: 'https://x/#/sign/abc',
    });
    expect(e.html).not.toContain('<script>');
    expect(e.html).toContain('Paul &amp; Co');
    expect(e.html).toContain('hi<br>there');
    expect(escapeHtml(`'`)).toBe('&#39;');
  });
});
