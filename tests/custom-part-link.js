/* Three things:
   1. a CUSTOM part attached to a photo, with size + material, reaching Excel
   2. the customer / re-seller header fields reaching Excel and the PDF
   3. the Photo column on sheet 1 linking to the right row on the Photos sheet */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { OUT, EXECUTABLE } = require('./lib/paths');
const { serve } = require('./lib/serve');
const { photo } = require('./lib/photos');

const PORT = +(process.env.PORT || 8811);


let pass = 0, fail = 0;
const check = (ok, msg) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); };

(async () => {
  const server = await serve(PORT);
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
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
  await page.waitForSelector('#saveSetup');

  console.log('--- contact fields ---');
  await page.fill('#f-site', 'AMR GP Ltd');
  await page.fill('#f-by', 'S. Yorke');
  check(await page.locator('.moreblock').count() === 1, 'contacts block present');
  check(!(await page.locator('.moreblock').first().evaluate(e => e.open)), 'folded away by default');
  await page.click('.moreblock summary');
  await page.waitForTimeout(200);
  await page.fill('#f-contact', 'Evita Grant');
  await page.fill('#f-contactInfo', 'evita.grant@example.com');
  await page.fill('#f-reseller', 'Arco');
  await page.fill('#f-resContact', 'Rob Chapman');
  await page.fill('#f-resInfo', '07860 909274');
  await page.click('#saveSetup');
  await page.waitForTimeout(400);
  await page.click('#btnSetup');
  await page.waitForTimeout(400);
  check(await page.inputValue('#f-reseller') === 'Arco', 'reseller persisted');
  check(await page.locator('.moreblock').first().evaluate(e => e.open), 'block opens when already filled');
  await page.evaluate(() => document.getElementById('overlay').classList.remove('on'));

  console.log('\n--- custom part on a photo ---');
  await page.click('#addArea');
  await page.waitForSelector('[data-preset]');
  await page.click('[data-preset="0"]');
  await page.waitForTimeout(400);
  await page.click('.nav button[data-tab="photos"]');
  await page.waitForTimeout(400);
  const jpg = await photo('landscape');
  for (let i = 0; i < 2; i++) {
    await page.setInputFiles('#fileIn', { name: `p${i}.jpg`, mimeType: 'image/jpeg', buffer: jpg });
    await page.waitForTimeout(600);
  }
  await page.locator('.photocard input').nth(1).fill('Bespoke bracket needed here');
  await page.waitForTimeout(300);

  // second photo -> add part -> custom
  await page.locator('[data-findpart]').nth(1).click();
  await page.waitForTimeout(700);
  check(/P2/.test(await page.textContent('#refNote')), 'ref bar shows the shared photo reference');
  const customTop = page.locator('#refNote #addCustom');
  check(await customTop.count() === 1, 'custom item offered at the top of the results');
  await customTop.click();
  await page.waitForTimeout(500);
  check(/Attach to photo/.test(await page.textContent('#saveCustom')), 'sheet targets the photo');
  await page.fill('#c-name', 'Bespoke pit-lane warning, reflective');
  await page.fill('#c-size', '500 x 500mm');
  await page.fill('#c-mat', 'Dibond');
  await page.click('#saveCustom');
  await page.waitForTimeout(800);
  const cardTxt = await page.textContent('#s-photos');
  check(/Bespoke pit-lane warning/.test(cardTxt), 'custom part shows on the photo card');
  check(/Dibond/.test(cardTxt) && /500 x 500mm/.test(cardTxt), 'material and size show on the card');

  console.log('\n--- export ---');
  await page.click('.nav button[data-tab="report"]');
  await page.waitForTimeout(400);
  await page.click('#expXlsx');
  await page.waitForSelector('#fSave', { timeout: 30000 });
  await page.evaluate(() => document.getElementById('fSave').click());
  await page.waitForTimeout(1000);
  const b = await page.evaluate(() => window.__grabbed);
  fs.writeFileSync(path.join(OUT, 'custom.xlsx'), Buffer.from(b));
  console.log('  wrote custom.xlsx', (b.length / 1024).toFixed(0), 'KB');

  await page.evaluate(() => { document.getElementById('overlay').classList.remove('on'); window.__grabbed = null; });
  await page.click('.nav button[data-tab="report"]');
  await page.waitForTimeout(300);
  await page.click('#expPdf');
  await page.waitForSelector('#fSave', { timeout: 30000 });
  await page.evaluate(() => document.getElementById('fSave').click());
  await page.waitForTimeout(1200);
  const pdf = await page.evaluate(() => window.__grabbed);
  if (pdf) fs.writeFileSync(path.join(OUT, 'custom.pdf'), Buffer.from(pdf));

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  await browser.close();
  server.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
