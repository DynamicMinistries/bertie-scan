// Reads the writing on a page (English and Afrikaans). Runs on the phone itself with the free Tesseract
// engine, kept in vendor/ so nothing is ever sent anywhere.

let worker = null, mode = null, onProgress = () => {};

function loadScript(src) {
  return new Promise((ok, bad) => {
    if (window.Tesseract) return ok();
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => bad(new Error('The text reader could not be loaded. Connect to the internet once and try again.'));
    document.head.append(s);
  });
}

const at = p => new URL(p, document.baseURI).href;

export async function getWorker() {
  if (worker) return worker;
  worker = (async () => {
    await loadScript(at('vendor/tesseract.min.js'));
    return window.Tesseract.createWorker(['eng', 'afr'], 1, {
      workerPath: at('vendor/worker.min.js'), corePath: at('vendor/core'), langPath: at('vendor/lang'),
      workerBlobURL: false, gzip: true, cacheMethod: 'none',
      logger: m => { if (m.status === 'recognizing text') onProgress(m.progress); },
      errorHandler: () => {},
    });
  })();
  worker.catch(() => { worker = null; });
  return worker;
}

// Loads everything once in the background so it also works later without internet.
export async function warm() { try { await getWorker(); await release(); } catch { /* try again another day */ } }

export async function release() {
  const w = worker; worker = null; mode = null;
  if (w) try { (await w).terminate(); } catch { /* already gone */ }
}

// layoutMode: 'normal' (letters, books, columns) or 'table' (receipts, invoices: keeps rows together)
export async function readPage(blob, width, height, layoutMode = 'normal', progress = () => {}) {
  const w = await getWorker();
  const psm = layoutMode === 'table' ? '6' : '3';
  if (mode !== psm) { await w.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: '1', user_defined_dpi: String(Math.round(Math.max(width, height) / 11.69)) }); mode = psm; }
  onProgress = progress;
  const { data } = await w.recognize(blob, {}, { blocks: true, text: false });
  const paras = [], words = [];
  let lineNo = 0;
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) {
    const lines = [];
    for (const l of p.lines || []) {
      const ws = (l.words || []).filter(v => {
        const t = v.text.trim();
        if (!t || v.confidence < 30) return false;
        if (/^[|_~=\-—.,:;'"`]+$/.test(t)) return v.confidence > 60;
        return t.length > 2 || v.confidence > 55;
      });
      // specks and ruled lines come back as one or two stray marks: leave them out
      if (!ws.length || (ws.length === 1 && ws[0].confidence < 55 && ws[0].text.length < 3)) continue;
      if (ws.every(v => /^[|_~—=\-\\/.,:;'"`]+$/.test(v.text))) continue;
      const h = ws.map(v => v.bbox.y1 - v.bbox.y0).sort((a, c) => a - c);
      const row = l.rowAttributes && (l.rowAttributes.rowHeight || l.rowAttributes.row_height);
      const size = row > 0 ? row : h[h.length >> 1] * 1.25;
      const line = { x0: ws[0].bbox.x0, y0: l.bbox.y0, x1: ws[ws.length - 1].bbox.x1, y1: l.bbox.y1, size, words: ws.map(v => ({ text: v.text, x0: v.bbox.x0, x1: v.bbox.x1 })) };
      lines.push(line);
      for (const v of ws) words.push({ text: v.text, x0: v.bbox.x0, y0: l.bbox.y0, x1: v.bbox.x1, y1: l.bbox.y1, line: lineNo });
      lineNo++;
    }
    if (lines.length) paras.push(lines);
  }
  return { width, height, paras, words };
}

export const plainText = r => r.paras.map(p => p.map(l => l.words.map(w => w.text).join(' ')).join('\n')).join('\n\n');
