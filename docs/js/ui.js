// Small helpers for building screens, sheets and messages.
export function h(tag, attrs, ...kids) {
  const [name, ...cls] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (cls.length) el.className = cls.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k in el && k !== 'list' && typeof v !== 'object') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(3)) if (c != null && c !== false) el.append(c);
  return el;
}

const P = {
  back: 'M15 5l-7 7 7 7', close: 'M6 6l12 12M18 6L6 18', plus: 'M12 5v14M5 12h14', check: 'M5 13l4.5 4.5L19 7',
  camera: 'M4 8.5A1.5 1.5 0 015.500 7H8l1.500-2.500h5L16 7h2.500A1.500 1.500 0 0120 8.500v9a1.500 1.500 0 01-1.500 1.500h-13A1.500 1.500 0 014 17.500zM12 16.200a3.400 3.400 0 100-6.800 3.400 3.400 0 000 6.800z',
  photos: 'M4 6.500A1.500 1.500 0 015.500 5h13A1.500 1.500 0 0120 6.500v11a1.500 1.500 0 01-1.500 1.500h-13A1.500 1.500 0 014 17.500zM4 16l4.500-4.500 4 4 2.500-2.500L20 17M15 9.500h.01',
  share: 'M12 15V4M8 7.500L12 3.500l4 4M6 11H5v9h14v-9h-1', download: 'M12 4v11M8 11.500l4 4 4-4M5 20h14', open: 'M14 4h6v6M20 4l-9 9M18 14v5H5V6h5',
  trash: 'M5 7h14M10 7V4.500h4V7M7 7l1 12.500h8L17 7M10.500 10.500v6M13.500 10.500v6', crop: 'M7 3v14h14M3 7h14v14', rotate: 'M19 12a7 7 0 11-2.300-5.200M19 3.500V8h-4.500',
  sliders: 'M5 8h8M17 8h2M5 16h2M11 16h8M15 6v4M9 14v4', text: 'M6 6h12M12 6v13M9 19h6', dots: 'M5.500 12h.01M12 12h.01M18.500 12h.01', bolt: 'M13 3L6 13.500h5L10.500 21 18 10.500h-5z',
  gear: 'M12 15.200a3.200 3.200 0 100-6.400 3.200 3.200 0 000 6.400zM19 12l1.800 1.400-1.700 3-2.200-.8-1.700 1-.4 2.400h-3.500l-.4-2.400-1.700-1-2.200.8-1.700-3L7 12 5.300 10.600l1.700-3 2.200.8 1.700-1 .4-2.400h3.500l.4 2.400 1.700 1 2.200-.8 1.700 3z',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01', search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4', left: 'M14 6l-6 6 6 6', right: 'M10 6l6 6-6 6', pen: 'M5 19l1-4L16 5l3 3L9 18z', frame: 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4', auto: 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M9 12.500l2 2 4-4.500', copy: 'M9 9h10v11H9zM15 9V4H5v11h4',
};
export function icon(name, size = 24) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'ic');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', P[name]); s.append(p);
  return s;
}

export const urls = new Set();
export function blobUrl(b) { const u = URL.createObjectURL(b); urls.add(u); return u; }
export function dropUrl(u) { if (urls.delete(u)) URL.revokeObjectURL(u); }

/* ---------- screens, with the phone's own back button working ---------- */
const stack = [];
let screens = {}, root, sheetOpen = null, closing = null;

export function setup(el, defs) {
  root = el; screens = defs;
  history.replaceState({ d: 0 }, '');
  window.addEventListener('popstate', e => {
    if (sheetOpen) { const s = sheetOpen; sheetOpen = null; s.remove(); if (s._done) s._done(); if (closing) { const c = closing; closing = null; c(); } return; }
    const d = e.state && e.state.d != null ? e.state.d : 0;
    while (stack.length - 1 > d) stack.pop();
    render();
    if (closing) { const c = closing; closing = null; c(); }
  });
}
function render() {
  const top = stack[stack.length - 1];
  if (root._leave) { const f = root._leave; root._leave = null; f(); }
  for (const u of [...urls]) dropUrl(u);
  const el = screens[top.name](top.params || {});
  root.replaceChildren(el);
  root._leave = el._leave || null;
  window.scrollTo(0, 0);
}
export function go(name, params) { stack.push({ name, params }); if (stack.length > 1) history.pushState({ d: stack.length - 1 }, ''); render(); }
export function swap(name, params) { stack[stack.length - 1] = { name, params }; render(); }
export function refresh() { render(); }
export function back() { return new Promise(r => { closing = r; history.back(); }); }

export function sheet(title, build, cls = '') {
  return new Promise(done => {
    const close = () => new Promise(r => { if (sheetOpen !== wrap) return r(); closing = r; history.back(); });
    const body = h('div.sheet-body');
    const wrap = h('div.sheet-wrap', { class: cls, onclick: e => { if (e.target === wrap && !wrap._lock) close(); } },
      h('div.sheet', { role: 'dialog', 'aria-label': title },
        h('div.sheet-head', null, h('h2', null, title), h('button.iconbtn', { onclick: () => { if (!wrap._lock) close(); }, 'aria-label': 'Close' }, icon('close'))), body));
    wrap._done = () => done(wrap._value);
    build(body, { close, finish: async v => { wrap._value = v; await close(); }, lock: v => { wrap._lock = v; } });
    document.body.append(wrap);
    sheetOpen = wrap;
    history.pushState({ d: stack.length - 1, sheet: 1 }, '');
  });
}

export const confirmBox = (title, text, yes, danger) => sheet(title, (b, s) => {
  b.append(h('p', null, text), h('div.row', null, h('button.btn.ghost', { onclick: () => s.finish(false) }, 'Cancel'), h('button.btn' + (danger ? '.danger' : ''), { onclick: () => s.finish(true) }, yes)));
});

let toastTimer;
export function toast(msg, ms = 2600) {
  let t = document.querySelector('.toast');
  if (!t) document.body.append(t = h('div.toast', { role: 'status' }));
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}

export function busy(msg) {
  const label = h('div', null, msg), el = h('div.busy', null, h('div.spinner'), label);
  document.body.append(el);
  return { say: m => { label.textContent = m; }, done: () => el.remove() };
}
