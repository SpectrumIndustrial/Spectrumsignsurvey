/* The whole interface is built by joining strings together, so the faults
   that get through are the ones a browser quietly forgives: a stray closing
   tag, the same id used twice, something a little wider than the phone, a
   control too small to hit with a glove on. None of them throws, none shows
   up in a screenshot you are not looking hard at, and two had got through.

   Every screen, every sheet and all four Guide tabs are walked here and
   checked for all four.                                                   */
const { chromium } = require('playwright');
const { EXECUTABLE } = require('./lib/paths');
const { serve } = require('./lib/serve');
const { photo } = require('./lib/photos');

const PORT = +(process.env.PORT || 8969);
let pass = 0, fail = 0;
const ck = (ok, msg) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); };

/* 32px is the floor used here: Apple asks for 44, and the chrome around a
   control often supplies the rest, but under 32 is a miss waiting to happen. */
const MIN_TAP = 32;

(async () => {
  const server = await serve(PORT);
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });

  const seen = [];
  async function screen(name, rootSel) {
    const r = await page.evaluate(({ sel, minTap }) => {
      const out = { dupes: [], wide: [], small: [], reparse: true };
      const ids = {};
      document.querySelectorAll('[id]').forEach(e => {
        if (ids[e.id]) { if (out.dupes.indexOf(e.id) < 0) out.dupes.push(e.id); } else ids[e.id] = 1;
      });
      document.querySelectorAll('body *').forEach(e => {
        const b = e.getBoundingClientRect();
        if (b.width && b.right > window.innerWidth + 1.5) {
          out.wide.push((e.id ? '#' + e.id : '.' + String(e.className).split(' ')[0])
            + ' +' + Math.round(b.right - window.innerWidth) + 'px');
        }
      });
      document.querySelectorAll('button, select, input, a, summary').forEach(e => {
        const b = e.getBoundingClientRect();
        if (b.width > 0 && b.height > 0 && (b.height < minTap || b.width < minTap)) {
          out.small.push((e.id ? '#' + e.id : '.' + String(e.className).split(' ')[0])
            + ' ' + Math.round(b.width) + 'x' + Math.round(b.height));
        }
      });
      const root = document.querySelector(sel);
      if (root) {
        const once = root.innerHTML;
        const box = document.createElement('div');
        box.innerHTML = once;
        out.reparse = box.innerHTML === once;
      }
      out.wide = [...new Set(out.wide)]; out.small = [...new Set(out.small)];
      return out;
    }, { sel: rootSel, minTap: MIN_TAP });
    seen.push([name, r]);
    return r;
  }

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(1000);
  await screen('setup sheet', '#sheet');
  await page.fill('#f-site', 'B & M, L24 8RJ');
  await page.fill('#f-by', 'S. Yorke');
  await page.click('.moreblock summary'); await page.waitForTimeout(250);
  await page.selectOption('#f-reseller', 'Arco');
  await page.click('#saveSetup'); await page.waitForTimeout(500);
  await screen('areas, empty', '#s-survey');

  await page.click('#addArea'); await page.waitForSelector('#areaName');
  await screen('add-area sheet', '#sheet');
  await page.fill('#areaName', 'Entrance gate/Carpark');
  await page.click('#makeArea'); await page.waitForTimeout(600);
  await screen('area, empty', '#s-survey');
  await page.click('#addSet'); await page.waitForTimeout(500);
  await screen('sign-set sheet', '#sheet');
  await page.locator('[data-addset]').first().click(); await page.waitForTimeout(700);
  await screen('area with signs', '#s-survey');
  await page.locator('.item').first().locator('[data-v="Missing"]').click();
  await page.waitForTimeout(400);
  await screen('area, one missing', '#s-survey');
  await page.click('#backAreas'); await page.waitForTimeout(400);
  await screen('areas, one area', '#s-survey');

  await page.click('.nav button[data-tab="parts"]'); await page.waitForTimeout(900);
  await screen('parts', '#s-parts');
  await page.fill('#q', 'fire exit'); await page.waitForTimeout(800);
  await screen('parts, results', '#s-parts');

  await page.click('.nav button[data-tab="photos"]'); await page.waitForTimeout(500);
  const jpg = await photo('landscape');
  await page.setInputFiles('#fileIn', { name: 'a.jpg', mimeType: 'image/jpeg', buffer: jpg });
  await page.waitForTimeout(900);
  await page.locator('.photocard input').first().fill('Panel above the roller door');
  await page.waitForTimeout(300);
  await page.locator('[data-findpart]').first().click(); await page.waitForTimeout(800);
  await page.fill('#q', 'fire exit'); await page.waitForTimeout(700);
  await page.locator('#results .prow').first().click(); await page.waitForTimeout(800);
  await screen('photos with a part', '#s-photos');
  await page.locator('.pc-part-bits').first().click(); await page.waitForTimeout(600);
  await screen('edit-part sheet', '#sheet');
  await page.evaluate(() => document.getElementById('overlay').classList.remove('on'));

  await page.click('.nav button[data-tab="report"]'); await page.waitForTimeout(800);
  await screen('report', '#s-report');
  await page.click('.nav button[data-tab="guide"]'); await page.waitForTimeout(700);
  for (const t of ['signs', 'spec', 'checks', 'regs']) {
    await page.click(`[data-gtab="${t}"]`); await page.waitForTimeout(600);
    await screen('guide/' + t, '#s-guide');
  }

  console.log(`--- ${seen.length} screens ---`);
  const dupes = seen.filter(([, r]) => r.dupes.length);
  ck(dupes.length === 0, 'no element id is used twice'
     + (dupes.length ? ' — ' + dupes.map(([n, r]) => n + ': ' + r.dupes.join(',')).join('; ') : ''));
  const wide = seen.filter(([, r]) => r.wide.length);
  ck(wide.length === 0, 'nothing is wider than the phone'
     + (wide.length ? ' — ' + wide.map(([n, r]) => n + ': ' + r.wide.slice(0, 3).join(',')).join('; ') : ''));
  const small = seen.filter(([, r]) => r.small.length);
  ck(small.length === 0, `no control is under ${MIN_TAP}px`
     + (small.length ? ' — ' + small.map(([n, r]) => n + ': ' + r.small.slice(0, 4).join(',')).join('; ') : ''));
  const torn = seen.filter(([, r]) => !r.reparse);
  ck(torn.length === 0, 'every screen\'s markup survives a re-parse (no stray or missing tags)'
     + (torn.length ? ' — ' + torn.map(([n]) => n).join(', ') : ''));

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log(errs.length ? 'ERRORS:\n' + [...new Set(errs)].join('\n') : 'no console errors');
  await browser.close();
  server.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
