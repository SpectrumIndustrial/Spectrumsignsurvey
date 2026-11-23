/* A survey used to exist on exactly one phone. The PDF and the spreadsheet are
   outputs — neither can be opened back up and carried on with — so a phone
   lost or wiped mid-job took the job with it.

   This builds a survey with everything in it, saves it to a file, wipes the
   device completely, and opens the file back up. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { OUT, EXECUTABLE } = require('./lib/paths');
const { serve } = require('./lib/serve');
const { photo } = require('./lib/photos');

const PORT = +(process.env.PORT || 8893);
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
        window.__grabbed = fetch(this.href).then(r => r.text());
        return;
      }
      return orig.apply(this, arguments);
    };
  });

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(900);
  await page.fill('#f-site', 'AMR GP Ltd');
  await page.fill('#f-by', 'S. Yorke');
  await page.fill('#f-pc', 'NN17 2DA');
  await page.waitForTimeout(250);
  await page.locator('.placechip', { hasText: 'Corby' }).click();
  await page.click('#saveSetup');
  await page.waitForTimeout(300);

  /* Something of each kind, so "nothing is lost" means something. */
  await page.click('#addArea');
  await page.waitForSelector('[data-preset]');
  await page.locator('.preset', { hasText: /^Workshop/ }).click();
  await page.waitForTimeout(450);
  await page.locator('.item').first().locator('.chip.miss').click();
  await page.waitForTimeout(200);
  await page.locator('.item').nth(1).locator('.chip.dam').click();
  await page.waitForTimeout(200);

  await page.click('.nav button[data-tab="parts"]');
  await page.waitForTimeout(300);
  await page.fill('#q', 'fire exit');
  await page.waitForTimeout(700);
  await page.locator('.prow').first().click();
  await page.waitForTimeout(400);
  await page.locator('#s-parts [data-qset]').first().fill('250');
  await page.waitForTimeout(300);

  const jpg = await photo('landscape');
  await page.click('.nav button[data-tab="photos"]');
  await page.waitForTimeout(250);
  await page.setInputFiles('#fileIn', { name: 'a.jpg', mimeType: 'image/jpeg', buffer: jpg });
  await page.waitForTimeout(700);
  await page.locator('[data-pnote]').first().fill('Cracked face by the roller door');
  await page.waitForTimeout(200);
  await page.locator('[data-findpart]').first().click();
  await page.waitForTimeout(600);
  await page.fill('#q', 'no smoking');
  await page.waitForTimeout(700);
  await page.locator('.prow').first().click();
  await page.waitForTimeout(700);
  await page.waitForTimeout(600);

  const before = await page.evaluate(() => new Promise(resolve => {
    const rq = indexedDB.open('spectrum.surveys');
    rq.onsuccess = () => {
      rq.result.transaction('surveys', 'readonly').objectStore('surveys')
        .openCursor().onsuccess = e => {
          const c = e.target.result;
          if (!c) return resolve(null);
          const r = c.value;
          resolve({ id: r.id, site: r.site, by: r.by, addr: r.addr,
                    areas: r.areas.length,
                    signs: r.areas[0].signs.length,
                    statuses: r.areas[0].signs.map(s => s.st).join(','),
                    products: r.areas[0].order.length,
                    qty: r.areas[0].order[0] && r.areas[0].order[0].qty,
                    photos: r.areas[0].photos.length,
                    note: r.areas[0].photos[0] && r.areas[0].photos[0].note,
                    parts: r.areas[0].photos[0] && r.areas[0].photos[0].parts.length,
                    photoBytes: r.areas[0].photos[0] && r.areas[0].photos[0].src.length });
        };
    };
  }));
  ck(!!before && before.photos === 1 && before.products === 1,
     `survey built — ${before.areas} area, ${before.signs} signs, ${before.products} product, ${before.photos} photo`);

  console.log('\n--- save it to a file ---');
  await page.click('#btnSurveys');
  await page.waitForTimeout(400);
  ck(await page.locator('#saveSurveyFile').count() === 1, 'the Surveys sheet offers to save one to a file');
  await page.click('#saveSurveyFile');
  await page.waitForSelector('#fSave', { timeout: 20000 });
  await page.evaluate(() => document.getElementById('fSave').click());
  await page.waitForTimeout(1000);
  const text = await page.evaluate(() => window.__grabbed);
  ck(!!text && text.length > 1000, `the file is written (${text ? (text.length / 1024).toFixed(0) : 0}KB)`);
  const file = path.join(OUT, 'survey-backup.json');
  fs.writeFileSync(file, text);
  const parsed = JSON.parse(text);
  ck(parsed.areas[0].photos[0].src.indexOf('data:image/jpeg') === 0,
     'the photograph itself is in the file, not a reference to one');

  console.log('\n--- wipe the device ---');
  await page.evaluate(() => new Promise(resolve => {
    localStorage.clear();
    try { sessionStorage.clear(); } catch (e) {}
    const del = indexedDB.deleteDatabase('spectrum.surveys');
    del.onsuccess = del.onerror = del.onblocked = () => resolve();
  }));
  await page.reload();
  await page.waitForTimeout(1200);
  const emptied = await page.evaluate(() => new Promise(resolve => {
    const rq = indexedDB.open('spectrum.surveys');
    rq.onsuccess = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains('surveys')) return resolve(0);
      db.transaction('surveys', 'readonly').objectStore('surveys').count().onsuccess =
        e => resolve(e.target.result);
    };
  }));
  ck(emptied === 0, `nothing left on the device (${emptied} surveys stored)`);

  console.log('\n--- open the file back up ---');
  /* A wiped phone opens straight onto "Before you start", which is exactly
     where someone restoring a backup finds themselves. */
  ck(await page.locator('#setupOpenFile').count() === 1,
     'the first-run sheet offers to open a file rather than only starting fresh');
  await page.click('#setupOpenFile');
  await page.waitForTimeout(300);
  await page.setInputFiles('#surveyIn', file);
  await page.waitForTimeout(1500);

  const after = await page.evaluate(() => new Promise(resolve => {
    const rq = indexedDB.open('spectrum.surveys');
    rq.onsuccess = () => {
      rq.result.transaction('surveys', 'readonly').objectStore('surveys')
        .openCursor().onsuccess = e => {
          const c = e.target.result;
          if (!c) return resolve(null);
          const r = c.value;
          resolve({ id: r.id, site: r.site, by: r.by, addr: r.addr,
                    areas: r.areas.length,
                    signs: r.areas[0].signs.length,
                    statuses: r.areas[0].signs.map(s => s.st).join(','),
                    products: r.areas[0].order.length,
                    qty: r.areas[0].order[0] && r.areas[0].order[0].qty,
                    photos: r.areas[0].photos.length,
                    note: r.areas[0].photos[0] && r.areas[0].photos[0].note,
                    parts: r.areas[0].photos[0] && r.areas[0].photos[0].parts.length,
                    photoBytes: r.areas[0].photos[0] && r.areas[0].photos[0].src.length });
        };
    };
  }));
  ck(!!after, 'the survey is back on the device');
  const fields = ['id', 'site', 'by', 'addr', 'areas', 'signs', 'statuses',
                  'products', 'qty', 'photos', 'note', 'parts', 'photoBytes'];
  const lost = fields.filter(f => JSON.stringify(before[f]) !== JSON.stringify(after[f]));
  ck(lost.length === 0, 'everything came back unchanged'
     + (lost.length ? ' — differs: ' + lost.map(f => `${f} ${JSON.stringify(before[f])} → ${JSON.stringify(after[f])}`).join(', ') : ''));

  ck((await page.textContent('#s-survey')).indexOf('AMR GP Ltd') >= 0 ||
     (await page.textContent('#ctxLabel')).length > 0, 'and it is the survey now on screen');

  console.log('\n--- opening it twice does not overwrite the first ---');
  await page.click('#btnSurveys');
  await page.waitForTimeout(500);
  await page.setInputFiles('#surveyIn', file);
  await page.waitForTimeout(1500);
  const count = await page.evaluate(() => new Promise(resolve => {
    const rq = indexedDB.open('spectrum.surveys');
    rq.onsuccess = () => {
      rq.result.transaction('surveys', 'readonly').objectStore('surveys').count().onsuccess =
        e => resolve(e.target.result);
    };
  }));
  ck(count === 2, `a second copy is added rather than replacing the first (${count} surveys)`);

  console.log('\n--- anything that is not a survey is refused ---');
  const junk = path.join(OUT, 'not-a-survey.json');
  fs.writeFileSync(junk, '{"hello":"world"}');
  await page.click('#btnSurveys');
  await page.waitForTimeout(500);
  await page.setInputFiles('#surveyIn', junk);
  await page.waitForTimeout(800);
  ck((await page.textContent('#toastMsg')).indexOf("isn't a survey") >= 0,
     'a file that is not a survey is turned away with a plain message');
  const stillTwo = await page.evaluate(() => new Promise(resolve => {
    const rq = indexedDB.open('spectrum.surveys');
    rq.onsuccess = () => {
      rq.result.transaction('surveys', 'readonly').objectStore('surveys').count().onsuccess =
        e => resolve(e.target.result);
    };
  }));
  ck(stillTwo === 2, 'and nothing on the device was touched');

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no console errors');
  await browser.close(); server.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
