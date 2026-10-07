# Deidentifier

Removes patient identifiers from photos of clinical material (paper notes, Optos, Cirrus OCT, EMR screens, letters) **on your own device**, so the cleaned image can be pasted into Claude for case presentations.

- **Nothing is uploaded.** All processing (straightening, text recognition, redaction) runs in the browser. The page's Content-Security-Policy blocks every request to any other site.
- **Nothing is kept.** Photos, search terms and text-scan results live only in memory. They are wiped when you press **End session**, close the app, or leave it idle for 10 minutes. The only thing saved is your box templates, which hold positions only.
- **Works offline.** After the first visit, install it ("Add to Home screen" / "Install app") and it runs in airplane mode.

## Using it

1. **New session**: optionally type the patient's surname, given names, MRN, Medicare number or phone, and any clinician names. The text scan finds these anywhere in the image. You can also enter an age/sex label (e.g. `67M`) to print over a covered DOB.
2. **Add photos**: use **Take photo** (the in-app camera keeps originals out of your gallery), **Import photos**, or on Android share photos to *Deidentifier* from the gallery.
3. **Choose the type**: Paper notes, Optos single, Optos pair, Cirrus, or Other.
4. **Straighten**: drag the four corners onto the edges of the page or screen. Everything outside is cropped off.
5. **Redact**:
   - Preset boxes are placed for the image type.
   - The on-device text scan adds boxes for search-term matches, Medicare numbers (check-digit validated), labelled MRN/UR/DOB/phone fields, addresses, emails and barcodes.
   - Orange boxes are *suggestions* (e.g. "Dr …", "Mrs …"). Keep or dismiss each one.
   - Drag boxes to move them and use the red handles to resize. Use **+ Box** to draw your own.
   - Tap a box to print text on it, such as `RE` / `LE` for laterality or your age/sex label.
   - **Save as my template** stores the box positions for that image type. Do this once on a real image of each type, because the built-in presets are only starting guesses.
6. **Review & export**:
   - The final image is re-scanned. Anything that still looks like an identifier outside the black boxes is outlined in red.
   - Tick the checklist, then **Copy** (paste into Claude), **Save**, or **Share**.
   - Exports are re-encoded from scratch. They have no EXIF or GPS metadata, are cropped, use solid black boxes (never blur), and get a generic file name.

## Limits: your review is the final safeguard

- Text recognition reads **printed** text. It does **not** reliably read handwriting, so look for handwritten names yourself.
- Presets are positioned for typical layouts. Check them on every image, especially angled photos of screens.
- Imported photos remain in your phone gallery or downloads folder. Delete them there yourself, or use the in-app camera.
- Android keyboards may learn words you type. Consider your keyboard's incognito mode when typing patient names.
- Barcode detection uses the browser's built-in detector. It is available on Android Chrome but not on Windows. The sticker preset covers the barcode either way.

## Hosting (GitHub Pages)

1. In the repository, go to **Settings → Pages** and set **Source** to **GitHub Actions**. Free accounts need the repository to be public; the code contains no patient data.
2. Merge to `main`. The workflow in `.github/workflows/deploy.yml` runs the tests, builds, and publishes to `https://<user>.github.io/<repo>/`.
3. Open that URL once on each device, install it, then test it in airplane mode.

## Development

```bash
npm install
npm run dev          # local dev server
npm test             # unit tests (detection rules, geometry, templates)
npm run test:e2e     # Playwright: full flow on synthetic images, network + storage checks, offline mode
npm run build        # production build in dist/
```

The OCR engine and English language data are copied from `node_modules` into `public/vendor/` by `scripts/vendor.mjs`, so they are served from the app's own origin. Test images in `tests/e2e/fixtures.ts` are drawn at test time with a fictional patient. Never commit real patient images.

### Layout

| Path | Purpose |
|---|---|
| `src/state/session.ts` | In-memory session and `wipe()` |
| `src/geometry/` | Corner detection, homography, perspective warp |
| `src/detect/patterns.ts` | Australian identifier rules (Medicare, MRN/UR, DOB, phone, address, names) |
| `src/detect/ocr.ts` | tesseract.js wrapper, loaded from local files only |
| `src/presets/` | Default box positions and user templates (geometry only) |
| `src/export/` | Flattened rendering, verification re-scan, copy/save/share |
| `src/ui/screens/` | Start → Photos → Type → Straighten → Redact → Review |
| `src/sw.ts` | Offline cache of app files, plus the Android share target (photos are never cached) |
