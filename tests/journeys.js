/* The paths the other suites never walk.

   Measured rather than guessed: the handlers in index.html were listed and
   checked against what the tests actually click, and these were the ones
   nothing touched. Most are destructive or near-destructive — deleting a
   sign, an area, a whole survey, clearing a note — which is exactly the set
   you least want untested. */
const { chromium } = require('playwright');
const { EXECUTABLE } = require('./lib/paths');
const { serve } = require('./lib/serve');
const { photo } = require('./lib/photos');

const PORT = +(process.env.PORT || 8899);
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
  await page.waitForTimeout(350);
  await page.click('#addArea');
  await page.waitForSelector('[data-preset]');
  await page.locator('.preset', { hasText: /^Workshop/ }).click();
  await page.waitForTimeout(450);

  console.log('--- the catalogue list ---');
  await page.click('.nav button[data-tab="parts"]');
  await page.waitForTimeout(300);
  await page.fill('#q', 'sign');
  await page.waitForTimeout(800);
  const firstPage = await page.locator('.prow').count();
  ck(await page.locator('#more').count() === 1, `"Show more" appears with ${firstPage} results on screen`);
  await page.click('#more');
  await page.waitForTimeout(500);
  const secondPage = await page.locator('.prow').count();
  ck(secondPage > firstPage, `it loads more (${firstPage} then ${secondPage})`);

  await page.click('#clrQ');
  await page.waitForTimeout(400);
  ck(await page.inputValue('#q') === '', 'the clear button empties the search');

  console.log('\n--- the size and material filters ---');
  await page.fill('#q', 'fire exit');
  await page.waitForTimeout(700);
  const unfiltered = await page.locator('.prow').count();
  await page.locator('[data-filter="mat"]').click();
  await page.waitForTimeout(450);
  ck(await page.locator('#pf').count() === 1, 'the material picker opens with its own search');
  /* The picker only offers materials these results actually come in, and the
     first row is "Any material" — which clears rather than sets. Take whatever
     the catalogue offers rather than naming one. */
  const real = page.locator('#plist [data-pick]:not([data-pick=""])');
  const allMats = await real.count();
  ck(allMats > 0, `${allMats} materials offered for this search`);
  const pick = await real.first().getAttribute('data-pick');
  await page.fill('#pf', pick.slice(0, 2));
  await page.waitForTimeout(400);
  const narrowed = await real.count();
  ck(narrowed > 0 && narrowed <= allMats, `typing "${pick.slice(0, 2)}" narrows them (${allMats} to ${narrowed})`);
  await page.locator(`#plist [data-pick="${pick}"]`).click();
  await page.waitForTimeout(600);
  ck(await page.locator('.fchip.active').count() === 1, `${pick} shows as the active filter`);
  ck(await page.locator('#clrF').count() === 1, 'and a way to clear it appears');
  const filtered = await page.locator('.prow').count();
  const label = await page.textContent('.count');
  ck(filtered > 0, `products are still listed (${filtered} shown, "${label.trim()}")`);
  await page.click('#clrF');
  await page.waitForTimeout(500);
  ck(await page.locator('.fchip.active').count() === 0, 'clearing the filters removes it');
  ck(await page.locator('.prow').count() === unfiltered, 'and the full list comes back');

  console.log('\n--- picking a product against a sign, then changing your mind ---');
  await page.click('.nav button[data-tab="survey"]');
  await page.waitForTimeout(350);
  await page.locator('.item').first().locator('.chip.miss').click();
  await page.waitForTimeout(250);
  await page.locator('.item').first().locator('[data-find]').click();
  await page.waitForTimeout(600);
  ck(await page.locator('#clearRef').count() === 1, 'the Parts tab says which sign it is finding for');
  await page.click('#clearRef');
  await page.waitForTimeout(350);
  ck(await page.locator('#clearRef').count() === 0, 'and that can be cleared without adding anything');

  console.log('\n--- adding a sign from the library, then removing one ---');
  await page.click('.nav button[data-tab="survey"]');
  await page.waitForTimeout(350);
  const signsBefore = await page.locator('.item').count();
  await page.click('#addSign');
  await page.waitForTimeout(450);
  ck(await page.locator('#sf').count() === 1, 'the sign library opens with a search');
  await page.fill('#sf', 'assembly');
  await page.waitForTimeout(400);
  await page.locator('[data-addsign]').first().click();
  await page.waitForTimeout(500);
  ck(await page.locator('.item').count() === signsBefore + 1, 'a sign can be added from the library');

  await page.locator('.item').last().locator('[data-delsign]').click();
  await page.waitForTimeout(450);
  ck((await page.textContent('#sheet')).indexOf('Remove this sign') >= 0, 'removing one asks first');
  await page.click('#cfNo');
  await page.waitForTimeout(400);
  ck(await page.locator('.item').count() === signsBefore + 1, 'saying no keeps it');
  await page.locator('.item').last().locator('[data-delsign]').click();
  await page.waitForTimeout(450);
  await page.locator('#sheet .btn.danger-solid, #sheet .btn-primary').first().click();
  await page.waitForTimeout(500);
  ck(await page.locator('.item').count() === signsBefore, 'saying yes removes it');

  console.log('\n--- completing an area, and reopening it ---');
  for (let i = 0; i < await page.locator('.item').count(); i++) {
    await page.locator('.item').nth(i).locator('.chip.ok').click();
    await page.waitForTimeout(90);
  }
  await page.locator('#s-survey .btn-primary').last().click();
  await page.waitForTimeout(500);
  ck(await page.locator('.areacard.done').count() === 1, 'the area shows as done');
  await page.locator('.areacard').first().click();
  await page.waitForTimeout(400);
  ck(await page.locator('#reopenArea').count() === 1, 'a finished area offers to be reopened');
  await page.click('#reopenArea');
  await page.waitForTimeout(450);
  ck(await page.locator('#reopenArea').count() === 0, 'and reopening it takes it back off the list');

  console.log('\n--- area notes ---');
  await page.locator('.note-add').first().click();
  await page.waitForTimeout(450);
  await page.fill('#nt', 'Roller shutter was down, revisit the back wall');
  await page.click('#saveNote');
  await page.waitForTimeout(450);
  ck((await page.textContent('#s-survey')).indexOf('Roller shutter') >= 0, 'a note can be written');
  await page.locator('.note-shown').first().click();
  await page.waitForTimeout(450);
  ck(await page.locator('#delNote').count() === 1, 'an existing note offers to be cleared');
  await page.click('#delNote');
  await page.waitForTimeout(450);
  ck((await page.textContent('#s-survey')).indexOf('Roller shutter') < 0, 'and clearing it removes it');

  console.log('\n--- more than one survey on the phone ---');
  await page.click('#btnSurveys');
  await page.waitForTimeout(450);
  await page.click('#newSurvey');
  await page.waitForTimeout(600);
  await page.fill('#f-site', 'Second site');
  await page.fill('#f-by', 'S. Yorke');
  await page.click('#saveSetup');
  await page.waitForTimeout(500);
  await page.click('#btnSurveys');
  await page.waitForTimeout(600);
  const rows = await page.locator('.surveyrow').count();
  ck(rows === 2, `both surveys are listed (${rows})`);

  await page.locator('[data-opensurvey]').last().click();
  await page.waitForTimeout(800);
  ck((await page.textContent('#ctxLabel')).length > 0, 'switching back to the first one works');
  await page.click('#btnSurveys');
  await page.waitForTimeout(600);
  ck((await page.textContent('.surveyrow.cur')).indexOf('AMR GP Ltd') >= 0,
     'and the list shows which one is open');

  console.log('\n--- deleting a survey ---');
  await page.locator('.surveyrow').filter({ hasText: 'Second site' }).locator('[data-delsurvey]').click();
  await page.waitForTimeout(500);
  ck((await page.textContent('#sheet')).indexOf('Delete') >= 0, 'deleting one asks first');
  await page.click('#cfNo');
  await page.waitForTimeout(500);
  ck(await page.locator('.surveyrow').count() === 2, 'saying no keeps it');
  await page.locator('.surveyrow').filter({ hasText: 'Second site' }).locator('[data-delsurvey]').click();
  await page.waitForTimeout(500);
  await page.locator('#sheet .btn.danger-solid, #sheet .btn-primary').first().click();
  await page.waitForTimeout(800);
  ck(await page.locator('.surveyrow').count() === 1, 'saying yes removes it');

  console.log('\n--- deleting an area ---');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.click('.nav button[data-tab="survey"]');
  await page.waitForTimeout(400);
  /* the app may already be inside the area rather than on the list of them */
  if (await page.locator('#backAreas').count()) {
    await page.click('#backAreas');
    await page.waitForTimeout(400);
  }
  ck(await page.locator('.areacard').count() === 1, 'the first survey still has its area');
  await page.locator('.areacard').first().click();
  await page.waitForTimeout(400);
  await page.click('#renameArea');
  await page.waitForTimeout(450);
  ck(await page.locator('#delArea').count() === 1, 'the area menu offers to delete it');
  await page.click('#delArea');
  await page.waitForTimeout(500);
  await page.locator('#sheet .btn.danger-solid, #sheet .btn-primary').first().click();
  await page.waitForTimeout(600);
  ck(await page.locator('.areacard').count() === 0, 'the area is gone');

  console.log('\n--- the walk-round opens and closes ---');
  await page.click('.nav button[data-tab="guide"]');
  await page.waitForTimeout(450);
  await page.click('[data-gtab="checks"]');
  await page.waitForTimeout(500);
  await page.click('#zoneAll');
  await page.waitForTimeout(350);
  ck(await page.locator('#zoneList details[open]').count() === 11, 'Open all opens every zone');
  ck((await page.textContent('#zoneAll')) === 'Close all', 'and the button turns round');
  await page.click('#zoneAll');
  await page.waitForTimeout(350);
  ck(await page.locator('#zoneList details[open]').count() === 0, 'Close all closes them');
  ck(await page.locator('.nav button[data-tab="survey"].on').count() === 0,
     'and it does not quietly navigate somewhere else');

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no console errors');
  await browser.close(); server.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
