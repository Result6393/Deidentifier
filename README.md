# Deidentifier

Covers patient identifiers on photos of clinical material (paper notes, Optos, Cirrus OCT, EMR screens, letters) **on your own device**, so the cleaned images are safe to use in case presentations. Built for working through a whole batch quickly.

- **Nothing is uploaded.** All processing runs in the browser. The page's Content-Security-Policy blocks every request to any other site.
- **Nothing is kept.** Photos and boxes live only in memory. They are wiped when you press **End session**, close the app, or leave it idle for 10 minutes. The only thing saved is your box templates, which hold positions only.
- **Works offline.** After the first visit, install it ("Add to Home screen" / "Install app") and it runs in airplane mode. The whole app is about 50 KB.

## Using it

1. **Import** a batch (select many photos, drag them onto the page, or share them to *Deidentifier* from the Android gallery), or use **Camera**. The in-app camera keeps originals out of your gallery. Imported photos stay in your gallery or downloads, so delete those originals yourself.
2. **Tap a type** (Notes, Optos 1, Optos 2, Cirrus, Other). The preset black boxes appear immediately. The last type you used is applied automatically to the next photo you open, so a run of similar photos needs no taps.
3. **Nudge the boxes**: drag to move, use the red handles to resize, **+ Box** to draw another, Delete to remove. Tap a box to print `RE` / `LE` / `OD` / `OS` / `OU` or custom text on it.
4. Press **Done** (or Enter), then **›** (or →, or swipe the photo left). The filmstrip along the bottom shows every photo with its boxes: a green tick means done, a red `?` means no boxes yet. Tap any thumbnail to jump to it.
5. **Export** all of them: one ZIP, a folder (desktop Chrome/Edge), the Android share sheet, or separate downloads. Before exporting you get a warning listing any photo with no boxes or not marked done.

**Under the photo** is a bar with the file's name (hover for the full name; imports from the camera are called "Camera photo 1", etc.), **Copy**, and a **Save** button for just this photo, right now. The button says what it will do:
- **Overwrite**: the photo came from **Import folder** (see below). After a quick "Replace “name”?" confirmation, the original is replaced in its own format and full size.
- **Save**: a new file. On a computer the browser's Save dialog opens suggesting `name (redacted).jpg`; if you pick the original's own name the browser asks whether to replace it. On a phone it downloads `name (redacted).jpg`.
- **Update file**: you already saved this photo this session, so it rewrites that same file without asking again.
- **Saved ✓**: nothing has changed since the last save. It switches back as soon as you change a box, rotate or straighten. Saving also marks the photo Done and puts a small ⤓ on its thumbnail. **Ctrl+S** does the same.

**Zoom.** The button beside **+ Box** shows the current zoom. **Fit** shows the whole photo in the frame. The other levels are real percentages of actual size, where **100% means one photo pixel per screen pixel** (50%, 100%, 200%, 400%). Zoomed in, the photo is shown at full resolution so it stays sharp, and zooming centres on the box you have selected. Keys: **F** = Fit, **1** = 100%.

**+ Box is a toggle.** Press it once and drag as many boxes as you like. It stays on until you press it again or press Esc, and it stays on when you move to the next photo. While it is on, **tap** an existing box to select it (then move its handles or use its options as usual); **dragging** draws a new box, even when you start on top of an existing one. Tap the type that is already chosen to deselect it and remove its boxes; the next photos then start with no type until you choose one.

**Layouts (saved box positions).** *Built-in* is the starting guess. Once the boxes sit where you want them, open the photo **⋯** menu and choose **Save boxes as new layout…**, then name it (for example "Clinic A sticker"). You can keep several per type: once a type has a saved layout, a **Layout** selector appears under the type buttons so you can switch between them. **Make default** (★) chooses the layout that new photos of that type start with. **Update** overwrites a layout with the current boxes, and **Delete layout** removes it. Layouts store positions and a name only, never the image or any text, and they stay on this device in the browser's local storage. Clearing the browser's site data removes them.

The photo **⋯** menu also holds the occasional tools: **Rotate**, **Straighten** (lets you drag four corners onto a page or screen that was photographed at an angle; this resets that photo's boxes to its layout), **Solid preview** (shows the boxes exactly as they will be exported), and **Reset boxes**. The top **⋯** menu has **End session**, the offline status and the version number. Tap a box to get its options (print RE/LE/OD/OS/OU or custom text on it, or delete it); they float over the photo so it never moves.

**Copy** (under the photo) puts the photo on screen, with its boxes applied, on the clipboard (PNG, up to 2000 px) ready to paste. Swiping works on an empty part of the photo at 1× zoom; it won't trigger when you drag a box, draw, or pan a zoomed photo.

Keys: ← / → previous / next, Enter done, Delete removes the selected box, Esc deselects.

Exports are re-encoded from scratch. They have solid black boxes (never blur), no EXIF or GPS metadata, and generic names (`case-image-001.jpg`…). The ZIP carries no timestamps or original file names.

## Replacing the originals (desktop Chrome or Edge only)

By default every export makes **new** files and your originals stay where they are. To replace the originals with the redacted versions instead:

1. On a computer with Chrome or Edge, open the top **⋯** menu (or the first screen) and choose **Import folder…**. Pick the folder that holds the photos (Chrome refuses to open Downloads, Documents or Desktop themselves, but a subfolder of them is fine). The browser asks once for permission to change files in that folder.
2. Redact the photos as usual, then **Export → Overwrite originals…**. Only photos that **have new black boxes or edits** (boxes, rotate, straighten) are replaced; the button shows how many ("3 changed"), the confirmation lists exactly those files, and every other photo in the folder is left alone, byte for byte. A photo you already replaced is not replaced again until you change it again. Each replaced file keeps its **own name, format (JPEG/PNG/WebP) and full size**.

Why a folder, and why only a computer? A web page can only write back to a file when the browser has given it a handle to that file. Choosing a folder gives one permission prompt for the whole batch, while picking files one by one would ask once per file. Phones don't offer this at all, and photos opened with Import, Camera or the Android share sheet can't be replaced. On a phone, delete the originals from the gallery yourself. HEIC/AVIF/GIF files in the folder are skipped because the browser can't save them back in the same format.

The app asks before it can destroy anything:
- **A firm confirmation** first: which changed files, in which folder, a note that the unredacted originals are gone for good, any "no boxes" or "not marked done" warnings, and a tick box you must tick before the button works. **Cancel** is selected by default.
- **A changed-on-disk check.** If a file was edited or swapped since you opened it, you're told which, and can skip those files, overwrite anyway, or cancel everything.
- **Safe writes.** Each file is written to a temporary copy that replaces the original only when complete, so a failure never leaves half a photo.
- **Saving new files into a folder** (**Export → Save to a folder…**) also checks first. If files of the same name already exist (for example `case-image-001.jpg` from last time) you can **Cancel**, **Keep both** (the new ones get names like `case-image-001 (2).jpg`), or **Replace existing**. ZIP and separate downloads go to your downloads folder, where the browser itself renames duplicates and never overwrites.

Nothing about the folder or files is stored: the handles live in memory and are dropped when you end the session or close the app.

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
| `src/presets/` | Built-in box positions and the user's saved, named layouts (geometry only) |
| `src/ui/Workspace.tsx` | Type chips, toolbar, filmstrip navigation, keyboard shortcuts |
| `src/ui/RedactCanvas.tsx` | Box drawing, moving and resizing |
| `src/export/` | Rendering with solid boxes, ZIP writer, save/share helpers |
| `src/geometry/` | Perspective warp for the optional Straighten step |
| `src/sw.ts` | Offline cache of app files, plus the Android share target (photos are never cached) |
