# Bertie Scan: full prompt (version 1.1)

Build a phone and iPad document scanner for Bertie that replaces paid scanner apps. No adverts, no account, no fees, and nothing is ever uploaded: everything happens on the phone. It must run on iPhone, iPad and Android, so it is an installable web app (PWA) made of plain HTML, CSS and JavaScript with no build step. The whole app is the `docs` folder.

## What it does
- Home: list of scans with a small picture, name, number of pages and date; search when there are four or more; big buttons Photos and Scan; settings.
- Camera: live picture with the page outlined. Yellow means found, green means ready. Takes the picture by itself when the page is steady for about a second (Auto), or by tapping (By hand). After a picture it waits until the page moves or changes before the next one. Torch where the phone allows it, choose from photos, or use the phone's own camera (sharper for small cards). Several pages in a row, then Done.
- Every page: edges found, straightened to its true shape (snaps to A4 or ID card), shadows removed and paper made white.
- Page: looks Clean colour, Grey, Black & white, Photo; crop by dragging corners or sides with a magnifier; rotate; brightness and contrast; read text and copy it; give all pages the same look; swipe between pages; double tap to zoom; delete.
- Document: rename, add pages, drag pages into order, delete.
- Save or send, always starting on PDF:
  - PDF: A4, same shape as the scan, or two per page (ID card front and back at real size); small, normal or best quality; optional searchable text; optional page numbers.
  - Word (.docx, opens in Word and Google Docs): words you can edit (letter or book, or receipt/table which keeps rows together), or a picture of each page.
  - Pictures (JPG).
  - Then the phone's share sheet (WhatsApp, email, Drive, Files), download, or look at it. Chrome on Android does not allow sharing .docx or .zip directly, so there it is download first.
- Settings: auto capture on or off, back up all scans as one zip of PDFs, download the text reader for use without internet.
- Works without internet after the first visit. Light and dark.
- Says iPad, iPhone or phone, depending on where it runs.
- Putting it on the Home Screen: a card on the home screen (until it is installed or put away) and a place in settings. Android: Install button. iPhone and iPad: Apple does not let a website show an install button, so "Show me how" gives the steps: Share, View More, Add to Home Screen (Edit Actions if it is missing), turn on Open as Web App, Add, open from the icon. In another browser it first offers the address to paste in Safari. It warns that scans made in Safari stay in Safari, because the installed app starts empty.
- iPhone and iPad need iOS or iPadOS 16.4 or newer; older ones are told to update.

## Where it lives
- Live at https://dynamicministries.github.io/bertie-scan/ (GitHub Pages, free, https). `Open Bertie Scan on phone.png` is a square code that opens it.
- Code: https://github.com/DynamicMinistries/bertie-scan (public). Pages serves the `docs` folder of `main`; a push to `main` puts the change online in about a minute.
- Everything here is public, so never put scans, passwords, keys or private details in this folder. Commits use the GitHub no-reply address.
- Keep the address. Scans belong to the address on each phone, so a move would leave them behind.

## How it is made
- `docs/js/detect.js` finds the page (own code: wipe out writing, edges, lines, best four-sided shape; second method for patterned tablecloths; fine fit on a bigger picture).
- `docs/js/imageproc.js` straightens and cleans (own code).
- `docs/js/pdf.js` and `docs/js/docx.js` write the files (own code, no libraries).
- `docs/js/ocr.js` reads English and Afrikaans with Tesseract.js 7 kept in `docs/vendor` (free, Apache 2.0; refreshed with `npm install` then `npm run vendor`).
- `docs/js/worker.js` does the heavy work in the background; `store.js` keeps scans in the phone's IndexedDB; `camera.js`, `ui.js`, `engine.js`, `app.js` are the rest.
- `docs/sw.js` keeps the app on the phone. **Change `VERSION` in it with every change**, otherwise phones keep the old one. Scans are not touched by updates.
- On localhost the offline part is off unless the address has `?sw=1`.

## Checking it
- `npm start`, then http://localhost:5190 (preview name `bertie-scan`).
- Page finding: `python tools/make_test_photos.py <folder>` then `node tools/check-detect.mjs <folder>`. On 25 November 2026: 20 of 22 right, to about 0.1% of the photo's width; the two misses are a loud red and white checked tablecloth.

- Live site on 25 November 2026 in a separate Chrome at phone size: can be installed, finds and straightens a page, reads English and Afrikaans, makes PDF and Word, opens the camera. The same with the internet cut off, and scans were still there after closing and opening again.
- Version 1.1 checked while pretending to be an iPad (upright and sideways, Safari, Chrome, and opened from the icon), an iPhone and an Android phone.
- Still to check: scanning on a real iPad or phone.

## Limits
- Handwriting cannot be turned into editable words well; use "Picture of the page".
- Scans live only on the phone. Removing the app or clearing the browser's data removes them, so use Back up.
