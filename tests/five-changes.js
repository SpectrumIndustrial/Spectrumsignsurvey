/* Name the area yourself; sign lists optional. Status and Requirement off the
   spreadsheet. A re-seller picked from a list, free text for anyone else, and
   their own part number beside ours on the order list when we hold it.     */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { OUT, EXECUTABLE } = require('./lib/paths');
const { serve } = require('./lib/serve');
const { photo } = require('./lib/photos');
const { sheetText, strings } = require('./lib/xlsx');

const PORT = +(process.env.PORT || 8957);
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
    const o = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download && this.href.startsWith('blob:')) {
        window.__grabbed = fetch(this.href).then(r => r.arrayBuffer()).then(b => Array.from(new Uint8Array(b)));
        return;
      }
      return o.apply(this, arguments);
    };
  });
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(1000);

  console.log('--- the re-seller is picked, not typed ---');
  await page.fill('#f-site', 'Brantham Mill');
  await page.fill('#f-by', 'S. Yorke');
  await page.click('.moreblock summary');
  await page.waitForTimeout(250);
  ck(await page.locator('#f-reseller').evaluate(e => e.tagName) === 'SELECT', 'it is a list');
  const opts = await page.locator('#f-reseller option').evaluateAll(els => els.map(e => e.textContent.trim()));
  ck(/Arco/.test(opts.join('|')) && /Lyreco/.test(opts.join('|')) && /Cromwell/.test(opts.join('|')),
     `all three are offered — ${opts.filter(o => /Arco|Lyreco|Cromwell/.test(o)).join(', ')}`);
  ck(opts.some(o => /Arco.*part numbers/.test(o)), 'and it says which one brings part numbers with it');
  ck(await page.locator('#otherResWrap').evaluate(e => e.hidden), 'the free-text box is out of the way to begin with');

  await page.selectOption('#f-reseller', '__other');
  await page.waitForTimeout(300);
  ck(!(await page.locator('#otherResWrap').evaluate(e => e.hidden)), 'choosing someone else opens a box to type in');
  await page.fill('#f-resellerOther', 'Hughes Safety Supplies');
  await page.click('#saveSetup');
  await page.waitForTimeout(500);
  await page.click('#btnSetup');
  await page.waitForTimeout(600);
  ck(await page.inputValue('#f-resellerOther') === 'Hughes Safety Supplies',
     'a typed re-seller comes back intact, on "someone else"');
  ck(await page.inputValue('#f-reseller') === '__other', 'with the list showing that, not blank');

  await page.selectOption('#f-reseller', 'Arco');
  await page.waitForTimeout(250);
  await page.click('#saveSetup');
  await page.waitForTimeout(500);

  console.log('\n--- an area is named, not picked ---');
  await page.click('#addArea');
  await page.waitForSelector('#areaName');
  ck(await page.locator('#areaName').count() === 1, 'the sheet asks for a name first');
  ck(await page.locator('#makeArea').count() === 1, 'with a button that just makes it');
  ck(await page.locator('.preset').count() > 0, 'and the sign lists are still offered below, not hidden');
  await page.fill('#areaName', 'Mez area');
  await page.click('#makeArea');
  await page.waitForTimeout(700);
  ck((await page.textContent('#ctxLabel')).trim() === 'Mez area', 'the area is called what was typed');
  ck(await page.locator('#s-survey .item').count() === 0, 'and starts with no signs at all');

  console.log('\n--- but a sign list is one tap away from inside it ---');
  ck(await page.locator('#addSet').count() === 1, 'the empty area offers the usual signs');
  await page.click('#addSet');
  await page.waitForTimeout(500);
  await page.locator('[data-addset]').first().click();
  await page.waitForTimeout(700);
  const n = await page.locator('#s-survey .item').count();
  ck(n > 0, `a list can be dropped in afterwards (${n} signs)`);
  ck(/signs added/.test(await page.textContent('#toastMsg')), 'with a toast saying so');
  await page.locator('#toastAct button').click();
  await page.waitForTimeout(700);
  ck(await page.locator('#s-survey .item').count() === 0, 'and undo takes them straight back out');

  console.log('\n--- naming it from a sign list keeps the typed name ---');
  await page.click('#backAreas');
  await page.waitForTimeout(400);
  await page.click('#addArea');
  await page.waitForSelector('#areaName');
  await page.fill('#areaName', 'Entrance gate/Carpark');
  await page.locator('.preset', { hasText: /^Warehouse/ }).first().click();
  await page.waitForTimeout(700);
  ck((await page.textContent('#ctxLabel')).trim() === 'Entrance gate/Carpark',
     'the typed name wins over the list it came from');
  ck(await page.locator('#s-survey .item').count() > 0, 'and the signs came with it');

  console.log('\n--- the Guide says what to look for where ---');
  await page.click('.nav button[data-tab="guide"]');
  await page.waitForTimeout(500);
  await page.click('[data-gtab="checks"]');
  await page.waitForTimeout(500);
  const g = await page.textContent('#s-guide');
  ck(/What to look for where/.test(g), 'the walk-round tab carries the lists');
  ck(/Warehouse/.test(g) && /Plant room/.test(g), 'naming each kind of space');

  console.log('\n--- the order list ---');
  await page.click('.nav button[data-tab="survey"]');
  await page.waitForTimeout(400);
  await page.locator('.item').first().locator('[data-v="Missing"]').click();
  await page.waitForTimeout(400);
  await page.locator('.item').first().locator('[data-find]').first().click();
  await page.waitForTimeout(800);
  await page.fill('#q', '0002');
  await page.waitForTimeout(800);
  await page.locator('#results .prow').first().click();
  await page.waitForTimeout(800);

  await page.click('.nav button[data-tab="report"]');
  await page.waitForTimeout(600);
  await page.click('#expXlsx');
  await page.waitForSelector('#fSave', { timeout: 40000 });
  await page.evaluate(() => document.getElementById('fSave').click());
  await page.waitForTimeout(1800);
  const xb = Buffer.from(await page.evaluate(() => window.__grabbed));
  fs.writeFileSync(path.join(OUT, 'five-changes.xlsx'), xb);
  const sheets = sheetText(xb);
  const order = sheets[Object.keys(sheets)[0]];
  const headIx = order.indexOf('Location');
  const header = order.slice(headIx, headIx + 9);
  console.log('    header row:', header.join(' | '));

  ck(header.indexOf('Status') < 0, 'Status is gone from the spreadsheet');
  ck(header.indexOf('Requirement') < 0, 'Requirement is gone too');
  ck(header.indexOf('Description') >= 0 && header.indexOf('Qty') >= 0 && header.indexOf('Notes') >= 0,
     'the columns that order the goods are all still there');
  ck(header.indexOf('Arco part') >= 0, 'and Arco gets a column of its own');
  ck(header.indexOf('Arco part') === header.indexOf('Part No') + 1, 'right beside ours, where it is read');
  const flat = strings(xb).join('\n');
  ck(/55S0002/.test(flat), "Arco's own code sits on the row — Spectrum 0002 is Arco 55S0002");
  ck(!/ \/ /.test((/55S0002[^\n]*/.exec(flat) || [''])[0]),
     'and it is the one code, not a list, where the file gives only one');
  ck(/Missing/.test(flat), 'the sign status still reaches the office, in the notes');

  /* 0001 has fifteen Arco codes against it. Picking one would be a guess. */
  const amb = /several \(\d+\) - check/.test(strings(xb).join('\n'));
  console.log('    (ambiguous products are flagged rather than guessed' + (amb ? ', seen here' : '') + ')');

  console.log('\n--- and no column when the re-seller has no codes ---');
  await page.evaluate(() => { document.getElementById('overlay').classList.remove('on'); window.__grabbed = null; });
  await page.click('#btnSetup');
  await page.waitForTimeout(600);
  await page.selectOption('#f-reseller', 'Lyreco');
  await page.waitForTimeout(250);
  await page.click('#saveSetup');
  await page.waitForTimeout(500);
  await page.click('.nav button[data-tab="report"]');
  await page.waitForTimeout(500);
  await page.click('#expXlsx');
  await page.waitForSelector('#fSave', { timeout: 40000 });
  await page.evaluate(() => document.getElementById('fSave').click());
  await page.waitForTimeout(1800);
  const xb2 = Buffer.from(await page.evaluate(() => window.__grabbed));
  const sh2 = sheetText(xb2);
  const o2 = sh2[Object.keys(sh2)[0]];
  const h2 = o2.slice(o2.indexOf('Location'), o2.indexOf('Location') + 8);
  ck(h2.indexOf('Lyreco part') < 0 && h2.indexOf('Arco part') < 0,
     `no part column for a re-seller we hold no codes for — ${h2.join(' | ')}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no console errors');
  await browser.close();
  server.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
