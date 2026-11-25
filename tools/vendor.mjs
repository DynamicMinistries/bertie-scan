// Copies the text-reading engine out of node_modules into docs/vendor (run after npm install).
import fs from 'fs';
const N = new URL('../node_modules/', import.meta.url), V = new URL('../docs/vendor/', import.meta.url);
fs.mkdirSync(new URL('core/', V), { recursive: true }); fs.mkdirSync(new URL('lang/', V), { recursive: true });
const cp = (a, b) => fs.copyFileSync(new URL(a, N), new URL(b, V));
cp('tesseract.js/dist/tesseract.min.js', 'tesseract.min.js');
cp('tesseract.js/dist/worker.min.js', 'worker.min.js');
cp('tesseract.js/LICENSE.md', 'LICENSE-tesseract.txt');
for (const k of ['lstm', 'simd-lstm', 'relaxedsimd-lstm']) cp(`tesseract.js-core/tesseract-core-${k}.wasm.js`, `core/tesseract-core-${k}.wasm.js`);
for (const l of ['eng', 'afr']) cp(`@tesseract.js-data/${l}/4.0.0_best_int/${l}.traineddata.gz`, `lang/${l}.traineddata.gz`);
