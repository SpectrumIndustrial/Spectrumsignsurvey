/* Enough of a PDF reader to check what the customer will actually receive.

   The app writes its own PDF with uncompressed content streams, so the text is
   sitting there in `(...) Tj` operators and can be read back without a library.
   Until now the only thing asserted about the PDF was that the app said it was
   ready — which would still have been true of an empty one. */

function structure(buf) {
  const head = buf.slice(0, 8).toString('latin1');
  const tail = buf.slice(-2048).toString('latin1');
  return {
    isPdf: head.startsWith('%PDF-'),
    version: head.slice(5, 8).trim(),
    hasEof: /%%EOF\s*$/.test(tail),
    hasXref: tail.indexOf('startxref') >= 0,
    pages: (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length,
    images: (buf.toString('latin1').match(/\/DCTDecode/g) || []).length,
    bytes: buf.length
  };
}

/* Every string drawn on the page, with the PDF's own escaping undone. */
function text(buf) {
  const raw = buf.toString('latin1');
  const out = [];
  for (const m of raw.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)) {
    out.push(m[1].replace(/\\([\\()])/g, '$1'));
  }
  return out;
}

module.exports = { structure, text };
