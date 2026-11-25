// Ties the pieces together: adds pages, reworks them, and makes the finished files.
import * as store from './store.js';
import { DEV } from './store.js';
import { buildPdf } from './pdf.js';
import { buildDocx, zip } from './docx.js';
import * as ocr from './ocr.js';

class Helper {
  constructor() { this.n = 0; this.wait = new Map(); }
  start() {
    this.w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.w.onmessage = e => { const p = this.wait.get(e.data.id); this.wait.delete(e.data.id); if (p) e.data.err ? p.bad(new Error(e.data.err)) : p.ok(e.data.ok); };
    this.w.onerror = e => { const all = [...this.wait.values()]; this.wait.clear(); this.w = null; all.forEach(p => p.bad(new Error(e.message || `The ${DEV} ran out of memory. Close other apps and try again.`))); };
  }
  call(op, args, transfer = []) {
    if (!this.w) this.start();
    return new Promise((ok, bad) => { const id = ++this.n; this.wait.set(id, { ok, bad }); this.w.postMessage({ id, op, args }, transfer); });
  }
}
export const live = new Helper(), heavy = new Helper();

export const WHOLE = [[0, 0], [1, 0], [1, 1], [0, 1]];
export const FILTERS = [['auto', 'Clean colour'], ['grey', 'Grey'], ['bw', 'Black & white'], ['photo', 'Photo']];
export const settings = {
  get: (k, d) => { try { const v = localStorage.getItem('bs:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('bs:' + k, JSON.stringify(v)); } catch { /* not important */ } },
};

export function niceDate(t, time) {
  const d = new Date(t), M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${M[d.getMonth()]} ${d.getFullYear()}` + (time ? ` ${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}` : '');
}
export async function newDoc() {
  const now = Date.now(), doc = { id: store.uid(), name: 'Scan ' + niceDate(now, true), created: now, updated: now, pages: [] };
  await store.putDoc(doc);
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  return doc;
}

// One change to a document at a time, so quick scanning never mixes up the page list
let queue = Promise.resolve();
const inTurn = fn => { const p = queue.then(fn); queue = p.catch(() => {}); return p; };
export const idle = () => queue;

async function render(page, blob) {
  const r = await heavy.call('process', { key: page.id, blob, quad: page.quad, rot: page.rot, filter: page.filter, bright: page.bright, contrast: page.contrast });
  page.w = r.width; page.h = r.height; page.ocr = null; page.v = (page.v || 0) + 1;
  await store.putFile(page.id + ':out', r.blob);
  await store.putFile(page.id + ':thumb', r.thumb);
  await store.putPage(page);
  return page;
}

// guess: corners seen in the live picture, used only if the sharp photo gives none
export function addPage(docId, rawBlob, { guess = null, at = null } = {}) {
  return inTurn(async () => {
    const id = store.uid();
    const { blob } = await heavy.call('normalise', { key: id, blob: rawBlob });
    const f = await heavy.call('find', { key: id, blob });
    let quad = WHOLE, sure = false;
    if (f.found && f.found.score > 0.45) { quad = f.found.quad; sure = f.found.score > 0.73; } else if (guess) quad = guess;
    const page = { id, docId, quad, rot: 0, filter: settings.get('filter', 'auto'), bright: 0, contrast: 0, sure };
    await store.putFile(id + ':orig', blob);
    await render(page, blob);
    const doc = await store.getDoc(docId);
    if (!doc) { await store.deletePage(id); return null; }
    if (at == null) doc.pages.push(id); else doc.pages.splice(at, 0, id);
    await store.putDoc(doc);
    return page;
  });
}

export function changePage(page, changes) {
  return inTurn(async () => {
    Object.assign(page, changes);
    await render(page, await store.getFile(page.id + ':orig'));
    const doc = await store.getDoc(page.docId);
    if (doc) await store.putDoc(doc);
    return page;
  });
}
export function removePage(page) {
  return inTurn(async () => {
    const doc = await store.getDoc(page.docId);
    doc.pages = doc.pages.filter(i => i !== page.id);
    await store.putDoc(doc);
    await store.deletePage(page.id);
    return doc;
  });
}
export const reorder = (docId, ids) => inTurn(async () => { const d = await store.getDoc(docId); d.pages = ids; await store.putDoc(d); return d; });

export async function textOf(page, kind, progress) {
  if (page.ocr && page.ocr.kind === kind) return page.ocr.data;
  const out = await store.getFile(page.id + ':out');
  // very large pages are read at a comfortable size; the positions are scaled back afterwards
  const pic = await heavy.call('jpeg', { blob: out, maxSide: 2800, quality: 0.92 });
  const data = await ocr.readPage(pic.blob, pic.width, pic.height, kind, progress);
  page.ocr = { kind, data };
  await store.putPage(page);
  return data;
}

const QUALITY = { small: [1500, 0.6], normal: [2300, 0.78], best: [3200, 0.9] };
export const cleanName = s => (s || 'Scan').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Scan';

export async function makePdf(doc, pages, opt, say = () => {}) {
  const [maxSide, quality] = QUALITY[opt.quality] || QUALITY.normal, out = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    say(`Page ${i + 1} of ${pages.length}`);
    const blob = await store.getFile(p.id + ':out');
    const e = await heavy.call('pdfPage', { blob, filter: p.filter, maxSide, quality });
    if (opt.searchable) {
      const t = await textOf(p, 'normal', f => say(`Reading page ${i + 1} of ${pages.length}: ${Math.round(f * 100)}%`));
      const k = e.width / t.width;
      e.words = t.words.map(w => ({ ...w, x0: w.x0 * k, x1: w.x1 * k, y0: w.y0 * k, y1: w.y1 * k }));
    }
    out.push(e);
  }
  say('Putting the PDF together');
  return buildPdf(out, { title: doc.name, size: opt.size, numbers: opt.numbers });
}

export async function makeDocx(doc, pages, opt, say = () => {}) {
  const out = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (opt.mode === 'image') {
      say(`Page ${i + 1} of ${pages.length}`);
      const j = await heavy.call('jpeg', { blob: await store.getFile(p.id + ':out'), maxSide: 2300, quality: 0.8 });
      out.push({ width: j.width, height: j.height, image: new Uint8Array(await j.blob.arrayBuffer()) });
    } else out.push(await textOf(p, opt.kind, f => say(`Reading page ${i + 1} of ${pages.length}: ${Math.round(f * 100)}%`)));
  }
  say('Putting the Word file together');
  return buildDocx(out, { title: doc.name, mode: opt.mode });
}

export async function makeJpegs(doc, pages, say = () => {}) {
  const files = [];
  for (let i = 0; i < pages.length; i++) {
    say(`Page ${i + 1} of ${pages.length}`);
    const j = await heavy.call('jpeg', { blob: await store.getFile(pages[i].id + ':out'), maxSide: 3200, quality: 0.9 });
    files.push(new File([j.blob], `${cleanName(doc.name)}${pages.length > 1 ? ' ' + (i + 1) : ''}.jpg`, { type: 'image/jpeg' }));
  }
  return files;
}

export async function backupAll(say) {
  const docs = await store.allDocs(), files = [], used = new Set();
  for (const d of docs) {
    const pages = await store.getPages(d);
    if (!pages.length) continue;
    say(d.name);
    let name = cleanName(d.name), k = 2;
    while (used.has(name.toLowerCase())) name = `${cleanName(d.name)} (${k++})`;
    used.add(name.toLowerCase());
    const pdf = await makePdf(d, pages, { size: 'a4', quality: 'best' });
    files.push({ name: name + '.pdf', data: new Uint8Array(await pdf.arrayBuffer()), store: true });
  }
  if (!files.length) return null;
  return new File([await zip(files, 'application/zip')], `Bertie Scan backup ${niceDate(Date.now())}.zip`, { type: 'application/zip' });
}
export { ocr };
