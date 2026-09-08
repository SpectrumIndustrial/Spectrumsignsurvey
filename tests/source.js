/* Static checks on index.html — no browser, runs in milliseconds.

   Two things in the app fail *silently* rather than throwing, so nothing in a
   click-through test notices them:

   - isoBadge() falls back to the category's default glyph when an icon key
     doesn't resolve, so a typo in a TPL row just makes one sign quietly look
     like another.
   - the preset resolver skips any sign name it can't find, so a typo in a
     preset quietly gives that area one sign fewer.

   Both are one wrong character, and both are invisible on screen unless you
   already know what you're looking for. Reading the source is the only way to
   catch them reliably. */
const fs = require('fs');
const { APP } = require('./lib/paths');

const src = fs.readFileSync(APP, 'utf8');
let pass = 0, fail = 0;
const ck = (ok, msg) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); };

/* ---- the sign library ---- */
const tplBlock = src.slice(src.indexOf('var TPL = ['), src.indexOf('\n];', src.indexOf('var TPL = [')));
const rows = tplBlock.split('\n').filter(l => l.startsWith('["'));
ck(rows.length > 20, `${rows.length} signs in TPL`);

const signNames = rows.map(l => JSON.parse(l.replace(/,$/, ''))[1]);
ck(new Set(signNames).size === signNames.length, 'no two signs share a name');

/* ---- icon keys ---- */
const iconBlock = src.slice(src.indexOf('var SIGN_ICONS = {'), src.indexOf('\n};', src.indexOf('var SIGN_ICONS = {')));
const defined = new Set([...iconBlock.matchAll(/\n  ([a-z]+): /g)].map(m => m[1]));
const referenced = rows.map(l => JSON.parse(l.replace(/,$/, ''))[5]).filter(Boolean);

/* "extinguisher" is deliberately absent from SIGN_ICONS: the fire-equipment
   badge draws an extinguisher as its own default, so that key is meant to
   fall through to it. Every other key must resolve. */
const DELIBERATE_FALLBACK = ['extinguisher'];
const unresolved = [...new Set(referenced)]
  .filter(k => !defined.has(k) && !DELIBERATE_FALLBACK.includes(k));
ck(unresolved.length === 0, 'every icon key a sign asks for is defined'
   + (unresolved.length
      ? ` — ${unresolved.join(', ')} resolves to nothing, so those signs\n       silently draw their category's default glyph instead`
      : ` (${defined.size} icons, ${new Set(referenced).size} keys in use)`));

const unused = [...defined].filter(k => !referenced.includes(k));
ck(unused.length === 0, 'no icon is defined but unused'
   + (unused.length ? ` — orphaned: ${unused.join(', ')}` : ''));

/* ---- presets ---- */
const preBlock = src.slice(src.indexOf('var PRESETS = ['), src.indexOf('\n];', src.indexOf('var PRESETS = [')));
const preNames = [...preBlock.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m => m[1])
  .filter(n => n.length > 12 && !/^(Reception|Office|Warehouse|Workshop|Loading bay|Plant room|Chemical store|Canteen|External areas|Other area)$/.test(n));
const strays = [...new Set(preNames)].filter(n => !signNames.includes(n));
ck(strays.length === 0, `every sign a preset names exists in the sign library`
   + (strays.length ? ` — not found: ${strays.map(s => JSON.stringify(s)).join(', ')}` : ` (${new Set(preNames).size} checked)`));

/* ---- zones stay contiguous, or the guide repeats its headings ---- */
const zones = rows.map(l => JSON.parse(l.replace(/,$/, ''))[0]);
const firstSeen = {}; let broken = null;
zones.forEach((z, i) => {
  if (!(z in firstSeen)) firstSeen[z] = i;
  else if (zones[i - 1] !== z) broken = z;
});
ck(!broken, 'the signs in each zone sit together in the list' + (broken ? ` — ${broken} is split` : ''));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
