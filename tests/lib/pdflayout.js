/* Reads back where the app actually put things on the page.

   tests/lib/pdf.js answers "is this wording in the document". It cannot
   answer "can anyone read it" — a line can run off the right of the paper,
   or have a filled rectangle painted over it afterwards, and still be in the
   text. Both have happened. This parses the content stream in paint order,
   measures every drawn string with the app's own font-width tables, and
   reports the three ways wording goes missing without disappearing. */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function widthTable(name) {
  const m = new RegExp('var ' + name + '\\s*=\\s*\\[([^\\]]*)\\]').exec(SRC);
  if (!m) throw new Error('width table ' + name + ' not found in index.html');
  return JSON.parse('[' + m[1] + ']');
}
const HW = widthTable('HW'), HBW = widthTable('HBW');

function textWidth(s, size, bold) {
  const t = bold ? HBW : HW;
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i) - 32;
    w += (c >= 0 && c < t.length ? t[c] : 500);
  }
  return w * size / 1000;
}

/* The app folds em dashes, curly quotes and bullets down to ASCII before
   writing them, so anything compared against the PDF has to be folded too or
   a perfectly intact sentence reads as cut off at the first dash. */
const SUBS = { '—': '-', '–': '-', '‘': "'", '’': "'",
               '“': '"', '”': '"', ' ': ' ', '•': '-',
               '·': '-', '…': '...' };
function asDrawn(s) {
  return String(s == null ? '' : s)
    .replace(/[—–‘’“” •·…]/g, c => SUBS[c])
    .replace(/\s+/g, ' ');
}

const TEXT_OP = /BT\s+[\d.]+\s+[\d.]+\s+[\d.]+\s+rg\s+\/(F[12])\s+([\d.]+)\s+Tf\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Td\s+\(((?:\\.|[^\\()])*)\)\s*Tj\s+ET/;
const RECT_OP = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+re\s+f/;
const BOTH = new RegExp(TEXT_OP.source + '|' + RECT_OP.source, 'g');

/* The ops of one content stream, in the order they were painted. */
function opsIn(raw, page) {
  const out = [];
  let m;
  BOTH.lastIndex = 0;
  while ((m = BOTH.exec(raw))) {
    if (m[1]) {
      const s = m[5].replace(/\\([\\()])/g, '$1');
      const bold = m[1] === 'F2', size = +m[2];
      out.push({ kind: 'text', page, s, size, bold, x: +m[3], y: +m[4], w: textWidth(s, size, bold) });
    } else {
      out.push({ kind: 'rect', page, x: +m[9], y: +m[10], w: +m[11], h: +m[12] });
    }
  }
  return out;
}

/* One array of ops per page.

   Page matters: every page starts its coordinates again from the bottom left,
   so comparing a line on page two against a block on page three says they
   overlap when they are nowhere near each other. The app writes its content
   streams uncompressed, so each page's drawing is simply the text between a
   stream and its endstream. */
function pages(buf) {
  const raw = buf.toString('latin1');
  const out = [];
  let at = 0, n = 0;
  for (;;) {
    const s = raw.indexOf('stream\n', at);
    if (s < 0) break;
    const e = raw.indexOf('endstream', s);
    if (e < 0) break;
    const body = raw.slice(s + 7, e);
    at = e + 9;
    /* image XObjects are streams too, and have no drawing operators in them */
    if (body.indexOf(' Tj ') < 0 && body.indexOf(' re f') < 0) continue;
    out.push(opsIn(body, ++n));
  }
  return out;
}

/* Every string and every filled rectangle in the document. */
function ops(buf) {
  return [].concat.apply([], pages(buf));
}

/* Strings whose right-hand end is past the printable width. */
function overflowing(buf, rightMargin = 555.28) {
  return ops(buf).filter(o => o.kind === 'text' && o.s.trim() && o.x + o.w > rightMargin + 0.5);
}

/* Strings a filled rectangle was painted over afterwards, on the same page —
   present in the file, invisible on the page. A little slack at the baseline,
   since a fill that only touches a descender still reads fine. */
function buried(buf) {
  const out = [];
  pages(buf).forEach(all => {
    for (let i = 0; i < all.length; i++) {
      const t = all[i];
      if (t.kind !== 'text' || !t.s.trim()) continue;
      for (let j = i + 1; j < all.length; j++) {
        const r = all[j];
        if (r.kind !== 'rect') continue;
        const topOfText = t.y + t.size * 0.72, botOfText = t.y - t.size * 0.1;
        const overlapsY = r.y < topOfText - 1 && r.y + r.h > botOfText + 1;
        const overlapsX = r.x < t.x + t.w - 1 && r.x + r.w > t.x + 1;
        if (overlapsY && overlapsX) { out.push(t); break; }
      }
    }
  });
  return out;
}

/* Of `wanted`, how much made it in — joining the drawn strings back up, since
   a wrapped sentence arrives as several of them. */
function howMuchGotThrough(buf, wanted) {
  const flat = ops(buf).filter(o => o.kind === 'text').map(o => o.s).join(' ').replace(/\s+/g, ' ');
  const want = asDrawn(wanted);
  if (flat.indexOf(want) >= 0) return { whole: true, got: want.length, of: want.length };
  let got = 0;
  for (let n = want.length; n > 0; n--) { if (flat.indexOf(want.slice(0, n)) >= 0) { got = n; break; } }
  return { whole: false, got, of: want.length, from: want.slice(Math.max(0, got - 12), got + 30) };
}

module.exports = { ops, pages, overflowing, buried, howMuchGotThrough, asDrawn, textWidth };
