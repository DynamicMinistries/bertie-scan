// Keeps the scans on the phone (IndexedDB). Nothing is uploaded anywhere.
let dbp;
function open() {
  return dbp || (dbp = new Promise((ok, bad) => {
    const r = indexedDB.open('bertie-scan', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('docs', { keyPath: 'id' });
      d.createObjectStore('pages', { keyPath: 'id' });
      d.createObjectStore('files');
    };
    r.onsuccess = () => { r.result.onversionchange = () => r.result.close(); ok(r.result); };
    r.onerror = () => { dbp = null; bad(r.error); };
  }));
}
async function tx(stores, mode, fn) {
  const d = await open();
  return new Promise((ok, bad) => {
    const t = d.transaction(stores, mode);
    let out;
    const q = fn(t);
    if (q && 'onsuccess' in q) q.onsuccess = () => { out = q.result; };
    t.oncomplete = () => ok(out);
    t.onerror = () => bad(t.error);
    t.onabort = () => bad(t.error || new Error('The phone is out of storage space.'));
  });
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const allDocs = async () => (await tx(['docs'], 'readonly', t => t.objectStore('docs').getAll())).sort((a, b) => b.updated - a.updated);
export const getDoc = id => tx(['docs'], 'readonly', t => t.objectStore('docs').get(id));
export const putDoc = (d, keepDate) => { if (!keepDate) d.updated = Date.now(); return tx(['docs'], 'readwrite', t => { t.objectStore('docs').put(d); }); };
export const getPage = id => tx(['pages'], 'readonly', t => t.objectStore('pages').get(id));
export const putPage = p => tx(['pages'], 'readwrite', t => { t.objectStore('pages').put(p); });
export const getPages = async doc => (await Promise.all(doc.pages.map(getPage))).filter(Boolean);

// files are stored as plain bytes, which every phone's storage handles reliably
export async function putFile(key, blob) {
  const buf = await blob.arrayBuffer();
  return tx(['files'], 'readwrite', t => { t.objectStore('files').put({ buf, type: blob.type }, key); });
}
export async function getFile(key) {
  const f = await tx(['files'], 'readonly', t => t.objectStore('files').get(key));
  return f && new Blob([f.buf], { type: f.type });
}
function dropFiles(t, id) { for (const k of ['orig', 'out', 'thumb']) t.objectStore('files').delete(`${id}:${k}`); }
export const deletePage = id => tx(['pages', 'files'], 'readwrite', t => { t.objectStore('pages').delete(id); dropFiles(t, id); });
export const deleteDoc = doc => tx(['docs', 'pages', 'files'], 'readwrite', t => {
  t.objectStore('docs').delete(doc.id);
  for (const id of doc.pages) { t.objectStore('pages').delete(id); dropFiles(t, id); }
});
