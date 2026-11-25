// Straightens a photographed page and cleans it up. Own code, no libraries.

export function homography(from, to) {
  // solves for the 8 numbers that map the four "from" points onto the four "to" points
  const A = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i], [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    const d = A[c][c] || 1e-12;
    for (let k = c; k < 9; k++) A[c][k] /= d;
    for (let r = 0; r < 8; r++) if (r !== c) {
      const f = A[r][c];
      if (f) for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map(r => r[8]).concat(1);
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// True width-to-height of the sheet, allowing for the camera being held at an angle.
export function trueAspect(q, w, h) {
  const [tl, tr, br, bl] = q;
  const W = (dist(tl, tr) + dist(bl, br)) / 2, H = (dist(tl, bl) + dist(tr, br)) / 2;
  const flat = W / H;
  const u0 = w / 2, v0 = h / 2;
  const P = p => [p[0] - u0, p[1] - v0, 1];
  const m1 = P(tl), m2 = P(tr), m3 = P(bl), m4 = P(br);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const c14 = cross(m1, m4);
  const k2 = dot(c14, m3) / dot(cross(m2, m4), m3), k3 = dot(c14, m2) / dot(cross(m3, m4), m2);
  const n2 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 - 1], n3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 - 1];
  const longest = Math.max(w, h);
  let f = longest * 0.82; // an ordinary phone lens, used when the angle is too slight to work it out
  if (Math.abs(n2[2]) > 0.06 && Math.abs(n3[2]) > 0.06) {
    const f2 = -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2]);
    if (f2 > 0) { const ff = Math.sqrt(f2); if (ff > longest * 0.6 && ff < longest * 1.2) f = ff; }
  }
  const len2 = n => (n[0] * n[0] + n[1] * n[1]) / (f * f) + n[2] * n[2];
  const r = Math.sqrt(len2(n2) / len2(n3));
  if (!isFinite(r) || r / flat > 1.7 || flat / r > 1.7) return flat;
  return r;
}

const SHAPES = [210 / 297, 85.6 / 53.98]; // A4, bank or ID card
export function snapAspect(r) {
  for (const s of SHAPES) for (const t of [s, 1 / s]) if (Math.abs(Math.log(r / t)) < 0.06) return t;
  return r;
}

// src: {data,width,height}. Returns the flattened page.
// Pulls the corners in by a hair so no sliver of table shows at the page edge.
function insetQuad(q, f) {
  return q.map((p, i) => {
    const a = q[(i + 1) % 4], b = q[(i + 3) % 4];
    return [p[0] + (a[0] - p[0]) * f + (b[0] - p[0]) * f, p[1] + (a[1] - p[1]) * f + (b[1] - p[1]) * f];
  });
}

export function warp(src, quad, maxSide, aspect, trim = 0.004) {
  const { data: S, width: w, height: h } = src;
  if (trim) quad = insetQuad(quad, trim);
  const [tl, tr, br, bl] = quad;
  const W0 = Math.max(dist(tl, tr), dist(bl, br)), H0 = Math.max(dist(tl, bl), dist(tr, br));
  const r = aspect || snapAspect(trueAspect(quad, w, h));
  const H = Math.max(H0, W0 / r), Wd = H * r;
  const k = Math.min(1, maxSide / Math.max(H, Wd));
  const dw = Math.max(8, Math.round(Wd * k)), dh = Math.max(8, Math.round(H * k));
  const M = homography([[0, 0], [dw - 1, 0], [dw - 1, dh - 1], [0, dh - 1]], quad);
  const out = new Uint8ClampedArray(dw * dh * 4);
  // when shrinking a lot, average four points per pixel so thin writing is not lost
  const taps = Math.max(W0 / dw, H0 / dh) > 1.35 ? [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]] : [[0, 0]];
  const T = taps.length;
  let o = 0;
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++, o += 4) {
    let R = 0, G = 0, B = 0;
    for (let t = 0; t < T; t++) {
      const px = x + taps[t][0], py = y + taps[t][1];
      const z = M[6] * px + M[7] * py + 1;
      let sx = (M[0] * px + M[1] * py + M[2]) / z, sy = (M[3] * px + M[4] * py + M[5]) / z;
      if (sx < 0) sx = 0; else if (sx > w - 1.001) sx = w - 1.001;
      if (sy < 0) sy = 0; else if (sy > h - 1.001) sy = h - 1.001;
      const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0;
      const i = (y0 * w + x0) * 4, j = i + w * 4;
      const a = (1 - fx) * (1 - fy), b = fx * (1 - fy), c = (1 - fx) * fy, d = fx * fy;
      R += S[i] * a + S[i + 4] * b + S[j] * c + S[j + 4] * d;
      G += S[i + 1] * a + S[i + 5] * b + S[j + 1] * c + S[j + 5] * d;
      B += S[i + 2] * a + S[i + 6] * b + S[j + 2] * c + S[j + 6] * d;
    }
    out[o] = R / T; out[o + 1] = G / T; out[o + 2] = B / T; out[o + 3] = 255;
  }
  return { data: out, width: dw, height: dh };
}

export function rotate(img, quarter) {
  quarter = ((quarter % 4) + 4) % 4;
  if (!quarter) return img;
  const { width: w, height: h } = img;
  const s = new Uint32Array(img.data.buffer, img.data.byteOffset, w * h);
  const W = quarter % 2 ? h : w, H = quarter % 2 ? w : h;
  const d = new Uint32Array(W * H);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = s[y * w + x];
    if (quarter === 1) d[x * W + (W - 1 - y)] = v;
    else if (quarter === 2) d[(H - 1 - y) * W + (W - 1 - x)] = v;
    else d[(H - 1 - x) * W + y] = v;
  }
  return { data: new Uint8ClampedArray(d.buffer), width: W, height: H };
}

function maxFilter(p, w, h, r) {
  const t = new Float32Array(p.length), o = new Float32Array(p.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0; for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) m = Math.max(m, p[y * w + k]);
    t[y * w + x] = m;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0; for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) m = Math.max(m, t[k * w + x]);
    o[y * w + x] = m;
  }
  return o;
}

function smooth(p, w, h) {
  const o = new Float32Array(p.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, k = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      const q = (2 - Math.abs(dx)) * (2 - Math.abs(dy)); s += p[Y * w + X] * q; k += q;
    }
    o[y * w + x] = s / k;
  }
  return o;
}

// Estimates the colour of the bare paper everywhere on the page (shadows included).
function paperMap(img) {
  const { data: D, width: w, height: h } = img;
  const cell = Math.max(6, Math.round(Math.max(w, h) / 110));
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell), n = gw * gh;
  const C = [new Float32Array(n), new Float32Array(n), new Float32Array(n)], lum = new Float32Array(n);
  const st = Math.max(1, Math.floor(cell / 12));
  const hist = new Uint16Array(256);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    const x1 = Math.min(w, (gx + 1) * cell), y1 = Math.min(h, (gy + 1) * cell), g = gy * gw + gx;
    hist.fill(0); let cnt = 0;
    for (let y = gy * cell; y < y1; y += st) for (let x = gx * cell; x < x1; x += st) {
      const i = (y * w + x) * 4; hist[(D[i] * 77 + D[i + 1] * 150 + D[i + 2] * 29) >> 8]++; cnt++;
    }
    let acc = 0, v = 255; const need = Math.max(1, cnt * 0.3);
    while (v > 0 && acc + hist[v] < need) acc += hist[v--];
    let r = 0, gg = 0, b = 0, k = 0;
    for (let y = gy * cell; y < y1; y += st) for (let x = gx * cell; x < x1; x += st) {
      const i = (y * w + x) * 4, l = (D[i] * 77 + D[i + 1] * 150 + D[i + 2] * 29) >> 8;
      if (l >= v) { r += D[i]; gg += D[i + 1]; b += D[i + 2]; k++; }
    }
    C[0][g] = r / k; C[1][g] = gg / k; C[2][g] = b / k; lum[g] = (r * 77 + gg * 150 + b * 29) / k / 256;
  }
  // cells that are mostly ink or a photo are much darker, or more coloured, than the paper around them:
  // treat them as unknown and fill them in from their neighbours
  const wide = maxFilter(lum, gw, gh, Math.max(3, Math.round(Math.max(gw, gh) / 9)));
  const local = maxFilter(lum, gw, gh, 2);
  const top = Array.from(lum).sort((a, b) => a - b)[Math.floor(n * 0.9)];
  const ok = new Uint8Array(n);
  let good = 0;
  for (let g = 0; g < n; g++) {
    const mx = Math.max(C[0][g], C[1][g], C[2][g]), mn = Math.min(C[0][g], C[1][g], C[2][g]);
    ok[g] = lum[g] > wide[g] * 0.62 && lum[g] > local[g] * 0.86 && lum[g] > top * 0.28 && (mx - mn) / (mx + 1) < 0.42 ? 1 : 0;
    good += ok[g];
  }
  // Shadows fade in softly and keep the paper's tint; printed photos and colour blocks start sharply
  // and have their own tint. Spread out from the brightest paper across soft changes only.
  const reach = new Uint8Array(n), queue = [];
  for (let g = 0; g < n; g++) if (ok[g] && lum[g] > top * 0.93) { reach[g] = 1; queue.push(g); }
  let pr = 0, pg = 0, pb = 0;
  for (const g of queue) { pr += C[0][g]; pg += C[1][g]; pb += C[2][g]; }
  while (queue.length) {
    const g = queue.pop(), x = g % gw, y = (g / gw) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= gw || Y >= gh) continue;
      const q = Y * gw + X;
      if (!reach[q] && ok[q] && lum[q] > lum[g] * 0.88) { reach[q] = 1; queue.push(q); }
    }
  }
  good = 0;
  for (let g = 0; g < n; g++) if (ok[g]) {
    if (!reach[g]) {
      const a = (C[0][g] / C[1][g]) / (pr / pg), b = (C[2][g] / C[1][g]) / (pb / pg);
      if (Math.abs(a - 1) > 0.09 || Math.abs(b - 1) > 0.09 || lum[g] < top * 0.42) ok[g] = 0;
    }
    good += ok[g];
  }
  if (good < n * 0.12) ok.fill(1);
  for (let pass = 0; pass < gw + gh; pass++) {
    const add = [];
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const g = y * gw + x; if (ok[g]) continue;
      let s = 0, a = 0, b = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= gw || Y >= gh) continue;
        const q = Y * gw + X; if (!ok[q]) continue;
        s++; a += C[0][q]; b += C[1][q]; c += C[2][q];
      }
      if (s) add.push([g, a / s, b / s, c / s]);
    }
    if (!add.length) break;
    for (const [g, a, b, c] of add) { C[0][g] = a; C[1][g] = b; C[2][g] = c; ok[g] = 1; }
  }
  for (let c = 0; c < 3; c++) C[c] = smooth(smooth(C[c], gw, gh), gw, gh);
  return { C, gw, gh, cell };
}

// Divides the paper colour out: shadows go, paper turns white, ink stays.
function flatten(img) {
  const { data: D, width: w, height: h } = img;
  const { C, gw, gh, cell } = paperMap(img);
  const out = new Uint8ClampedArray(D.length);
  const xs = new Int32Array(w), xf = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const u = Math.max(0, Math.min(gw - 1.0001, (x + 0.5) / cell - 0.5));
    xs[x] = Math.min(u | 0, Math.max(0, gw - 2)); xf[x] = gw > 1 ? u - xs[x] : 0;
  }
  const row = [new Float32Array(gw), new Float32Array(gw), new Float32Array(gw)];
  for (let y = 0; y < h; y++) {
    const v = Math.max(0, Math.min(gh - 1.0001, (y + 0.5) / cell - 0.5));
    const y0 = Math.min(v | 0, Math.max(0, gh - 2)), fy = gh > 1 ? v - y0 : 0, y1 = Math.min(gh - 1, y0 + 1);
    for (let c = 0; c < 3; c++) for (let x = 0; x < gw; x++) row[c][x] = C[c][y0 * gw + x] * (1 - fy) + C[c][y1 * gw + x] * fy;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, a = xs[x], b = Math.min(gw - 1, a + 1), f = xf[x];
      for (let c = 0; c < 3; c++) out[i + c] = D[i + c] * 250 / Math.max(24, row[c][a] * (1 - f) + row[c][b] * f);
      out[i + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

function darkest(img, share) {
  const { data: D } = img, H = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < D.length; i += 16) { H[(D[i] * 77 + D[i + 1] * 150 + D[i + 2] * 29) >> 8]++; n++; }
  let acc = 0, v = 0; while (v < 255 && acc + H[v] < n * share) acc += H[v++];
  return v;
}

function sharpen(img, amount) {
  const { data: D, width: w, height: h } = img;
  const L = new Float32Array(w * h);
  for (let i = 0, j = 0; j < L.length; i += 4, j++) L[j] = D[i] * 0.3 + D[i + 1] * 0.59 + D[i + 2] * 0.11;
  const out = new Uint8ClampedArray(D);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const j = y * w + x;
    const b = (L[j] * 4 + (L[j - 1] + L[j + 1] + L[j - w] + L[j + w]) * 2 + L[j - w - 1] + L[j - w + 1] + L[j + w - 1] + L[j + w + 1]) / 16;
    const d = (L[j] - b) * amount;
    if (d > 1 || d < -1) { const i = j * 4; out[i] = D[i] + d; out[i + 1] = D[i + 1] + d; out[i + 2] = D[i + 2] + d; }
  }
  return { data: out, width: w, height: h };
}

function levels(img, lo, hi, sat) {
  const { data: D } = img, T = new Float32Array(256);
  for (let v = 0; v < 256; v++) T[v] = Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * 255;
  for (let i = 0; i < D.length; i += 4) {
    const r = T[D[i]], g = T[D[i + 1]], b = T[D[i + 2]];
    const l = r * 0.3 + g * 0.59 + b * 0.11;
    D[i] = l + (r - l) * sat; D[i + 1] = l + (g - l) * sat; D[i + 2] = l + (b - l) * sat;
  }
  return img;
}

function grey(img) {
  const { data: D } = img;
  for (let i = 0; i < D.length; i += 4) D[i] = D[i + 1] = D[i + 2] = (D[i] * 77 + D[i + 1] * 150 + D[i + 2] * 29) >> 8;
  return img;
}

function adjust(img, bright, contrast) {
  if (!bright && !contrast) return img;
  const { data: D } = img, T = new Uint8ClampedArray(256), k = Math.pow(2.2, contrast / 50), b = bright * 1.3;
  for (let v = 0; v < 256; v++) T[v] = (v - 150) * k + 150 + b;
  for (let i = 0; i < D.length; i += 4) { D[i] = T[D[i]]; D[i + 1] = T[D[i + 1]]; D[i + 2] = T[D[i + 2]]; }
  return img;
}

// Pure black and white, judged against the writing's own surroundings (Sauvola's method).
function blackWhite(img, bright, contrast) {
  const { data: D, width: w, height: h } = img;
  const r = Math.max(8, Math.round(Math.max(w, h) / 90));
  const W = w + 1;
  const I = new Float64Array(W * (h + 1)), Q = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let s = 0, q = 0;
    for (let x = 0; x < w; x++) {
      const v = D[(y * w + x) * 4]; s += v; q += v * v;
      I[(y + 1) * W + x + 1] = I[y * W + x + 1] + s;
      Q[(y + 1) * W + x + 1] = Q[y * W + x + 1] + q;
    }
  }
  const out = new Uint8ClampedArray(D.length);
  const k = 0.34 - contrast / 50 * 0.1, shift = -bright * 0.9;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), n = (y1 - y0) * (x1 - x0);
      const s = I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0];
      const q = Q[y1 * W + x1] - Q[y0 * W + x1] - Q[y1 * W + x0] + Q[y0 * W + x0];
      const m = s / n, sd = Math.sqrt(Math.max(0, q / n - m * m));
      const i = (y * w + x) * 4, t = Math.min(205, Math.max(112, m * (1 + k * (sd / 110 - 1)) + shift));
      out[i] = out[i + 1] = out[i + 2] = D[i] < t ? 0 : 255; out[i + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

// filter: auto | grey | bw | photo
export function enhance(img, filter, bright = 0, contrast = 0) {
  if (filter === 'photo') {
    const c = { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };
    return adjust(c, bright, contrast);
  }
  const flat = flatten(img);
  if (filter === 'bw') return blackWhite(grey(flat), bright, contrast);
  const lo = Math.min(90, darkest(flat, 0.004) * 0.85);
  const g = filter === 'grey' ? grey(flat) : flat;
  return adjust(sharpen(levels(g, lo, 236, filter === 'grey' ? 1 : 1.18), 0.7), bright, contrast);
}

export function shrink(img, maxSide) {
  const { data: S, width: w, height: h } = img;
  const k = maxSide / Math.max(w, h);
  if (k >= 1) return img;
  const W = Math.max(1, Math.round(w * k)), H = Math.max(1, Math.round(h * k)), out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const y0 = Math.floor(y * h / H), y1 = Math.max(y0 + 1, Math.floor((y + 1) * h / H));
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor(x * w / W), x1 = Math.max(x0 + 1, Math.floor((x + 1) * w / W));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = (yy * w + xx) * 4; r += S[i]; g += S[i + 1]; b += S[i + 2]; n++; }
      const o = (y * W + x) * 4; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { data: out, width: W, height: H };
}
