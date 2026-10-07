import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { FAKE, SEARCH_TERMS, makeFixtures } from './fixtures';

let fixtures: Awaited<ReturnType<typeof makeFixtures>>;
test.beforeAll(async ({ browser }) => {
  fixtures = await makeFixtures(browser);
});

// Headless Chromium can't answer the native save dialog; use the download fallback.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker);
});

/** Records every request the app makes so we can prove nothing leaves the origin. */
function trackRequests(page: Page) {
  const requests: { url: string; method: string }[] = [];
  page.on('request', (r) => requests.push({ url: r.url(), method: r.method() }));
  return requests;
}

async function startSession(page: Page) {
  await page.goto('/');
  await page.getByPlaceholder(/Surname, given names/).fill(SEARCH_TERMS);
  await page.getByPlaceholder('e.g. 67M').fill('67F');
  await page.getByRole('button', { name: 'Continue' }).click();
}

/** Runs one image through type → straighten → redact → review → save, returning the exported bytes. */
async function deidentify(page: Page, file: string, type: string): Promise<Buffer> {
  await page.getByTestId('file-input').setInputFiles(file);
  await page.getByRole('button', { name: 'De-identify' }).last().click();
  await page.locator(`[data-type="${type}"]`).click();
  await page.getByTestId('flatten').click();
  await expect(page.locator('.status')).toContainText(/Scan complete|to review/);
  const keepAll = page.getByRole('button', { name: 'Keep all suggestions' });
  if (await keepAll.isVisible()) await keepAll.click();
  await page.getByTestId('to-review').click();
  await expect(page.locator('.status')).toContainText('found no identifiers outside the black boxes');
  for (const box of await page.locator('.checklist input[type=checkbox]').all()) await box.check();
  const download = page.waitForEvent('download');
  await page.getByTestId('save').click();
  const bytes = readFileSync(await (await download).path());
  // Kept for eyeballing the result; test-results/ is git-ignored.
  mkdirSync('test-results', { recursive: true });
  writeFileSync(`test-results/export-${type}.jpg`, bytes);
  return bytes;
}

/** Decodes an exported image in the page and returns the RGB at normalised points. */
async function sample(page: Page, bytes: Buffer, points: [number, number][]) {
  return page.evaluate(
    async ({ b64, points }) => {
      // (fetch() of a data: URL is blocked by the app's CSP, so decode by hand.)
      const blob = new Blob([Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))]);
      const bmp = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      return points.map(([x, y]) => Array.from(ctx.getImageData(Math.round(x * bmp.width), Math.round(y * bmp.height), 1, 1).data.slice(0, 3)));
    },
    { b64: bytes.toString('base64'), points },
  );
}

test('paper notes: sticker, body name and clinician are removed, nothing leaves the device', async ({ page }) => {
  const requests = trackRequests(page);
  await startSession(page);
  const out = await deidentify(page, fixtures.notes, 'notes');

  // JPEG with no EXIF/APP1 metadata.
  expect(out.subarray(0, 2).toString('hex')).toBe('ffd8');
  expect(out.includes(Buffer.from('Exif'))).toBe(false);

  // Sticker region (preset) is solid black.
  for (const rgb of await sample(page, out, [[0.75, 0.08], [0.9, 0.15]])) {
    expect(Math.max(...rgb)).toBeLessThan(20);
  }

  // Every request stayed on this origin and nothing was uploaded.
  const origin = new URL(page.url()).origin;
  const external = requests.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith('data:') && !r.url.startsWith('blob:'));
  expect(external).toEqual([]);
  expect(requests.filter((r) => r.method !== 'GET')).toEqual([]);

  // Ending the session leaves no patient data in any browser storage.
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'End session' }).click();
  await expect(page.getByText('Session ended')).toBeVisible();
  const stored = await page.evaluate(async () => {
    const ls = Object.keys(localStorage).map((k) => `${k}=${localStorage.getItem(k)}`);
    const dbs = (await indexedDB.databases()).map((d) => d.name);
    const cached: string[] = [];
    for (const name of await caches.keys()) {
      for (const req of await (await caches.open(name)).keys()) cached.push(new URL(req.url).pathname);
    }
    return { ls, dbs, cached };
  });
  expect(stored.dbs).toEqual([]);
  const everything = JSON.stringify(stored);
  for (const secret of [FAKE.surname, FAKE.given, FAKE.mrn]) expect(everything.toLowerCase()).not.toContain(secret.toLowerCase());
  for (const path of stored.cached) expect(path).toMatch(/\.(js|css|html|svg|png|gz|webmanifest)$|\/$/);
});

test('Cirrus: header identifiers removed while exam details stay visible', async ({ page }) => {
  await startSession(page);
  const out = await deidentify(page, fixtures.cirrus, 'cirrus');
  expect(out.includes(Buffer.from('Exif'))).toBe(false);
  // The "Exam Date" / "Signal Strength" column is left uncovered (mostly white page).
  const grid: [number, number][] = [];
  for (let x = 0.56; x < 0.75; x += 0.02) for (let y = 0.03; y < 0.12; y += 0.01) grid.push([x, y]);
  const white = (await sample(page, out, grid)).filter((rgb) => Math.min(...rgb) > 200).length;
  expect(white / grid.length).toBeGreaterThan(0.6);
});

test('Optos pair: toolbar and both overlays removed', async ({ page }) => {
  await startSession(page);
  const out = await deidentify(page, fixtures.optos2, 'optos2');
  // Toolbar band and left overlay.
  for (const rgb of await sample(page, out, [[0.5, 0.03], [0.05, 0.12], [0.55, 0.12]])) {
    expect(Math.max(...rgb)).toBeLessThan(20);
  }
});

test('works fully offline once installed', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect(page.locator('.badge')).toContainText('offline ready');
  await context.setOffline(true);
  await page.reload();
  await page.getByPlaceholder(/Surname, given names/).fill(SEARCH_TERMS);
  await page.getByRole('button', { name: 'Continue' }).click();
  const out = await deidentify(page, fixtures.cirrus, 'cirrus');
  expect(out.length).toBeGreaterThan(1000);
});
