/* Undo used to live and die with one toast: a second deletion replaced the
   first toast and took the only route back to it with it. Deleting two things
   in a row on site is normal, so this checks you can walk back more than one. */
const { chromium } = require('playwright');
const { EXECUTABLE } = require('./lib/paths');
const { serve } = require('./lib/serve');
const { photo } = require('./lib/photos');

const PORT = +(process.env.PORT || 8889);
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

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(900);
  await page.fill('#f-site', 'AMR GP Ltd');
  await page.fill('#f-by', 'S. Yorke');
  await page.click('#saveSetup');
  await page.waitForTimeout(300);
  await page.click('#addArea');
  await page.waitForSelector('[data-preset]');
  await page.locator('.preset', { hasText: /^Workshop/ }).click();
  await page.waitForTimeout(450);

  const jpg = await photo('landscape');
  await page.click('.nav button[data-tab="photos"]');
  await page.waitForTimeout(250);
  for (let i = 0; i < 3; i++) {
    await page.setInputFiles('#fileIn', { name: `p${i}.jpg`, mimeType: 'image/jpeg', buffer: jpg });
    await page.waitForTimeout(650);
  }
  const notes = ['By the roller door', 'Above the press', 'Outside the paint store'];
  for (let i = 0; i < 3; i++) {
    await page.locator('[data-pnote]').nth(i).fill(notes[i]);
    await page.waitForTimeout(150);
  }
  ck(await page.locator('#s-photos [data-pdel]').count() === 3, 'three photos to start with');

  console.log('\n--- two deletions in a row, both recoverable ---');
  await page.locator('#s-photos [data-pdel]').nth(2).click();
  await page.waitForTimeout(250);
  await page.locator('#s-photos [data-pdel]').nth(1).click();   /* before the first toast times out */
  await page.waitForTimeout(250);
  ck(await page.locator('#s-photos [data-pdel]').count() === 1, 'two gone, one left');

  await page.locator('.toast-act').click();
  await page.waitForTimeout(400);
  ck(await page.locator('#s-photos [data-pdel]').count() === 2, 'the first Undo brings one back');
  ck((await page.textContent('.toast-act')) === 'Undo previous',
     'and the confirmation offers to keep going');

  await page.locator('.toast-act').click();
  await page.waitForTimeout(400);
  ck(await page.locator('#s-photos [data-pdel]').count() === 3,
     'tapping again brings back the one the old build would have lost');

  const back = await page.locator('[data-pnote]').evaluateAll(els => els.map(e => e.value));
  ck(JSON.stringify(back) === JSON.stringify(notes),
     `both come back in their original order with their notes — ${JSON.stringify(back)}`);

  console.log('\n--- the stack does not outlive what it can restore ---');
  ck(await page.locator('.toast-act').count() === 0 ||
     (await page.textContent('.toast-act')) !== 'Undo previous',
     'nothing is offered once everything has been put back');

  console.log('\n--- it works across different kinds of thing ---');
  await page.click('.nav button[data-tab="parts"]');
  await page.waitForTimeout(350);
  await page.fill('#q', 'fire exit');
  await page.waitForTimeout(700);
  await page.locator('.prow').first().click();
  await page.waitForTimeout(400);
  await page.locator('.prow').nth(1).click();
  await page.waitForTimeout(400);
  const products = await page.locator('#s-parts .oline-name').count();
  ck(products === 2, `two products added (${products})`);

  await page.locator('#s-parts [data-del]').nth(1).click();
  await page.waitForTimeout(250);
  await page.locator('#s-parts [data-del]').nth(0).click();
  await page.waitForTimeout(250);
  ck(await page.locator('#s-parts .oline-name').count() === 0, 'both removed');
  await page.locator('.toast-act').click();
  await page.waitForTimeout(350);
  await page.locator('.toast-act').click();
  await page.waitForTimeout(350);
  ck(await page.locator('#s-parts .oline-name').count() === 2, 'both products come back');

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no console errors');
  await browser.close(); server.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
