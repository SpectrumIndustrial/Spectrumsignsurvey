/* A part pinned to a photo could only have its quantity changed, be removed,
   or be joined by another — getting the size wrong meant deleting it and
   starting again. It can now be edited where it sits, and swapped for a
   different product without losing its place or its quantity.             */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { OUT, EXECUTABLE } = require('./lib/paths');
const { serve } = require('./lib/serve');
const { photo } = require('./lib/photos');
const { strings } = require('./lib/xlsx');
const pdf = require('./lib/pdf');

const PORT = +(process.env.PORT || 8933);
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
  await page.fill('#f-site', 'Brantham Mill');
  await page.fill('#f-by', 'S. Yorke');
  await page.click('#saveSetup');
  await page.waitForTimeout(400);
  await page.click('#addArea');
  await page.waitForSelector('[data-preset]');
  await page.locator('.preset', { hasText: /^Workshop/ }).click();
  await page.waitForTimeout(500);

  await page.click('.nav button[data-tab="photos"]');
  await page.waitForTimeout(400);
  const jpg = await photo('landscape');
  await page.setInputFiles('#fileIn', { name: 'a.jpg', mimeType: 'image/jpeg', buffer: jpg });
  await page.waitForTimeout(900);
  await page.locator('.photocard input').first().fill('Panel by the roller door');
  await page.waitForTimeout(350);

  /* a catalogue part */
  await page.locator('[data-findpart]').first().click();
  await page.waitForTimeout(800);
  await page.fill('#q', 'fire exit');
  await page.waitForTimeout(700);
  await page.locator('#results .prow').first().click();
  await page.waitForTimeout(900);

  console.log('--- the part row opens an editor ---');
  ck(await page.locator('.pc-part-bits[data-partedit]').count() === 1,
     'the part details are a button, not just text');
  const before = (await page.locator('.pc-part-bits').first().textContent()).trim();
  const pn = (/\d{3,}/.exec(before) || [''])[0];
  ck(pn.length >= 3, `a catalogue part is attached (${pn})`);

  await page.locator('.pc-part-bits').first().click();
  await page.waitForTimeout(600);
  ck(await page.locator('#ep-name').count() === 1, 'tapping it opens the editor');
  const lede = await page.textContent('.sheet-lede');
  ck(lede.indexOf(pn) >= 0 && /part number stays/i.test(lede),
     'which names the part number and says it stays with it');
  ck(await page.locator('#swapPart').count() === 1, 'with a way to swap the product outright');
  const startName = await page.inputValue('#ep-name');
  const startSize = await page.inputValue('#ep-size');
  ck(startName.length > 0 && startSize.length > 0,
     `prefilled from the catalogue — "${startName}", ${startSize}`);
  ck(await page.inputValue('#ep-qty') === '1', 'and carries the quantity');

  console.log('\n--- editing it ---');
  await page.fill('#ep-size', '600 x 400mm');
  await page.fill('#ep-mat', 'Rigid PVC');
  await page.fill('#ep-qty', '4');
  await page.click('#savePart');
  await page.waitForTimeout(800);
  let row = (await page.locator('.pc-part-bits').first().textContent()).replace(/\s+/g, ' ').trim();
  ck(/600 x 400mm/.test(row), `the new size is on the card — "${row}"`);
  ck(/Rigid PVC/.test(row), 'and the new material');
  ck(/Edited/.test(row), 'a changed catalogue part is flagged as edited');
  ck(row.indexOf(pn) >= 0, 'while keeping its part number');
  ck(await page.locator('.pc-part .stepper input').first().inputValue() === '4',
     'the quantity typed into the editor took');

  /* undo */
  await page.locator('#toastAct button').click();
  await page.waitForTimeout(700);
  row = (await page.locator('.pc-part-bits').first().textContent()).replace(/\s+/g, ' ').trim();
  ck(!/Edited/.test(row), 'undo takes the edit back off');
  ck(row.indexOf(startSize) >= 0, `and restores the catalogue size (${startSize})`);
  ck(await page.locator('.pc-part .stepper input').first().inputValue() === '1',
     'along with the quantity');

  /* redo the edit and keep it, for the exports */
  await page.locator('.pc-part-bits').first().click();
  await page.waitForTimeout(600);
  await page.fill('#ep-name', 'Fire exit, left arrow, extra large');
  await page.fill('#ep-size', '600 x 400mm');
  await page.fill('#ep-qty', '3');
  await page.click('#savePart');
  await page.waitForTimeout(800);
  ck(/Fire exit, left arrow, extra large/.test(await page.textContent('#s-photos')),
     'the reworded description shows on the photo card');

  console.log('\n--- a custom item is editable in the same place ---');
  await page.locator('[data-findpart]').first().click();
  await page.waitForTimeout(800);
  await page.click('#refCustom #addCustom');
  await page.waitForTimeout(600);
  await page.fill('#c-name', 'Bespoke bracket');
  await page.fill('#c-size', '200mm');
  await page.click('#saveCustom');
  await page.waitForTimeout(900);
  ck(await page.locator('.pc-part-bits').count() === 2, 'the photo now carries two parts');
  await page.locator('.pc-part-bits').nth(1).click();
  await page.waitForTimeout(600);
  ck(/custom item/i.test(await page.textContent('.sheet-lede')), 'the editor knows it is a custom item');
  ck(await page.inputValue('#ep-name') === 'Bespoke bracket', 'prefilled with what was typed');
  await page.fill('#ep-name', 'Bespoke bracket, galvanised');
  await page.fill('#ep-mat', 'Mild steel');
  await page.click('#savePart');
  await page.waitForTimeout(800);
  const custRow = (await page.locator('.pc-part-bits').nth(1).textContent()).replace(/\s+/g, ' ');
  ck(/Bespoke bracket, galvanised/.test(custRow), `the custom item is edited in place — "${custRow}"`);
  ck(/Mild steel/.test(custRow), 'material and all');
  ck(!/Edited/.test(custRow), 'a custom item is never flagged as edited — there is nothing to differ from');

  console.log('\n--- swapping one product for another ---');
  await page.locator('.pc-part-bits').first().click();
  await page.waitForTimeout(600);
  await page.click('#swapPart');
  await page.waitForTimeout(900);
  ck(/Replacing the part on/.test(await page.textContent('#refNote')),
     'the catalogue says it is replacing, not adding');
  await page.fill('#q', 'no smoking');
  await page.waitForTimeout(700);
  const picked = (await page.locator('#results .prow').first().textContent()).replace(/\s+/g, ' ');
  await page.locator('#results .prow').first().click();
  await page.waitForTimeout(1000);
  ck(await page.locator('.pc-part-bits').count() === 2,
     'the photo still has two parts — it replaced one rather than adding a third');
  const swapped = (await page.locator('.pc-part-bits').first().textContent()).replace(/\s+/g, ' ');
  ck(!/Fire exit, left arrow/.test(swapped), `the old product is gone — now "${swapped}"`);
  ck(!/Edited/.test(swapped), 'and the new one starts clean, not flagged');
  ck(await page.locator('.pc-part .stepper input').first().inputValue() === '3',
     'the quantity carried over to the product that took its place');
  ck(/Swapped for/.test(await page.textContent('#toastMsg')), 'with a toast that says so');
  await page.locator('#toastAct button').click();
  await page.waitForTimeout(800);
  ck(/Fire exit, left arrow/.test(await page.textContent('#s-photos')),
     'undo puts the first product back');
  ck(await page.locator('.pc-part-bits').count() === 2, 'still two parts, not three');

  console.log('\n--- cancelling a swap adds nothing ---');
  await page.locator('.pc-part-bits').first().click();
  await page.waitForTimeout(600);
  await page.click('#swapPart');
  await page.waitForTimeout(900);
  await page.click('#clearRef');
  await page.waitForTimeout(500);
  await page.fill('#q', 'no smoking');
  await page.waitForTimeout(700);
  await page.locator('#results .prow').first().click();
  await page.waitForTimeout(900);
  await page.click('.nav button[data-tab="photos"]');
  await page.waitForTimeout(600);
  ck(await page.locator('.pc-part-bits').count() === 2,
     'cancelling drops the photo too, so the product goes to the area list instead');

  console.log('\n--- what the office receives ---');
  await page.click('.nav button[data-tab="report"]');
  await page.waitForTimeout(600);
  await page.click('#expXlsx');
  await page.waitForSelector('#fSave', { timeout: 40000 });
  await page.evaluate(() => document.getElementById('fSave').click());
  await page.waitForTimeout(1600);
  const xbuf = Buffer.from(await page.evaluate(() => window.__grabbed));
  fs.writeFileSync(path.join(OUT, 'edit-parts.xlsx'), xbuf);
  const sheet = strings(xbuf).join('\n');
  ck(/Fire exit, left arrow, extra large/.test(sheet), 'the reworded part is on the order list');
  ck(new RegExp(pn + ' \\(edited\\)').test(sheet),
     `its part number is marked as edited (${pn} (edited))`);
  ck(/check against the part number/.test(sheet),
     'with a note telling the office to check it rather than quote the catalogue');
  ck(/Bespoke bracket, galvanised/.test(sheet), 'and the edited custom item is there too');
  ck(/Mild steel/.test(sheet), 'with the material that was typed into the editor');

  await page.evaluate(() => { document.getElementById('overlay').classList.remove('on'); window.__grabbed = null; });
  await page.click('.nav button[data-tab="report"]');
  await page.waitForTimeout(400);
  await page.click('#expPdf');
  await page.waitForSelector('#fSave', { timeout: 40000 });
  await page.evaluate(() => document.getElementById('fSave').click());
  await page.waitForTimeout(1600);
  const pbuf = Buffer.from(await page.evaluate(() => window.__grabbed));
  fs.writeFileSync(path.join(OUT, 'edit-parts.pdf'), pbuf);
  const joined = pdf.text(pbuf).join('\n');
  ck(pdf.structure(pbuf).isPdf, 'the PDF builds');
  ck(new RegExp(pn + ' \\(edited\\)').test(joined), 'and names the edited part the same way');

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no console errors');
  await browser.close();
  server.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
