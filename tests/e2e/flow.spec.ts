import { expect, test, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeFixtures } from './fixtures';

const APP_VERSION = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;

/** The version label must be fully visible: not clipped by its container or the screen. */
async function expectVersionVisible(page: Page) {
  const v = page.getByTestId('version');
  await expect(v).toHaveText(`v${APP_VERSION}`);
  const clipped = await v.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const parent = el.parentElement!.getBoundingClientRect();
    return { clippedText: el.scrollWidth > el.clientWidth, outside: r.left < 0 || r.right > window.innerWidth, outOfParent: r.right > parent.right + 1 };
  });
  expect(clipped).toEqual({ clippedText: false, outside: false, outOfParent: false });
  const name = await page.locator('.brand-name').evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(name, 'app name is not cut off').toBe(false);
}

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
/** Opens the photo "⋯" menu and clicks one of its items. */
async function tool(page: Page, name: string | RegExp) {
  await page.getByTestId('photo-menu').click();
  await page.getByRole('button', { name }).click();
}
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
  await page.getByTestId('photo-menu').click();
  await page.getByTestId('save-preset').click();
  await expect(page.getByTestId('layout-select')).toContainText('Clinic A');
  page.once('dialog', (d) => d.accept());
  await page.getByTestId('photo-menu').click();
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

test('copy puts the redacted image on the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByTestId('file-input').setInputFiles(fixtures.notes);
  await type(page, 'notes');
  await page.getByTestId('copy').click();
  await expect(page.getByText('Copied to clipboard.')).toBeVisible();
  const clip = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    const blob = await item.getType('image/png');
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const px = (x: number, y: number) => Array.from(ctx.getImageData(Math.round(x * bmp.width), Math.round(y * bmp.height), 1, 1).data.slice(0, 3));
    return { types: item.types, sticker: px(0.75, 0.08), width: bmp.width };
  });
  expect(clip.types).toContain('image/png');
  expect(Math.max(...clip.sticker)).toBeLessThan(20);
  expect(clip.width).toBeLessThanOrEqual(2000);
});

test('selecting or deselecting a box never moves the photo', async ({ page }) => {
  await page.getByTestId('file-input').setInputFiles(fixtures.notes);
  await type(page, 'notes');
  const surface = page.getByTestId('redact-surface');
  const top = async () => (await surface.boundingBox())!.y;
  const y0 = await top();
  await page.locator('.rbox').first().click({ position: { x: 15, y: 15 } });
  await expect(page.getByRole('button', { name: 'Delete box' })).toBeVisible();
  expect(await top()).toBe(y0);
  await page.getByRole('button', { name: 'RE', exact: true }).click();
  expect(await top()).toBe(y0);
  await page.getByRole('button', { name: 'Delete box' }).waitFor();
  // Tap empty photo to deselect.
  const s = (await surface.boundingBox())!;
  await page.mouse.click(s.x + 20, s.y + 40);
  await expect(page.getByRole('button', { name: 'Delete box' })).toHaveCount(0);
  expect(await top()).toBe(y0);
});

test.describe('phone width', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test('box options float over the photo and the photo does not move', async ({ page }) => {
    await page.getByTestId('file-input').setInputFiles(fixtures.notes);
    await type(page, 'notes');
    const surface = page.getByTestId('redact-surface');
    const y0 = (await surface.boundingBox())!.y;
    await page.locator('.rbox').first().tap({ position: { x: 15, y: 15 } });
    await expect(page.getByRole('button', { name: 'Delete box' })).toBeAttached();
    expect((await surface.boundingBox())!.y).toBe(y0);
  });
});

test.describe('compact controls', () => {
  const cases = [
    { name: 'laptop 1280×720', viewport: { width: 1280, height: 720 }, maxTop: 160, font: null },
    { name: 'phone 390×844', viewport: { width: 390, height: 844 }, maxTop: 160, font: null },
    // A much wider system font must not make any bar wrap (this is what GitHub's runner uses).
    { name: 'phone 390×844, wide font', viewport: { width: 390, height: 844 }, maxTop: 160, font: 'DejaVu Sans' },
    { name: 'small phone 360×740, wide font', viewport: { width: 360, height: 740 }, maxTop: 160, font: 'DejaVu Sans' },
  ];
  for (const c of cases) {
    test(`${c.name}: photo starts high, bars are single rows, frequent actions need no menu`, async ({ page }) => {
      await page.setViewportSize(c.viewport);
      if (c.font) await page.addStyleTag({ content: `html,body,button,select,input,textarea{font-family:'${c.font}' !important}` });
      await page.getByTestId('file-input').setInputFiles([fixtures.notes, fixtures.cirrus]);
      await expect(page.locator('.film')).toHaveCount(2);
      await type(page, 'notes');
      const top = (await page.getByTestId('redact-surface').boundingBox())!.y;
      expect(top).toBeLessThanOrEqual(c.maxTop);
      await expectVersionVisible(page);
      // Each bar fits on one row.
      for (const sel of ['.topbar', '.types', '.toolbar']) {
        const h = (await page.locator(sel).first().boundingBox())!.height;
        expect(h, `${sel} height`).toBeLessThanOrEqual(56);
      }
      // No horizontal page scroll.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      // Used on every photo: all visible without opening a menu.
      for (const id of ['prev', 'next', 'done', 'draw', 'export-menu']) await expect(page.getByTestId(id)).toBeVisible();
      await expect(page.getByTestId('import')).toBeVisible();
      for (const t of ['notes', 'optos1', 'optos2', 'cirrus', 'generic']) await expect(page.locator(`[data-type="${t}"]`)).toBeVisible();
      // The whole photo fits above the filmstrip.
      const surface = (await page.getByTestId('redact-surface').boundingBox())!;
      const film = (await page.locator('.filmstrip').boundingBox())!;
      expect(surface.y + surface.height).toBeLessThanOrEqual(film.y + 1);
    });
  }

  test('version is fully visible with no photos loaded, at several phone widths', async ({ page }) => {
    for (const width of [320, 360, 390, 411, 430]) {
      await page.setViewportSize({ width, height: 800 });
      await page.reload();
      await expect(page.getByTestId('import')).toBeVisible();
      await expectVersionVisible(page);
    }
  });

  test('the ⋯ menus hold the rare actions and close after use', async ({ page }) => {
    await page.getByTestId('file-input').setInputFiles(fixtures.notes);
    await type(page, 'notes');
    await page.getByTestId('photo-menu').click();
    for (const name of ['Rotate', 'Straighten…', 'Solid preview', 'Reset boxes', 'Save boxes as new layout…']) {
      await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible();
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Rotate' })).toHaveCount(0);
    await page.getByTestId('photo-menu').click();
    await page.getByRole('button', { name: /Solid preview/ }).click();
    await expect(page.getByRole('button', { name: 'Rotate' })).toHaveCount(0);
    await expect(page.locator('.rbox.solid')).toHaveCount(1);
    await page.getByTestId('app-menu').click();
    await expect(page.getByText(/On-device only/)).toBeVisible();
    await expect(page.getByText(/^Version \d+\.\d+\.\d+$/)).toBeVisible();
  });
});

test('straighten: manual corners warp the photo and reset its boxes', async ({ page }) => {
  await page.getByTestId('file-input').setInputFiles(fixtures.notes);
  await type(page, 'notes');
  await tool(page, 'Straighten…');
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
  await page.getByTestId('app-menu').click();
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
  await expect(page.getByTestId('app-menu').locator('.dot')).toBeVisible();
  await page.getByTestId('app-menu').click();
  await expect(page.getByText(/offline ready/)).toBeVisible();
  await page.keyboard.press('Escape');
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

// --- Replacing originals and not overwriting by accident ----------------------------------------
// Chromium's origin-private file system gives real FileSystemDirectoryHandles, so the real
// read / replace / atomic-write code runs. Only the native folder picker is stood in for.
test.describe('files on disk', () => {
  type Seed = { name: string; from?: string; as?: string; text?: string };

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>; showSaveFilePicker: (o: { suggestedName: string }) => Promise<FileSystemFileHandle>; __saveCalls: number };
      w.showDirectoryPicker = () => navigator.storage.getDirectory();
      // Stands in for the native "Save as" dialog: always saves into the test folder under the suggested name.
      w.__saveCalls = 0;
      w.showSaveFilePicker = async (o) => {
        w.__saveCalls++;
        return (await navigator.storage.getDirectory()).getFileHandle(o.suggestedName, { create: true });
      };
    });
    await page.goto('/');
  });

  async function seed(page: Page, files: Seed[]) {
    const prepared = files.map((f) => ({ name: f.name, as: f.as, text: f.text, b64: f.from ? readFileSync(f.from).toString('base64') : null }));
    await page.evaluate(async (list) => {
      const root = await navigator.storage.getDirectory();
      for (const f of list) {
        let blob: Blob;
        if (f.b64) {
          const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))]));
          const c = new OffscreenCanvas(bmp.width, bmp.height);
          c.getContext('2d')!.drawImage(bmp, 0, 0);
          blob = await c.convertToBlob({ type: f.as ?? 'image/png', quality: 0.9 });
        } else blob = new Blob([f.text ?? '']);
        const w = await (await root.getFileHandle(f.name, { create: true })).createWritable();
        await w.write(blob);
        await w.close();
      }
    }, prepared);
  }

  /** Name → size, first bytes and a content hash, for everything in the folder. */
  async function disk(page: Page) {
    return page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const out: Record<string, { size: number; magic: string; hash: string }> = {};
      for await (const [name, h] of (root as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        const f = await (h as FileSystemFileHandle).getFile();
        const buf = await f.arrayBuffer();
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buf))).map((b) => b.toString(16).padStart(2, '0')).join('');
        out[name] = { size: f.size, magic: Array.from(new Uint8Array(buf.slice(0, 4))).map((b) => b.toString(16).padStart(2, '0')).join(''), hash };
      }
      return out;
    });
  }

  async function pixels(page: Page, name: string, points: [number, number][]) {
    return page.evaluate(
      async ({ name, points }) => {
        const root = await navigator.storage.getDirectory();
        const bmp = await createImageBitmap(await (await root.getFileHandle(name)).getFile());
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = c.getContext('2d')!;
        ctx.drawImage(bmp, 0, 0);
        return points.map(([x, y]) => Array.from(ctx.getImageData(Math.round(x * bmp.width), Math.round(y * bmp.height), 1, 1).data.slice(0, 3)));
      },
      { name, points },
    );
  }

  const importFolder = async (page: Page) => {
    await page.getByTestId('app-menu').click();
    await page.getByTestId('import-folder').click();
  };

  const threeOnDisk = (): Seed[] => [
    { name: 'a-notes.jpg', from: fixtures.notes, as: 'image/jpeg' },
    { name: 'b-cirrus.png', from: fixtures.cirrus, as: 'image/png' },
    { name: 'c-optos.webp', from: fixtures.optos2, as: 'image/webp' },
  ];

  /** Opens the Export menu unless it is already open. */
  async function openExport(page: Page) {
    if (!(await page.getByTestId('export-zip').isVisible())) await page.getByTestId('export-menu').click();
  }

  /** Opens the Export menu, starts "Overwrite originals" and answers the confirmation. */
  async function overwrite(page: Page, answer: 'go' | 'cancel') {
    await openExport(page);
    await page.getByTestId('export-overwrite').click();
    await expect(page.getByTestId('dialog')).toBeVisible();
    if (answer === 'go') {
      await expect(page.getByTestId('dialog-go')).toBeDisabled();
      await page.getByTestId('dialog-tick').check();
      await page.getByTestId('dialog-go').click();
    } else await page.getByTestId('dialog-cancel').click();
  }

  test('import a folder, then replace the originals: same names, same formats, boxes burnt in', async ({ page }) => {
    await seed(page, [...threeOnDisk(), { name: 'notes.txt', text: 'not a photo' }, { name: 'scan.heic', text: 'pretend heic' }]);
    const before = await disk(page);
    await importFolder(page);
    await expect(page.locator('.film')).toHaveCount(3);
    await expect(page.getByText(/Opened 3 photos/)).toBeVisible();
    await expect(page.getByText(/1 other image file \(e\.g\. HEIC\) was ignored/)).toBeVisible();
    // Type and mark done in filename order: notes, cirrus, optos pair.
    await type(page, 'notes');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowRight');
    await type(page, 'cirrus');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowRight');
    await type(page, 'optos2');
    await page.keyboard.press('Enter');

    await overwrite(page, 'go');
    await expect(page.getByText('Replaced 3 originals.')).toBeVisible();

    const after = await disk(page);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort()); // no new files, none removed
    expect(after['a-notes.jpg'].magic.startsWith('ffd8ff')).toBe(true);
    expect(after['b-cirrus.png'].magic).toBe('89504e47');
    expect(after['c-optos.webp'].magic).toBe('52494646');
    for (const n of ['a-notes.jpg', 'b-cirrus.png', 'c-optos.webp']) expect(after[n].hash).not.toBe(before[n].hash);
    // Files that weren't photos we could replace are untouched.
    expect(after['notes.txt']).toEqual(before['notes.txt']);
    expect(after['scan.heic']).toEqual(before['scan.heic']);
    // Full size is kept (not shrunk to 2000 px) and the identifiers are black.
    for (const rgb of await pixels(page, 'a-notes.jpg', [[0.75, 0.08], [0.9, 0.15]])) expect(Math.max(...rgb)).toBeLessThan(25);
    for (const rgb of await pixels(page, 'b-cirrus.png', [[0.1, 0.03], [0.1, 0.07]])) expect(Math.max(...rgb)).toBeLessThan(25);
    for (const rgb of await pixels(page, 'c-optos.webp', [[0.5, 0.03], [0.05, 0.12]])) expect(Math.max(...rgb)).toBeLessThan(25);
    // The photo on screen still opens after its file was replaced.
    await expect(page.getByTestId('count')).toHaveText('3 / 3');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('canvas.display.full')).toBeVisible();
  });

  test('cancelling the confirmation, or pressing Esc, leaves every original byte-identical', async ({ page }) => {
    await seed(page, threeOnDisk());
    const before = await disk(page);
    await importFolder(page);
    await expect(page.locator('.film')).toHaveCount(3);
    await type(page, 'notes');
    await overwrite(page, 'cancel');
    await expect(page.getByTestId('dialog')).toHaveCount(0);
    expect(await disk(page)).toEqual(before);
    // Esc also cancels.
    await page.getByTestId('export-overwrite').click();
    await expect(page.getByTestId('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('dialog')).toHaveCount(0);
    expect(await disk(page)).toEqual(before);
  });

  test('the confirmation names the files, warns about missing boxes, and defaults to Cancel', async ({ page }) => {
    await seed(page, threeOnDisk());
    await importFolder(page);
    await expect(page.locator('.film')).toHaveCount(3);
    await page.getByTestId('export-menu').click();
    await page.getByTestId('export-overwrite').click();
    const dialog = page.getByTestId('dialog');
    await expect(dialog).toContainText('permanently replaces 3 original photos');
    await expect(dialog).toContainText('cannot get them back'.replace('cannot', 'cannot'));
    await expect(dialog).toContainText('a-notes.jpg');
    await expect(dialog).toContainText('c-optos.webp');
    await expect(dialog).toContainText('No black boxes on images 1, 2, 3');
    await expect(page.getByTestId('dialog-cancel')).toBeFocused();
  });

  test('photos not opened from a folder are never touched, and are called out', async ({ page }) => {
    await seed(page, [{ name: 'a.jpg', from: fixtures.notes, as: 'image/jpeg' }, { name: 'b.png', from: fixtures.cirrus, as: 'image/png' }]);
    await page.getByTestId('file-input').setInputFiles(fixtures.optos2);
    await expect(page.locator('.film')).toHaveCount(1);
    // Only a normal import: no overwrite option, just an explanation.
    await page.getByTestId('export-menu').click();
    await expect(page.getByTestId('export-overwrite')).toHaveCount(0);
    await expect(page.getByTestId('overwrite-hint')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByTestId('export-menu').click();
    await importFolder(page);
    await expect(page.locator('.film')).toHaveCount(3);
    await page.getByTestId('export-menu').click();
    await expect(page.getByTestId('export-overwrite')).toContainText('2 of 3');
    await page.getByTestId('export-overwrite').click();
    await expect(page.getByTestId('dialog')).toContainText('1 other photo was not imported from a folder and will not be changed');
    await page.getByTestId('dialog-cancel').click();
  });

  test('a file edited on disk since import is flagged; Skip keeps it, Cancel stops everything', async ({ page }) => {
    await seed(page, [{ name: 'a.jpg', from: fixtures.notes, as: 'image/jpeg' }, { name: 'b.png', from: fixtures.cirrus, as: 'image/png' }]);
    await importFolder(page);
    await expect(page.locator('.film')).toHaveCount(2);
    await type(page, 'notes');
    await page.keyboard.press('ArrowRight');
    await type(page, 'cirrus');
    // Someone else changes b.png after it was opened.
    await seed(page, [{ name: 'b.png', text: 'edited elsewhere, longer than before' }]);
    const edited = await disk(page);

    // Cancel everything: nothing at all is written.
    await overwrite(page, 'go');
    await expect(page.getByTestId('dialog')).toContainText('1 file has changed since you opened it');
    await expect(page.getByTestId('dialog')).toContainText('b.png');
    await expect(page.getByTestId('dialog-skip')).toBeFocused();
    await page.getByTestId('dialog-cancel').click();
    expect(await disk(page)).toEqual(edited);

    // Skip: a.jpg is replaced, b.png keeps the newer content.
    await overwrite(page, 'go');
    await page.getByTestId('dialog-skip').click();
    await expect(page.getByText(/Replaced 1 original\./)).toBeVisible();
    await expect(page.getByText(/Skipped 1: b\.png: changed on disk since import/)).toBeVisible();
    const after = await disk(page);
    expect(after['b.png']).toEqual(edited['b.png']);
    expect(after['a.jpg'].hash).not.toBe(edited['a.jpg'].hash);
  });

  test('saving into a folder that already has files of that name asks first', async ({ page }) => {
    const old = { name: 'case-image-001.jpg', text: 'OLD FILE FROM LAST TIME' };
    await seed(page, [old]);
    const before = await disk(page);
    await page.getByTestId('file-input').setInputFiles([fixtures.notes, fixtures.cirrus]);
    await expect(page.locator('.film')).toHaveCount(2);
    await type(page, 'notes');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowRight');
    await type(page, 'cirrus');
    await page.keyboard.press('Enter');
    const save = async (clashing = 1) => {
      await openExport(page);
      await page.getByRole('button', { name: 'Save to a folder…' }).click();
      await expect(page.getByTestId('dialog')).toContainText(`${clashing} of 2 files already exist`);
      await expect(page.getByTestId('dialog')).toContainText('case-image-001.jpg');
      await expect(page.getByTestId('dialog-cancel')).toBeFocused();
    };

    // Cancel: nothing is written.
    await save();
    await page.getByTestId('dialog-cancel').click();
    expect(await disk(page)).toEqual(before);

    // Keep both: the old file is untouched, new ones get free names.
    await save();
    await page.getByTestId('dialog-keep').click();
    await expect(page.getByText('Exported 2 images.')).toBeVisible();
    const kept = await disk(page);
    expect(Object.keys(kept).sort()).toEqual(['case-image-001 (2).jpg', 'case-image-001.jpg', 'case-image-002.jpg']);
    expect(kept['case-image-001.jpg']).toEqual(before['case-image-001.jpg']);
    expect(kept['case-image-001 (2).jpg'].magic.startsWith('ffd8ff')).toBe(true);

    // Replace: the old file really is overwritten (now both names exist, so both are listed).
    await save(2);
    await page.getByTestId('dialog-replace').click();
    await expect(page.getByText('Exported 2 images.').first()).toBeVisible();
    const replaced = await disk(page);
    expect(replaced['case-image-001.jpg'].hash).not.toBe(before['case-image-001.jpg'].hash);
    expect(replaced['case-image-001.jpg'].magic.startsWith('ffd8ff')).toBe(true);
  });

  test('saving into a folder with no clashes does not ask anything', async ({ page }) => {
    await page.getByTestId('file-input').setInputFiles([fixtures.notes, fixtures.cirrus]);
    await expect(page.locator('.film')).toHaveCount(2);
    await type(page, 'notes');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowRight');
    await type(page, 'cirrus');
    await page.keyboard.press('Enter');
    await page.getByTestId('export-menu').click();
    await page.getByRole('button', { name: 'Save to a folder…' }).click();
    await expect(page.getByText('Exported 2 images.')).toBeVisible();
    await expect(page.getByTestId('dialog')).toHaveCount(0);
    expect(Object.keys(await disk(page)).sort()).toEqual(['case-image-001.jpg', 'case-image-002.jpg']);
  });


  // --- Saving just the current photo ---------------------------------------------------------
  const saveCalls = (page: Page) => page.evaluate(() => (window as unknown as { __saveCalls: number }).__saveCalls);

  test('Save writes this photo as a new "(redacted)" file, then updates the same file on later presses', async ({ page }) => {
    await page.getByTestId('file-input').setInputFiles([fixtures.notes, fixtures.cirrus]);
    await expect(page.locator('.film')).toHaveCount(2);
    await expect(page.getByTestId('filename')).toHaveText('notes.png');
    await type(page, 'notes');
    const save = page.getByTestId('save');
    await expect(save).toHaveText('Save');
    await save.click();
    await expect(page.getByText('Saved “notes (redacted).png”.')).toBeVisible();
    await expect(save).toHaveText('Saved ✓');
    await expect(save).toBeDisabled();
    // Stays on the photo, and it's now marked done and saved.
    await expect(page.getByTestId('count')).toHaveText('1 / 2');
    await expect(page.locator('.film-badge.done')).toHaveCount(1);
    await expect(page.locator('.film-saved')).toHaveCount(1);
    expect(await saveCalls(page)).toBe(1);
    const first = await disk(page);
    expect(Object.keys(first)).toEqual(['notes (redacted).png']);
    expect(first['notes (redacted).png'].magic).toBe('89504e47');
    for (const rgb of await pixels(page, 'notes (redacted).png', [[0.75, 0.08], [0.9, 0.15]])) expect(Math.max(...rgb)).toBeLessThan(25);

    // Change something: the button comes back as "Update file", and rewrites the same file without asking again.
    await page.getByTestId('draw').click();
    const s = (await page.getByTestId('redact-surface').boundingBox())!;
    await page.mouse.move(s.x + 30, s.y + 150);
    await page.mouse.down();
    await page.mouse.move(s.x + 140, s.y + 190, { steps: 4 });
    await page.mouse.up();
    await expect(save).toHaveText('Update file');
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByText('Updated “notes (redacted).png”.')).toBeVisible();
    await expect(save).toHaveText('Saved ✓');
    expect(await saveCalls(page)).toBe(1);
    const second = await disk(page);
    expect(Object.keys(second)).toEqual(['notes (redacted).png']);
    expect(second['notes (redacted).png'].hash).not.toBe(first['notes (redacted).png'].hash);
  });

  test('Ctrl+S saves the current photo', async ({ page }) => {
    await page.getByTestId('file-input').setInputFiles(fixtures.cirrus);
    await type(page, 'cirrus');
    await page.keyboard.press('Control+s');
    await expect(page.getByText('Saved “cirrus (redacted).png”.')).toBeVisible();
    expect(Object.keys(await disk(page))).toEqual(['cirrus (redacted).png']);
  });

  test('without a save dialog (phones) Save downloads a "(redacted)" file', async ({ page }) => {
    await page.addInitScript(() => delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker);
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles(fixtures.notes);
    await type(page, 'notes');
    const download = page.waitForEvent('download');
    await page.getByTestId('save').click();
    expect((await download).suggestedFilename()).toBe('notes (redacted).png');
    await expect(page.getByTestId('save')).toHaveText('Saved ✓');
  });

  test('Overwrite replaces the original after a quick confirmation; Cancel changes nothing', async ({ page }) => {
    await seed(page, [{ name: 'a.jpg', from: fixtures.notes, as: 'image/jpeg' }]);
    const before = await disk(page);
    await importFolder(page);
    await expect(page.getByTestId('filename')).toHaveText('a.jpg');
    await type(page, 'notes');
    await expect(page.getByTestId('save')).toHaveText('Overwrite');
    await page.getByTestId('save').click();
    await expect(page.getByTestId('dialog')).toContainText('Replace “a.jpg”?');
    await expect(page.getByTestId('dialog-cancel')).toBeFocused();
    await expect(page.getByTestId('dialog-tick')).toHaveCount(0); // quick confirm: no tick box
    await page.getByTestId('dialog-cancel').click();
    expect(await disk(page)).toEqual(before);
    await expect(page.getByTestId('save')).toHaveText('Overwrite');

    await page.getByTestId('save').click();
    await page.getByTestId('dialog-go').click();
    await expect(page.getByText('Replaced “a.jpg”.')).toBeVisible();
    const after = await disk(page);
    expect(Object.keys(after)).toEqual(['a.jpg']);
    expect(after['a.jpg'].magic.startsWith('ffd8ff')).toBe(true);
    expect(after['a.jpg'].hash).not.toBe(before['a.jpg'].hash);
    for (const rgb of await pixels(page, 'a.jpg', [[0.75, 0.08], [0.9, 0.15]])) expect(Math.max(...rgb)).toBeLessThan(25);
    await expect(page.getByTestId('save')).toHaveText('Saved ✓');
    expect(await saveCalls(page)).toBe(0); // never opened the save dialog
  });

  test('Overwrite still stops if the file changed on disk after it was opened', async ({ page }) => {
    await seed(page, [{ name: 'a.jpg', from: fixtures.notes, as: 'image/jpeg' }]);
    await importFolder(page);
    await type(page, 'notes');
    await seed(page, [{ name: 'a.jpg', text: 'someone else saved a different file here' }]);
    const edited = await disk(page);
    await page.getByTestId('save').click();
    await page.getByTestId('dialog-go').click();
    await expect(page.getByTestId('dialog')).toContainText('“a.jpg” has changed since you opened it');
    await expect(page.getByTestId('dialog-cancel')).toBeFocused();
    await page.getByTestId('dialog-cancel').click();
    expect(await disk(page)).toEqual(edited);
    await page.getByTestId('save').click();
    await page.getByTestId('dialog-go').click();
    await page.getByTestId('dialog-go').click(); // "Overwrite anyway"
    await expect(page.getByText('Replaced “a.jpg”.')).toBeVisible();
    expect((await disk(page))['a.jpg'].hash).not.toBe(edited['a.jpg'].hash);
  });

  test('ending the session forgets the folder handles', async ({ page }) => {
    await seed(page, threeOnDisk());
    await importFolder(page);
    await expect(page.locator('.film')).toHaveCount(3);
    page.once('dialog', (d) => d.accept());
    await page.getByTestId('app-menu').click();
    await page.getByRole('button', { name: 'End session' }).click();
    await expect(page.locator('.film')).toHaveCount(0);
    const stored = await page.evaluate(async () => ({ ls: Object.keys(localStorage), dbs: (await indexedDB.databases()).map((d) => d.name) }));
    expect(stored.ls).toEqual([]);
    expect(stored.dbs).toEqual([]);
  });
});

test.describe('deselecting the type', () => {
  test('tapping the chosen type again removes it and its boxes, and it stays off', async ({ page }) => {
    await page.getByTestId('file-input').setInputFiles([fixtures.notes, fixtures.cirrus]);
    await expect(page.locator('.film')).toHaveCount(2);
    await type(page, 'notes');
    await expect(page.locator('[data-type="notes"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.rbox')).toHaveCount(1);
    await type(page, 'notes'); // tap the chosen type again
    await expect(page.locator('[data-type="notes"]')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.rbox')).toHaveCount(0);
    await expect(page.getByText('Choose a type above to place the boxes')).toBeVisible();
    // Going on does not carry a type onto the next photo, and coming back does not quietly put it back.
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.rbox')).toHaveCount(0);
    await expect(page.locator('[data-type="notes"]')).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.rbox')).toHaveCount(0);
    await expect(page.locator('[data-type="notes"]')).toHaveAttribute('aria-pressed', 'false');
    // Choosing a type again works as before, and is carried forward again.
    await type(page, 'cirrus');
    await expect(page.locator('.rbox')).toHaveCount(4);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('[data-type="cirrus"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.rbox')).toHaveCount(4);
  });

  test('deselecting after editing the boxes asks first', async ({ page }) => {
    await page.getByTestId('file-input').setInputFiles(fixtures.notes);
    await type(page, 'notes');
    await page.getByTestId('draw').click();
    const s = (await page.getByTestId('redact-surface').boundingBox())!;
    await page.mouse.move(s.x + 30, s.y + 150);
    await page.mouse.down();
    await page.mouse.move(s.x + 140, s.y + 190, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.press('Escape');
    await expect(page.locator('.rbox')).toHaveCount(2);
    page.once('dialog', (d) => d.dismiss());
    await type(page, 'notes');
    await expect(page.locator('.rbox')).toHaveCount(2); // kept
    page.once('dialog', (d) => d.accept());
    await type(page, 'notes');
    await expect(page.locator('.rbox')).toHaveCount(0);
  });
});

test.describe('file name, zoom and the box tool', () => {
  /** A big photo as an upload payload, so zoom percentages can be checked against real pixels. */
  async function bigPhoto(page: Page, w = 4000, h = 3000) {
    const b64 = await page.evaluate(
      async ([w, h]) => {
        const c = new OffscreenCanvas(w, h);
        const ctx = c.getContext('2d')!;
        const g = ctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(1, '#8899aa');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        const blob = await c.convertToBlob({ type: 'image/png' });
        let s = '';
        const bytes = new Uint8Array(await blob.arrayBuffer());
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(s);
      },
      [w, h],
    );
    return { name: 'big-photo.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') };
  }
  const surfaceWidth = async (page: Page) => Math.round((await page.getByTestId('redact-surface').boundingBox())!.width);
  const zoomTo = async (page: Page, label: string | RegExp) => {
    await page.getByTestId('zoom-menu').click();
    await page.getByRole('button', { name: label }).click();
  };

  test('the file name is shown, truncated with the full name on hover', async ({ page }) => {
    const long = 'a-very-long-original-file-name-from-the-clinic-camera-2026-10-08-sequence-0001.png';
    await page.getByTestId('file-input').setInputFiles([
      { name: long, mimeType: 'image/png', buffer: readFileSync(fixtures.notes) },
      { name: 'cirrus.png', mimeType: 'image/png', buffer: readFileSync(fixtures.cirrus) },
    ]);
    await expect(page.locator('.film')).toHaveCount(2);
    await expect(page.getByTestId('filename')).toHaveText(long);
    await expect(page.getByTestId('filename')).toHaveAttribute('title', long);
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('filename')).toHaveText('cirrus.png');
  });

  for (const c of [
    { name: 'phone 390', viewport: { width: 390, height: 844 }, font: null },
    { name: 'phone 360 in a wide font', viewport: { width: 360, height: 740 }, font: 'DejaVu Sans' },
  ]) {
    test(`the file bar stays on one row with a long name: ${c.name}`, async ({ page }) => {
      await page.setViewportSize(c.viewport);
      if (c.font) await page.addStyleTag({ content: `html,body,button,select,input,textarea{font-family:'${c.font}' !important}` });
      await page.getByTestId('file-input').setInputFiles({ name: 'a-very-long-original-file-name-from-the-clinic-camera-2026-10-08-0001.png', mimeType: 'image/png', buffer: readFileSync(fixtures.notes) });
      await type(page, 'notes');
      const bar = (await page.getByTestId('filebar').boundingBox())!;
      expect(bar.height).toBeLessThanOrEqual(48);
      for (const id of ['copy', 'save']) await expect(page.getByTestId(id)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const surface = (await page.getByTestId('redact-surface').boundingBox())!;
      expect(surface.y).toBeLessThanOrEqual(160);
      // Photo, file bar and filmstrip all fit on the screen together.
      const film = (await page.locator('.filmstrip').boundingBox())!;
      expect(bar.y + bar.height).toBeLessThanOrEqual(film.y + 1);
    });
  }

  test('zoom: Fit shows the whole photo, 100% is one photo pixel per screen pixel', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('file-input').setInputFiles(await bigPhoto(page));
    await type(page, 'notes');
    await expect(page.getByTestId('zoom-menu')).toHaveText(/Fit/);
    const frame = (await page.locator('.viewport').boundingBox())!;
    const fit = await surfaceWidth(page);
    expect(fit).toBeLessThan(frame.width); // whole photo fits in the frame
    expect((await page.getByTestId('redact-surface').boundingBox())!.height).toBeLessThanOrEqual(frame.height);

    await zoomTo(page, /100%/);
    await expect(page.getByTestId('zoom-menu')).toHaveText(/100%/);
    expect(await surfaceWidth(page)).toBe(4000); // 4000-pixel-wide photo at 1 px per px
    // Zoomed in, the photo is decoded at full size (not the 2400 px working copy) so it's sharp.
    await expect.poll(() => page.locator('canvas.display.full').evaluate((c: HTMLCanvasElement) => c.width)).toBe(4000);
    await zoomTo(page, /^200%/);
    expect(await surfaceWidth(page)).toBe(8000);
    await zoomTo(page, /^50%/);
    expect(await surfaceWidth(page)).toBe(2000);
    await zoomTo(page, /Fit to screen/);
    expect(await surfaceWidth(page)).toBe(fit);
    await expect(page.getByTestId('zoom-menu')).toHaveText(/Fit/);
  });

  test('zoom keys: 1 for 100%, F for fit', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('file-input').setInputFiles(await bigPhoto(page, 3000, 2000));
    await type(page, 'notes');
    await page.keyboard.press('1');
    await expect(page.getByTestId('zoom-menu')).toHaveText(/100%/);
    expect(await surfaceWidth(page)).toBe(3000);
    await page.keyboard.press('f');
    await expect(page.getByTestId('zoom-menu')).toHaveText(/Fit/);
    expect(await surfaceWidth(page)).toBeLessThan(1280);
  });

  test.describe('on a high-density screen', () => {
    test.use({ deviceScaleFactor: 2 });
    test('100% means one photo pixel per device pixel', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.getByTestId('file-input').setInputFiles(await bigPhoto(page, 3000, 2000));
      await type(page, 'notes');
      await page.keyboard.press('1');
      expect(await surfaceWidth(page)).toBe(1500); // 3000 photo pixels on a 2x screen
    });
  });

  test('zooming in keeps the selected box in view', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('file-input').setInputFiles(await bigPhoto(page));
    await type(page, 'notes'); // preset box sits in the top-right corner
    await page.locator('.rbox').first().click({ position: { x: 10, y: 10 } });
    await page.keyboard.press('1');
    await expect(page.getByTestId('zoom-menu')).toHaveText(/100%/);
    const frame = (await page.locator('.viewport').boundingBox())!;
    await expect
      .poll(async () => {
        const b = (await page.locator('.rbox.selected').boundingBox())!;
        const cx = b.x + b.width / 2;
        const cy = b.y + b.height / 2;
        return cx > frame.x && cx < frame.x + frame.width && cy > frame.y && cy < frame.y + frame.height;
      })
      .toBe(true);
  });

  test('+ Box stays on until you turn it off, so several boxes can be drawn in a row', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('file-input').setInputFiles([fixtures.notes, fixtures.cirrus]);
    await expect(page.locator('.film')).toHaveCount(2);
    await type(page, 'notes');
    await expect(page.locator('.rbox')).toHaveCount(1);
    const draw = page.getByTestId('draw');
    await expect(draw).toHaveAttribute('aria-pressed', 'false');
    await draw.click();
    await expect(draw).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(/Drawing: drag for each box/)).toBeVisible();
    const s = (await page.getByTestId('redact-surface').boundingBox())!;
    for (const y of [140, 200, 260]) {
      await page.mouse.move(s.x + 30, s.y + y);
      await page.mouse.down();
      await page.mouse.move(s.x + 150, s.y + y + 30, { steps: 4 });
      await page.mouse.up();
    }
    await expect(page.locator('.rbox')).toHaveCount(4); // the preset plus three drawn without touching the button again
    await expect(draw).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(draw).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText(/Drawing: drag for each box/)).toHaveCount(0);
    // Dragging on empty photo no longer draws.
    await page.mouse.move(s.x + 30, s.y + 320);
    await page.mouse.down();
    await page.mouse.move(s.x + 150, s.y + 350, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('.rbox')).toHaveCount(4);
    // Moving to another photo ends it too.
    await draw.click();
    await expect(draw).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(draw).toHaveAttribute('aria-pressed', 'false');
  });
});

test.describe('touch', () => {
  test.use({ hasTouch: true, viewport: { width: 420, height: 800 } });

  /** A real touch gesture (pointerType "touch") dispatched through the browser. */
  async function swipe(page: Page, from: [number, number], to: [number, number]) {
    const cdp = await page.context().newCDPSession(page);
    const pt = (p: [number, number]) => [{ x: p[0], y: p[1] }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(from) });
    for (let i = 1; i <= 5; i++) {
      const x = from[0] + ((to[0] - from[0]) * i) / 5;
      const y = from[1] + ((to[1] - from[1]) * i) / 5;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt([x, y]) });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }

  test('swiping the photo moves to the next and previous photo', async ({ page }) => {
    await importThree(page);
    await expect(page.locator('.film')).toHaveCount(3);
    await expect(page.getByTestId('count')).toHaveText('1 / 3');
    const s = (await page.getByTestId('redact-surface').boundingBox())!;
    const y = s.y + s.height * 0.6;
    // Swipe left = next photo.
    await swipe(page, [s.x + s.width * 0.8, y], [s.x + s.width * 0.2, y + 5]);
    await expect(page.getByTestId('count')).toHaveText('2 / 3');
    // Swipe right = previous photo.
    const s2 = (await page.getByTestId('redact-surface').boundingBox())!;
    await swipe(page, [s2.x + s2.width * 0.2, s2.y + s2.height * 0.6], [s2.x + s2.width * 0.8, s2.y + s2.height * 0.6 - 5]);
    await expect(page.getByTestId('count')).toHaveText('1 / 3');
  });

  test('short, vertical or box-dragging touches do not change photo', async ({ page }) => {
    await page.getByTestId('file-input').setInputFiles([fixtures.notes, fixtures.cirrus]);
    await expect(page.locator('.film')).toHaveCount(2);
    await type(page, 'notes');
    const s = (await page.getByTestId('redact-surface').boundingBox())!;
    await swipe(page, [s.x + s.width * 0.5, s.y + s.height * 0.6], [s.x + s.width * 0.5 - 20, s.y + s.height * 0.6]);
    await swipe(page, [s.x + s.width * 0.8, s.y + s.height * 0.5], [s.x + s.width * 0.3, s.y + s.height * 0.8]);
    // Dragging the preset box sideways moves the box, not the photo.
    const box = (await page.locator('.rbox').first().boundingBox())!;
    await swipe(page, [box.x + box.width / 2, box.y + box.height / 2], [box.x + box.width / 2 - 100, box.y + box.height / 2]);
    await expect(page.getByTestId('count')).toHaveText('1 / 2');
  });
});
