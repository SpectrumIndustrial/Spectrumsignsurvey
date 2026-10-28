/* What happens when the text isn't tidy.

   Site names, notes and custom part names are free text typed on a phone, and
   they end up in three places with three different sets of rules: HTML on
   screen, XML inside the spreadsheet, and PDF string literals. Each has
   characters that break it if they aren't escaped — & < > " in XML, ( ) and
   backslash in PDF — and a break in any of them is silent: a corrupt workbook
   that Excel refuses, or a PDF that opens blank.

   Until now nothing checked the PDF beyond the app saying it was ready, which
   would also have been true of an empty one. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { OUT, EXECUTABLE } = require('./lib/paths');
const { serve } = require('./lib/serve');
const { photo } = require('./lib/photos');
const { sheetText, entries } = require('./lib/xlsx');
const pdf = require('./lib/pdf');

const PORT = +(process.env.PORT || 8897);
let pass = 0, fail = 0;
const ck = (ok, msg) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); };

/* Each of these has broken a real export somewhere. */
const SITE  = 'Smith & Jones <Holdings> "Ltd"';
const NOTE  = "Panel cracked (lower left) — 50% gone, see O'Brien's note \\ ref #12";
const PART  = 'Custom plate <400 × 150> & bracket';
const AREA  = 'Bay 3 & 4 — "the old paint shop"';

(async () => {
  const server = await serve(PORT);
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });

  await page.addInitScript(() => {
    window.__grabbed = null;
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download && this.href.startsWith('blob:')) {
        window.__grabbed = fetch(this.href).then(r => r.arrayBuffer()).then(b => Array.from(new Uint8Array(b)));
        return;
      }
      return orig.apply(this, arguments);
    };
  });

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(900);
  await page.fill('#f-site', SITE);
  await page.fill('#f-by', "S. O'Yorke & Co");
  await page.click('#saveSetup');
  await page.waitForTimeout(350);

  await page.click('#addArea');
  await page.waitForSelector('[data-preset]');
  await page.locator('.preset', { hasText: /^Workshop/ }).click();
  await page.waitForTimeout(450);

  /* rename the area to something awkward */
  await page.click('#renameArea');
  await page.waitForTimeout(400);
  await page.fill('#an', AREA);
  await page.click('#saveName');
  await page.waitForTimeout(400);
  ck((await page.textContent('#s-survey')).indexOf('Bay 3 & 4') >= 0,
     'the area name survives on screen with & and quotes in it');

  await page.locator('.item').first().locator('.chip.miss').click();
  await page.waitForTimeout(200);

  /* a custom product with awkward text */
  await page.click('.nav button[data-tab="parts"]');
  await page.waitForTimeout(300);
  await page.click('#addCustom');
  await page.waitForTimeout(450);
  await page.fill('#c-name', PART);
  await page.fill('#c-size', '400 × 150mm');
  await page.fill('#c-mat', 'RPVC');
  await page.click('#saveCustom');
  await page.waitForTimeout(500);
  ck((await page.textContent('#s-parts')).indexOf('Custom plate') >= 0, 'the custom product is listed');

  /* a photo with an awkward note */
  const jpg = await photo('landscape');
  await page.click('.nav button[data-tab="photos"]');
  await page.waitForTimeout(250);
  await page.setInputFiles('#fileIn', { name: 'a.jpg', mimeType: 'image/jpeg', buffer: jpg });
  await page.waitForTimeout(700);
  await page.locator('[data-pnote]').first().fill(NOTE);
  await page.waitForTimeout(400);

  ck(errs.length === 0, 'nothing has thrown while typing any of it'
     + (errs.length ? '\n       ' + errs.join('\n       ') : ''));

  console.log('\n--- the spreadsheet ---');
  await page.click('.nav button[data-tab="report"]');
  await page.waitForTimeout(400);
  await page.click('#expXlsx');
  await page.waitForSelector('#fSave', { timeout: 30000 });
  await page.evaluate(() => document.getElementById('fSave').click());
  await page.waitForTimeout(1200);
  const xbytes = await page.evaluate(() => window.__grabbed);
  ck(!!xbytes, 'the workbook builds');
  if (xbytes) {
    const buf = Buffer.from(xbytes);
    fs.writeFileSync(path.join(OUT, 'awkward.xlsx'), buf);
    let parts = null;
    try { parts = entries(buf); } catch (e) { /* reported below */ }
    ck(!!parts, 'the workbook is a readable zip');

    /* The real risk: an unescaped & or < makes the sheet XML malformed, and
       Excel refuses the whole file rather than showing one bad cell. */
    let wellFormed = true, badPart = '';
    for (const name of Object.keys(parts || {})) {
      if (!/\.(xml|rels)$/.test(name)) continue;
      const xml = parts[name].toString('utf8');
      const stripped = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
      /* a bare & that isn't the start of an entity is the classic break */
      if (/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(stripped)) { wellFormed = false; badPart = name; }
    }
    ck(wellFormed, 'no sheet contains an unescaped &' + (wellFormed ? '' : ` — ${badPart}`));

    const all = [].concat(...Object.values(sheetText(buf)));
    ck(all.some(t => t.indexOf('Smith & Jones') >= 0), 'the site name reads back with its & intact');
    ck(all.some(t => t.indexOf('<Holdings>') >= 0), 'and its angle brackets');
    ck(all.some(t => t.indexOf('Bay 3 & 4') >= 0), 'the area name too');
    ck(all.some(t => t.indexOf('Custom plate') >= 0), 'the custom product');
    ck(all.some(t => t.indexOf("O'Brien's") >= 0), 'and the apostrophes in the note');
  }

  console.log('\n--- the PDF ---');
  await page.evaluate(() => { document.getElementById('overlay').classList.remove('on'); window.__grabbed = null; });
  await page.click('.nav button[data-tab="report"]');
  await page.waitForTimeout(400);
  await page.click('#expPdf');
  await page.waitForSelector('#fSave', { timeout: 30000 });
  await page.evaluate(() => document.getElementById('fSave').click());
  await page.waitForTimeout(1500);
  const pbytes = await page.evaluate(() => window.__grabbed);
  ck(!!pbytes, 'the PDF builds');
  if (pbytes) {
    const buf = Buffer.from(pbytes);
    fs.writeFileSync(path.join(OUT, 'awkward.pdf'), buf);
    const s = pdf.structure(buf);
    ck(s.isPdf, `it is a PDF (version ${s.version})`);
    ck(s.hasEof && s.hasXref, 'it is complete — cross-reference table and end marker present');
    ck(s.pages >= 1, `${s.pages} page${s.pages === 1 ? '' : 's'}`);
    ck(s.images >= 1, `the photograph is embedded (${s.images} image${s.images === 1 ? '' : 's'})`);

    const t = pdf.text(buf);
    ck(t.length > 20, `${t.length} pieces of text drawn`);
    const joined = t.join('\n');
    ck(joined.indexOf('Smith & Jones') >= 0, 'the site name is on the page');
    ck(joined.indexOf('Bay 3 & 4') >= 0, 'the area name is on the page');
    /* Unescaped brackets in a PDF string truncate the text or corrupt the
       stream, so this one is checking the escaping actually round-trips. */
    ck(joined.indexOf('(lower left)') >= 0, 'the brackets in the note survived');
    ck(joined.indexOf("O'Brien's") >= 0, 'so did the apostrophes');
    ck(joined.indexOf('\\ ref') >= 0, 'and the backslash');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no console errors');
  await browser.close(); server.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
