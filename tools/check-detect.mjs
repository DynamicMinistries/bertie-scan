// Scores page finding against pretend photos with known corners.
// python tools/make_test_photos.py <folder>   then   node tools/check-detect.mjs <folder>
import fs from 'fs';
import path from 'path';
import { detectQuad, findPage } from '../docs/js/detect.js';
import { trueAspect, snapAspect } from '../docs/js/imageproc.js';

const dir = process.argv[2], truth = JSON.parse(fs.readFileSync(path.join(dir, 'truth.json')));
const load = (s, n) => {
  const f = fs.readdirSync(`${dir}_${s}`).find(f => f.startsWith(n + '_'));
  const [, w, h] = f.match(/(\d+)x(\d+)\.rgba$/);
  return { d: fs.readFileSync(`${dir}_${s}/${f}`), w: +w, h: +h };
};
let bad = 0, ms = 0;
const names = Object.keys(truth);
for (const n of names) {
  const t = truth[n], a = load(320, n), b = load(1200, n);
  const t0 = performance.now(); const r = detectQuad(a.d, a.w, a.h); ms += performance.now() - t0;
  if (!r) { console.log(n, 'NOT FOUND'); bad++; continue; }
  const ref = findPage({ data: a.d, width: a.w, height: a.h }, { data: b.d, width: b.w, height: b.h }).quad;
  const err = (q, w) => Math.max(...q.map((p, i) => Math.hypot(p[0] / w - t.quad[i][0] / t.w, p[1] / w - t.quad[i][1] / t.w))) * 100;
  const e1 = err(r.quad, a.w), e2 = err(ref, b.w), asp = trueAspect(ref, b.w, b.h);
  if (e2 > 1.2) bad++;
  console.log(n.padEnd(22), 'score', r.score.toFixed(2), 'rough', e1.toFixed(2) + '%', 'fine', e2.toFixed(2) + '%',
    'shape', (asp / t.aspect).toFixed(3), Math.abs(snapAspect(asp) - t.aspect) < .001 ? 'snap' : 'no-snap', e2 > 1.2 ? '<<<<' : '');
}
console.log('bad', bad, 'of', names.length, ' ms each', (ms / names.length).toFixed(0));
