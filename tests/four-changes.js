/* The four changes asked for after the last round on site:

   1. "Mark the rest OK"      — settle the remaining signs in an area in one tap
   2. discontinued hidden     — out of the catalogue results unless asked for
   3. no legal line on cards  — the citation is reference, not a decision
   4. unassessed areas        — an area with nothing checked carries no
                                compliance figures, but keeps its photos,
                                products and notes in both exports            */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { OUT, EXECUTABLE } = require('./lib/paths');
const { serve } = require('./lib/serve');
const { photo } = require('./lib/photos');
const { strings } = require('./lib/xlsx');
const pdf = require('./lib/pdf');

const PORT = +(process.env.PORT || 8921);
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
  await page.waitForSelector('#saveSetup');
  await page.fill('#f-site', 'Brantham Mill');
  await page.fill('#f-by', 'S. Yorke');
  await page.click('#saveSetup');
  await page.waitForTimeout(400);

  /* ============ 1. Mark the rest OK ============ */
  console.log('\n--- "mark the rest OK" ---');
  await page.click('#addArea');
  await page.waitForSelector('[data-preset]');
  await page.locator('.preset', { hasText: /^Workshop/ }).click();
  await page.waitForTimeout(500);

  let signs = await page.locator('#s-survey .item').count();
  ck(signs >= 4, `the Workshop preset brought ${signs} signs`);

  let lbl = await page.textContent('#allOk');
  ck(/Mark the remaining \d+ as OK/.test(lbl), `the button offers to settle the rest — "${lbl.trim()}"`);
  ck(new RegExp('remaining ' + signs + ' ').test(lbl), 'and counts every sign while none is checked');

  /* one real finding first, so we can prove it survives */
  await page.locator('.item').nth(1).locator('[data-v="Missing"]').click();
  await page.waitForTimeout(400);
  const missingName = (await page.locator('.item').nth(1).locator('.item-name').textContent()).trim();
  lbl = await page.textContent('#allOk');
  ck(new RegExp('remaining ' + (signs - 1) + ' ').test(lbl),
     `the count drops to ${signs - 1} once one sign is recorded`);

  await page.click('#allOk');
  await page.waitForTimeout(500);
  const states = await page.locator('.item').evaluateAll(
    els => els.map(e => [e.querySelector('.item-name').textContent.trim(), e.dataset.s]));
  ck(states.every(s => s[1]), 'every sign in the area now has a status');
  ck(states.filter(s => s[1] === 'OK').length === signs - 1, `${signs - 1} of them were marked OK`);
  const stillMissing = states.find(s => s[0] === missingName);
  ck(stillMissing && stillMissing[1] === 'Missing', 'the sign recorded as Missing was left alone');
  ck(await page.locator('#allOk').count() === 0, 'and the button goes away with nothing left to settle');

  /* undo puts back exactly what it changed */
  ck(/marked OK/.test(await page.textContent('#toastMsg')), 'the toast says what happened');
  await page.locator('#toastAct button').click();
  await page.waitForTimeout(500);
  const after = await page.locator('.item').evaluateAll(
    els => els.map(e => [e.querySelector('.item-name').textContent.trim(), e.dataset.s]));
  ck(after.filter(s => !s[1]).length === signs - 1, 'undo puts the signs it marked back to not checked');
  const kept = after.find(s => s[0] === missingName);
  ck(kept && kept[1] === 'Missing', 'and does not touch the one that was already recorded');
  ck(await page.locator('#allOk').count() === 1, 'the button is offered again');

  /* settle it for real, then add one sign the surveyor has not reached — that
     one is the only sign on site that is genuinely "not yet checked" */
  await page.click('#allOk');
  await page.waitForTimeout(500);
  await page.click('#addSign');
  await page.waitForTimeout(500);
  await page.fill('#sf', 'assembly');
  await page.waitForTimeout(400);
  await page.locator('[data-addsign]').first().click();
  await page.waitForTimeout(600);
  ck(await page.locator('.item').count() === signs + 1, 'a tenth sign is added and left unchecked');
  ck(/remaining 1 as OK/.test(await page.textContent('#allOk')),
     'the button offers to settle just that one');
  signs++;

  /* ============ 3. no legal line on the sign cards ============ */
  console.log('\n--- the legal line is off the cards ---');
  ck(await page.locator('#s-survey .item .legal').count() === 0,
     'no sign card carries the regulation line');
  ck(await page.locator('#s-survey .item .item-name').count() === signs,
     'the cards themselves are all still there');
  await page.click('.nav button[data-tab="guide"]');
  await page.waitForTimeout(500);
  await page.click('[data-gtab="signs"]');
  await page.waitForTimeout(400);
  ck(await page.locator('#s-guide .legal').count() > 0,
     'the Guide still lists the regulation against each sign');
  await page.click('.nav button[data-tab="survey"]');
  await page.waitForTimeout(400);

  /* ============ 2. discontinued hidden by default ============ */
  console.log('\n--- discontinued products ---');
  await page.click('.nav button[data-tab="parts"]');
  await page.waitForTimeout(700);
  await page.fill('#q', 'welding mask');
  await page.waitForTimeout(600);
  let cnt = await page.textContent('#count');
  ck(/\b1\b\s*product found/.test(cnt.replace(/\s+/g, ' ')), `one live match shown — "${cnt.split('\n')[0]}"`);
  ck(await page.locator('#results .disc').count() === 0, 'no discontinued line is in the results');
  ck(await page.locator('#discSw').count() === 1, 'the count line says some are held back');
  ck(/1 discontinued line hidden — show/.test(await page.textContent('#discSw')),
     'and says how many, with a way to see them');

  await page.click('#discSw');
  await page.waitForTimeout(500);
  cnt = (await page.textContent('#count')).replace(/\s+/g, ' ');
  ck(/\b2\b products found/.test(cnt), 'showing them brings the count to 2');
  ck(await page.locator('#results .disc').count() === 1, 'the discontinued line is labelled as such');
  ck(/Hide 1 discontinued line/.test(await page.textContent('#discSw')), 'and can be put away again');
  await page.click('#discSw');
  await page.waitForTimeout(500);
  ck(await page.locator('#results .disc').count() === 0, 'putting it away hides it again');

  /* a search where everything is discontinued still says so */
  await page.fill('#q', 'Stack correctly');
  await page.waitForTimeout(600);
  cnt = (await page.textContent('#count')).replace(/\s+/g, ' ');
  ck(/\b0\b products found/.test(cnt), 'a search of nothing but discontinued lines finds none');
  ck(/1 discontinued line hidden — show/.test(await page.textContent('#discSw')),
     'but offers them rather than leaving you thinking it does not exist');

  /* a full part number is never held back */
  await page.fill('#q', '0012');
  await page.waitForTimeout(600);
  const firstRow = await page.locator('#results .prow').first().textContent();
  ck(/0012/.test(firstRow) && /Wear welding mask/.test(firstRow),
     'typing a discontinued part number in full puts it first, not away');
  ck(await page.locator('#results .prow').first().locator('.disc').count() === 1,
     'and it is still flagged as discontinued where it sits');
  await page.fill('#q', '');
  await page.waitForTimeout(500);

  /* ============ 4. an area with nothing checked ============ */
  console.log('\n--- an area nobody checked a sign in ---');
  await page.click('.nav button[data-tab="survey"]');
  await page.waitForTimeout(400);
  await page.click('#backAreas');
  await page.waitForTimeout(400);
  await page.click('#addArea');
  await page.waitForSelector('[data-preset]');
  await page.locator('.preset', { hasText: /^Reception/ }).click();
  await page.waitForTimeout(500);
  const refName = (await page.textContent('#ctxLabel')).trim();
  const refSigns = await page.locator('#s-survey .item').count();
  ck(refSigns > 0, `the second area came with ${refSigns} signs, none of them checked`);

  /* photo + a part against the photo — what these areas are actually for */
  await page.click('.nav button[data-tab="photos"]');
  await page.waitForTimeout(400);
  const jpg = await photo('landscape');
  await page.setInputFiles('#fileIn', { name: 'ref.jpg', mimeType: 'image/jpeg', buffer: jpg });
  await page.waitForTimeout(900);
  await page.locator('.photocard input').first().fill('Panel above the door, customer asked for a quote');
  await page.waitForTimeout(400);
  await page.locator('[data-findpart]').first().click();
  await page.waitForTimeout(800);
  await page.fill('#q', 'fire exit');
  await page.waitForTimeout(700);
  await page.locator('#results .prow').first().click();
  await page.waitForTimeout(800);
  const refPart = (await page.locator('#s-photos .pc-parts').first().textContent()).trim();
  ck(refPart.length > 0, `a product is pinned to its photo — "${refPart}"`);
  const refPn = (/\d{4,}/.exec(refPart) || [''])[0];
  ck(refPn.length >= 4, `with a part number to follow through the exports (${refPn})`);

  /* the working screen is unchanged: it still counts every sign */
  await page.click('.nav button[data-tab="survey"]');
  await page.waitForTimeout(400);
  await page.click('#backAreas');
  await page.waitForTimeout(500);
  const shMeta = await page.textContent('.sh-meta');
  ck(new RegExp('of ' + (signs + refSigns) + ' signs checked').test(shMeta),
     `the Areas screen still counts all ${signs + refSigns} signs while you work — "${shMeta.trim()}"`);

  /* the report leaves the unchecked area out of the figures */
  await page.click('.nav button[data-tab="report"]');
  await page.waitForTimeout(700);
  const rep = (await page.textContent('#s-report')).replace(/\s+/g, ' ');
  const totals = await page.locator('.totals .totalrow > div').evaluateAll(
    els => els.map(e => [e.querySelector('.tl').textContent, e.querySelector('.tn').textContent]));
  const areaTot = totals.find(x => x[0] === 'areas');
  ck(areaTot && areaTot[1] === '2', `both areas are still counted in the totals (${areaTot && areaTot[1]})`);
  ck(/1 area has no signs checked/.test(rep),
     'and the report says one of them carries no compliance figures');
  const refCard = await page.locator('.areacard.compact', { hasText: refName }).textContent();
  ck(/No signs checked/.test(refCard), `the unchecked area reads "No signs checked" — "${refCard.replace(/\s+/g, ' ').trim()}"`);
  ck(!/0 of \d+ checked/.test(rep), 'nowhere does the report say "0 of N checked"');
  ck(/no signs checked, so/.test(rep), 'and it says plainly why that area sits outside the figures');

  /* ---- PDF ---- */
  console.log('\n--- the two documents ---');
  await page.click('#expPdf');
  await page.waitForSelector('#fSave', { timeout: 40000 });
  await page.evaluate(() => document.getElementById('fSave').click());
  await page.waitForTimeout(1600);
  const pbuf = Buffer.from(await page.evaluate(() => window.__grabbed));
  fs.writeFileSync(path.join(OUT, 'four-changes.pdf'), pbuf);
  const st = pdf.structure(pbuf), lines = pdf.text(pbuf), joined = lines.join('\n');
  ck(st.isPdf && st.hasEof, `a readable PDF came out (${st.pages} pages, ${(st.bytes / 1024).toFixed(0)} KB)`);
  ck(joined.indexOf(refName) >= 0, 'the unchecked area is still in the report');
  ck(lines.some(l => /Photos and products/.test(l)),
     'headed "Photos and products" rather than "0/N checked"');
  ck(joined.indexOf('Panel above the door') >= 0, 'its photo description is there');
  ck(/recorded for photos and products only/.test(joined),
     'and the summary band explains what was left out of the percentage');
  const notChecked = lines.filter(l => l === 'Not checked').length;
  ck(notChecked === 1, `one "Not checked" row — the one sign nobody reached (${notChecked}), `
     + 'not the nine in the area that was never a sign survey');
  ck(joined.indexOf(refPn) >= 0, 'the product pinned to its photo is named under the photo');

  /* ---- XLSX ---- */
  await page.evaluate(() => { document.getElementById('overlay').classList.remove('on'); window.__grabbed = null; });
  await page.click('.nav button[data-tab="report"]');
  await page.waitForTimeout(400);
  await page.click('#expXlsx');
  await page.waitForSelector('#fSave', { timeout: 40000 });
  await page.evaluate(() => document.getElementById('fSave').click());
  await page.waitForTimeout(1600);
  const xbuf = Buffer.from(await page.evaluate(() => window.__grabbed));
  fs.writeFileSync(path.join(OUT, 'four-changes.xlsx'), xbuf);
  const sheet = strings(xbuf).join('\n');
  ck(sheet.indexOf(refName) >= 0, 'the unchecked area appears on the order list');
  ck(/1 area sign-surveyed · 1 recorded for photos and products only/.test(sheet),
     'the header says which areas were sign-surveyed');
  const m = /(\d+) not yet checked/.exec(sheet);
  ck(m && m[1] === '1',
     `"not yet checked" counts the one sign nobody reached${m ? ' (' + m[1] + ')' : ' — absent'}, `
     + 'not the nine in the unsurveyed area');
  ck(sheet.indexOf(refPn) >= 0, 'the product from the unsurveyed area is on the order list');
  ck(sheet.indexOf('Panel above the door') >= 0, 'and its photo note is carried through');

  /* ---- and a survey that is nothing but photos and parts ---- */
  console.log('\n--- a visit where no sign was checked at all ---');
  await page.evaluate(() => { document.getElementById('overlay').classList.remove('on'); });
  await page.click('#btnSurveys');
  await page.waitForTimeout(600);
  await page.click('#newSurvey');
  await page.waitForTimeout(900);
  await page.fill('#f-site', 'Photo visit only');
  await page.fill('#f-by', 'S. Yorke');
  await page.click('#saveSetup');
  await page.waitForTimeout(500);
  await page.click('#addArea');
  await page.waitForSelector('[data-preset]');
  await page.locator('.preset', { hasText: /^Reception/ }).click();
  await page.waitForTimeout(600);
  await page.click('.nav button[data-tab="photos"]');
  await page.waitForTimeout(400);
  await page.setInputFiles('#fileIn', { name: 'only.jpg', mimeType: 'image/jpeg', buffer: jpg });
  await page.waitForTimeout(900);
  await page.locator('.photocard input').first().fill('Reception desk panel');
  await page.waitForTimeout(400);
  await page.click('.nav button[data-tab="report"]');
  await page.waitForTimeout(700);
  const only = (await page.textContent('#s-report')).replace(/\s+/g, ' ');
  ck(/1 area has no signs checked/.test(only), 'the report says the one area carries no figures');
  ck(!/0 of \d+ checked/.test(only), 'and still never says "0 of N checked"');

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no console errors');
  await browser.close();
  server.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
