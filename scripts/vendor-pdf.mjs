// Copies the parts of pdf.js the app needs into public/vendor/pdfjs, so PDFs are read with code
// served from the app's own origin (and cached for offline use). Never copies the scripting engine:
// the app does not run JavaScript embedded in PDFs.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = dirname(require.resolve('pdfjs-dist/package.json'));
const out = join(process.cwd(), 'public', 'vendor', 'pdfjs');

const copy = (from, to) => {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
};

// The legacy build includes polyfills, so it runs on browsers without the newest JavaScript.
copy(join(pkg, 'legacy', 'build', 'pdf.worker.min.mjs'), join(out, 'pdf.worker.min.mjs'));
copy(join(pkg, 'LICENSE'), join(out, 'LICENSE'));
for (const dir of ['wasm', 'standard_fonts', 'iccs']) {
  for (const f of readdirSync(join(pkg, dir))) {
    if (f.startsWith('quickjs')) continue;
    copy(join(pkg, dir, f), join(out, dir, f));
  }
}
console.log('Vendored pdf.js into public/vendor/pdfjs');
