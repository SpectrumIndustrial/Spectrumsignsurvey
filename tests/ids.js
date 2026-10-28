/* Ids are handed out from one counter, S.seq, and everything that can be
   deleted is found by its id. A stored survey that arrives without that
   counter — one saved by an older build, or restored from anywhere else —
   would restart it at 1 and mint ids that already exist, after which deleting
   one thing deletes another.

   This builds a real survey, strips `seq` out of the stored record the way a
   stale save would, reloads, and checks the app hands out fresh ids rather
   than repeating ones already in use. */
const { chromium } = require('playwright');
const { EXECUTABLE } = require('./lib/paths');
const { serve } = require('./lib/serve');
const { photo } = require('./lib/photos');

const PORT = +(process.env.PORT || 8883);
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
  await page.setInputFiles('#fileIn', { name: 'a.jpg', mimeType: 'image/jpeg', buffer: jpg });
  await page.waitForTimeout(700);
  await page.waitForTimeout(600);                       /* let the debounced write land */

  /* Make the stored record look like one written before the counter existed. */
  const stripped = await page.evaluate(() => new Promise(resolve => {
    const rq = indexedDB.open('spectrum.surveys');
    rq.onsuccess = () => {
      const db = rq.result;
      const tx = db.transaction('surveys', 'readwrite');
      const st = tx.objectStore('surveys');
      st.openCursor().onsuccess = e => {
        const c = e.target.result;
        if (!c) return;
        const rec = c.value;
        const had = rec.seq;
        delete rec.seq;
        c.update(rec);
        resolve(had);
      };
    };
  }));
  ck(typeof stripped === 'number' && stripped > 1,
     `the stored survey had reached seq ${stripped}; removed it`);

  await page.reload();
  await page.waitForTimeout(1200);

  /* Everything already in the survey, plus one of each added after the reload. */
  await page.click('.nav button[data-tab="photos"]');
  await page.waitForTimeout(350);
  await page.setInputFiles('#fileIn', { name: 'b.jpg', mimeType: 'image/jpeg', buffer: jpg });
  await page.waitForTimeout(800);

  /* Ground truth: every id in the survey as it is actually stored. Reading the
     DOM only shows one screen's worth, and the first collision found was a
     photo taking the area's id, which no single screen lists together. */
  const ids = await page.evaluate(() => new Promise(resolve => {
    const rq = indexedDB.open('spectrum.surveys');
    rq.onsuccess = () => {
      rq.result.transaction('surveys', 'readonly').objectStore('surveys')
        .openCursor().onsuccess = e => {
          const c = e.target.result;
          if (!c) return resolve(null);
          const rec = c.value, out = [];
          (rec.areas || []).forEach(a => {
            out.push(['area', a.id]);
            (a.signs || []).forEach(x => out.push(['sign', x.id]));
            (a.order || []).forEach(x => out.push(['product', x.id]));
            (a.photos || []).forEach(x => out.push(['photo', x.id]));
          });
          resolve({ ids: out, seq: rec.seq });
        };
    };
  }));
  ck(!!ids, 'the survey was read back from storage');

  const counts = {};
  ids.ids.forEach(([kind, id]) => { (counts[id] = counts[id] || []).push(kind); });
  const clashes = Object.keys(counts).filter(id => counts[id].length > 1);
  ck(clashes.length === 0,
     `every id in the survey is unique (${ids.ids.length} items)`
     + (clashes.length ? ' — ' + clashes.map(id => `id ${id} used by ${counts[id].join(' and ')}`).join(', ') : ''));

  const highest = Math.max.apply(null, ids.ids.map(x => x[1]));
  ck(ids.seq > highest,
     `the counter is ahead of everything in the survey (seq ${ids.seq}, highest id ${highest})`);

  const photoIds = await page.evaluate(() =>
    [...document.querySelectorAll('#s-photos [data-pdel]')].map(e => e.dataset.pdel));
  ck(photoIds.length === 2, `both photos are listed (${photoIds.length})`);

  /* The real consequence: deleting one thing must not take another with it. */
  const before = await page.locator('#s-photos [data-pdel]').count();
  await page.click('.nav button[data-tab="photos"]');
  await page.waitForTimeout(300);
  await page.locator('[data-pdel]').first().click();
  await page.waitForTimeout(500);
  const after = await page.locator('#s-photos [data-pdel]').count();
  ck(after === 1, `deleting one photo removes exactly one (${before} then ${after})`);

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no console errors');
  await browser.close(); server.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
