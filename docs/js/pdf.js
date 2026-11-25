// Writes a proper PDF file from scanned pages. Own code, no libraries.
// A page is { kind:'jpeg', bytes, width, height, grey } or { kind:'bits', bytes (deflated rows), width, height },
// plus words: [{ text, x0, y0, x1, y1, line }] in picture pixels, which become invisible, searchable text.

const MM = 72 / 25.4;
const A4 = [210 * MM, 297 * MM];
const CARD = [85.6 * MM, 53.98 * MM];

// Helvetica letter widths, for fitting the invisible text over the picture
const HW = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const CP1252 = { '€': 128, '‚': 130, 'ƒ': 131, '„': 132, '…': 133, '†': 134, '‡': 135, 'ˆ': 136, '‰': 137, 'Š': 138, '‹': 139, 'Œ': 140, 'Ž': 142, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '–': 150, '—': 151, '˜': 152, '™': 153, 'š': 154, '›': 155, 'œ': 156, 'ž': 158, 'Ÿ': 159 };

function encode(text) {
  const out = [];
  for (const ch of text.normalize('NFC')) {
    const c = ch.codePointAt(0);
    if (CP1252[ch]) out.push(CP1252[ch]);
    else if ((c >= 32 && c < 127) || (c >= 160 && c <= 255)) out.push(c);
    else {
      const base = ch.normalize('NFD').codePointAt(0);
      out.push(base >= 32 && base < 127 ? base : 63);
    }
  }
  return out;
}
function widthOf(codes) {
  let w = 0;
  for (const c of codes) {
    if (c >= 32 && c < 127) w += HW[c - 32];
    else if (c >= 160) {
      const b = String.fromCharCode(c).normalize('NFD').charCodeAt(0);
      w += b >= 32 && b < 127 ? HW[b - 32] : 556;
    } else w += c === 151 ? 1000 : c === 149 ? 350 : c === 150 ? 556 : c >= 145 && c <= 146 ? 222 : c >= 147 && c <= 148 ? 333 : 556;
  }
  return w / 1000;
}
const hex = codes => '<' + codes.map(c => c.toString(16).padStart(2, '0')).join('') + '>';
const utf16 = s => { let h = 'FEFF'; for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(4, '0'); return '<' + h.toUpperCase() + '>'; };
const n = v => (Math.abs(v) < 1e-4 ? 0 : v).toFixed(3).replace(/\.?0+$/, '');

export async function deflate(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

// Packs a black and white picture into one bit per dot and compresses it: tiny files with razor-sharp writing.
export async function packBits(img) {
  const { data: D, width: w, height: h } = img, rb = (w + 7) >> 3;
  const raw = new Uint8Array((rb + 1) * h);
  let prev = new Uint8Array(rb);
  for (let y = 0; y < h; y++) {
    const row = new Uint8Array(rb);
    for (let x = 0; x < w; x++) if (D[(y * w + x) * 4] > 127) row[x >> 3] |= 128 >> (x & 7);
    const o = y * (rb + 1);
    raw[o] = 2; // each row is stored as its difference from the row above
    for (let k = 0; k < rb; k++) raw[o + 1 + k] = (row[k] - prev[k]) & 255;
    prev = row;
  }
  return { kind: 'bits', bytes: await deflate(raw), width: w, height: h };
}

// Where the picture goes on the sheet
function place(p, size) {
  const r = p.width / p.height;
  if (size === 'fit') {
    // keep the shape of the scan, with its long side like A4 unless it is small like a card
    const isCard = Math.abs(Math.log(Math.max(r, 1 / r) / (CARD[0] / CARD[1]))) < 0.03;
    const long = isCard ? CARD[0] : A4[1];
    let W = r >= 1 ? long : long * r, H = r >= 1 ? long / r : long;
    if (Math.abs(Math.log(Math.min(W, H) / A4[0])) < 0.01) { if (r >= 1) H = A4[0]; else W = A4[0]; }
    return { W, H, x: 0, y: 0, w: W, h: H };
  }
  const [W, H] = r > 1.05 ? [A4[1], A4[0]] : A4;
  if (Math.abs(Math.log(r / (W / H))) < 0.02) return { W, H, x: 0, y: 0, w: W, h: H };
  const m = 10 * MM;
  let w = W - 2 * m, h = w / r;
  if (h > H - 2 * m) { h = H - 2 * m; w = h * r; }
  return { W, H, x: (W - w) / 2, y: H - m - h, w, h };
}

// Two scans on one A4 sheet, for the front and back of an ID card or licence (cards come out at their real size)
function placePair(p, slot) {
  const [W, H] = A4, r = p.width / p.height;
  const isCard = Math.abs(Math.log(r / (CARD[0] / CARD[1]))) < 0.08;
  let w, h;
  if (isCard) { w = CARD[0] * 1.0; h = w / r; } else {
    w = W - 30 * MM; h = w / r;
    if (h > H / 2 - 20 * MM) { h = H / 2 - 20 * MM; w = h * r; }
  }
  const cy = isCard ? H - (slot ? 125 : 55) * MM : H * (slot ? 0.25 : 0.75);
  return { W, H, x: (W - w) / 2, y: cy - h / 2, w, h };
}

function textLayer(p, box) {
  if (!p.words || !p.words.length) return '';
  const k = box.w / p.width, lines = new Map();
  for (const w of p.words) { if (!lines.has(w.line)) lines.set(w.line, []); lines.get(w.line).push(w); }
  let s = 'BT 3 Tr\n';
  for (const ws of lines.values()) {
    const y0 = Math.min(...ws.map(w => w.y0)), y1 = Math.max(...ws.map(w => w.y1));
    const size = Math.max(2, (y1 - y0) * k * 0.95);
    ws.forEach((w, i) => {
      const codes = encode(w.text + (i < ws.length - 1 ? ' ' : ''));
      const next = ws[i + 1];
      const right = next && next.x0 > w.x1 ? next.x0 : w.x1;
      const natural = widthOf(codes) * size;
      if (!natural) return;
      const tz = Math.max(10, Math.min(400, (right - w.x0) * k / natural * 100));
      // the base of the line: about a fifth of the letter height hangs below it
      const yb = box.y + box.h - (y1 - (y1 - y0) * 0.2) * k;
      s += `/F1 ${n(size)} Tf ${n(tz)} Tz 1 0 0 1 ${n(box.x + w.x0 * k)} ${n(yb)} Tm ${hex(codes)} Tj\n`;
    });
  }
  return s + 'ET\n';
}

export async function buildPdf(pages, { title = 'Scan', size = 'a4', numbers = false } = {}) {
  const enc = new TextEncoder();
  const parts = [], offsets = [];
  let length = 0, objects = 0;
  const push = b => { const u = typeof b === 'string' ? enc.encode(b) : b; parts.push(u); length += u.length; };
  const alloc = () => ++objects;
  const obj = (id, body) => { offsets[id] = length; push(`${id} 0 obj\n`); body(); push('\nendobj\n'); };
  const stream = (id, dict, bytes) => obj(id, () => { push(`<< ${dict} /Length ${bytes.length} >>\nstream\n`); push(bytes); push('\nendstream'); });

  push('%PDF-1.5\n'); push(new Uint8Array([37, 226, 227, 207, 211, 10]));
  const catalog = alloc(), tree = alloc(), font = alloc(), info = alloc();

  const sheets = [];
  if (size === 'pair') {
    for (let i = 0; i < pages.length; i += 2) {
      const a = pages.slice(i, i + 2);
      sheets.push(a.map((p, s) => ({ p, box: placePair(p, s) })));
    }
  } else for (const p of pages) sheets.push([{ p, box: place(p, size) }]);

  const kids = [];
  for (let i = 0; i < sheets.length; i++) {
    const page = alloc(), content = alloc(), { W, H } = sheets[i][0].box;
    let ops = '', res = '';
    for (let j = 0; j < sheets[i].length; j++) {
      const { p, box } = sheets[i][j], im = alloc();
      const base = `/Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height}`;
      if (p.kind === 'bits') stream(im, `${base} /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 1 /BitsPerComponent 1 /Columns ${p.width} >>`, p.bytes);
      else stream(im, `${base} /ColorSpace ${p.grey ? '/DeviceGray' : '/DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode`, p.bytes);
      res += `/Im${j} ${im} 0 R `;
      ops += `q ${n(box.w)} 0 0 ${n(box.h)} ${n(box.x)} ${n(box.y)} cm /Im${j} Do Q\n`;
      ops += textLayer(p, box);
    }
    if (numbers) {
      const codes = encode(`${i + 1} / ${sheets.length}`), w = widthOf(codes) * 9;
      ops += `BT 0 Tr 100 Tz 0.35 g /F1 9 Tf 1 0 0 1 ${n((W - w) / 2)} 14 Tm ${hex(codes)} Tj ET\n`;
    }
    stream(content, '/Filter /FlateDecode', await deflate(enc.encode(ops)));
    obj(page, () => push(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${n(W)} ${n(H)}] /Resources << /XObject << ${res}>> /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
    kids.push(`${page} 0 R`);
  }
  const d = new Date(), z = v => String(v).padStart(2, '0');
  const off = -d.getTimezoneOffset(), tz = `${off < 0 ? '-' : '+'}${z(Math.floor(Math.abs(off) / 60))}'${z(Math.abs(off) % 60)}'`;
  const stamp = `D:${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}${tz}`;
  obj(catalog, () => push(`<< /Type /Catalog /Pages ${tree} 0 R /ViewerPreferences << /DisplayDocTitle true >> >>`));
  obj(tree, () => push(`<< /Type /Pages /Count ${kids.length} /Kids [${kids.join(' ')}] >>`));
  obj(font, () => push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'));
  obj(info, () => push(`<< /Title ${utf16(title)} /Creator (Bertie Scan) /Producer (Bertie Scan) /CreationDate (${stamp}) /ModDate (${stamp}) >>`));
  const start = length;
  let x = `xref\n0 ${objects + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  push(`${x}trailer\n<< /Size ${objects + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${start}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}
