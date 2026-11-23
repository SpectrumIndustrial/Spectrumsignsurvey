/* Exercises every pre-existing feature of the app plus the new ones, so
   "no functionality lost" is a measured claim rather than an assumption. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { OUT, EXECUTABLE } = require('./lib/paths');
const { serve } = require('./lib/serve');
const { photo } = require('./lib/photos');

const PORT = +(process.env.PORT || 8743);


let pass = 0; const fails = [];
async function step(name, fn) {
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fails.push(name + ' :: ' + e.message); console.log('  FAIL ' + name + ' :: ' + e.message); }
}
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const has = (t, s, m) => { if (!String(t).includes(s)) throw new Error(`${m}: ${JSON.stringify(String(t).slice(0, 200))}`); };

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
  await page.waitForTimeout(900);

  console.log('--- setup ---');
  await step('first-run sheet', async () => { await page.waitForSelector('#saveSetup', { timeout: 5000 }); });
  await step('site details save', async () => {
    await page.fill('#f-site', 'Regression Ltd');
    await page.fill('#f-by', 'Tester');
    await page.click('#saveSetup');
    await page.waitForTimeout(300);
    has(await page.textContent('#ctxLabel'), 'Regression Ltd', 'ctx label');
  });

  console.log('--- areas ---');
  await step('add area from preset', async () => {
    await page.click('#addArea');
    await page.waitForSelector('[data-preset]');
    await page.click('[data-preset="0"]');
    await page.waitForTimeout(400);
    if (await page.locator('.item').count() < 5) throw new Error('preset signs missing');
  });
  await step('area note', async () => {
    await page.click('#areaNoteBlock button');
    await page.waitForTimeout(300);
    await page.fill('.sheet-text', 'Front of house, tidy.');
    await page.click('#saveNote');
    await page.waitForTimeout(300);
    has(await page.textContent('#s-survey'), 'Front of house, tidy.', 'area note');
  });
  await step('sign statuses', async () => {
    await page.locator('.item').nth(0).locator('.chip.miss').click();
    await page.waitForTimeout(150);
    await page.locator('.item').nth(1).locator('.chip.dam').click();
    await page.waitForTimeout(150);
    await page.locator('.item').nth(2).locator('.chip.ok').click();
    await page.waitForTimeout(300);
    has(await page.textContent('#s-survey'), '3 of 9 signs checked', 'progress');
  });
  await step('sign note', async () => {
    await page.locator('.item').nth(0).locator('[data-editnote]').click();
    await page.waitForTimeout(300);
    await page.fill('.sheet-text', 'Bracket snapped.');
    await page.click('#saveNote');
    await page.waitForTimeout(300);
    has(await page.textContent('#s-survey'), 'Bracket snapped.', 'sign note');
  });
  await step('add sign from library', async () => {
    const before = await page.locator('.item').count();
    await page.click('#addSign');
    await page.waitForTimeout(400);
    await page.locator('#signlist .listrow').first().click();
    await page.waitForTimeout(400);
    eq(await page.locator('.item').count(), before + 1, 'sign count');
  });
  await step('custom sign', async () => {
    const before = await page.locator('.item').count();
    await page.click('#addSign');
    await page.waitForTimeout(300);
    await page.click('#customSign');
    await page.waitForTimeout(400);
    await page.fill('#cs-name', 'Bespoke door notice');
    await page.click('#saveCustomSign');
    await page.waitForTimeout(400);
    eq(await page.locator('.item').count(), before + 1, 'sign count');
    has(await page.textContent('#s-survey'), 'Bespoke door notice', 'custom sign');
  });

  console.log('--- parts ---');
  await step('link a product to a sign', async () => {
    await page.locator('.item').nth(0).locator('[data-find]').click();
    await page.waitForTimeout(700);
    has(await page.textContent('#s-parts'), 'For: No smoking', 'ref bar');
    await page.fill('#q', 'no smoking');
    await page.waitForTimeout(700);
    await page.locator('.prow').first().click();
    await page.waitForTimeout(600);
    /* addPart stays on Parts on purpose (you may be adding several), so go
       back to the area before reading the sign card. */
    has(await page.textContent('#s-parts'), 'In Reception — 1 product', 'order list');
    await page.click('.nav button[data-tab="survey"]');
    await page.waitForTimeout(500);
    has(await page.textContent('#s-survey'), '1 product added', 'link badge');
  });
  await step('catalogue search + filters', async () => {
    await page.click('.nav button[data-tab="parts"]');
    await page.waitForTimeout(400);
    await page.fill('#q', 'fire exit');
    await page.waitForTimeout(700);
    if (await page.locator('.prow').count() < 1) throw new Error('no results');
    await page.locator('[data-filter="mat"]').click();
    await page.waitForTimeout(500);
    await page.locator('#plist [data-pick]').nth(1).click();
    await page.waitForTimeout(600);
    if (await page.locator('.prow').count() < 1) throw new Error('no results after material filter');
    await page.click('#clrF');
    await page.waitForTimeout(400);
  });
  await step('add loose product + stepper', async () => {
    await page.locator('.prow').first().click();
    await page.waitForTimeout(500);
    const line = page.locator('.oline').last();
    await line.locator('[data-d="1"]').click();
    await page.waitForTimeout(300);
    has(await line.textContent(), '2', 'qty stepped to 2');
  });
  await step('custom product', async () => {
    await page.click('#addCustom');
    await page.waitForTimeout(400);
    await page.fill('#c-name', 'Bespoke fixing bracket');
    await page.fill('#c-mat', 'Steel');
    await page.fill('#c-size', '50x50mm');
    await page.click('#saveCustom');
    await page.waitForTimeout(500);
    has(await page.textContent('#s-parts'), 'Bespoke fixing bracket', 'custom product');
  });
  await step('delete product then undo', async () => {
    const before = await page.locator('.oline').count();
    await page.locator('.oline').last().locator('[data-del]').click();
    await page.waitForTimeout(400);
    eq(await page.locator('.oline').count(), before - 1, 'after delete');
    await page.click('.toast-act');
    await page.waitForTimeout(500);
    eq(await page.locator('.oline').count(), before, 'after undo');
  });

  console.log('--- photos ---');
  const jpg = await photo('landscape');
  await step('add photos', async () => {
    await page.click('.nav button[data-tab="photos"]');
    await page.waitForTimeout(400);
    for (let i = 0; i < 2; i++) {
      await page.setInputFiles('#fileIn', { name: `p${i}.jpg`, mimeType: 'image/jpeg', buffer: jpg });
      await page.waitForTimeout(500);
    }
    eq(await page.locator('.photocard').count(), 2, 'photo count');
  });
  await step('photo note', async () => {
    await page.locator('.photocard input').first().fill('Cracked face');
    await page.waitForTimeout(500);
  });
  await step('attach a part to a photo', async () => {
    await page.locator('[data-findpart]').first().click();
    await page.waitForTimeout(700);
    has(await page.textContent('#s-parts'), 'For: P1', 'photo ref bar');
    await page.fill('#q', 'no smoking');
    await page.waitForTimeout(700);
    await page.locator('.prow').first().click();
    await page.waitForTimeout(700);
    has(await page.textContent('#s-photos'), 'SAPP', 'part meta on photocard');
  });
  await step('remove part then undo', async () => {
    await page.locator('[data-partdel]').first().click();
    await page.waitForTimeout(500);
    if (await page.locator('[data-partdel]').count() !== 0) throw new Error('part not removed');
    await page.click('.toast-act');
    await page.waitForTimeout(600);
    eq(await page.locator('[data-partdel]').count(), 1, 'part restored');
  });
  await step('delete photo then undo', async () => {
    await page.locator('[data-pdel]').last().click();
    await page.waitForTimeout(500);
    eq(await page.locator('.photocard').count(), 1, 'after delete');
    await page.click('.toast-act');
    await page.waitForTimeout(600);
    eq(await page.locator('.photocard').count(), 2, 'after undo');
  });

  console.log('--- area menu ---');
  await step('rename area', async () => {
    await page.click('.nav button[data-tab="survey"]');
    await page.waitForTimeout(400);
    await page.click('#renameArea');
    await page.waitForTimeout(400);
    await page.fill('#an', 'Front Reception');
    await page.click('#saveName');
    await page.waitForTimeout(500);
    has(await page.textContent('#s-survey'), 'Front Reception', 'renamed');
  });
  await step('duplicate area', async () => {
    await page.click('#renameArea');
    await page.waitForTimeout(400);
    await page.click('#dupArea');
    await page.waitForTimeout(600);
    await page.click('#backAreas').catch(() => {});
    await page.waitForTimeout(500);
    if (await page.locator('.areacard').count() < 2) throw new Error('duplicate missing');
  });
  await step('second area + complete it', async () => {
    await page.click('#addArea');
    await page.waitForSelector('[data-preset]');
    await page.click('[data-preset="2"]');
    await page.waitForTimeout(500);
    await page.click('#completeArea');
    await page.waitForTimeout(400);
    const cf = page.locator('#cfYes');
    if (await cf.count()) { await cf.click(); await page.waitForTimeout(500); }
    has(await page.textContent('#s-survey'), 'Complete', 'completed pill');
  });

  console.log('--- guide ---');
  await step('guide search', async () => {
    await page.click('.nav button[data-tab="guide"]');
    await page.waitForTimeout(500);
    await page.fill('#gq', 'smoking');
    await page.waitForTimeout(500);
    has(await page.textContent('#guideList'), 'No smoking', 'guide search');
    await page.click('#gClr');
    await page.waitForTimeout(400);
  });
  await step('guide sections', async () => {
    await page.click('[data-gtab="spec"]');
    await page.waitForTimeout(400);
    has(await page.textContent("#guideBody"), "Self-adhesive vinyl", "spec section");
    await page.click('[data-gtab="regs"]');
    await page.waitForTimeout(400);
    has(await page.textContent('#guideBody'), 'Safety Signs and Signals', 'regs section');
    await page.click('[data-gtab="signs"]');
    await page.waitForTimeout(400);
    has(await page.textContent('#guideBody'), 'How to read a sign', 'signs section');
  });
  await step('guide add-to-area', async () => {
    await page.click('.nav button[data-tab="survey"]');
    await page.waitForTimeout(400);
    await page.locator('.areacard').first().click();
    await page.waitForTimeout(500);
    const before = await page.locator('.item').count();
    await page.click('.nav button[data-tab="guide"]');
    await page.waitForTimeout(500);
    const btn = page.locator('[data-guideadd]').first();
    await btn.click();
    await page.waitForTimeout(500);
    await page.click('.nav button[data-tab="survey"]');
    await page.waitForTimeout(500);
    if (await page.locator('.item').count() <= before) throw new Error('sign not added from guide');
  });

  console.log('--- theme ---');
  await step('theme toggle persists', async () => {
    await page.click('#btnTheme');
    await page.waitForTimeout(300);
    eq(await page.evaluate(() => document.documentElement.classList.contains('dark')), true, 'dark on');
    await page.reload();
    await page.waitForTimeout(1200);
    eq(await page.evaluate(() => document.documentElement.classList.contains('dark')), true, 'dark after reload');
    await page.click('#btnTheme');
    await page.waitForTimeout(300);
  });

  console.log('--- exports ---');
  await step('xlsx contents', async () => {
    await page.click('.nav button[data-tab="report"]');
    await page.waitForTimeout(500);
    await page.click('#expXlsx');
    await page.waitForSelector('#fSave', { timeout: 30000 });
    await page.evaluate(() => document.getElementById('fSave').click());
    await page.waitForTimeout(700);
    const b = await page.evaluate(() => window.__grabbed);
    if (!b) throw new Error('no file');
    fs.writeFileSync(path.join(OUT, 'regression.xlsx'), Buffer.from(b));
    const zip = Buffer.from(b).toString('latin1');
    if (!zip.includes('xl/media/')) throw new Error('no photos embedded in the workbook');
    if (!zip.includes('xl/drawings/')) throw new Error('no drawing part in the workbook');
    await page.evaluate(() => { document.getElementById('overlay').classList.remove('on'); window.__grabbed = null; });
  });
  await step('pdf builds', async () => {
    await page.click('.nav button[data-tab="report"]');
    await page.waitForTimeout(400);
    await page.click('#expPdf');
    await page.waitForSelector('#fSave', { timeout: 30000 });
    has(await page.textContent('#sheet'), 'PDF ready', 'pdf sheet');
    await page.evaluate(() => document.getElementById('overlay').classList.remove('on'));
  });

  console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) console.log('FAILURES:\n' + fails.join('\n'));
  console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.join('\n') : 'no console errors');
  await browser.close();
  server.close();
  process.exit(fails.length || errors.length ? 1 : 0);
})();
