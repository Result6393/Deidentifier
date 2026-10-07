# Deidentifier

Covers patient identifiers on photos of clinical material (paper notes, Optos, Cirrus OCT, EMR screens, letters) **on your own device**, so the cleaned images are safe to use in case presentations. Built for working through a whole batch quickly.

- **Nothing is uploaded.** All processing runs in the browser. The page's Content-Security-Policy blocks every request to any other site.
- **Nothing is kept.** Photos and boxes live only in memory. They are wiped when you press **End session**, close the app, or leave it idle for 10 minutes. The only thing saved is your box templates, which hold positions only.
- **Works offline.** After the first visit, install it ("Add to Home screen" / "Install app") and it runs in airplane mode. The whole app is about 50 KB.

## Using it

1. **Import** a batch (select many photos, drag them onto the page, or share them to *Deidentifier* from the Android gallery), or use **Camera**. The in-app camera keeps originals out of your gallery. Imported photos stay in your gallery or downloads, so delete those originals yourself.
2. **Tap a type** (Notes, Optos 1, Optos 2, Cirrus, Other). The preset black boxes appear immediately. The last type you used is applied automatically to the next photo you open, so a run of similar photos needs no taps.
3. **Nudge the boxes**: drag to move, use the red handles to resize, **+ Box** to draw another, Delete to remove. Tap a box to print `RE` / `LE` / `OD` / `OS` / `OU` or custom text on it.
4. Press **Mark done** (or Enter), then **Next** (or →). The filmstrip along the bottom shows every photo with its boxes: a green tick means done, a red `?` means no boxes yet. Tap any thumbnail to jump to it.
5. **Export** all of them: one ZIP, a folder (desktop Chrome/Edge), the Android share sheet, or separate downloads. Before exporting you get a warning listing any photo with no boxes or not marked done.

Other tools: **↻** rotates, **Straighten** lets you drag four corners onto a page or screen that was photographed at an angle (this resets that photo's boxes to the preset), **Solid preview** shows the boxes exactly as they will be exported, and **Save as my template** stores the current box positions for that type. Do this once on a real image of each type, because the built-in presets are only starting guesses.

Keys: ← / → previous / next, Enter done, Delete removes the selected box, Esc deselects.

Exports are re-encoded from scratch. They have solid black boxes (never blur), no EXIF or GPS metadata, and generic names (`case-image-001.jpg`…). The ZIP carries no timestamps or original file names.

## Limits: your review is the final safeguard

- **There is no automatic detection.** The app only covers the areas you see boxed. It does not read the image, so it cannot tell you if something identifying is left outside a box (a name in a letter body, handwriting, a second sticker, a reflection). Check every image before exporting.
- Presets assume identifiers sit in roughly the same place each time. If a photo is framed differently, adjust the boxes or use Straighten.
- Android keyboards may learn text you type into the custom stamp field.

## Hosting (GitHub Pages)

1. In the repository, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Pushing to `main` runs `.github/workflows/deploy.yml`: tests, build, and publish to `https://<user>.github.io/<repo>/`.
3. Open that URL once on each device, install it, then test it in airplane mode.

## Development

```bash
npm install
npm run dev          # local dev server
npm test             # unit tests (ZIP writer, geometry, boxes, templates)
npm run test:e2e     # Playwright: batch flow on synthetic images, network + storage checks, offline mode
npm run build        # production build in dist/
```

Test images are drawn at test time with a fictional patient (`tests/e2e/fixtures.ts`). Never commit real patient images.

| Path | Purpose |
|---|---|
| `src/state/session.ts` | In-memory session, image decoding cache, `wipe()` |
| `src/presets/` | Default box positions and user templates (geometry only) |
| `src/ui/Workspace.tsx` | Type chips, toolbar, filmstrip navigation, keyboard shortcuts |
| `src/ui/RedactCanvas.tsx` | Box drawing, moving and resizing |
| `src/export/` | Rendering with solid boxes, ZIP writer, save/share helpers |
| `src/geometry/` | Perspective warp for the optional Straighten step |
| `src/sw.ts` | Offline cache of app files, plus the Android share target (photos are never cached) |
