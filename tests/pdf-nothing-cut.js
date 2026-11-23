/* The report is the thing the customer is handed, and wording was going
   missing from it in three different ways: cut off at a fixed line count,
   run off the right of the paper, or painted over by the grey summary band.
   None of it showed up as an error anywhere.

   This fills every field a surveyor can type into with something as long as
   a real one gets, then reads the finished PDF back and checks each piece of
   wording arrived whole, inside the margins, and still visible.            */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { OUT, EXECUTABLE } = require('./lib/paths');
const { serve } = require('./lib/serve');
const { photo } = require('./lib/photos');
const lay = require('./lib/pdflayout');
const pdf = require('./lib/pdf');

const PORT = +(process.env.PORT || 8945);
let pass = 0, fail = 0;
const ck = (ok, msg) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); };

/* Long, but nothing a surveyor would not type. */
const LONG = {
  site: 'Centurion Europe Distribution Centre, Brantham Mill Industrial Estate, Unit 14b, Manningtree',
  by: 'Stephen Yorke-Harrington',
  addr: 'Brantham, Manningtree, Essex',
  contact: 'Evita Grant-Fairweather',
  contactInfo: 'evita.grant-fairweather@centurioneurope.example.co.uk',
  reseller: 'Arco Professional Safety Services',
  resContact: 'Robert Chapman-Williams',
  resInfo: '07860 909274 / rob.chapman@arco.example.com',
  area: 'Mezzanine packing line, dispatch marshalling bay and the covered loading apron behind the goods-in office',
  areaNote: 'The whole of the mezzanine run was resurfaced in August and the previous floor graphics came up with the old coating, so everything from the stair head to the dispatch shutter needs replacing rather than patching.',
  photoNote: 'Faded fire exit panel above the roller shutter, barely legible from the far side of the bay — the customer wants it replaced with a photoluminescent one and a projecting version adding at the corner.',
  custom: 'Bespoke pit-lane warning panel, reflective, with the customer logo to the top left and the unit number beneath it in 95mm characters',
  surveyNote: 'Access to the high-level runs needs a scissor lift booking, which the site manager will arrange for the week commencing the twelfth; everything at ground level can be fitted on the same visit.'
};

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
  await page.waitForTimeout(1000);
  await page.fill('#f-site', LONG.site);
  await page.fill('#f-by', LONG.by);
  await page.fill('#f-pc', 'CO11 1NJ');
  await page.fill('#f-addr', LONG.addr);
  await page.click('.moreblock summary');
  await page.waitForTimeout(200);
  await page.fill('#f-contact', LONG.contact);
  await page.fill('#f-contactInfo', LONG.contactInfo);
  await page.fill('#f-reseller', LONG.reseller);
  await page.fill('#f-resContact', LONG.resContact);
  await page.fill('#f-resInfo', LONG.resInfo);
  await page.click('#saveSetup');
  await page.waitForTimeout(500);

  await page.click('#addArea');
  await page.waitForSelector('[data-preset]');
  await page.locator('.preset', { hasText: /^Workshop/ }).click();
  await page.waitForTimeout(600);

  /* a long area name */
  await page.click('#renameArea');
  await page.waitForTimeout(500);
  await page.locator('#sheet input').first().fill(LONG.area);
  await page.locator('#sheet button').filter({ hasText: /Save|Rename/ }).first().click();
  await page.waitForTimeout(600);
  await page.evaluate(() => document.getElementById('overlay').classList.remove('on'));

  /* a long area note */
  await page.locator('[data-editnote]').first().click();
  await page.waitForTimeout(500);
  await page.fill('#nt', LONG.areaNote);
  await page.locator('#sheet button').filter({ hasText: /Save/ }).first().click();
  await page.waitForTimeout(600);

  await page.locator('.item').first().locator('[data-v="Missing"]').click();
  await page.waitForTimeout(400);

  /* a photo with a long description and a long custom part */
  await page.click('.nav button[data-tab="photos"]');
  await page.waitForTimeout(400);
  const jpg = await photo('landscape');
  await page.setInputFiles('#fileIn', { name: 'a.jpg', mimeType: 'image/jpeg', buffer: jpg });
  await page.waitForTimeout(900);
  await page.locator('.photocard input').first().fill(LONG.photoNote);
  await page.waitForTimeout(400);
  await page.locator('[data-findpart]').first().click();
  await page.waitForTimeout(800);
  await page.click('#refCustom #addCustom');
  await page.waitForTimeout(600);
  await page.fill('#c-name', LONG.custom);
  await page.fill('#c-size', '750 x 500mm');
  await page.fill('#c-mat', 'Aluminium composite');
  await page.click('#saveCustom');
  await page.waitForTimeout(900);

  /* a long general note */
  await page.click('.nav button[data-tab="report"]');
  await page.waitForTimeout(600);
  await page.locator('[data-editnote="survey"]').click();
  await page.waitForTimeout(500);
  await page.fill('#nt', LONG.surveyNote);
  await page.locator('#sheet button').filter({ hasText: /Save/ }).first().click();
  await page.waitForTimeout(700);

  await page.click('.nav button[data-tab="report"]');
  await page.waitForTimeout(400);
  await page.click('#expPdf');
  await page.waitForSelector('#fSave', { timeout: 40000 });
  await page.evaluate(() => document.getElementById('fSave').click());
  await page.waitForTimeout(2000);
  const buf = Buffer.from(await page.evaluate(() => window.__grabbed));
  fs.writeFileSync(path.join(OUT, 'nothing-cut.pdf'), buf);
  const st = pdf.structure(buf);
  console.log(`  (${st.pages} pages, ${(st.bytes / 1024).toFixed(0)} KB)`);

  console.log('\n--- every piece of wording arrives whole ---');
  for (const [field, value] of Object.entries(LONG)) {
    const r = lay.howMuchGotThrough(buf, value);
    ck(r.whole, `${field} — ${r.got}/${r.of} characters`
       + (r.whole ? '' : `, cut after "…${r.from}"`));
  }

  console.log('\n--- and is actually readable on the page ---');
  const over = lay.overflowing(buf);
  ck(over.length === 0, 'nothing runs past the right-hand margin'
     + (over.length ? ':\n' + over.map(o =>
         `       +${(o.x + o.w - 555.28).toFixed(0)}pt  ${JSON.stringify(o.s.slice(0, 70))}`).join('\n') : ''));

  const hidden = lay.buried(buf);
  ck(hidden.length === 0, 'nothing is painted over by a filled block'
     + (hidden.length ? ':\n' + hidden.map(o =>
         `       ${JSON.stringify(o.s.slice(0, 70))}`).join('\n') : ''));

  /* Two strings on top of each other are as unreadable as one under a block,
     and nothing was watching for it. */
  let collisions = 0, firstPair = '';
  lay.pages(buf).forEach(page => {
    const t = page.filter(o => o.kind === 'text' && o.s.trim());
    for (let i = 0; i < t.length; i++) {
      for (let j = i + 1; j < t.length; j++) {
        const a = t[i], b = t[j];
        if (!(a.y - a.size * 0.1 < b.y + b.size * 0.72 - 1.5
              && a.y + a.size * 0.72 > b.y - b.size * 0.1 + 1.5)) continue;
        if (!(a.x < b.x + b.w - 1.5 && a.x + a.w > b.x + 1.5)) continue;
        collisions++;
        if (!firstPair) firstPair = JSON.stringify(a.s.slice(0, 40)) + ' over ' + JSON.stringify(b.s.slice(0, 40));
      }
    }
  });
  ck(collisions === 0, 'no two lines are printed on top of each other'
     + (collisions ? ` — ${collisions}, e.g. ${firstPair}` : ''));

  const all = lay.ops(buf).filter(o => o.kind === 'text' && o.s.trim());
  const low = all.filter(o => o.y < 40 && !/Spectrum Industrial|Page \d+ of \d+/.test(o.s));
  ck(low.length === 0, 'nothing but the footer sits below the bottom margin'
     + (low.length ? ` — ${low.length} line(s)` : ''));
  ck(all.every(o => o.x >= 39), 'nothing starts left of the margin either');

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no console errors');
  await browser.close();
  server.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
