import { h, icon, blobUrl, setup, go, swap, refresh, back, sheet, confirmBox, toast, busy } from './ui.js';
import * as store from './store.js';
import { DEV } from './store.js';
import * as E from './engine.js';
import { Camera, Steady } from './camera.js';
import { isConvex, orderCorners } from './detect.js';
import { plainText } from './ocr.js';

export const VERSION = '1.1';
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isApple = DEV !== 'phone';
// Apple lets only the person put an app on the Home Screen, so there the app can only show the steps
const appleBrowser = (navigator.userAgent.match(/CriOS|EdgiOS|FxiOS|GSA|OPT|DuckDuckGo/) || [''])[0];
const inSafari = isApple && !appleBrowser && /Version\/[\d.]+.*Safari\//.test(navigator.userAgent);
const tooOld = typeof OffscreenCanvas === 'undefined';
let installEvent = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; });
const oops = e => { console.error(e); toast(/quota|storage/i.test(String(e && e.message)) ? `The ${DEV} is out of storage space. Delete some old scans first.` : 'That did not work: ' + (e && e.message || e), 5000); };
const pagesWord = n => `${n} page${n === 1 ? '' : 's'}`;
const kb = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

async function thumb(el, pageId) {
  const b = await store.getFile(pageId + ':thumb');
  if (b && el.isConnected !== false) el.src = blobUrl(b);
}

function pickPhotos(opts = {}) {
  return new Promise(ok => {
    const i = h('input', { type: 'file', accept: 'image/*', multiple: !opts.camera });
    if (opts.camera) i.setAttribute('capture', 'environment');
    i.style.display = 'none';
    i.addEventListener('change', () => { ok([...i.files]); i.remove(); });
    i.addEventListener('cancel', () => { ok([]); i.remove(); });
    document.body.append(i);
    i.click();
  });
}
async function addPhotos(docId, files) {
  if (!files.length) return docId;
  const b = busy('Adding…');
  try {
    if (!docId) docId = (await E.newDoc()).id;
    for (let i = 0; i < files.length; i++) {
      b.say(files.length > 1 ? `Adding photo ${i + 1} of ${files.length}…` : 'Finding the page…');
      await E.addPage(docId, files[i]);
    }
  } catch (e) { oops(e); } finally { b.done(); }
  const d = docId && await store.getDoc(docId);
  if (d && !d.pages.length) { await store.deleteDoc(d); return null; }
  return docId;
}

/* ---------- putting the app on the Home Screen ---------- */
async function installHelp() {
  if (installEvent) { installEvent.prompt(); return; }
  const n = (await store.allDocs()).length;
  const step = (ic, ...t) => h('li', null, h('span.step-ic', null, icon(ic, 26)), h('div', null, ...t));
  const b = t => h('b', null, t);
  await sheet(`Put it on your ${DEV}`, body => {
    if (!isApple) return body.append(h('p', null, 'Open the ⋮ menu at the top right of Chrome, then tap "Add to Home screen" or "Install app".'));
    if (!inSafari) {
      body.append(h('p', null, b('Open this page in Safari first.'), ' Copy the address here, open Safari, hold your finger on the address bar and tap Paste and Go. Then tap Show me how again.'),
        h('button.btn.wide', { onclick: async () => { const u = location.origin + location.pathname; try { await navigator.clipboard.writeText(u); toast('Address copied. Now open Safari.'); } catch { toast(u, 8000); } } }, icon('copy'), 'Copy the address'));
      return;
    }
    body.append(h('ol.steps', null,
      step('share', b('Tap Share'), h('small', null, DEV === 'iPad' ? 'The square with an arrow pointing up, at the top right of Safari.' : 'The square with an arrow pointing up. If you do not see it, tap the three dots first.')),
      step('dots', b('Tap View More'), h('small', null, 'If it is not there, scroll down the list instead.')),
      step('plusbox', b('Tap Add to Home Screen'), h('small', null, 'Not in the list? Scroll to the bottom, tap Edit Actions, and tap the plus next to it.')),
      step('check', b('Turn on Open as Web App, then tap Add'), h('small', null, 'If there is no such switch, just tap Add.')),
      step('frame', b('Leave Safari and open Bertie Scan from its new icon'), h('small', null, 'From then on always use the icon.'))),
      n && h('p.warn', null, `The ${n === 1 ? 'scan' : n + ' scans'} you made here will stay in Safari, because the new app starts empty. Save or send ${n === 1 ? 'it' : 'them'} first.`) || '');
  });
}

/* ---------- home: all the scans ---------- */
function home() {
  const list = h('div.docs'), q = h('input', { type: 'search', placeholder: 'Search your scans', 'aria-label': 'Search your scans', oninput: () => draw() });
  let docs = [];
  const draw = () => {
    const f = q.value.trim().toLowerCase();
    const show = docs.filter(d => d.name.toLowerCase().includes(f));
    searchBox.hidden = docs.length < 4;
    list.replaceChildren(...show.map(d => {
      const im = h('img', { alt: '', loading: 'lazy' });
      if (d.pages[0]) thumb(im, d.pages[0]);
      return h('div.doc', null,
        h('button.doc-open', { onclick: () => go('doc', { id: d.id }) }, h('span.doc-pic', null, im), h('span.doc-text', null, h('b', null, d.name), h('small', null, `${pagesWord(d.pages.length)} · ${E.niceDate(d.updated)}`))),
        h('button.iconbtn', { 'aria-label': 'More for ' + d.name, onclick: () => docMenu(d).then(load) }, icon('dots')));
    }));
    if (!docs.length) list.append(h('div.empty', null, h('img', { src: 'icons/icon.svg', alt: '' }), h('h2', null, 'Scan your first page'), h('p', null, `Lay the paper flat on something darker than the paper, tap Scan, and hold the ${DEV} above it. It finds the edges and takes the picture by itself.`)));
    else if (!show.length) list.append(h('p.muted', null, 'Nothing with that name.'));
  };
  const load = async () => { docs = await store.allDocs(); draw(); };
  const searchBox = h('label.search', { hidden: true }, icon('search', 20), q);
  load().catch(oops);
  const install = standalone || E.settings.get('hideInstall', false) ? null : h('div.install', null,
    h('div', null, h('b', null, `Put Bertie Scan on your ${DEV}`), h('p', null, 'It opens like any other app and works without internet.')),
    h('div.row', null, h('button.btn.small', { onclick: installHelp }, isApple ? 'Show me how' : 'Install'),
      h('button.btn.small.ghost', { onclick: e => { E.settings.set('hideInstall', true); e.target.closest('.install').remove(); } }, 'Not now')));
  return h('main.screen.home', null,
    h('header.top', null, h('h1', null, 'Bertie Scan'), h('button.iconbtn', { 'aria-label': 'Settings', onclick: settingsSheet }, icon('gear'))),
    tooOld && h('div.install', null, h('b', null, `This ${DEV} needs an update`), h('p', null, isApple ? `Bertie Scan needs iPadOS or iOS 16.4 or newer. Open Settings, General, Software Update.` : 'Please update Chrome in the Play Store.')),
    install, searchBox, list,
    h('div.dock', null,
      h('button.btn.ghost.tall', { onclick: async () => { const id = await addPhotos(null, await pickPhotos()); if (id) go('doc', { id }); } }, icon('photos'), 'Photos'),
      h('button.btn.tall.main', { onclick: () => go('camera', {}) }, icon('camera'), 'Scan')));
}

const rename = async d => {
  const v = await sheet('Name', (b, s) => {
    const i = h('input.field', { value: d.name, 'aria-label': 'Name', maxLength: 100 });
    b.append(h('form', { onsubmit: e => { e.preventDefault(); s.finish(i.value); } }, i, h('div.row', null, h('button.btn', { type: 'submit' }, 'Save name'))));
    setTimeout(() => { i.focus(); i.select(); }, 250);
  });
  if (v && v.trim()) { const f = await store.getDoc(d.id); f.name = E.cleanName(v); await store.putDoc(f, true); return f.name; }
};

async function docMenu(d) {
  const v = await sheet(d.name, (b, s) => b.append(h('div.menu', null,
    h('button', { onclick: () => s.finish('share') }, icon('share'), 'Save or send'),
    h('button', { onclick: () => s.finish('rename') }, icon('pen'), 'Change the name'),
    h('button.red', { onclick: () => s.finish('delete') }, icon('trash'), 'Delete'))));
  if (v === 'rename') await rename(d);
  if (v === 'share') await exportSheet(d.id);
  if (v === 'delete' && await confirmBox('Delete this scan?', `"${d.name}" (${pagesWord(d.pages.length)}) will be removed from this ${DEV}. This cannot be undone.`, 'Delete', true)) { await store.deleteDoc(await store.getDoc(d.id) || d); toast('Deleted'); return 'deleted'; }
  return v;
}

async function settingsSheet() {
  let used = '';
  try { const e = await navigator.storage.estimate(); used = `Your scans use ${kb(e.usage || 0)} on this ${DEV}.`; } catch { /* not known */ }
  const n = (await store.allDocs()).length;
  const act = await sheet('Settings', (b, s) => {
    const auto = h('input', { type: 'checkbox', checked: E.settings.get('auto', true), onchange: e => E.settings.set('auto', e.target.checked) });
    const ready = h('button.btn.ghost', {
      onclick: async () => {
        ready.disabled = true; ready.textContent = 'Downloading (about 9 MB)…';
        await E.ocr.warm(); ready.textContent = 'Done';
      },
    }, 'Download the text reader now');
    b.append(...[
      h('label.switch', null, h('span', null, h('b', null, 'Take the picture by itself'), h('small', null, `When the page is in view and the ${DEV} is still`)), auto),
      h('div.block', null, h('b', null, 'Back up'), h('p.muted', null, `Your scans live only on this ${DEV}. Make one file with a PDF of every scan, and keep it in Google Drive or on your computer.`), h('button.btn.ghost', { disabled: !n, onclick: () => s.finish('backup') }, `Back up ${n === 1 ? 'my scan' : `all ${n} scans`}`)),
      h('div.block', null, h('b', null, 'Use without internet'), h('p.muted', null, 'Scanning and PDF always work without internet. Reading the words (for Word files and searchable PDFs) needs one download first.'), ready),
      !standalone && h('div.block', null, h('b', null, `Put it on your ${DEV}`), h('p.muted', null, 'Then it opens from its own icon, like any other app.'), h('button.btn.ghost', { onclick: () => s.finish('install') }, 'Show me how')),
      h('p.muted', null, `${used} Nothing is ever uploaded. No adverts, no account, no fees.`),
      h('p.muted', null, `Bertie Scan ${VERSION}. Reads text with the free Tesseract engine (Apache 2.0).`)].filter(Boolean));
  });
  if (act === 'install') await installHelp();
  if (act === 'backup') {
    const b = busy('Making the backup…');
    try { const f = await E.backupAll(m => b.say(m)); b.done(); if (f) await doneSheet([f]); } catch (e) { b.done(); oops(e); }
  }
}

/* ---------- camera ---------- */
function camera({ docId }) {
  let id = docId || null, count = 0, running = true, taking = false, lastThumb = null, box = null, retryAt = 0;
  const video = h('video', { muted: true, playsInline: true, autoplay: true });
  video.setAttribute('playsinline', '');
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg'), poly = document.createElementNS(NS, 'polygon');
  svg.setAttribute('viewBox', '0 0 1000 1000'); svg.setAttribute('preserveAspectRatio', 'none'); svg.append(poly);
  const flash = h('div.flash'), hint = h('div.hint', { role: 'status' }, 'Starting the camera…');
  const stage = h('div.stage', null, video, svg, flash), area = h('div.cam-area', null, stage, hint);
  const cam = new Camera(video), steady = new Steady();
  const ring = h('button.shutter', { 'aria-label': 'Take the picture', onclick: () => shoot() }, h('span'));
  let auto = E.settings.get('auto', true);
  const autoBtn = h('button.pill', { onclick: () => { auto = !auto; E.settings.set('auto', auto); paintAuto(); } });
  const paintAuto = () => { autoBtn.replaceChildren(icon('auto', 20), auto ? 'Auto' : 'By hand'); autoBtn.classList.toggle('on', auto); autoBtn.setAttribute('aria-pressed', auto); };
  paintAuto();
  const torch = h('button.iconbtn.light', { hidden: true, 'aria-label': 'Torch', onclick: async () => { try { await cam.torch(!cam.torchOn); torch.classList.toggle('on', cam.torchOn); } catch { toast('The torch is not available'); } } }, icon('bolt'));
  const pile = h('button.pile', { disabled: true, 'aria-label': 'See the pages', onclick: () => done() }, h('img', { alt: '' }), h('b'));
  const doneBtn = h('button.btn.main', { disabled: true, onclick: () => done() }, 'Done');
  const say = t => { if (hint.textContent !== t) hint.textContent = t; };

  const fit = () => {
    if (!video.videoWidth) return;
    const r = area.getBoundingClientRect(), k = Math.min(r.width / video.videoWidth, r.height / video.videoHeight);
    stage.style.width = video.videoWidth * k + 'px'; stage.style.height = video.videoHeight * k + 'px';
  };
  const small = document.createElement('canvas');
  async function loop() {
    while (running) {
      const t0 = performance.now();
      if (cam.stream && video.videoWidth && !taking && !document.hidden) {
        if (box !== video.videoWidth + 'x' + video.videoHeight) { box = video.videoWidth + 'x' + video.videoHeight; fit(); steady.reset(); }
        const k = 288 / Math.max(video.videoWidth, video.videoHeight);
        small.width = Math.round(video.videoWidth * k); small.height = Math.round(video.videoHeight * k);
        const g = small.getContext('2d', { willReadFrequently: true });
        g.drawImage(video, 0, 0, small.width, small.height);
        const px = g.getImageData(0, 0, small.width, small.height).data.buffer;
        try {
          let r = await E.live.call('detect', { data: px, w: small.width, h: small.height }, [px]);
          if (r && r.score < 0.5) r = null;
          const s = steady.push(r, performance.now());
          if (!running || taking) continue;
          poly.setAttribute('points', s.quad ? s.quad.map(p => `${p[0] * 1000},${p[1] * 1000}`).join(' ') : '');
          svg.classList.toggle('good', !!s.good);
          ring.style.setProperty('--p', auto ? s.progress : 0);
          say(!s.quad ? (steady.missed > 12 || !steady.smooth ? 'Point at the page' : '') : r && r.area < 0.16 ? 'Move closer' : s.waiting ? (auto ? 'Next page' : 'Tap to scan the next page') : !s.good ? 'Show the whole page' : auto ? 'Hold still' : 'Tap to scan');
          if (auto && s.progress >= 1 && performance.now() > retryAt) shoot();
        } catch (e) { console.error(e); await new Promise(r => setTimeout(r, 500)); }
      }
      await new Promise(r => setTimeout(r, Math.max(30, 110 - (performance.now() - t0))));
    }
  }
  async function shoot() {
    if (taking || !cam.stream) return;
    taking = true; ring.disabled = true; ring.style.setProperty('--p', 0);
    const guess = steady.smooth && steady.smooth.map(p => [...p]);
    say('Taking the picture, hold still');
    try {
      const { blob, photo } = await cam.still();
      flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
      if (navigator.vibrate && navigator.userActivation && navigator.userActivation.hasBeenActive) navigator.vibrate(30);
      steady.taken(); retryAt = performance.now() + 1200;
      count++;
      pile.querySelector('b').textContent = count; pile.disabled = doneBtn.disabled = false;
      if (!id) id = (await E.newDoc()).id;
      pile.classList.add('wait');
      E.addPage(id, blob, { guess: photo ? null : guess }).then(async p => {
        if (!p) return;
        if (!p.sure) toast('Page edges not clear: you can set them under Crop');
        const t = await store.getFile(p.id + ':thumb');
        if (!running || !t) return;
        if (lastThumb) URL.revokeObjectURL(lastThumb);
        lastThumb = URL.createObjectURL(t);
        pile.querySelector('img').src = lastThumb; pile.classList.add('has');
      }).catch(oops).finally(() => pile.classList.remove('wait'));
    } catch (e) { oops(e); }
    taking = false; ring.disabled = false;
  }
  async function leave(toDoc) {
    const b = count ? busy('Finishing your pages…') : null;
    await E.idle();
    if (b) b.done();
    const d = id && await store.getDoc(id);
    if (d && !d.pages.length && !docId) { await store.deleteDoc(d); id = null; }
    if (docId) return back();
    if (toDoc && id) swap('doc', { id }); else back();
  }
  const done = () => leave(true);
  async function start() {
    say('Starting the camera…');
    try {
      await cam.start();
      if (!running) return cam.stop();
      torch.hidden = !cam.hasTorch; fit(); say('Point at the page');
    } catch (e) {
      if (!running) return;
      area.replaceChildren(h('div.cam-fail', null,
        h('h2', null, e.name === 'NotAllowedError' ? 'The camera is blocked' : 'The camera could not start'),
        h('p', null, e.name === 'NotAllowedError' ? `Allow the camera for Bertie Scan in your ${DEV} settings, then open the app again. Or use the ${DEV}'s own camera here:` : `You can use the ${DEV}'s own camera instead:`),
        h('button.btn.main', { onclick: ownCamera }, icon('camera'), `Use the ${DEV} camera`)));
    }
  }
  async function ownCamera() {
    const f = await pickPhotos({ camera: true });
    if (!f.length) return;
    const fresh = await addPhotos(id, f);
    if (fresh) { id = fresh; count++; leave(true); }
  }
  async function fromPhotos() {
    const f = await pickPhotos();
    if (!f.length) return;
    const fresh = await addPhotos(id, f);
    if (fresh) { id = fresh; count += f.length; leave(true); }
  }
  const vis = () => { if (document.hidden) cam.stop(); else if (running && !cam.stream) start(); };
  document.addEventListener('visibilitychange', vis);
  window.addEventListener('resize', fit);
  let wake = null;
  if (navigator.wakeLock) navigator.wakeLock.request('screen').then(w => { if (running) wake = w; else w.release(); }).catch(() => {});
  const el = h('main.screen.cam', null,
    h('div.cam-top', null, h('button.iconbtn.light', { 'aria-label': 'Close', onclick: () => leave(true) }, icon('close')), autoBtn, torch, h('button.iconbtn.light', { 'aria-label': `Use the ${DEV} camera (sharper for small cards)`, onclick: ownCamera }, icon('camera'))),
    area,
    h('div.cam-bottom', null, h('button.iconbtn.light.big', { 'aria-label': 'Choose from photos', onclick: fromPhotos }, icon('photos', 28)), ring, h('div.cam-right', null, pile, doneBtn)));
  el._leave = () => { running = false; cam.stop(); document.removeEventListener('visibilitychange', vis); window.removeEventListener('resize', fit); if (wake) wake.release().catch(() => {}); if (lastThumb) URL.revokeObjectURL(lastThumb); };
  start().then(loop);
  return el;
}

/* ---------- one document ---------- */
function doc({ id }) {
  const title = h('button.title', { onclick: async () => { const n = await rename(d); if (n) { d.name = n; title.firstChild.textContent = n; } } }, h('span'), icon('pen', 18));
  const sub = h('p.muted.pad'), grid = h('div.grid');
  let d;
  const load = async () => {
    d = await store.getDoc(id);
    if (!d) return back();
    title.firstChild.textContent = d.name;
    sub.textContent = `${pagesWord(d.pages.length)}${d.pages.length > 1 ? '. Drag the dots on a page to move it.' : '. Tap the page to crop it or change how it looks.'}`;
    grid.replaceChildren(...d.pages.map((pid, i) => {
      const im = h('img', { alt: 'Page ' + (i + 1), draggable: false });
      thumb(im, pid);
      const c = h('div.pg', null, h('button.pg-open', { onclick: () => go('page', { docId: id, pageId: pid }) }, im), h('div.pg-foot', null, h('span', null, i + 1), d.pages.length > 1 && grip()));
      c.dataset.id = pid;
      return c;
    }), h('button.pg.add', { onclick: () => go('camera', { docId: id }) }, icon('plus', 30), 'Add a page'));
  };
  // dragging pages into a new order
  const grip = () => {
    const g = h('button.grip', { 'aria-label': 'Move this page' }, icon('grip', 22));
    g.addEventListener('pointerdown', e => {
      const card = g.closest('.pg'); e.preventDefault(); card.classList.add('drag');
      const mv = ev => {
        const under = document.elementsFromPoint(ev.clientX, ev.clientY).map(x => x.closest && x.closest('.pg')).find(x => x && x !== card && x.dataset.id);
        if (under) { const a = [...grid.children], before = a.indexOf(card) > a.indexOf(under); grid.insertBefore(card, before ? under : under.nextSibling); }
        if (ev.clientY < 90) scrollBy(0, -12); else if (ev.clientY > innerHeight - 130) scrollBy(0, 12);
      };
      const up = async () => {
        window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); card.classList.remove('drag');
        const ids = [...grid.querySelectorAll('.pg[data-id]')].map(x => x.dataset.id);
        if (ids.join() !== d.pages.join()) { await E.reorder(id, ids); load(); }
      };
      // listened for on the whole window, because the card itself moves while it is dragged
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    });
    return g;
  };
  load().catch(oops);
  return h('main.screen', null,
    h('header.top', null, h('button.iconbtn', { 'aria-label': 'Back', onclick: back }, icon('back')), title,
      h('button.iconbtn', { 'aria-label': 'Delete this scan', onclick: async () => { if (await confirmBox('Delete this scan?', `"${d.name}" (${pagesWord(d.pages.length)}) will be removed from this ${DEV}. This cannot be undone.`, 'Delete', true)) { await store.deleteDoc(d); await back(); toast('Deleted'); } } }, icon('trash'))),
    sub, grid,
    h('div.dock', null,
      h('button.btn.ghost.tall', { onclick: async () => { const f = await pickPhotos(); if (f.length) { await addPhotos(id, f); load(); } } }, icon('photos'), 'Photos'),
      h('button.btn.main.tall', { onclick: () => exportSheet(id) }, icon('share'), 'Save or send')));
}

/* ---------- one page ---------- */
function page({ docId, pageId }) {
  let d, p, working = false;
  const img = h('img.sheet-img', { alt: 'The scanned page', draggable: false }), view = h('div.view', null, img), spin = h('div.spinner', { hidden: true });
  const count = h('b.count'), strip = h('div.looks');
  const prev = h('button.iconbtn', { 'aria-label': 'Previous page', onclick: () => step(-1) }, icon('left')), next = h('button.iconbtn', { 'aria-label': 'Next page', onclick: () => step(1) }, icon('right'));
  const step = k => { const i = d.pages.indexOf(pageId) + k; if (i >= 0 && i < d.pages.length) swap('page', { docId, pageId: d.pages[i] }); };
  const show = async () => { const b = await store.getFile(pageId + ':out'); if (b) img.src = blobUrl(b); };
  const work = async fn => {
    if (working) return; working = true; spin.hidden = false;
    try { await fn(); await show(); } catch (e) { oops(e); }
    working = false; spin.hidden = true;
  };
  const looks = async () => {
    const orig = await store.getFile(pageId + ':orig');
    const r = await E.heavy.call('looks', { key: pageId, blob: orig, quad: p.quad, rot: p.rot, filters: E.FILTERS.map(f => f[0]) });
    if (!strip.isConnected) return;
    strip.replaceChildren(...E.FILTERS.map(([f, label]) => h('button.look' + (p.filter === f ? '.on' : ''), {
      'aria-pressed': p.filter === f, onclick: e => {
        if (p.filter === f || working) return;
        strip.querySelectorAll('.look').forEach(x => x.classList.remove('on')); e.currentTarget.classList.add('on');
        E.settings.set('filter', f);
        work(() => E.changePage(p, { filter: f }));
      },
    }, h('img', { src: blobUrl(r[f]), alt: '' }), h('span', null, label))));
  };
  (async () => {
    d = await store.getDoc(docId); p = await store.getPage(pageId);
    if (!d || !p) return back();
    const i = d.pages.indexOf(pageId);
    count.textContent = `Page ${i + 1} of ${d.pages.length}`;
    prev.disabled = i <= 0; next.disabled = i >= d.pages.length - 1;
    await show(); await looks();
  })().catch(oops);

  // swipe for next page, double tap to zoom in
  let x0 = null, y0 = 0, lastTap = 0;
  view.addEventListener('pointerdown', e => { x0 = e.clientX; y0 = e.clientY; });
  view.addEventListener('pointerup', e => {
    if (x0 == null) return;
    const dx = e.clientX - x0, dy = e.clientY - y0; x0 = null;
    if (Math.hypot(dx, dy) < 10) {
      if (e.timeStamp - lastTap < 320) {
        const r = img.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
        view.classList.toggle('zoom');
        if (view.classList.contains('zoom')) { view.scrollLeft = img.scrollWidth * fx - view.clientWidth / 2; view.scrollTop = img.scrollHeight * fy - view.clientHeight / 2; }
        lastTap = 0;
      } else lastTap = e.timeStamp;
    } else if (!view.classList.contains('zoom') && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) step(dx < 0 ? 1 : -1);
  });
  view.addEventListener('pointercancel', () => { x0 = null; });

  const tool = (ic, label, fn) => h('button.tool', { onclick: fn }, icon(ic), label);
  return h('main.screen.page', null,
    h('header.top', null, h('button.iconbtn', { 'aria-label': 'Back', onclick: back }, icon('back')), h('div.pager', null, prev, count, next),
      h('button.iconbtn', { 'aria-label': 'Delete this page', onclick: async () => {
        if (!await confirmBox('Delete this page?', 'It will be removed from this scan. This cannot be undone.', 'Delete', true)) return;
        const i = d.pages.indexOf(pageId), rest = await E.removePage(p);
        if (rest.pages.length) swap('page', { docId, pageId: rest.pages[Math.min(i, rest.pages.length - 1)] });
        else { await store.deleteDoc(rest); await back(); await back(); }
      } }, icon('trash'))),
    h('div.view-wrap', null, view, spin), strip,
    h('div.tools', null,
      tool('crop', 'Crop', () => p && go('crop', { docId, pageId })),
      tool('rotate', 'Rotate', () => p && work(async () => { await E.changePage(p, { rot: (p.rot + 1) % 4 }); await looks(); })),
      tool('sliders', 'Adjust', () => p && adjustSheet(p, img, work)),
      tool('text', 'Read text', () => p && textSheet(p)),
      tool('copy', 'All pages', () => p && allPagesSheet(d, p))));
}

async function adjustSheet(p, img, work) {
  const start = { bright: p.bright, contrast: p.contrast }, now = { ...start }, orig = await store.getFile(p.id + ':orig');
  let busyNow = false, again = false, shown = null;
  const draw = async () => {
    if (busyNow) { again = true; return; }
    busyNow = true;
    try { const b = await E.heavy.call('adjustPreview', { key: p.id, blob: orig, quad: p.quad, rot: p.rot, filter: p.filter, ...now }); const u = URL.createObjectURL(b); img.src = u; if (shown) URL.revokeObjectURL(shown); shown = u; } catch (e) { oops(e); }
    busyNow = false;
    if (again) { again = false; draw(); }
  };
  const ok = await sheet('Adjust', (b, s) => {
    const slider = (label, k) => {
      const out = h('output', null, now[k]), i = h('input', { type: 'range', min: -50, max: 50, value: now[k], 'aria-label': label, oninput: () => { now[k] = +i.value; out.textContent = i.value; draw(); } });
      return h('label.slider', null, h('span', null, label, out), i);
    };
    b.append(slider('Brightness', 'bright'), slider('Contrast', 'contrast'), h('div.row', null, h('button.btn.ghost', { onclick: () => { now.bright = now.contrast = 0; b.querySelectorAll('input').forEach(i => { i.value = 0; }); b.querySelectorAll('output').forEach(i => { i.textContent = 0; }); draw(); } }, 'Reset'), h('button.btn', { onclick: () => s.finish(true) }, 'Use this')));
  }, 'clear');
  if (ok && (now.bright !== start.bright || now.contrast !== start.contrast)) await work(() => E.changePage(p, now));
  else await work(async () => {});
  if (shown) URL.revokeObjectURL(shown);
}

async function textSheet(p) {
  const b = busy('Reading the page…');
  let t;
  try { t = plainText(await E.textOf(p, 'normal', f => b.say(`Reading the page… ${Math.round(f * 100)}%`))); } catch (e) { b.done(); return oops(e); }
  b.done();
  await sheet('Text on this page', (el, s) => {
    const a = h('textarea.text', { value: t || 'No writing was found on this page.', rows: 14 });
    el.append(a, h('div.row', null, h('button.btn.ghost', { onclick: async () => { try { await navigator.clipboard.writeText(a.value); toast('Copied'); } catch { a.select(); document.execCommand('copy'); toast('Copied'); } } }, 'Copy all'), navigator.share && h('button.btn', { onclick: () => navigator.share({ text: a.value }).catch(() => {}) }, 'Send')));
  });
}

async function allPagesSheet(d, p) {
  if (d.pages.length < 2) return toast('This scan has only one page');
  const name = E.FILTERS.find(f => f[0] === p.filter)[1];
  if (!await confirmBox('Same look for all pages?', `Make all ${d.pages.length} pages "${name}", with this page's brightness and contrast.`, 'Yes, all pages')) return;
  const b = busy('Working…');
  try {
    let i = 0;
    for (const q of await store.getPages(d)) {
      b.say(`Page ${++i} of ${d.pages.length}`);
      if (q.id !== p.id && (q.filter !== p.filter || q.bright !== p.bright || q.contrast !== p.contrast)) await E.changePage(q, { filter: p.filter, bright: p.bright, contrast: p.contrast });
    }
    toast('All pages look the same now');
  } catch (e) { oops(e); } finally { b.done(); }
}

/* ---------- crop: drag the corners ---------- */
function crop({ docId, pageId }) {
  let p, quad, src;
  const NS = 'http://www.w3.org/2000/svg', mk = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const img = h('img', { alt: '', draggable: false }), svg = mk('svg', { class: 'crop-svg' }), shade = mk('path', { class: 'shade', 'fill-rule': 'evenodd' }), poly = mk('polygon', { class: 'line' });
  svg.append(shade, poly);
  const loupe = h('div.loupe', { hidden: true }), box = h('div.crop-box', null, img, svg, loupe), area = h('div.crop-area', null, box);
  const dots = [];
  let W = 1, H = 1;
  const draw = () => {
    if (!quad) return;
    const P = quad.map(q => [q[0] * W, q[1] * H]);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    poly.setAttribute('points', P.map(q => q.join()).join(' '));
    shade.setAttribute('d', `M0 0H${W}V${H}H0Z M${P.map(q => q.join(' ')).join('L')}Z`);
    poly.classList.toggle('bad', !isConvex(P));
    dots.forEach((d, i) => { const c = i < 4 ? P[i] : [(P[i - 4][0] + P[(i - 3) % 4][0]) / 2, (P[i - 4][1] + P[(i - 3) % 4][1]) / 2]; d.style.transform = `translate(${c[0]}px,${c[1]}px)`; });
  };
  const fit = () => {
    if (!img.naturalWidth) return;
    const pad = 22, r = area.getBoundingClientRect(), k = Math.min((r.width - pad * 2) / img.naturalWidth, (r.height - pad * 2) / img.naturalHeight);
    W = img.naturalWidth * k; H = img.naturalHeight * k;
    box.style.width = W + 'px'; box.style.height = H + 'px'; draw();
  };
  const clamp = v => Math.max(0, Math.min(1, v));
  for (let i = 0; i < 8; i++) {
    const d = h('button.dot' + (i > 3 ? '.mid' : ''), { 'aria-label': i < 4 ? 'Corner ' + (i + 1) : 'Side ' + (i - 3) });
    dots.push(d); box.append(d);
    let from = null;
    d.addEventListener('pointerdown', e => { e.preventDefault(); d.setPointerCapture(e.pointerId); from = { x: e.clientX, y: e.clientY, q: quad.map(a => [...a]) }; d.classList.add('on'); zoom(); });
    d.addEventListener('pointermove', e => {
      if (!from) return;
      const dx = (e.clientX - from.x) / W, dy = (e.clientY - from.y) / H;
      for (const c of i < 4 ? [i] : [i - 4, (i - 3) % 4]) quad[c] = [clamp(from.q[c][0] + dx), clamp(from.q[c][1] + dy)];
      draw(); zoom();
    });
    const end = () => { from = null; d.classList.remove('on'); loupe.hidden = true; };
    d.addEventListener('pointerup', end); d.addEventListener('pointercancel', end);
    const zoom = () => {
      if (i > 3) return;
      const S = 116, Z = 2.6, x = quad[i][0] * W, y = quad[i][1] * H;
      loupe.hidden = false;
      loupe.style.backgroundImage = `url(${src})`; loupe.style.backgroundSize = `${W * Z}px ${H * Z}px`;
      loupe.style.backgroundPosition = `${S / 2 - x * Z}px ${S / 2 - y * Z}px`;
      // keep the magnifier clear of the finger and on the screen
      const lx = x < W / 2 ? Math.min(W - S, x + 50) : Math.max(0, x - S - 50), ly = y < 110 ? y + 46 : y - S - 30;
      loupe.style.transform = `translate(${lx}px,${ly}px)`;
    };
  }
  (async () => {
    p = await store.getPage(pageId); quad = p.quad.map(a => [...a]);
    src = blobUrl(await store.getFile(pageId + ':orig'));
    img.onload = fit; img.src = src;
  })().catch(oops);
  window.addEventListener('resize', fit);
  const el = h('main.screen.crop', null,
    h('header.top.dark', null, h('button.iconbtn.light', { 'aria-label': 'Cancel', onclick: back }, icon('close')), h('b', null, 'Drag the corners'), h('span.iconbtn')),
    area,
    h('div.crop-tools', null,
      h('button.pill', { onclick: async () => { const b = busy('Finding the page…'); try { const r = await E.heavy.call('find', { key: pageId, blob: await store.getFile(pageId + ':orig') }); if (r.found) { quad = r.found.quad; draw(); } else toast('No page edges found. Drag the corners by hand.'); } catch (e) { oops(e); } b.done(); } }, icon('auto', 20), 'Find page'),
      h('button.pill', { onclick: () => { quad = E.WHOLE.map(a => [...a]); draw(); } }, icon('frame', 20), 'Whole photo'),
      h('button.btn.main', { onclick: async () => {
        if (!isConvex(quad.map(q => [q[0] * W, q[1] * H]))) return toast('The corners are crossed. Move them so the lines go around the page.');
        const whole = quad.every((q, i) => Math.abs(q[0] - E.WHOLE[i][0]) < 0.002 && Math.abs(q[1] - E.WHOLE[i][1]) < 0.002);
        const b = busy('Straightening…');
        try { await E.changePage(p, { quad: whole ? E.WHOLE : orderCorners(quad.map(q => [q[0] * W, q[1] * H])).map(q => [q[0] / W, q[1] / H]), sure: true }); b.done(); back(); } catch (e) { b.done(); oops(e); }
      } }, icon('check'), 'Done')));
  el._leave = () => window.removeEventListener('resize', fit);
  return el;
}

/* ---------- save or send ---------- */
function choices(key, def, list, onpick) {
  const g = h('div.seg', { role: 'group' });
  let cur = key ? E.settings.get(key, def) : def;
  if (!list.some(l => l[0] === cur)) cur = def;
  const paint = () => [...g.children].forEach((b, i) => { b.classList.toggle('on', list[i][0] === cur); b.setAttribute('aria-pressed', list[i][0] === cur); });
  list.forEach(([v, label, note]) => g.append(h('button', { type: 'button', onclick: () => { cur = v; if (key) E.settings.set(key, v); paint(); if (onpick) onpick(v); } }, label, note && h('small', null, note))));
  paint();
  return { el: g, get: () => cur };
}
function toggle(key, label, note) {
  const i = h('input', { type: 'checkbox', checked: E.settings.get(key, false), onchange: () => E.settings.set(key, i.checked) });
  return { el: h('label.switch', null, h('span', null, h('b', null, label), note && h('small', null, note)), i), get: () => i.checked };
}

async function exportSheet(id) {
  await E.idle();
  const d = await store.getDoc(id);
  const opt = await sheet('Save or send', (b, s) => {
    const name = h('input.field', { value: d.name, 'aria-label': 'File name', maxLength: 100 });
    const size = choices('size', 'a4', [['a4', 'A4'], ['fit', 'Same shape as scan'], ['pair', 'Two per page', 'ID card front and back']]);
    const quality = choices('quality', 'normal', [['small', 'Small', 'for email'], ['normal', 'Normal'], ['best', 'Best', 'for printing']]);
    const search = toggle('searchable', 'Searchable', 'You can search and copy the words. Takes a few seconds a page.');
    const numbers = toggle('numbers', 'Page numbers');
    const mode = choices('wordMode', 'text', [['text', 'Words you can edit'], ['image', 'Picture of the page', 'looks exactly the same']], v => { kindBox.hidden = v !== 'text'; });
    const kind = choices('wordKind', 'normal', [['normal', 'Letter or book'], ['table', 'Receipt or table', 'keeps rows together']]);
    const kindBox = h('div', null, h('h3', null, 'What kind of page is it?'), kind.el, h('p.muted', null, 'Works for printed English and Afrikaans. Handwriting does not read well, so use "Picture of the page" for that.'));
    kindBox.hidden = mode.get() !== 'text';
    const panes = {
      pdf: h('div', null, h('h3', null, 'Paper'), size.el, h('h3', null, 'Quality'), quality.el, search.el, numbers.el),
      docx: h('div', null, h('h3', null, 'What should be in the Word file?'), mode.el, kindBox),
      jpg: h('div', null, h('p.muted', null, 'Every page becomes a photo (JPG).')),
    };
    const btn = h('button.btn.main.wide', { onclick: () => s.finish({ format: fmt.get(), name: name.value, size: size.get(), quality: quality.get(), searchable: search.get(), numbers: numbers.get(), mode: mode.get(), kind: kind.get() }) });
    const pane = v => { for (const k in panes) panes[k].hidden = k !== v; btn.textContent = v === 'pdf' ? 'Make the PDF' : v === 'docx' ? 'Make the Word file' : 'Make the pictures'; };
    const fmt = choices(null, 'pdf', [['pdf', 'PDF'], ['docx', 'Word'], ['jpg', 'Pictures']], pane);
    fmt.el.classList.add('bigseg');
    b.append(h('label.lab', null, 'File name', name), fmt.el, ...Object.values(panes), btn);
    pane(fmt.get());
  });
  if (!opt) return;
  const nm = E.cleanName(opt.name);
  if (nm !== d.name) { d.name = nm; await store.putDoc(d, true); refreshTitle(nm); }
  const pages = await store.getPages(d);
  const b = busy('Making your file…');
  let files;
  try {
    const say = m => b.say(m);
    if (opt.format === 'pdf') files = [new File([await E.makePdf(d, pages, opt, say)], nm + '.pdf', { type: 'application/pdf' })];
    else if (opt.format === 'docx') files = [new File([await E.makeDocx(d, pages, opt, say)], nm + '.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })];
    else files = await E.makeJpegs(d, pages, say);
  } catch (e) { b.done(); return oops(e); }
  b.done();
  await doneSheet(files);
}
const refreshTitle = n => { const t = document.querySelector('.title span'); if (t) t.textContent = n; };

function doneSheet(files) {
  const total = files.reduce((s, f) => s + f.size, 0);
  const canShare = !!(navigator.canShare && navigator.canShare({ files }));
  const save = () => {
    files.forEach((f, i) => setTimeout(() => { const u = URL.createObjectURL(f), a = h('a', { href: u, download: f.name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 60000); }, i * 350));
    toast('Saved to your Downloads');
  };
  return sheet('Your file is ready', (b, s) => {
    b.append(...[h('div.ready', null, h('div.ready-ic', null, icon('check', 30)), h('div', null, h('b', null, files.length > 1 ? `${files.length} pictures` : files[0].name), h('small', null, kb(total)))),
      canShare && h('button.btn.main.wide', { onclick: async () => { try { await navigator.share({ files, title: files[0].name }); s.finish('shared'); } catch (e) { if (e.name !== 'AbortError') toast(`The ${DEV} could not share this. Use Download instead.`); } } }, icon('share'), isApple ? 'Send or save to Files' : 'Send (WhatsApp, email, Drive)'),
      h('button.btn.wide' + (canShare ? '.ghost' : '.main'), { onclick: save }, icon('download'), `Download to this ${DEV}`),
      files.length === 1 && files[0].type === 'application/pdf' && h('button.btn.ghost.wide', { onclick: () => { const u = URL.createObjectURL(files[0]); if (!window.open(u, '_blank')) location.href = u; setTimeout(() => URL.revokeObjectURL(u), 120000); } }, icon('open'), 'Look at it'),
      !canShare && navigator.share && h('p.muted', null, 'To send it: download it, then open it from your Downloads and tap Share.')].filter(Boolean));
  });
}

/* ---------- start ---------- */
setup(document.getElementById('app'), { home, camera, doc, page, crop });
go('home');
window.__bertie = { store, E }; // used by the tests

if ('serviceWorker' in navigator && (location.hostname !== 'localhost' || /[?&]sw=1/.test(location.search))) {
  // a new version takes over straight away, but never in the middle of something
  const had = navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && document.querySelector('main.home') && !document.querySelector('.sheet-wrap, .busy')) location.reload(); });
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
