/* Every preset must resolve to the signs it names, in order, and every TPL
   zone must stay contiguous so the guide's zone headings don't repeat. */
const { chromium } = require('playwright');
const { EXECUTABLE } = require('./lib/paths');
const { serve } = require('./lib/serve');
const PORT = +(process.env.PORT || 8861);
let pass=0,fail=0;const ck=(o,m)=>{o?pass++:fail++;console.log(`  ${o?'ok  ':'FAIL'} ${m}`);};
(async()=>{const server=await serve(PORT);
const b=await chromium.launch({executablePath: EXECUTABLE});
const ctx=await b.newContext({viewport:{width:390,height:844}});
const page=await ctx.newPage();
const errs=[];page.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
page.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE '+m.text());});
await page.goto(`http://localhost:${PORT}/`);await page.waitForTimeout(900);
await page.fill('#f-site','Preset check');await page.fill('#f-by','S. Yorke');
await page.click('#saveSetup');await page.waitForTimeout(300);

// Every preset: create the area, read back the sign names on the card list
const expect = {
 'Reception':['No smoking / e-cigarettes sign',"HSE 'Health and Safety Law' poster","Employers' Liability Insurance certificate",'Fire action notice','First aid location & first aider info','Directional fire exit (running man)','Push bar to open / keep clear','Extinguisher ID (CO2 / foam / water)','Fire alarm call point'],
 'Workshop':['Head protection must be worn','Eye protection must be worn','Hearing protection must be worn','Safety footwear / hi-vis must be worn','Moving machinery / crush hazard','Emergency stop / isolation point','Directional fire exit (running man)','Extinguisher ID (CO2 / foam / water)','Fire alarm call point'],
 'External areas':['No smoking / e-cigarettes sign','Visitor sign-in / induction sign','CCTV in operation','Fire assembly point'],
 'Chemical store':['Hazardous / flammable material','No smoking / no naked flames','Compressed gas storage','Extinguisher ID (CO2 / foam / water)'],
 'Plant room':['Danger — electric shock risk','No unauthorised access','Extinguisher ID (CO2 / foam / water)'],
 'Warehouse':['Forklift operating area','Pedestrian route','Racking maximum load','Directional fire exit (running man)','Fire door — keep shut','Push bar to open / keep clear','Extinguisher ID (CO2 / foam / water)','Fire alarm call point'],
 'Office':["HSE 'Health and Safety Law' poster","Employers' Liability Insurance certificate",'Fire action notice','First aid location & first aider info','Directional fire exit (running man)','Fire door — keep shut','Extinguisher ID (CO2 / foam / water)','Fire alarm call point'],
 'Loading bay':['Vehicle movement / reversing','Pedestrian crossing point','No smoking / e-cigarettes sign','Fire assembly point'],
 'Canteen':['No smoking','First aid location & first aider info','Directional fire exit (running man)'],
};
console.log('--- presets resolve to the signs they name ---');
const names = await page.evaluate(()=>{
  return null; // presets are inside the IIFE; drive them through the UI instead
});
let idx = 0;
const labels = ['Reception','Office','Warehouse','Workshop','Loading bay','Plant room','Chemical store','Canteen','External areas'];
for (const label of labels) {
  await page.click('#addArea'); await page.waitForSelector('[data-preset]');
  await page.locator('.preset', { hasText: new RegExp('^'+label) }).first().click();
  await page.waitForTimeout(350);
  const got = await page.locator('.item .item-name').allTextContents();
  const want = expect[label];
  ck(JSON.stringify(got)===JSON.stringify(want), `${label}: ${got.length} signs` +
     (JSON.stringify(got)===JSON.stringify(want)?'':`\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`));
  await page.click('#backAreas'); await page.waitForTimeout(250);
}
console.log('\n--- guide: zones stay contiguous, every sign has a badge ---');
await page.click('.nav button[data-tab="guide"]'); await page.waitForTimeout(450);
const zones = await page.locator('#guideList .zone-head .eyebrow').allTextContents();
ck(zones.length===new Set(zones).size, `${zones.length} zone headings, none repeated`);
const cards = await page.locator('#guideList .iso').count();
ck(cards===32, `32 signs rendered with a badge (got ${cards})`);
const empty = await page.evaluate(()=>[...document.querySelectorAll('#guideList .iso svg')]
  .filter(s=>!s.children.length).map(s=>s.parentElement.getAttribute('title')));
ck(empty.length===0, `no badge renders empty` + (empty.length?' — '+empty.join(', '):''));

/* A mistyped icon key doesn't throw: isoBadge quietly falls back to the
   category's default glyph, so two different signs end up looking identical.
   23 is the number of distinct badges the 32 signs should draw — 18 pictograms
   plus the five category defaults, shared by the signs Spectrum's own artwork
   doesn't cover (fire door, push bar, emergency stop, vehicle movement, permit
   to work) and by the statutory notices. If a key stops resolving, this drops. */
const distinct = await page.evaluate(()=>new Set([...document.querySelectorAll('#guideList .iso')]
  .map(e=>e.innerHTML)).size);
ck(distinct===23, `32 signs draw 23 distinct badges (got ${distinct})`);

/* Screen-space check: getBBox() is in the element's own user space, so it says
   nothing about where a transformed glyph actually lands. Compare painted
   rectangles against the badge's own box instead. */
const spill = await page.evaluate(()=>{
  const bad=[];
  document.querySelectorAll('#guideList .iso svg').forEach((svg,i)=>{
    const box = svg.getBoundingClientRect();
    const name = svg.parentElement.getAttribute('title')+' #'+i;
    svg.querySelectorAll('path,rect,circle,g').forEach(el=>{
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) return;
      const pad = 0.6/32*box.width;
      if (r.left < box.left-pad || r.top < box.top-pad ||
          r.right > box.right+pad || r.bottom > box.bottom+pad)
        bad.push(name+' '+el.tagName+' '+[r.left-box.left, r.top-box.top, r.width, r.height].map(v=>v.toFixed(1)));
    });
  });
  return bad;
});
ck(spill.length===0, `no glyph is painted outside its badge` + (spill.length?'\n       '+spill.join('\n       '):''));
console.log(`\n${pass} passed, ${fail} failed`);
console.log(errs.length?'ERRORS:\n'+errs.join('\n'):'no console errors');
await b.close();server.close();process.exit(fail||errs.length?1:0);})();
