export interface Attachment {
  filename: string;
  content: string; // base64
}

export interface Email {
  to: string;
  subject: string;
  html: string;
  attachments?: Attachment[];
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function layout(body: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1c2230">
<div style="max-width:560px;margin:0 auto;padding:24px">
<div style="background:#fff;border-radius:12px;padding:24px">${body}</div>
<p style="color:#667085;font-size:12px;text-align:center">Sent with MyPDF</p>
</div></body></html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="background:#1f4e8c;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block">${escapeHtml(label)}</a></p>`;
}

export function signRequestEmail(p: { to: string; signerName: string; senderName: string; title: string; message?: string | null; link: string }): Email {
  const note = p.message ? `<blockquote style="border-left:3px solid #d0d5dd;margin:16px 0;padding:4px 12px;color:#344054">${escapeHtml(p.message).replace(/\n/g, '<br>')}</blockquote>` : '';
  return {
    to: p.to,
    subject: `${p.senderName} sent you "${p.title}" to sign`,
    html: layout(
      `<p>Hi ${escapeHtml(p.signerName)},</p><p>${escapeHtml(p.senderName)} has asked you to sign <strong>${escapeHtml(p.title)}</strong>.</p>${note}` +
        button(p.link, 'Review and sign') +
        `<p style="color:#667085;font-size:13px">This link is personal to you. Don't forward it.</p>`,
    ),
  };
}

export function completedEmail(p: { to: string; name: string; title: string; sha256: string; pdfBase64: string; filename: string }): Email {
  return {
    to: p.to,
    subject: `Completed: "${p.title}"`,
    html: layout(
      `<p>Hi ${escapeHtml(p.name)},</p><p>Everyone has signed <strong>${escapeHtml(p.title)}</strong>. The completed document is attached, with a certificate of completion on its last page.</p>` +
        `<p style="color:#667085;font-size:12px;word-break:break-all">SHA-256 of the attached file: ${p.sha256}</p>`,
    ),
    attachments: [{ filename: p.filename, content: p.pdfBase64 }],
  };
}

export function declinedEmail(p: { to: string; senderName: string; signerName: string; title: string; reason?: string | null }): Email {
  return {
    to: p.to,
    subject: `Declined: "${p.title}"`,
    html: layout(
      `<p>Hi ${escapeHtml(p.senderName)},</p><p>${escapeHtml(p.signerName)} declined to sign <strong>${escapeHtml(p.title)}</strong>.</p>` +
        (p.reason ? `<p>Their reason: ${escapeHtml(p.reason)}</p>` : ''),
    ),
  };
}

/**
 * Sends through Resend. Without RESEND_API_KEY (local development) the email
 * is logged instead, so the flow can be tested end to end.
 */
export async function sendEmail(email: Email, env: { apiKey?: string; from: string }): Promise<void> {
  if (!env.apiKey) {
    console.log(`[email] to=${email.to} subject=${email.subject}\n${email.html}`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.from, to: [email.to], subject: email.subject, html: email.html, attachments: email.attachments }),
  });
  if (!res.ok) throw new Error(`Email to ${email.to} failed: ${res.status} ${await res.text()}`);
}
