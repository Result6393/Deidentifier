// Copies the OCR engine and English language data into public/vendor so the
// app never loads code or data from a CDN. Run automatically by dev/build.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const out = join(process.cwd(), 'public', 'vendor', 'tesseract');
mkdirSync(out, { recursive: true });

const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));
const files = [
  [join(pkgDir('tesseract.js'), 'dist', 'worker.min.js'), 'worker.min.js'],
  [join(pkgDir('tesseract.js-core'), 'tesseract-core-lstm.wasm.js'), 'tesseract-core-lstm.wasm.js'],
  [join(pkgDir('tesseract.js-core'), 'tesseract-core-simd-lstm.wasm.js'), 'tesseract-core-simd-lstm.wasm.js'],
  // "best_int" is the smaller integer model used by tesseract.js for LSTM-only OCR.
  [join(pkgDir('@tesseract.js-data/eng'), '4.0.0_best_int', 'eng.traineddata.gz'), 'eng.traineddata.gz'],
];

for (const [src, name] of files) {
  if (!existsSync(src)) throw new Error(`Missing vendor file: ${src}`);
  copyFileSync(src, join(out, name));
}
console.log(`Vendored ${files.length} OCR files into public/vendor/tesseract`);
