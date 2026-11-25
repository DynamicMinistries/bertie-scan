// Finds the edges of a sheet of paper in a picture. Own code, no libraries.
// Corners are always returned in the order: top-left, top-right, bottom-right, bottom-left.

const DEG = Math.PI / 180;

// Grey "closing" (grow the light areas, then shrink them again) wipes out the writing on a page
// but leaves the outline of the paper, so lines of text are not mistaken for edges.
function slide(src, dst, w, h, r, horizontal, max) {
  const n = horizontal ? w : h, m = horizontal ? h : w;
  const step = horizontal ? 1 : w, lineStep = horizontal ? w : 1;
  for (let l = 0; l < m; l++) {
    const base = l * lineStep;
    for (let i = 0; i < n; i++) {
      const a = i - r < 0 ? 0 : i - r, b = i + r >= n ? n - 1 : i + r;
      let v = src[base + a * step];
      for (let k = a + 1; k <= b; k++) {
        const x = src[base + k * step];
        if (max ? x > v : x < v) v = x;
      }
      dst[base + i * step] = v;
    }
  }
}

function closing(p, w, h, r) {
  const t = new Float32Array(p.length), u = new Float32Array(p.length);
  slide(p, t, w, h, r, true, true); slide(t, u, w, h, r, false, true);
  slide(u, t, w, h, r, true, false); slide(t, u, w, h, r, false, false);
  return u;
}

function blur(p, w, h, passes) {
  let a = p;
  for (let k = 0; k < passes; k++) {
    const b = new Float32Array(p.length), c = new Float32Array(p.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      b[i] = (a[x ? i - 1 : i] + 2 * a[i] + a[x < w - 1 ? i + 1 : i]) / 4;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      c[i] = (b[y ? i - w : i] + 2 * b[i] + b[y < h - 1 ? i + w : i]) / 4;
    }
    a = c;
  }
  return a;
}

function gradients(rgba, w, h, closeR) {
  const n = w * h;
  const mag = new Float32Array(n), gx = new Float32Array(n), gy = new Float32Array(n);
  for (let c = 0; c < 3; c++) {
    let p = new Float32Array(n);
    for (let i = 0; i < n; i++) p[i] = rgba[i * 4 + c];
    p = blur(closing(p, w, h, closeR), w, h, 2);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const sx = (p[i - w + 1] + 2 * p[i + 1] + p[i + w + 1] - p[i - w - 1] - 2 * p[i - 1] - p[i + w - 1]) / 8;
      const sy = (p[i + w - 1] + 2 * p[i + w] + p[i + w + 1] - p[i - w - 1] - 2 * p[i - w] - p[i - w + 1]) / 8;
      const m = Math.hypot(sx, sy);
      if (m > mag[i]) { mag[i] = m; gx[i] = sx; gy[i] = sy; }
    }
  }
  return { mag, gx, gy };
}

function edgePixels(g, w, h) {
  const { mag, gx, gy } = g;
  const keep = [];
  const hist = new Uint32Array(1024);
  let total = 0;
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    const i = y * w + x, m = mag[i];
    if (m < 0.8) continue;
    const dx = Math.round(gx[i] / m), dy = Math.round(gy[i] / m);
    if (m < mag[i + dy * w + dx] || m <= mag[i - dy * w - dx]) continue;
    keep.push(i);
    hist[Math.min(1023, (m * 8) | 0)]++;
    total++;
  }
  // keep only the strongest edges, but never demand more than a modest contrast
  const want = Math.min(total, Math.round((w + h) * 5));
  let acc = 0, b = 1023;
  while (b > 0 && acc < want) acc += hist[b--];
  const thr = Math.min(Math.max(1.4, b / 8), 9);
  return keep.filter(i => mag[i] >= thr);
}

function intersect(a, b) {
  const d = a.nx * b.ny - a.ny * b.nx;
  if (Math.abs(d) < 1e-6) return null;
  return [(a.rho * b.ny - b.rho * a.ny) / d, (a.nx * b.rho - b.nx * a.rho) / d];
}

export function orderCorners(q) {
  const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
  const s = q.map(p => [p[0], p[1]]).sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  let k = 0, best = Infinity;
  for (let i = 0; i < 4; i++) { const v = s[i][0] + s[i][1]; if (v < best) { best = v; k = i; } }
  return [0, 1, 2, 3].map(i => s[(k + i) % 4]);
}

export function quadArea(q) {
  let a = 0;
  for (let i = 0; i < 4; i++) { const p = q[i], r = q[(i + 1) % 4]; a += p[0] * r[1] - r[0] * p[1]; }
  return Math.abs(a) / 2;
}

export function isConvex(q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(z) < 1e-6) return false;
    if (sign && Math.sign(z) !== sign) return false;
    sign = Math.sign(z);
  }
  return true;
}

// rgba: a small picture (longest side about 256 to 400). Returns { quad, score } or null.
export function detectQuad(rgba, w, h) {
  const diag = Math.hypot(w, h);
  const closeR = Math.max(2, Math.round(Math.max(w, h) / 90));
  const g = gradients(rgba, w, h, closeR);
  const px = edgePixels(g, w, h);
  if (px.length < (w + h) / 4) return null;

  // Hough voting, limited to the direction each edge actually points in
  const NT = 180, RO = Math.ceil(diag) + 2, NR = RO * 2 + 2;
  const acc = new Float32Array(NT * NR);
  const cos = [], sin = [];
  for (let t = 0; t < NT; t++) { cos.push(Math.cos(t * DEG)); sin.push(Math.sin(t * DEG)); }
  const E = px.map(i => {
    const m = g.mag[i];
    return { x: i % w, y: (i / w) | 0, ux: g.gx[i] / m, uy: g.gy[i] / m, m };
  });
  for (const e of E) {
    const vote = Math.min(2.2, Math.sqrt(e.m) * 0.6);
    const ang = Math.round(Math.atan2(e.uy, e.ux) / DEG);
    for (let d = -5; d <= 5; d++) {
      const t = ((ang + d) % NT + NT) % NT;
      const r = e.x * cos[t] + e.y * sin[t] + RO;
      const r0 = r | 0, f = r - r0, k = t * NR + r0;
      acc[k] += vote * (1 - f);
      acc[k + 1] += vote * f;
    }
  }
  const lines = [];
  const minVotes = Math.min(w, h) * 0.12;
  for (let k = 0; k < 28; k++) {
    let best = 0, bi = -1;
    for (let i = 0; i < acc.length; i++) if (acc[i] > best) { best = acc[i]; bi = i; }
    if (bi < 0 || best < minVotes) break;
    const t = (bi / NR) | 0, r = bi % NR - RO;
    lines.push({ nx: cos[t], ny: sin[t], rho: r });
    for (let dt = -6; dt <= 6; dt++) {
      let tt = t + dt, rr = r;
      if (tt < 0) { tt += NT; rr = -r; } else if (tt >= NT) { tt -= NT; rr = -r; }
      for (let dr = -5; dr <= 5; dr++) {
        const q = rr + dr + RO;
        if (q >= 0 && q < NR) acc[tt * NR + q] = 0;
      }
    }
  }

  // tidy each line with a least-squares fit, then note where along it there really is an edge
  const L = [];
  for (const l of lines) {
    for (let it = 0; it < 2; it++) {
      let sw = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
      const tol = it ? 2 : 3;
      for (const e of E) {
        if (Math.abs(e.x * l.nx + e.y * l.ny - l.rho) > tol) continue;
        if (Math.abs(e.ux * l.nx + e.uy * l.ny) < 0.95) continue;
        const v = Math.min(4, e.m);
        sw += v; sx += v * e.x; sy += v * e.y; sxx += v * e.x * e.x; syy += v * e.y * e.y; sxy += v * e.x * e.y;
      }
      if (sw < 8) break;
      const mx = sx / sw, my = sy / sw;
      const a = sxx / sw - mx * mx, b = sxy / sw - mx * my, c = syy / sw - my * my;
      const th = 0.5 * Math.atan2(2 * b, a - c); // direction along the line
      const nx = -Math.sin(th), ny = Math.cos(th);
      const s = nx * l.nx + ny * l.ny < 0 ? -1 : 1;
      if (Math.abs(nx * l.nx + ny * l.ny) < 0.97) break;
      l.nx = nx * s; l.ny = ny * s; l.rho = mx * l.nx + my * l.ny;
    }
    const T = Math.ceil(diag) + 1;
    const sup = new Float32Array(2 * T + 1), sig = new Float32Array(2 * T + 1);
    for (const e of E) {
      if (Math.abs(e.x * l.nx + e.y * l.ny - l.rho) > 2.2) continue;
      const d = e.ux * l.nx + e.uy * l.ny;
      if (Math.abs(d) < 0.9) continue;
      const t = Math.round(-e.x * l.ny + e.y * l.nx) + T;
      for (let k = Math.max(0, t - 1); k <= Math.min(2 * T, t + 1); k++) {
        sup[k] = 1;
        if (Math.abs(d * e.m) > Math.abs(sig[k])) sig[k] = d * e.m;
      }
    }
    const ps = new Float32Array(2 * T + 2), pg = new Float32Array(2 * T + 2);
    for (let k = 0; k <= 2 * T; k++) { ps[k + 1] = ps[k] + sup[k]; pg[k + 1] = pg[k] + Math.sign(sig[k]); }
    L.push({ ...l, ps, pg, T, border: 0 });
  }
  // the picture's own border can stand in for one side when the page runs off the picture
  for (const [nx, ny, rho] of [[1, 0, 1], [1, 0, w - 2], [0, 1, 1], [0, 1, h - 2]]) L.push({ nx, ny, rho, border: 1 });

  // opposite sides: pairs of roughly parallel lines
  const pairs = [];
  for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
    const a = L[i], b = L[j];
    if (a.border && b.border) continue;
    if (Math.abs(a.nx * b.nx + a.ny * b.ny) < Math.cos(38 * DEG)) continue;
    const at = (q, o) => { // distance between the lines near the middle of the picture
      const k = w / 2 * q.nx + h / 2 * q.ny - q.rho;
      const px = w / 2 - k * q.nx, py = h / 2 - k * q.ny;
      return Math.abs(px * o.nx + py * o.ny - o.rho);
    };
    if (Math.min(at(a, b), at(b, a)) < Math.min(w, h) * 0.12) continue;
    pairs.push({ a, b, ang: (Math.atan2(a.ny, a.nx) / DEG + 360) % 180 });
  }

  let best = null;
  const strong = new Uint8Array(w * h);
  for (const i of px) { strong[i] = 1; strong[i + 1] = 1; strong[i + w] = 1; strong[i - 1] = 1; strong[i - w] = 1; }
  const m = 3;
  const side = (l, p, q) => {
    const len = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (l.border) return { len, s: 0.42, ext: 0, sign: 0 };
    let t0 = -p[0] * l.ny + p[1] * l.nx, t1 = -q[0] * l.ny + q[1] * l.nx;
    if (t0 > t1) [t0, t1] = [t1, t0];
    const c = v => Math.max(0, Math.min(2 * l.T + 1, Math.round(v) + l.T));
    const A = c(t0), B = c(t1), n = Math.max(1, B - A);
    const x = Math.max(5, n * 0.14), g0 = 4;
    const e0 = (l.ps[c(t0 - g0)] - l.ps[c(t0 - g0 - x)]) / x, e1 = (l.ps[c(t1 + g0 + x)] - l.ps[c(t1 + g0)]) / x;
    return { len, s: (l.ps[B] - l.ps[A]) / n, ext: (e0 + e1) / 2, sign: (l.pg[B] - l.pg[A]) / n };
  };
  for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) {
    const P = pairs[i], Q = pairs[j];
    let da = Math.abs(P.ang - Q.ang); if (da > 90) da = 180 - da;
    if (da < 45) continue;
    if (P.a === Q.a || P.a === Q.b || P.b === Q.a || P.b === Q.b) continue;
    const borders = P.a.border + P.b.border + Q.a.border + Q.b.border;
    if (borders > 1) continue;
    const ls = [P.a, Q.a, P.b, Q.b];
    const c = [];
    let ok = true;
    for (let k = 0; k < 4 && ok; k++) {
      const p = intersect(ls[k], ls[(k + 1) % 4]);
      if (!p || p[0] < -m || p[1] < -m || p[0] > w - 1 + m || p[1] > h - 1 + m) ok = false;
      else c.push(p);
    }
    if (!ok || !isConvex(c)) continue;
    const area = quadArea(c) / (w * h);
    if (area < 0.07) continue;
    for (let k = 0; k < 4 && ok; k++) {
      const p = c[(k + 3) % 4], q = c[k], r = c[(k + 1) % 4];
      const ax = p[0] - q[0], ay = p[1] - q[1], bx = r[0] - q[0], by = r[1] - q[1];
      const cs = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) + 1e-9);
      if (Math.abs(cs) > Math.cos(48 * DEG)) ok = false;
    }
    if (!ok) continue;
    const cx = (c[0][0] + c[1][0] + c[2][0] + c[3][0]) / 4, cy = (c[0][1] + c[1][1] + c[2][1] + c[3][1]) / 4;
    let sum = 0, per = 0, mn = 1, ext = 0, inward = 0;
    for (let k = 0; k < 4; k++) {
      // the side between corner k and corner k+1 lies on line k+1
      const l = ls[(k + 1) % 4], s = side(l, c[k], c[(k + 1) % 4]);
      sum += s.s * s.len; per += s.len; mn = Math.min(mn, s.s); ext += s.ext;
      inward += s.sign * Math.sign(cx * l.nx + cy * l.ny - l.rho); // + means lighter on the inside
    }
    const cover = sum / per;
    if (mn < 0.28 || cover < 0.5) continue;
    const score = (0.7 * cover + 0.3 * mn) * (0.66 + 0.34 * Math.sqrt(area)) * (1 - 0.33 * ext / 4)
      * (1 + 0.14 * Math.max(-0.5, inward / 4)) - 0.04 * borders;
    // Paper nearly always has a clean margin just inside its edge. A shape that is busy there
    // (a patterned cloth, or a box that cuts across the page) is marked down.
    if (best && score <= best.score) continue;
    const scale = Math.sqrt(area * w * h), t0 = Math.max(6, scale * 0.04);
    let busy = 0, seen = 0;
    for (let k = 0; k < 4; k++) {
      const p = c[k], q = c[(k + 1) % 4];
      for (let s = 0; s < 30; s++) {
        const u = 0.08 + 0.84 * s / 29, x0 = p[0] + (q[0] - p[0]) * u, y0 = p[1] + (q[1] - p[1]) * u;
        const dx = cx - x0, dy = cy - y0, d = Math.hypot(dx, dy) || 1;
        for (let o = 0; o < 4; o++) {
          const t = t0 + o * 3, x = Math.round(x0 + dx / d * t), y = Math.round(y0 + dy / d * t);
          if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
          seen++; busy += strong[y * w + x];
        }
      }
    }
    const fine = score * (1 - 0.55 * Math.max(0, busy / Math.max(1, seen) - 0.03));
    if (!best || fine > best.score) best = { quad: c, score: fine, area };
  }
  if (!best || best.score < 0.74) {
    const r = smoothRegion(strong, w, h);
    if (r && (!best || r.score > best.score - 0.06)) best = r;
  }
  if (!best) return null;
  return { quad: orderCorners(best.quad), score: Math.max(0, Math.min(1, best.score)), area: best.area, rough: !!best.rough };
}

// A second way to find the page, for tablecloths and other busy patterns: with its writing wiped out,
// the page is the one big smooth patch in the picture.
function smoothRegion(edges, w, h) {
  // thicken the edges first, so small squares of a pattern that run into the page are pinched off
  const R = Math.round(Math.max(w, h) / 38), t = new Uint8Array(w * h), strong = new Uint8Array(w * h);
  slide(edges, t, w, h, R, true, true); slide(t, strong, w, h, R, false, true);
  const seen = new Uint8Array(w * h), stack = new Int32Array(w * h);
  let best = null;
  for (let s = 0; s < w * h; s++) {
    if (strong[s] || seen[s]) continue;
    let top = 0, n = 0, edge = 0;
    const lo = new Int32Array(h).fill(w), hi = new Int32Array(h).fill(-1);
    stack[top++] = s; seen[s] = 1;
    while (top) {
      const i = stack[--top], x = i % w, y = (i / w) | 0;
      n++;
      if (x < lo[y]) lo[y] = x;
      if (x > hi[y]) hi[y] = x;
      if (x < 3 || y < 3 || x > w - 4 || y > h - 4) edge++;
      if (x && !strong[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack[top++] = i - 1; }
      if (x < w - 1 && !strong[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack[top++] = i + 1; }
      if (y && !strong[i - w] && !seen[i - w]) { seen[i - w] = 1; stack[top++] = i - w; }
      if (y < h - 1 && !strong[i + w] && !seen[i + w]) { seen[i + w] = 1; stack[top++] = i + w; }
    }
    if (n < w * h * 0.05 || edge > (w + h) * 0.4) continue;
    const pts = [];
    for (let y = 0; y < h; y++) if (hi[y] >= 0) pts.push([lo[y], y], [hi[y], y]);
    const quad = hullToQuad(hull(pts));
    if (!quad || !isConvex(quad)) continue;
    const area = quadArea(quad), fill = n / area;
    if (fill < 0.72) continue;
    // put back the rim that the thickening took off
    const c = orderCorners(quad), out = R + 1.5;
    const L = c.map((p, k) => { const n = c[(k + 1) % 4], l = Math.hypot(n[0] - p[0], n[1] - p[1]) || 1, nx = -(n[1] - p[1]) / l, ny = (n[0] - p[0]) / l; return { nx, ny, rho: p[0] * nx + p[1] * ny - out }; });
    const q = c.map((p, k) => intersect(L[(k + 3) % 4], L[k]) || p).map(p => [Math.max(0, Math.min(w - 1, p[0])), Math.max(0, Math.min(h - 1, p[1]))]);
    const score = 0.56 + 0.3 * Math.min(1, fill) * Math.sqrt(area / (w * h)) - edge / (w + h) * 0.4;
    if (!best || score > best.score) best = { quad: q, score, area: area / (w * h), rough: true };
  }
  return best;
}

function hull(p) {
  p.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const c = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = list => { const r = []; for (const q of list) { while (r.length > 1 && c(r[r.length - 2], r[r.length - 1], q) <= 0) r.pop(); r.push(q); } r.pop(); return r; };
  return half(p).concat(half([...p].reverse()));
}

// Drops the side whose removal (by running its two neighbours on until they meet) adds the least area, until four are left.
function hullToQuad(v) {
  v = v.map(p => [...p]);
  while (v.length > 4) {
    let best = null;
    for (let i = 0; i < v.length; i++) {
      const n = v.length, a = v[(i + n - 1) % n], b = v[i], c = v[(i + 1) % n], d = v[(i + 2) % n];
      const x1 = b[0] - a[0], y1 = b[1] - a[1], x2 = c[0] - d[0], y2 = c[1] - d[1], den = x1 * y2 - y1 * x2;
      if (den >= -1e-9) continue;
      const t = ((d[0] - a[0]) * y2 - (d[1] - a[1]) * x2) / den, m = [a[0] + x1 * t, a[1] + y1 * t];
      const add = Math.abs((b[0] - m[0]) * (c[1] - m[1]) - (b[1] - m[1]) * (c[0] - m[0])) / 2;
      if (t >= 1 && (!best || add < best.add)) best = { i, m, add };
    }
    if (!best) return null;
    const j = (best.i + 1) % v.length;
    v[best.i] = best.m;
    v.splice(j, 1);
  }
  return v.length === 4 ? v : null;
}

// Takes a rough quad and slides every side onto the true edge of the paper, using a bigger picture.
// quad is in this picture's own pixels.
export function refineQuad(rgba, w, h, quad, reach) {
  const R = reach || Math.max(5, Math.round(Math.max(w, h) * 0.009));
  const lum = (x, y, c) => {
    const xi = x < 0 ? 0 : x > w - 1 ? w - 1 : x, yi = y < 0 ? 0 : y > h - 1 ? h - 1 : y;
    const x0 = xi | 0, y0 = yi | 0, x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = xi - x0, fy = yi - y0;
    const a = rgba[(y0 * w + x0) * 4 + c], b = rgba[(y0 * w + x1) * 4 + c], d = rgba[(y1 * w + x0) * 4 + c], e = rgba[(y1 * w + x1) * 4 + c];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
  };
  const fitted = [];
  for (let k = 0; k < 4; k++) {
    const p = quad[k], q = quad[(k + 1) % 4];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len < 40) return quad;
    const tx = (q[0] - p[0]) / len, ty = (q[1] - p[1]) / len, nx = -ty, ny = tx; // normal points into the page
    const N = 72, samples = [];
    for (let s = 0; s < N; s++) {
      const u = 0.05 + 0.9 * s / (N - 1);
      const bx = p[0] + tx * len * u, by = p[1] + ty * len * u;
      const prof = [];
      for (let d = -R - 2; d <= R + 2; d++) {
        let best = 0;
        for (let c = 0; c < 3; c++) {
          // a short average along the edge steadies noise; a 3px step across it measures the change
          let a = 0;
          for (let o = -2; o <= 2; o += 2) {
            const x = bx + tx * o, y = by + ty * o;
            a += lum(x + nx * (d + 1.5), y + ny * (d + 1.5), c) - lum(x + nx * (d - 1.5), y + ny * (d - 1.5), c);
          }
          if (Math.abs(a) > Math.abs(best)) best = a;
        }
        prof.push(best / 3);
      }
      samples.push({ bx, by, prof });
    }
    // which way does this side usually step: dark to light or light to dark?
    let pol = 0;
    for (const s of samples) {
      let b = 0;
      for (const v of s.prof) if (Math.abs(v) > Math.abs(b)) b = v;
      pol += Math.max(-30, Math.min(30, b));
    }
    const sgn = pol >= 0 ? 1 : -1;
    const pts = [];
    for (const s of samples) {
      let bi = -1, bv = 3;
      for (let i = 1; i < s.prof.length - 1; i++) {
        const v = s.prof[i] * sgn * (1 - 0.35 * Math.abs(i - R - 2) / (R + 2));
        if (v > bv) { bv = v; bi = i; }
      }
      if (bi < 0) continue;
      const a = s.prof[bi - 1] * sgn, b = s.prof[bi] * sgn, c = s.prof[bi + 1] * sgn, den = a - 2 * b + c;
      const off = bi - R - 2 + (Math.abs(den) > 1e-6 ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / den)) : 0);
      pts.push([s.bx + nx * off, s.by + ny * off, Math.min(20, bv)]);
    }
    let line = { nx, ny, rho: p[0] * nx + p[1] * ny };
    if (pts.length >= N * 0.35) {
      let wt = pts.map(p => p[2]), ok = true, cand = null;
      for (let it = 0; it < 8; it++) {
        let sw = 0, sx = 0, sy = 0;
        pts.forEach((p, i) => { sw += wt[i]; sx += wt[i] * p[0]; sy += wt[i] * p[1]; });
        if (sw < 1e-3) { ok = false; break; }
        const mx = sx / sw, my = sy / sw;
        let a = 0, b = 0, c = 0;
        pts.forEach((p, i) => { const dx = p[0] - mx, dy = p[1] - my; a += wt[i] * dx * dx; b += wt[i] * dx * dy; c += wt[i] * dy * dy; });
        const th = 0.5 * Math.atan2(2 * b, a - c);
        let lx = -Math.sin(th), ly = Math.cos(th);
        if (lx * nx + ly * ny < 0) { lx = -lx; ly = -ly; }
        cand = { nx: lx, ny: ly, rho: mx * lx + my * ly };
        const tol = it < 3 ? 2.5 : 1.2;
        wt = pts.map(p => { const r = Math.abs(p[0] * lx + p[1] * ly - cand.rho) / tol; return p[2] / (1 + r * r * r * r); });
      }
      if (ok && cand && cand.nx * nx + cand.ny * ny > Math.cos(4 * DEG)) line = cand;
    }
    fitted.push(line);
  }
  const out = [];
  for (let k = 0; k < 4; k++) {
    const p = intersect(fitted[(k + 3) % 4], fitted[k]);
    if (!p || Math.hypot(p[0] - quad[k][0], p[1] - quad[k][1]) > R * 2.5) out.push(quad[k]);
    else out.push([Math.max(0, Math.min(w - 1, p[0])), Math.max(0, Math.min(h - 1, p[1]))]);
  }
  return isConvex(out) ? out : quad;
}

// Finds the page and fits it closely: small is about 320 dots on its long side, big about 1200.
export function findPage(small, big) {
  const r = detectQuad(small.data, small.width, small.height);
  if (!r) return null;
  let q = r.quad.map(p => [(p[0] + 0.5) * big.width / small.width - 0.5, (p[1] + 0.5) * big.height / small.height - 0.5]);
  if (r.rough) for (const reach of [0.045, 0.02]) q = refineQuad(big.data, big.width, big.height, q, Math.round(Math.max(big.width, big.height) * reach));
  return { score: r.score, area: r.area, quad: refineQuad(big.data, big.width, big.height, q) };
}
