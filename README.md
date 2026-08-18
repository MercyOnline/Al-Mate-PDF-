# Almate.edu.lk PDF Footer Tool

A GitHub Pages-ready static web app that:

- accepts a PDF in the browser;
- asks for **Year**, **Subject**, and **Language**;
- analyzes every page and checks the exact bottom area where the footer would be placed;
- adds the Almate footer only to eligible A4 portrait pages;
- skips pages where content is detected in the footer area;
- preserves the original PDF page content instead of rasterizing the entire document;
- downloads automatically using this filename pattern:

`YEAR-SUBJECT-LANGUAGE.pdf`

Example: `2025-SFT-Tamil.pdf`

## Footer specification

The production footer is in `assets/footer.png`.

- Pixel size: **1800 x 140 px**
- Aspect ratio: **12.857:1**
- PDF placement: **180 mm x 14 mm**
- Bottom margin: **1.5 mm**
- Horizontal placement: centered on the page
- Design content: Almate.edu.lk logo + `Scan Me For More` + `All GCE A/L Papers & Resources` + QR code

The footer is intentionally much slimmer than the earlier 3:1 concept artwork. A 3:1 banner would become about 60 mm tall at 180 mm width, which is too large for the small blank footer area on an A4 exam paper.

## How the page detection works

1. PDF.js renders each page at low resolution **only for inspection**.
2. The app checks the pixels under the actual visible footer artwork, with a small safety padding.
3. A4 portrait pages with a sufficiently clear bottom area are marked `READY`.
4. Pages with content in that zone, non-A4 pages, or landscape pages are marked `SKIPPED`.
5. pdf-lib overlays the same footer PNG onto every eligible page.

The output page itself is **not** replaced by the analysis render, so the source page quality is retained.

## File-size behavior

The footer image is embedded once and reused on all eligible pages. The PDF is saved with object streams enabled. This is designed to keep size growth small, but a browser-only GitHub Pages application cannot guarantee that every PDF will become smaller than its source because existing PDF compression varies by file.

## Deploy to GitHub Pages

1. Create a new GitHub repository, for example `almate-pdf-footer`.
2. Extract this ZIP and upload all files to the repository root.
3. Commit and push to the `main` branch.
4. In GitHub, open **Settings > Pages**.
5. Under **Build and deployment**, choose **Deploy from a branch**.
6. Select `main` and `/ (root)`, then save.
7. GitHub will publish the site at the repository's GitHub Pages URL.

No server, database, Python, Node.js runtime, or API key is required after deployment. The PDF is processed locally in the user's browser.

## Optional custom domain

After the GitHub Pages version is working, you can configure a custom subdomain such as `tools.almate.edu.lk` in GitHub Pages and in your DNS provider. Do not add a `CNAME` file until you have chosen the exact subdomain.

## Third-party browser libraries

This project loads these pinned versions from jsDelivr:

- `pdf-lib` 1.17.1
- `pdfjs-dist` 3.11.174

If you later want the site to work with no CDN dependency, download those library files into a `vendor/` folder and change the script URLs in `index.html` plus the worker URL in `app.js`.

## Important PDF limitations

- Password-protected/encrypted PDFs are rejected.
- The automatic footer placement is designed for A4 portrait pages.
- If a page already has content where the footer would go, that page is skipped rather than covering the content.
- The tool preserves source quality; it does not perform OCR or AI image enhancement.

## Branding files

- `assets/logo.png` - selected Almate.edu.lk logo
- `assets/qr.jpg` - supplied QR artwork
- `assets/footer.png` - production footer used by the PDF processor

