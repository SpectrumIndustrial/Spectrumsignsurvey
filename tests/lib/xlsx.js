/* Just enough of a zip reader to look inside a workbook the app produced.

   The app writes its own xlsx, so a test that only checks "a file came out"
   checks nothing. This pulls the shared-string table — every piece of text in
   the workbook — so a test can assert what the office will actually see. */
const zlib = require('zlib');

function entries(buf) {
  /* Walk the central directory from the end-of-central-directory record. */
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip: no end-of-central-directory record');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('central directory entry ' + n + ' is malformed');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');

    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.slice(start, start + compSize);
    out[name] = method === 0 ? raw : zlib.inflateRawSync(raw);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/* Every piece of text the workbook displays, sheet by sheet.

   The app writes inline strings rather than a shared-string table, so the text
   lives in the sheets themselves. Returned as one array per sheet so a test can
   tell "three rows on the order sheet" from "one cell on the photo sheet". */
function sheetText(buf) {
  const files = entries(buf);
  const out = {};
  Object.keys(files)
    .filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort()
    .forEach(n => {
      out[n] = [...files[n].toString('utf8').matchAll(/<is><t[^>]*>([\s\S]*?)<\/t><\/is>/g)]
        .map(m => m[1]
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'));
    });
  return out;
}

/* Everything, flattened, when the sheet it came from doesn't matter. */
function strings(buf) {
  const per = sheetText(buf);
  return Object.keys(per).reduce((all, k) => all.concat(per[k]), []);
}

module.exports = { entries, strings, sheetText };
