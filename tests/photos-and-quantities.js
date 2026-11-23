/* The three things reported from site:
   - a photo's note and the photo itself couldn't be reached again once taken,
     except by starting to take another one
   - quantities could only be nudged with + and -, which is slow at 250
   - a photo could hold one part, and a single shot often shows several   */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { OUT, EXECUTABLE } = require('./lib/paths');
const { serve } = require('./lib/serve');
const { photo } = require('./lib/photos');
const { sheetText } = require('./lib/xlsx');

const PORT = +(process.env.PORT || 8877);
let pass = 0, fail = 0;
const ck = (ok, msg) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); };

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
  await page.fill('#f-site', 'AMR GP Ltd');
  await page.fill('#f-by', 'S. Yorke');
  await page.click('#saveSetup');
  await page.waitForTimeout(300);
  await page.click('#addArea');
  await page.waitForSelector('[data-preset]');
  await page.locator('.preset', { hasText: /^Workshop/ }).click();
  await page.waitForTimeout(400);

  const jpg = await photo('landscape');
  const addPhoto = async () => {
    await page.click('.nav button[data-tab="photos"]');
    await page.waitForTimeout(250);
    await page.setInputFiles('#fileIn', { name: 'p.jpg', mimeType: 'image/jpeg', buffer: jpg });
    await page.waitForTimeout(700);
  };

  console.log('--- a photo can be reached again after it is taken ---');
  await addPhoto();
  await page.locator('[data-pnote]').first().fill('Cracked face, needs replacing');
  await page.waitForTimeout(250);

  await page.click('.nav button[data-tab="survey"]');
  await page.waitForTimeout(300);
  ck(await page.locator('.thumb[data-openphoto]').count() === 1,
     'the area screen shows the photo as something you can tap');
  ck((await page.textContent('#goPhotos')).includes('Photos, notes and parts'),
     'the button no longer only offers to take another');

  await page.locator('.thumb[data-openphoto]').first().click();
  await page.waitForTimeout(600);
  ck(await page.locator('.nav button[data-tab="photos"].on').count() === 1, 'tapping it opens the Photos tab');
  ck(await page.locator('[data-photocard]').count() === 1, 'the photo card is there to edit');

  await page.locator('[data-pnote]').first().fill('Cracked face — replace with photoluminescent');
  await page.waitForTimeout(250);
  await page.click('.nav button[data-tab="survey"]');
  await page.waitForTimeout(300);
  ck((await page.textContent('.thumb[data-openphoto]')).includes('photoluminescent'),
     'the edited note is what shows back on the area');

  console.log('\n--- several parts on one photo ---');
  await page.locator('.thumb[data-openphoto]').first().click();
  await page.waitForTimeout(500);
  const attach = async (term) => {
    await page.locator('[data-findpart]').first().click();
    await page.waitForTimeout(600);
    await page.fill('#q', term);
    await page.waitForTimeout(700);
    await page.locator('.prow').first().click();
    await page.waitForTimeout(700);
  };
  await attach('fire exit');
  ck(await page.locator('.pc-part').count() === 1, 'first part attaches');
  ck((await page.textContent('[data-findpart]')).includes('Add another part'),
     'the button then offers another rather than disappearing');
  await attach('no smoking');
  await attach('first aid');
  ck(await page.locator('.pc-part').count() === 3, 'three parts on one photo');

  const names = await page.locator('.pc-part-name').allTextContents();
  await page.locator('.pc-part-x').nth(1).click();
  await page.waitForTimeout(400);
  ck(await page.locator('.pc-part').count() === 2, 'one part can be removed on its own');
  await page.locator('.toast-act').click();
  await page.waitForTimeout(400);
  const after = await page.locator('.pc-part-name').allTextContents();
  ck(JSON.stringify(after) === JSON.stringify(names), 'undo puts it back in the same place');

  console.log('\n--- typing a quantity ---');
  await page.click('.nav button[data-tab="parts"]');
  await page.waitForTimeout(400);
  await page.fill('#q', 'fire exit');
  await page.waitForTimeout(700);
  await page.locator('.prow').first().click();
  await page.waitForTimeout(500);

  const qty = page.locator('#s-parts [data-qset]').first();
  ck(await qty.count() === 1, 'the quantity is a field, not just a number');
  await qty.fill('250');
  await page.waitForTimeout(300);
  ck(await qty.inputValue() === '250', '250 can be typed straight in');
  await page.click('.nav button[data-tab="survey"]');
  await page.waitForTimeout(300);
  await page.click('.nav button[data-tab="parts"]');
  await page.waitForTimeout(400);
  ck(await page.locator('#s-parts [data-qset]').first().inputValue() === '250', 'and it survives leaving the screen');

  await page.locator('#s-parts [data-qset]').first().fill('12abc');
  await page.waitForTimeout(250);
  ck(await page.locator('#s-parts [data-qset]').first().inputValue() === '12', 'letters are refused');
  await page.locator('#s-parts [data-qset]').first().fill('');
  await page.locator('#s-parts [data-qset]').first().blur();
  await page.waitForTimeout(250);
  ck(await page.locator('#s-parts [data-qset]').first().inputValue() === '1', 'an empty box falls back to 1 on leaving it');

  await page.locator('#s-parts [data-q][data-d="1"]').first().click();
  await page.waitForTimeout(300);
  ck(await page.locator('#s-parts [data-qset]').first().inputValue() === '2', '+ still works alongside it');

  console.log('\n--- the parts reach the spreadsheet ---');
  await page.click('.nav button[data-tab="report"]');
  await page.waitForTimeout(400);
  await page.click('#expXlsx');
  await page.waitForSelector('#fSave', { timeout: 30000 });
  await page.evaluate(() => document.getElementById('fSave').click());
  await page.waitForTimeout(1200);
  const bytes = await page.evaluate(() => window.__grabbed);
  ck(!!bytes, 'the workbook builds');
  if (bytes) {
    const buf = Buffer.from(bytes);
    fs.writeFileSync(path.join(OUT, 'photo-parts.xlsx'), buf);
    const sheets = sheetText(buf);
    const order = sheets['xl/worksheets/sheet1.xml'] || [];
    const photos = sheets['xl/worksheets/sheet2.xml'] || [];
    const wanted = names.map(n => n.trim());

    const onOrder = wanted.filter(n => order.some(t => t.indexOf(n) >= 0));
    ck(onOrder.length === wanted.length,
       `all three parts reach the order list (${onOrder.length}/${wanted.length})`
       + (onOrder.length === wanted.length ? '' : ` — missing ${wanted.filter(n => !onOrder.includes(n)).join(', ')}`));

    /* On the order list they have to be separate rows for the office to act on,
       not three things crammed into one cell. */
    const crammed = order.filter(t => wanted.filter(n => t.indexOf(n) >= 0).length > 1);
    ck(crammed.length === 0, 'each one is its own row to quote, not a single cell');

    const together = photos.filter(t => wanted.filter(n => t.indexOf(n) >= 0).length === 3);
    ck(together.length === 1, 'the photo sheet names all three against that one shot');

    ck(order.indexOf('Cracked face — replace with photoluminescent') >= 0,
       'the edited note is the one that got exported');
    console.log(`       (${(buf.length / 1024).toFixed(0)}KB, ${order.length} cells on the order list)`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no console errors');
  await browser.close(); server.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
