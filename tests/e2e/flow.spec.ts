import { expect, test, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeFixtures } from './fixtures';

let fixtures: Awaited<ReturnType<typeof makeFixtures>>;
test.beforeAll(async ({ browser }) => {
  fixtures = await makeFixtures(browser);
});

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

/** Records every request the app makes so we can prove nothing leaves the origin. */
function trackRequests(page: Page) {
  const requests: { url: string; method: string }[] = [];
  page.on("request", (r) => requests.push({ url: r.url(), method: r.method() }));
  return requests;
}

const importThree = (page: Page) => page.getByTestId('file-input').setInputFiles([fixtures.notes, fixtures.cirrus, fixtures.optos2]);
const type = (page: Page, t: string) => page.locator(`[data-type="${t}"]`).click();

/** Imports the three fixtures and gives each its type, marking each done. */
async function prepareBatch(page: Page) {
  await importThree(page);
  await expect(page.locator('.film')).toHaveCount(3);
  await type(page, 'notes');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight');
  await type(page, 'cirrus');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight');
  await type(page, 'optos2');
  await page.keyboard.press('Enter');
}

/** Unzips with Python (independent of the app's own writer) and returns the JPEG bytes by name. */
function unzip(zipPath: string): Record<string, Buffer> {
  const dir = mkdtempSync(join(tmpdir(), 'unz-'));
  const r = spawnSync('python3', ['-I', '-c', 'import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; z.extractall(sys.argv[2])', zipPath, dir], { encoding: 'utf8' });
  expect(r.stderr).toBe('');
  return Object.fromEntries(readdirSync(dir).sort().map((n) => [n, readFileSync(join(dir, n))]));
}

/** Decodes an exported image in the page and returns the RGB at normalised points. */
async function sample(page: Page, bytes: Buffer, points: [number, number][]) {
  return page.evaluate(
    async ({ b64, points }) => {
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

async function exportZip(page: Page) {
  await page.getByTestId('export-menu').click();
  const download = page.waitForEvent('download');
  await page.getByTestId('export-zip').click();
  const d = await download;
  expect(d.suggestedFilename()).toBe('case-images.zip');
  return unzip((await d.path())!);
}

test('batch: import three, set types, step through, export one ZIP of redacted images', async ({ page }) => {
  const requests = trackRequests(page);
  await prepareBatch(page);

  // Filmstrip shows all three as done.
  await expect(page.locator('.film-badge.done')).toHaveCount(3);

  const files = await exportZip(page);
  expect(Object.keys(files)).toEqual(['case-image-001.jpg', 'case-image-002.jpg', 'case-image-003.jpg']);
  for (const bytes of Object.values(files)) {
    expect(bytes.subarray(0, 2).toString('hex')).toBe('ffd8');
    expect(bytes.includes(Buffer.from('Exif'))).toBe(false);
  }

  // Notes: the sticker region is solid black.
  for (const rgb of await sample(page, files['case-image-001.jpg'], [[0.75, 0.08], [0.9, 0.15]])) expect(Math.max(...rgb)).toBeLessThan(20);

  // Cirrus: header fields covered, exam-date column left alone.
  for (const rgb of await sample(page, files['case-image-002.jpg'], [[0.1, 0.03], [0.1, 0.07], [0.1, 0.1]])) expect(Math.max(...rgb)).toBeLessThan(20);
  const grid: [number, number][] = [];
  for (let x = 0.56; x < 0.75; x += 0.02) for (let y = 0.03; y < 0.08; y += 0.01) grid.push([x, y]);
  const white = (await sample(page, files['case-image-002.jpg'], grid)).filter((rgb) => Math.min(...rgb) > 200).length;
  expect(white / grid.length).toBeGreaterThan(0.5);

  // Optos pair: toolbar band and both overlays covered.
  for (const rgb of await sample(page, files['case-image-003.jpg'], [[0.5, 0.03], [0.05, 0.12], [0.55, 0.12]])) expect(Math.max(...rgb)).toBeLessThan(20);

  // Nothing left this origin, and nothing was uploaded.
  const origin = new URL(page.url()).origin;
  expect(requests.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith('data:') && !r.url.startsWith('blob:'))).toEqual([]);
  expect(requests.filter((r) => r.method !== 'GET')).toEqual([]);
});

test('navigation: arrow keys, Prev/Next, filmstrip, last type carries forward', async ({ page }) => {
  await importThree(page);
  await expect(page.locator('.film')).toHaveCount(3);
  await expect(page.getByTestId('count')).toHaveText('1 / 3');
  await type(page, 'notes');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('count')).toHaveText('2 / 3');
  // The next photo starts with the last-used type's boxes already placed.
  await expect(page.locator('[data-type="notes"]')).toHaveClass(/on/);
  await expect(page.locator('.rbox')).toHaveCount(1);
  await page.getByTestId('next').click();
  await expect(page.getByTestId('count')).toHaveText('3 / 3');
  await page.getByTestId('prev').click();
  await page.locator('.film-btn').first().click();
  await expect(page.getByTestId('count')).toHaveText('1 / 3');
  await page.keyboard.press('Enter');
  await expect(page.locator('.film-badge.done')).toHaveCount(1);
});

test('editing: drag a preset box, draw a new one, stamp it, delete it', async ({ page }) => {
  await page.getByTestId('file-input').setInputFiles(fixtures.notes);
  await type(page, 'notes');
  const box = page.locator('.rbox').first();
  const before = await box.boundingBox();
  await box.click({ position: { x: 20, y: 20 } });
  await page.mouse.move(before!.x + 20, before!.y + 20);
  await page.mouse.down();
  await page.mouse.move(before!.x - 10, before!.y + 60, { steps: 4 });
  await page.mouse.up();
  const after = await box.boundingBox();
  expect(Math.abs(after!.y - before!.y)).toBeGreaterThan(10);

  await page.getByTestId('draw').click();
  const s = (await page.getByTestId('redact-surface').boundingBox())!;
  await page.mouse.move(s.x + 30, s.y + s.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(s.x + 140, s.y + s.height * 0.65, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('.rbox')).toHaveCount(2);
  await page.getByRole('button', { name: 'RE', exact: true }).click();
  await expect(page.locator('.rbox .stamp')).toHaveText('RE');
  await page.keyboard.press('Delete');
  await expect(page.locator('.rbox')).toHaveCount(1);
});

test('layouts: save a named layout, make it the default, new photos start with it', async ({ page }) => {
  await page.getByTestId('file-input').setInputFiles([fixtures.notes, fixtures.notes]);
  await expect(page.locator('.film')).toHaveCount(2);
  await type(page, 'notes');
  await expect(page.locator('.rbox')).toHaveCount(1);

  // Add a second box, then save the arrangement under a name.
  await page.getByTestId('draw').click();
  const s = (await page.getByTestId('redact-surface').boundingBox())!;
  await page.mouse.move(s.x + 30, s.y + 200);
  await page.mouse.down();
  await page.mouse.move(s.x + 150, s.y + 240, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('.rbox')).toHaveCount(2);
  page.once('dialog', (d) => d.accept('Clinic A'));
  await page.getByTestId('save-preset').click();
  await expect(page.getByTestId('layout-select')).toContainText('Clinic A');
  page.once('dialog', (d) => d.accept());
  await page.getByTestId('make-default').click();
  await expect(page.getByTestId('layout-select')).toContainText('Clinic A ★');

  // The next photo, with its type chosen, starts with the saved layout (2 boxes).
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.rbox')).toHaveCount(2);
  // The built-in layout is still one tap away.
  await page.getByTestId('layout-select').selectOption({ label: 'Built-in' });
  await expect(page.locator('.rbox')).toHaveCount(1);

  // Saved layouts survive a reload and contain positions only.
  await page.reload();
  const stored = await page.evaluate(() => localStorage.getItem('deidentifier.presets.v2'));
  expect(JSON.parse(stored!).notes.presets).toHaveLength(1);
  expect(stored).not.toContain('TESTPERSON');
});

test('straighten: manual corners warp the photo and reset its boxes', async ({ page }) => {
  await page.getByTestId('file-input').setInputFiles(fixtures.notes);
  await type(page, 'notes');
  await page.getByRole('button', { name: 'Straighten' }).click();
  await page.getByTestId('flatten').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.rbox')).toHaveCount(1);
});

test('export as separate files downloads every image', async ({ page }) => {
  await prepareBatch(page);
  await page.getByTestId('export-menu').click();
  const names: string[] = [];
  page.on('download', (d) => names.push(d.suggestedFilename()));
  await page.getByTestId('export-files').click();
  await expect.poll(() => names.length).toBe(3);
  expect(names.sort()).toEqual(['case-image-001.jpg', 'case-image-002.jpg', 'case-image-003.jpg']);
});

test('exporting warns about images with no boxes or not marked done', async ({ page }) => {
  await importThree(page);
  await expect(page.locator('.film')).toHaveCount(3);
  await type(page, 'notes');
  const messages: string[] = [];
  page.on('dialog', async (d) => {
    messages.push(d.message());
    await d.dismiss();
  });
  await page.getByTestId('export-menu').click();
  await page.getByTestId('export-zip').click();
  await expect.poll(() => messages.length).toBe(1);
  expect(messages[0]).toContain('No black boxes on images 2, 3');
  expect(messages[0]).toContain('Not marked Done');
});

test('ending the session leaves no patient data in browser storage', async ({ page }) => {
  await prepareBatch(page);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'End session' }).click();
  await expect(page.getByText('Session ended')).toBeVisible();
  await expect(page.locator('.film')).toHaveCount(0);
  const stored = await page.evaluate(async () => {
    const ls = Object.keys(localStorage).map((k) => `${k}=${localStorage.getItem(k)}`);
    const dbs = (await indexedDB.databases()).map((d) => d.name);
    const cached: string[] = [];
    for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) cached.push(new URL(req.url).pathname);
    return { ls, dbs, cached };
  });
  expect(stored.ls).toEqual([]);
  expect(stored.dbs).toEqual([]);
  for (const path of stored.cached) expect(path).toMatch(/\.(js|css|html|svg|png|webmanifest)$|\/$/);
});

test('a dozen photos open quickly and stay editable', async ({ page }) => {
  const start = Date.now();
  await page.getByTestId('file-input').setInputFiles(Array(12).fill(fixtures.notes));
  await expect(page.locator('canvas.display.full')).toBeVisible();
  const firstReady = Date.now() - start;
  await expect(page.locator('.film')).toHaveCount(12);
  const allReady = Date.now() - start;
  console.log(`first photo ready in ${firstReady} ms, all 12 in ${allReady} ms`);
  expect(firstReady).toBeLessThan(5000);
  for (let i = 0; i < 11; i++) await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('count')).toHaveText('12 / 12');
  await expect(page.locator('canvas.display.full')).toBeVisible();
});

test('works fully offline once installed', async ({ page, context }) => {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect(page.locator('.badge')).toContainText('offline ready');
  await context.setOffline(true);
  await page.reload();
  await prepareBatch(page);
  const files = await exportZip(page);
  expect(Object.keys(files)).toHaveLength(3);
});

test.afterAll(() => {
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/.keep', '');
});
