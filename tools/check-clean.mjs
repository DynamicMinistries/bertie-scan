// node tools/check-clean.mjs <folder> <name> <filter>: straightens and cleans one test photo, writes raw pixels
import fs from 'fs';
import { refineQuad, detectQuad } from '../docs/js/detect.js';
import { warp, enhance } from '../docs/js/imageproc.js';
const [dir, name, ...filters] = process.argv.slice(2);
const raw = fs.readdirSync(dir + '_full').find(f => f.startsWith(name));
const [, w, h] = raw.match(/(\d+)x(\d+)\.rgba$/).map(Number);
const data = new Uint8ClampedArray(fs.readFileSync(`${dir}_full/${raw}`));
const sm = fs.readdirSync(dir + '_320').find(f => f.startsWith(name)), [, sw, sh] = sm.match(/(\d+)x(\d+)\.rgba$/).map(Number);
const r = detectQuad(fs.readFileSync(`${dir}_320/${sm}`), sw, sh);
const q = refineQuad(data, w, h, r.quad.map(p => [(p[0] + .5) * w / sw, (p[1] + .5) * h / sh]), 20);
console.log(r.score);
let t = performance.now(); const p = warp({ data, width: w, height: h }, q, 3000); console.log('warp', performance.now() - t | 0, p.width, p.height);
for (const f of filters) { t = performance.now(); const e = enhance(p, f); console.log(f, performance.now() - t | 0); fs.writeFileSync(`${dir}_out_${name}_${f}_${e.width}x${e.height}.raw`, e.data); }
