# MyPDF

Read, sign and initial PDFs on any device. Runs in the browser and installs as an app (PWA) on Windows, Mac, iPhone, iPad and Android.

## What works

**Sign yourself (no account needed)**

- Open a PDF (button, drag and drop, or "Open with" once installed) and scroll, zoom or fit to width
- Create your signature and initials by drawing, typing or uploading an image; they're remembered on this device
- Place signatures, initials, dates and text anywhere; drag to move, corner handle to resize, × or Delete to remove
- Download the signed PDF (on phones this opens the share sheet)
- Works offline after the first visit; files never leave the device

**Send for signature**

- Sign in with a code emailed to you (no password)
- Upload a PDF, add signers, and drag signature, initials, date and text fields onto the pages for each signer
- Signers can sign at the same time or one after another
- Each signer gets a personal email link and signs in their browser, on any device, without an account; they can also decline
- Signers agree to sign electronically before signing (Contract and Commercial Law Act 2017, Part 4)
- Every step is recorded in an audit trail with time, IP address and device
- When everyone has signed, the completed PDF gets a certificate-of-completion page and is emailed to everyone, with its SHA-256 fingerprint
- A dashboard shows each document's status, signers and audit trail

Setting up sending takes about 30 minutes: see [SETUP.md](SETUP.md).

## Develop

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests
npm run build    # production build in dist/
```

Built with React, TypeScript and Vite; [pdf.js](https://mozilla.github.io/pdf.js/) renders pages and [pdf-lib](https://pdf-lib.js.org/) writes the signed file. Sending uses [Supabase](https://supabase.com): Postgres with row-level security, private file storage, and two Deno edge functions in `supabase/functions` (`send-envelope` for senders, `signing` for signers via their link token). Code shared by the app and the functions lives in `supabase/functions/_shared`.

## Next

- Seal completed PDFs with a digital certificate so Adobe Reader flags any later edit
- Reminders, cancelling a sent document, and reusable templates
- Desktop and app-store builds
