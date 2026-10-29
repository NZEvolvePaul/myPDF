# MyPDF

Read, sign and initial PDFs on any device. Runs in the browser and installs as an app (PWA) on Windows, Mac, iPhone, iPad and Android.

## What works (phase 1)

- Open a PDF (button, drag and drop, or "Open with" once installed) and scroll, zoom or fit to width
- Create your signature and initials by drawing, typing or uploading an image; they're remembered on this device
- Place signatures, initials, dates and text anywhere; drag to move, corner handle to resize, × or Delete to remove
- Download the signed PDF (on phones this opens the share sheet)
- Works offline after the first visit; files never leave the device

## Develop

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests
npm run build    # production build in dist/
```

Built with React, TypeScript and Vite; [pdf.js](https://mozilla.github.io/pdf.js/) renders pages and [pdf-lib](https://pdf-lib.js.org/) writes the signed file.

## Next

Phase 2 adds accounts and sending documents to other people to sign, with an audit trail and a sealed final PDF.
