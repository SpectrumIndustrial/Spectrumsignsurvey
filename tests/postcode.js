/* Postcode -> town, after the alphabetical-guess bug.
   Rule under test: one locality is filled in; more than one is offered and
   nothing is assumed. */
const { chromium } = require('playwright');
const { EXECUTABLE } = require('./lib/paths');
const { serve } = require('./lib/serve');

const PORT = +(process.env.PORT || 8817);


let pass = 0, fail = 0;
const check = (ok, msg) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); };

(async () => {
  const server = await serve(PORT, { csp: true });
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(1200);
  await ctx.setOffline(true);
  await page.waitForSelector('#saveSetup');

  const type = async pc => {
    await page.fill('#f-pc', '');
    await page.waitForTimeout(50);
    await page.fill('#f-pc', pc);
    await page.waitForTimeout(150);
    return {
      town: await page.inputValue('#f-addr'),
      chips: await page.locator('.placechip').allTextContents(),
    };
  };

  console.log('--- the two you reported ---');
  let r = await type('NN14 6FX');
  check(r.town === '', `NN14 6FX does not guess a town (got ${JSON.stringify(r.town)})`);
  check(r.chips.includes('Rothwell'), `NN14 offers Rothwell (${r.chips.join(', ')})`);
  check(r.chips.includes('Desborough'), 'NN14 offers Desborough');
  check(!r.chips.includes('Kettering'), 'NN14 does not claim Kettering (it is NN16)');

  r = await type('NN17 2DA');
  check(r.town === '', `NN17 2DA does not guess a town (got ${JSON.stringify(r.town)})`);
  check(r.chips.join(',') === 'Bulwick,Corby', `NN17 offers Bulwick + Corby (${r.chips.join(', ')})`);

  console.log('\n--- picking one sticks ---');
  await page.locator('.placechip', { hasText: 'Corby' }).click();
  await page.waitForTimeout(200);
  check(await page.inputValue('#f-addr') === 'Corby', 'tapping Corby fills the field');
  r = await type('NN17 2DA');
  check(await page.inputValue('#f-addr') === 'Corby', 'a picked town is not overwritten by retyping the postcode');

  console.log('\n--- unambiguous districts still auto-fill ---');
  for (const [pc, want] of [['NN16 8AA', 'Kettering'], ['IP22 4AB', 'Diss'],
                            ['NR34 9QB', 'Beccles'], ['BT1 5GS', 'Belfast']]) {
    await page.fill('#f-addr', '');
    await page.evaluate(() => document.querySelector('#f-addr')
      .dispatchEvent(new Event('input', { bubbles: true })));
    r = await type(pc);
    check(r.town === want, `${pc} -> ${JSON.stringify(r.town)} (want ${want})`);
    check(r.chips.length === 0, `${pc} shows no chips (one answer only)`);
  }

  console.log('\n--- edges ---');
  await page.fill('#f-addr', '');
  await page.evaluate(() => document.querySelector('#f-addr')
    .dispatchEvent(new Event('input', { bubbles: true })));
  r = await type('PE28 0AA');          // 53 localities — the worst case
  check(r.chips.length === 10, `PE28 caps the list at 10 chips (got ${r.chips.length})`);
  const more = await page.textContent('#placeChips');
  check(/43 more/.test(more), 'PE28 says how many are not shown');

  r = await type('ZZ99 9ZZ');
  check(r.town === '' && r.chips.length === 0, 'junk postcode offers nothing');

  await page.fill('#f-addr', 'Whitton Estate');
  await page.waitForTimeout(150);
  r = await type('NN16 8AA');
  check(await page.inputValue('#f-addr') === 'Whitton Estate', 'hand-typed town survives an auto-fillable postcode');

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  await browser.close();
  server.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
