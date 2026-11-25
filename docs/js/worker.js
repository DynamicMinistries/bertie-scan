// Does the heavy picture work in the background so the screen stays smooth.
import { detectQuad, findPage } from './detect.js';
import { warp, rotate, enhance, shrink } from './imageproc.js';
import { packBits } from './pdf.js';

const MAX_SIDE = 4096, MAX_AREA = 14e6;

async function bitmap(blob) {
  try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch { return createImageBitmap(blob); }
}

function toPixels(bm, maxSide = MAX_SIDE) {
  const k = Math.min(1, maxSide / Math.max(bm.width, bm.height), Math.sqrt(MAX_AREA / (bm.width * bm.height)));
  const w = Math.max(1, Math.round(bm.width * k)), h = Math.max(1, Math.round(bm.height * k));
  const c = new OffscreenCanvas(w, h), g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(bm, 0, 0, w, h);
  return g.getImageData(0, 0, w, h);
}

async function toBlob(img, type = 'image/jpeg', quality = 0.9) {
  const c = new OffscreenCanvas(img.width, img.height);
  c.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  return c.convertToBlob({ type, quality });
}

// the last opened photo and its straightened version are kept for a moment, so changing the look is quick
let cache = {}, timer;
function touch() { clearTimeout(timer); timer = setTimeout(() => { cache = {}; }, 20000); }

async function source(key, blob) {
  touch();
  if (cache.key !== key) cache = { key, src: toPixels(await bitmap(blob)) };
  return cache.src;
}
async function straight(key, blob, quad, rot, maxSide) {
  const src = await source(key, blob), id = JSON.stringify([quad, rot, maxSide]);
  if (cache.id !== id) {
    const q = quad.map(p => [p[0] * src.width, p[1] * src.height]);
    const whole = quad.every((p, i) => p[0] === (i === 1 || i === 2 ? 1 : 0) && p[1] === (i > 1 ? 1 : 0));
    const page = whole ? shrink({ data: new Uint8ClampedArray(src.data), width: src.width, height: src.height }, maxSide) : warp(src, q, maxSide);
    cache.page = rotate(page, rot); cache.id = id; cache.small = null;
  }
  return cache.page;
}

function findIn(src) {
  const b = shrink(src, 1200), r = findPage(shrink(src, 320), b);
  if (!r) return null;
  const q = r.quad;
  return { score: r.score, quad: q.map(p => [Math.max(0, Math.min(1, (p[0] + 0.5) / b.width)), Math.max(0, Math.min(1, (p[1] + 0.5) / b.height))]) };
}

const ops = {
  detect({ data, w, h }) {
    const r = detectQuad(new Uint8ClampedArray(data), w, h);
    return r && { score: r.score, area: r.area, quad: r.quad.map(p => [(p[0] + 0.5) / w, (p[1] + 0.5) / h]) };
  },
  async find({ key, blob }) {
    const src = await source(key, blob);
    return { width: src.width, height: src.height, found: findIn(src) };
  },
  // keeps the original photo at a sensible size
  async normalise({ key, blob }) {
    const bm = await bitmap(blob);
    const big = Math.max(bm.width, bm.height) > MAX_SIDE || bm.width * bm.height > MAX_AREA;
    if (!big && blob.type === 'image/jpeg') { cache = { key, src: toPixels(bm) }; touch(); return { blob }; }
    const px = toPixels(bm);
    cache = { key, src: px }; touch();
    return { blob: await toBlob(px, 'image/jpeg', 0.92) };
  },
  async process({ key, blob, quad, rot, filter, bright, contrast, maxSide = 3200 }) {
    const page = await straight(key, blob, quad, rot, maxSide);
    const out = enhance(page, filter, bright, contrast);
    const main = filter === 'bw' ? await toBlob(out, 'image/png') : await toBlob(out, 'image/jpeg', 0.9);
    const thumb = await toBlob(shrink(out, 420), 'image/jpeg', 0.82);
    return { blob: main, thumb, width: out.width, height: out.height };
  },
  async looks({ key, blob, quad, rot, filters }) {
    const page = await straight(key, blob, quad, rot, 3200);
    const s = cache.small || (cache.small = shrink(page, 260));
    const out = {};
    for (const f of filters) out[f] = await toBlob(enhance(s, f), 'image/jpeg', 0.8);
    return out;
  },
  async adjustPreview({ key, blob, quad, rot, filter, bright, contrast }) {
    const page = await straight(key, blob, quad, rot, 3200);
    if (!cache.mid) cache.mid = {};
    if (cache.mid.id !== cache.id) cache.mid = { id: cache.id, img: shrink(page, 1000) };
    return toBlob(enhance(cache.mid.img, filter, bright, contrast), 'image/jpeg', 0.88);
  },
  async pdfPage({ blob, filter, maxSide, quality }) {
    const img = toPixels(await bitmap(blob), filter === 'bw' ? MAX_SIDE : maxSide);
    if (filter === 'bw') return packBits(img);
    const j = await toBlob(img, 'image/jpeg', quality);
    return { kind: 'jpeg', bytes: new Uint8Array(await j.arrayBuffer()), width: img.width, height: img.height };
  },
  async jpeg({ blob, maxSide, quality }) {
    const img = toPixels(await bitmap(blob), maxSide);
    return { blob: await toBlob(img, 'image/jpeg', quality), width: img.width, height: img.height };
  },
};

let chain = Promise.resolve();
self.onmessage = e => {
  const { id, op, args } = e.data;
  chain = chain.then(async () => {
    try { self.postMessage({ id, ok: await ops[op](args) }); } catch (err) { self.postMessage({ id, err: String(err && err.message || err) }); }
  });
};
