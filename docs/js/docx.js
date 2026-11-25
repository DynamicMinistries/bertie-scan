// Writes a Word document (.docx), which Google Docs also opens. Own code, no libraries.

/* ---------- zip ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; } return t; })();
function crc32(b) { let c = ~0; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return ~c >>> 0; }

export async function zip(files, type) {
  const enc = new TextEncoder(), out = [], central = [];
  let pos = 0;
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
    let body = data, method = 0;
    if (!f.store && typeof CompressionStream !== 'undefined') {
      body = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
      method = 8;
    }
    const head = (sig, central) => {
      const v = new DataView(new ArrayBuffer(central ? 46 : 30)); let o = 0;
      const u16 = x => { v.setUint16(o, x, true); o += 2; }, u32 = x => { v.setUint32(o, x, true); o += 4; };
      u32(sig); if (central) u16(20); u16(20); u16(0x0800); u16(method); u16(time); u16(date); u32(crc); u32(body.length); u32(data.length); u16(name.length); u16(0);
      if (central) { u16(0); u16(0); u16(0); u32(0); u32(pos); }
      return new Uint8Array(v.buffer);
    };
    central.push(head(0x02014b50, true), name);
    const h = head(0x04034b50, false);
    out.push(h, name, body);
    pos += h.length + name.length + body.length;
  }
  const size = central.reduce((s, b) => s + b.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, pos, true);
  return new Blob([...out, ...central, new Uint8Array(e.buffer)], { type });
}

/* ---------- turning recognised words into paragraphs ---------- */
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const TWIP_PAGE = { w: 11906, h: 16838, m: 1134 }; // A4 with 2 cm margins

// page: { width, height, paras: [[ line, ... ]] } where a line is { x0,y0,x1,y1, size, words:[{text,x0,x1}] }
export function layout(page) {
  const lines = page.paras.flat();
  if (!lines.length) return [];
  const textW = TWIP_PAGE.w - 2 * TWIP_PAGE.m;
  const ptPerPx = 595 / page.width;
  const base = median(lines.flatMap(l => l.words.map(() => l.size))) || 20;
  const basePt = Math.max(9, Math.min(14, Math.round(base * ptPerPx * 2) / 2));
  const xs0 = lines.map(l => l.x0).sort((a, b) => a - b), xs1 = lines.map(l => l.x1).sort((a, b) => a - b);
  const left = xs0[Math.floor(xs0.length * 0.05)], right = Math.max(xs1[Math.floor((xs1.length - 1) * 0.95)], left + 10);
  const span = right - left, tw = Math.min(textW / span, 11906 / page.width * 1.02);
  const out = [];
  let lastBottom = null;

  const runsOf = line => {
    // a wide gap between words means separate columns: jump there with a tab
    let buf = '';
    const tabs = [];
    line.words.forEach((w, i) => {
      const prev = line.words[i - 1];
      if (prev && w.x0 - prev.x1 > line.size * 1.9) {
        // the whole bit of text after the gap, up to the next gap
        let e = i;
        while (line.words[e + 1] && line.words[e + 1].x0 - line.words[e].x1 <= line.size * 1.9) e++;
        const end = line.words[e].x1, numeric = e - i < 3 && /^[R$€£(-]?\s?[\d.,\s]+[)%]?$/.test(line.words.slice(i, e + 1).map(v => v.text).join(' '));
        const atEdge = e === line.words.length - 1 && end > right - span * 0.03;
        tabs.push(numeric || atEdge ? { pos: Math.round((end - left) * tw), val: 'right' } : { pos: Math.round((w.x0 - left) * tw), val: 'left' });
        buf += '\t' + w.text;
      } else buf += (buf ? ' ' : '') + w.text;
    });
    return { text: buf, tabs };
  };

  for (const para of page.paras) {
    let cur = null;
    const flush = () => { if (cur) { out.push(cur); cur = null; } };
    para.forEach((l, i) => {
      const ratio = l.size / base;
      const pt = ratio > 1.17 || ratio < 0.8 ? Math.max(7, Math.round(basePt * ratio)) : basePt;
      const { text, tabs } = runsOf(l);
      if (!text.trim()) return;
      const mid = (l.x0 + l.x1) / 2, pageMid = (left + right) / 2;
      const inL = l.x0 - left, inR = right - l.x1;
      let align = 'left';
      if (!tabs.length && inL > span * 0.08 && inR > span * 0.08 && Math.abs(mid - pageMid) < span * 0.03) align = 'center';
      else if (!tabs.length && inR < span * 0.02 && inL > span * 0.4) align = 'right';
      const bullet = /^([•·▪◦*\-–]|\(?\d{1,3}[.)]|\(?[a-z][.)])\s+\S/i.test(text);
      const prev = para[i - 1];
      let join = false;
      if (cur && prev && cur.pt === pt && cur.align === align && !tabs.length && !cur.tabs.length && !bullet) {
        const first = l.words[0], need = first.x1 - first.x0 + l.size * 0.3;
        const paraRight = Math.max(...para.map(q => q.x1));
        // if the next word would have fitted on the line above, the writer broke the line on purpose
        join = align === 'left' && prev.x1 + need > paraRight - l.size * 0.4;
        if (!join && align === 'left' && prev.x1 + need <= paraRight && para.length > 1) { cur.text += '\n' + text; return; }
      }
      if (join) {
        if (/[a-zà-ÿ]-$/i.test(cur.text) && /^[a-zà-ÿ]/.test(text)) cur.text = cur.text.slice(0, -1) + text;
        else cur.text += ' ' + text;
        cur.bottom = l.y1;
        return;
      }
      flush();
      const gap = lastBottom == null ? 0 : Math.max(0, l.y0 - lastBottom);
      const before = gap > base * 0.9 ? Math.min(18, Math.round(gap * ptPerPx * 0.55)) : 0;
      const indent = align === 'left' && inL > span * 0.02 ? Math.round(inL * tw) : 0;
      cur = { text, tabs, pt, align, bullet, before, indent, bold: ratio > 1.17 };
      lastBottom = l.y1;
    });
    flush();
    if (para.length) lastBottom = para[para.length - 1].y1;
  }
  out.basePt = basePt;
  return out;
}

const esc = s => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function paraXml(p, base) {
  let pr = '';
  if (p.tabs.length) {
    const seen = new Set();
    pr += '<w:tabs>' + p.tabs.filter(t => t.pos > 0 && !seen.has(t.pos) && seen.add(t.pos)).map(t => `<w:tab w:val="${t.val}" w:pos="${t.pos}"/>`).join('') + '</w:tabs>';
  }
  pr += `<w:spacing w:before="${p.before * 20}" w:after="${p.tabs.length ? 40 : 60}"/>`;
  if (p.indent) pr += `<w:ind w:left="${p.indent}"/>`;
  if (p.align !== 'left') pr += `<w:jc w:val="${p.align}"/>`;
  const rp = (p.bold ? '<w:b/>' : '') + (p.pt !== base ? `<w:sz w:val="${p.pt * 2}"/><w:szCs w:val="${p.pt * 2}"/>` : '');
  const run = p.text.split(/([\t\n])/).map(t => t === '\t' ? '<w:tab/>' : t === '\n' ? '<w:br/>' : t ? `<w:t xml:space="preserve">${esc(t)}</w:t>` : '').join('');
  return `<w:p><w:pPr>${pr}</w:pPr><w:r>${rp ? `<w:rPr>${rp}</w:rPr>` : ''}${run}</w:r></w:p>`;
}

function imageXml(id, rid, w, h, title) {
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${w}" cy="${h}"/><wp:docPr id="${id}" name="${esc(title)}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${esc(title)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

// pages: [{ width, height, paras?, image?: Uint8Array jpeg }]   mode: 'text' | 'image'
export async function buildDocx(pages, { title = 'Scan', mode = 'text', lang = 'en-ZA' } = {}) {
  const media = [], rels = [];
  let body = '', basePt = 11;
  const margin = mode === 'image' ? 567 : TWIP_PAGE.m;
  const brk = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  if (mode === 'text') {
    const laid = pages.map(layout);
    basePt = median(laid.filter(l => l.length).map(l => l.basePt)) || 11;
    laid.forEach((ps, i) => {
      let xml = ps.map(p => paraXml(p, basePt)).join('');
      if (!xml) xml = '<w:p><w:r><w:rPr><w:i/><w:color w:val="808080"/></w:rPr><w:t>(No writing was found on this page.)</w:t></w:r></w:p>';
      if (i) xml = xml.replace('<w:pPr>', '<w:pPr><w:pageBreakBefore/>');
      if (i && !xml.includes('pageBreakBefore')) xml = brk + xml;
      body += xml;
    });
  } else {
    pages.forEach((p, i) => {
      const rid = `rIdImg${i + 1}`;
      media.push({ name: `word/media/page${i + 1}.jpg`, data: p.image, store: true });
      rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/page${i + 1}.jpg"/>`);
      const maxW = (TWIP_PAGE.w - 2 * margin) * 635, maxH = (TWIP_PAGE.h - 2 * margin - 320) * 635;
      const k = Math.min(maxW / p.width, maxH / p.height);
      body += `<w:p><w:pPr>${i ? '<w:pageBreakBefore/>' : ''}<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>${imageXml(i + 1, rid, Math.round(p.width * k), Math.round(p.height * k), `Page ${i + 1}`)}</w:p>`;
    });
  }
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const now = new Date().toISOString().replace(/\.\d+Z/, 'Z');
  return zip([
    { name: '[Content_Types].xml', data: `${X}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: 'docProps/core.xml', data: `${X}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>Bertie Scan</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>` },
    { name: 'word/_rels/document.xml.rels', data: `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${rels.join('')}</Relationships>` },
    { name: 'word/styles.xml', data: `${X}<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="${basePt * 2}"/><w:szCs w:val="${basePt * 2}"/><w:lang w:val="${lang}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>` },
    { name: 'word/document.xml', data: `${X}<w:document ${NS}><w:body>${body}<w:sectPr><w:pgSz w:w="${TWIP_PAGE.w}" w:h="${TWIP_PAGE.h}"/><w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="400" w:footer="400" w:gutter="0"/></w:sectPr></w:body></w:document>` },
    ...media,
  ], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}
