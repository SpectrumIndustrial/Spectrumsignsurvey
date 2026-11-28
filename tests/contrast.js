/* The week this was written, three faults shipped that no test could see and
   no screenshot made obvious unless you happened to look at that screen in
   that theme: the top bar kept white text after its background turned light,
   so the site name and the icons disappeared; three rules asked for a colour
   that was never defined and silently drew nothing; and the preset tiles were
   painted the same colour as the sheet they sat on, so in the dark they were
   nine invisible rectangles.

   All three are the same fault — something is drawn the colour of the thing
   behind it — and a browser reports none of them. So this suite walks the app
   in both themes and measures: every run of text against the surface it sits
   on, and every panel, card and button against the surface behind it.        */
const { chromium } = require('playwright');
const { EXECUTABLE } = require('./lib/paths');
const { serve } = require('./lib/serve');

const PORT = +(process.env.PORT || 8977);
let pass = 0, fail = 0;
const ck = (ok, msg) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); };

/* 4.5:1 is the readable-body-text floor everyone uses; 3:1 is the floor for
   large text, which is what the headings and the big figures are. */
const TEXT_MIN = 4.5, BIG_MIN = 3.0, BIG_PX = 20;

const PROBE = `(() => {
  const lum = c => {
    const [r, g, b] = c.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); });
    return .2126 * r + .7152 * g + .0722 * b;
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const parse = s => {
    const m = String(s).match(/rgba?\\(([^)]+)\\)/); if (!m) return null;
    const p = m[1].split(',').map(parseFloat);
    return { rgb: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 };
  };
  /* Flatten a stack of possibly-translucent fills down onto one solid colour,
     the way the screen does, so a bar at 72% opacity is judged as it looks. */
  const over = (top, under) => top.a >= 1 ? top.rgb : top.rgb.map((v, i) => v * top.a + under[i] * (1 - top.a));
  /* The "from" argument decides where the walk starts. Text sits on its OWN element's fill
     when it has one (white on a blue button is white on blue, not white on the
     page), so for text the walk starts at the element; for a panel, it starts
     at the parent, because the question there is what is BEHIND the panel. */
  const surfaceOf = (el, from) => {
    const stack = [];
    let n = from === 'self' ? el : el.parentElement;
    while (n) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; }
      n = n.parentElement;
    }
    let base = [255, 255, 255];
    const pageBg = parse(getComputedStyle(document.documentElement).backgroundColor)
                || parse(getComputedStyle(document.body).backgroundColor);
    if (pageBg && pageBg.a >= 1) base = pageBg.rgb;
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  };
  const shown = el => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return false;
    if (r.bottom < 0 || r.top > innerHeight * 4) return false;
    return true;
  };
  const name = el => (el.id ? '#' + el.id : '.' + String(el.className).split(' ')[0]);

  const dim = [], lost = [];

  /* Text: only elements that hold their own words, so a wrapper is not blamed
     for its children's colours. */
  document.querySelectorAll('body *').forEach(el => {
    if (!shown(el)) return;
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!own) return;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color); if (!fg || fg.a < .5) return;
    const bg = surfaceOf(el, 'self');
    const r = ratio(over(fg, bg), bg);
    const size = parseFloat(cs.fontSize) || 16;
    const big = size >= ${BIG_PX} || (size >= 16 && +cs.fontWeight >= 600);
    const floor = big ? ${BIG_MIN} : ${TEXT_MIN};
    if (r < floor) dim.push(name(el) + ' ' + r.toFixed(2) + ':1 (' + Math.round(size) + 'px, needs ' + floor + ') "' + el.textContent.trim().slice(0, 22) + '"');
  });

  /* Surfaces: a panel that is the colour of the thing behind it, with no
     border and no shadow to give it an edge, is not there at all. */
  document.querySelectorAll('button,.card,.item,.prow,.preset,.chip,.fchip,.kpi,.stat,.photocard,.zoneblock,.areacard,.sheet,input,select,textarea').forEach(el => {
    if (!shown(el)) return;
    const cs = getComputedStyle(el);
    const c = parse(cs.backgroundColor); if (!c || c.a === 0) return;
    const behind = surfaceOf(el);
    const face = over(c, behind);
    if (ratio(face, behind) > 1.03) return;
    const edged = ['Top','Right','Bottom','Left'].some(s => {
      if (parseFloat(cs['border' + s + 'Width']) <= 0 || cs['border' + s + 'Style'] === 'none') return false;
      const bc = parse(cs['border' + s + 'Color']);
      return bc && bc.a > .2 && ratio(over(bc, behind), behind) > 1.15;
    });
    if (edged || (cs.boxShadow && cs.boxShadow !== 'none')) return;
    lost.push(name(el) + ' "' + (el.textContent || el.value || '').trim().slice(0, 22) + '"');
  });

  return { dim: [...new Set(dim)], lost: [...new Set(lost)] };
})()`;

(async () => {
  const server = await serve(PORT);
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });

  const seen = [];
  const look = async label => {
    await page.waitForTimeout(350);
    seen.push([label, await page.evaluate(PROBE)]);
  };

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(1000);

  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') { await page.click('#btnTheme'); await page.waitForTimeout(400); }
    const t = s => theme + '/' + s;

    if (theme === 'light') {
      await look(t('setup sheet'));
      await page.fill('#f-site', 'B & M, L24 8RJ');
      await page.fill('#f-by', 'S. Yorke');
      await page.click('#saveSetup'); await page.waitForTimeout(500);
    } else {
      await page.click('.nav button[data-tab="survey"]'); await page.waitForTimeout(500);
      if (await page.locator('#backAreas').count()) {
        await page.click('#backAreas'); await page.waitForTimeout(400);
      }
    }

    await look(t('areas'));
    await page.click('#addArea'); await page.waitForSelector('#areaName');
    await look(t('add-area sheet'));
    await page.fill('#areaName', theme === 'light' ? 'Entrance gate' : 'Mezzanine');
    await page.click('#makeArea'); await page.waitForTimeout(600);
    await look(t('area, empty'));
    await page.click('#addSet'); await page.waitForTimeout(500);
    await look(t('sign-set sheet'));
    await page.locator('[data-addset]').first().click(); await page.waitForTimeout(700);
    await page.locator('.item').first().locator('[data-v="Missing"]').click();
    await page.waitForTimeout(400);
    await look(t('area with signs'));
    await page.click('#backAreas'); await page.waitForTimeout(400);

    await page.click('.nav button[data-tab="parts"]'); await page.waitForTimeout(800);
    await page.fill('#q', 'fire exit'); await page.waitForTimeout(800);
    await look(t('parts'));
    await page.click('.nav button[data-tab="photos"]'); await page.waitForTimeout(500);
    await look(t('photos'));
    await page.click('.nav button[data-tab="report"]'); await page.waitForTimeout(800);
    await look(t('report'));
    await page.click('.nav button[data-tab="guide"]'); await page.waitForTimeout(700);
    for (const g of ['signs', 'spec', 'checks', 'regs']) {
      await page.click(`[data-gtab="${g}"]`);
      await look(t('guide/' + g));
    }
  }

  console.log(`--- ${seen.length} screens, both themes ---`);
  const dim = seen.filter(([, r]) => r.dim.length);
  ck(dim.length === 0, 'every word is readable against what it is written on'
     + (dim.length ? ' — ' + dim.map(([n, r]) => n + ': ' + r.dim.slice(0, 3).join('; ')).join(' | ') : ''));
  const lost = seen.filter(([, r]) => r.lost.length);
  ck(lost.length === 0, 'nothing is painted the colour of the thing behind it'
     + (lost.length ? ' — ' + lost.map(([n, r]) => n + ': ' + r.lost.slice(0, 4).join('; ')).join(' | ') : ''));

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log(errs.length ? 'ERRORS:\n' + [...new Set(errs)].join('\n') : 'no console errors');
  await browser.close();
  server.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
