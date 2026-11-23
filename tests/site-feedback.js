/* Three things reported from site:
   - a part pinned to a photo was always a quantity of one, with no way to
     say five
   - going off to find a part and coming back dropped you at the top of the
     photo list, so you scrolled down to find your place again every time
   - the custom-item button sat directly above the search box and kept
     getting tapped by mistake when reaching for search              */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { OUT, EXECUTABLE } = require('./lib/paths');
const { serve } = require('./lib/serve');
const { photo } = require('./lib/photos');
const { sheetText } = require('./lib/xlsx');
const pdf = require('./lib/pdf');

const PORT = +(process.env.PORT || 8903);
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
  await page.waitForTimeout(350);
  await page.click('#addArea');
  await page.waitForSelector('[data-preset]');
  await page.locator('.preset', { hasText: /^Workshop/ }).click();
  await page.waitForTimeout(450);

  /* enough photos that the list scrolls properly */
  const jpg = await photo('landscape');
  await page.click('.nav button[data-tab="photos"]');
  await page.waitForTimeout(250);
  for (let i = 0; i < 6; i++) {
    await page.setInputFiles('#fileIn', { name: `p${i}.jpg`, mimeType: 'image/jpeg', buffer: jpg });
    await page.waitForTimeout(650);
  }
  ck(await page.locator('[data-photocard]').count() === 6, 'six photos to work with');

  console.log('\n--- coming back lands where you left ---');
  const cards = page.locator('[data-photocard]');
  await cards.nth(4).scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const leftAt = await page.evaluate(() => document.getElementById('scroller').scrollTop);
  ck(leftAt > 300, `scrolled down to the fifth photo (${Math.round(leftAt)}px)`);

  await cards.nth(4).locator('[data-findpart]').click();
  await page.waitForTimeout(700);
  ck(await page.evaluate(() => document.getElementById('scroller').scrollTop) === 0,
     'the product search opens at the top, as it should');
  await page.fill('#q', 'fire exit');
  await page.waitForTimeout(700);
  await page.locator('.prow').first().click();
  await page.waitForTimeout(800);

  const backAt = await page.evaluate(() => document.getElementById('scroller').scrollTop);
  ck(Math.abs(backAt - leftAt) < 160,
     `back on the photos roughly where you left them (${Math.round(leftAt)}px then ${Math.round(backAt)}px)`);
  ck(backAt > 300, 'and nowhere near the top');

  console.log('\n--- the quantity on a part pinned to a photo ---');
  const part = cards.nth(4).locator('.pc-part').first();
  ck(await part.locator('[data-pqset]').count() === 1, 'the part has a quantity you can type into');
  ck(await part.locator('[data-pq]').count() === 2, 'with + and - either side of it');
  ck(await part.locator('[data-pqset]').inputValue() === '1', 'it starts at one');

  await part.locator('[data-pq][data-d="1"]').click();
  await page.waitForTimeout(400);
  ck(await cards.nth(4).locator('[data-pqset]').first().inputValue() === '2', '+ takes it to two');
  await cards.nth(4).locator('[data-pq][data-d="-1"]').first().click();
  await page.waitForTimeout(400);
  ck(await cards.nth(4).locator('[data-pqset]').first().inputValue() === '1', '- takes it back');
  await cards.nth(4).locator('[data-pq][data-d="-1"]').first().click();
  await page.waitForTimeout(400);
  ck(await cards.nth(4).locator('[data-pqset]').first().inputValue() === '1', 'and it will not go below one');

  await cards.nth(4).locator('[data-pqset]').first().fill('12');
  await page.waitForTimeout(350);
  await cards.nth(4).locator('[data-pqset]').first().blur();
  await page.waitForTimeout(300);
  ck(await cards.nth(4).locator('[data-pqset]').first().inputValue() === '12', 'twelve can be typed straight in');

  await page.click('.nav button[data-tab="survey"]');
  await page.waitForTimeout(400);
  await page.click('.nav button[data-tab="photos"]');
  await page.waitForTimeout(500);
  ck(await page.locator('[data-pqset]').first().inputValue() === '12', 'and it survives leaving the screen');

  /* a second part on the same photo keeps its own count */
  await cards.nth(4).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await cards.nth(4).locator('[data-findpart]').click();
  await page.waitForTimeout(700);
  await page.fill('#q', 'no smoking');
  await page.waitForTimeout(700);
  await page.locator('.prow').first().click();
  await page.waitForTimeout(800);
  const qtys = await cards.nth(4).locator('[data-pqset]').evaluateAll(els => els.map(e => e.value));
  ck(JSON.stringify(qtys) === '["12","1"]',
     `each part keeps its own count — ${JSON.stringify(qtys)}`);

  console.log('\n--- the custom-item button is no longer under your thumb ---');
  await cards.nth(0).locator('[data-findpart]').click();
  await page.waitForTimeout(700);
  const order = await page.evaluate(() => {
    const ids = ['refNote', 'q', 'refCustom'];
    const tops = {};
    ids.forEach(id => {
      const el = document.getElementById(id);
      tops[id] = el ? el.getBoundingClientRect().top : null;
    });
    const custom = document.querySelector('#refCustom #addCustom');
    return { tops, hasCustom: !!custom,
             customTop: custom ? custom.getBoundingClientRect().top : null };
  });
  ck(order.hasCustom, 'the custom-item button is still offered when a photo is waiting');
  ck(order.customTop > order.tops.q,
     `it now sits below the search box (search at ${Math.round(order.tops.q)}px, button at ${Math.round(order.customTop)}px)`);
  ck(order.tops.refNote < order.tops.q,
     'and the "For: this photo" line stays above it, where the context belongs');

  console.log('\n--- the quantities reach the office ---');
  await page.click('#clearRef');
  await page.waitForTimeout(400);
  await page.click('.nav button[data-tab="report"]');
  await page.waitForTimeout(450);
  await page.click('#expXlsx');
  await page.waitForSelector('#fSave', { timeout: 30000 });
  await page.evaluate(() => document.getElementById('fSave').click());
  await page.waitForTimeout(1400);
  const xb = await page.evaluate(() => window.__grabbed);
  ck(!!xb, 'the workbook builds');
  if (xb) {
    const buf = Buffer.from(xb);
    fs.writeFileSync(path.join(OUT, 'photo-qty.xlsx'), buf);
    const sheets = sheetText(buf);
    const orderSheet = sheets['xl/worksheets/sheet1.xml'] || [];
    const photoSheet = sheets['xl/worksheets/sheet2.xml'] || [];
    /* the quantity column is a number, so it is not in the text — the photo
       sheet spells it out, and that is what proves it carried through */
    ck(photoSheet.some(t => t.indexOf('12 x ') >= 0),
       'the photo sheet says how many of it — ' + (photoSheet.find(t => t.indexOf('12 x ') >= 0) || '(not found)'));
    ck(orderSheet.some(t => t.indexOf('Fire exit') >= 0), 'and the part is on the order list');
  }

  await page.evaluate(() => { document.getElementById('overlay').classList.remove('on'); window.__grabbed = null; });
  await page.click('.nav button[data-tab="report"]');
  await page.waitForTimeout(400);
  await page.click('#expPdf');
  await page.waitForSelector('#fSave', { timeout: 30000 });
  await page.evaluate(() => document.getElementById('fSave').click());
  await page.waitForTimeout(1600);
  const pb = await page.evaluate(() => window.__grabbed);
  ck(!!pb, 'the PDF builds');
  if (pb) {
    const buf = Buffer.from(pb);
    fs.writeFileSync(path.join(OUT, 'photo-qty.pdf'), buf);
    const t = pdf.text(buf).join('\n');
    ck(t.indexOf('12 x ') >= 0, 'and the PDF says it under the photo too');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no console errors');
  await browser.close(); server.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
