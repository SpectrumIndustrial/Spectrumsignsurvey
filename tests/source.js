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

/* ---- taps ----

   Every tap in the app goes through one delegated handler: a chain of
   `t.closest("[data-x]")` tests, first match wins, with about twenty
   attribute names sharing one flat namespace. That is how a button carrying
   data-open="0" for "open all the walk-round zones" ended up matching the
   branch that opens an *area* — no error, no failing test, it just quietly
   went to the wrong screen and changed which area was active.

   Nothing here can tell two meanings apart by reading the source, so instead
   the counts are pinned. Adding a tap that reuses an existing action name
   changes its emit count and fails this check, which forces the question
   "is this the same action, or have I just collided with one?" to be asked
   at the right moment. Changing the numbers is fine — doing it deliberately
   is the whole point. */
const chain = src.slice(src.indexOf('document.addEventListener("click", function (e) {'));
const claims = [...chain.matchAll(/closest\("\[data-([a-z]+)\]"\)/g)].map(m => m[1]);
const emitted = {};
for (const m of src.matchAll(/data-([a-z]+)=/g)) emitted[m[1]] = (emitted[m[1]] || 0) + 1;

/* action name -> how many places in the source emit it */
const ACTIONS = {
  add: 1, addsign: 1, del: 1, delsign: 1, delsurvey: 1, editnote: 8, filter: 1,
  find: 2, findpart: 1, gtab: 1, guideadd: 1, open: 2, openphoto: 1,
  opensurvey: 1, partdel: 1, pdel: 1, pick: 2, place: 1, preset: 1, q: 2, set: 1
};
/* Carried on elements but never a tap: payload the handlers read, state the
   stylesheet matches on, and the fields with their own input listeners. */
const NOT_ACTIONS = { cat: 2, d: 2, photocard: 2, pnote: 1, qset: 1, qty: 1, s: 6, sign: 1, tab: 5, v: 1 };

const twice = [...new Set(claims)].filter(k => claims.filter(c => c === k).length > 1);
ck(twice.length === 0, 'no action is claimed by two branches'
   + (twice.length ? ` — ${twice.join(', ')}` : ` (${claims.length} branches)`));

const dead = [...new Set(claims)].filter(k => !emitted[k]);
ck(dead.length === 0, 'no branch waits for an action nothing emits'
   + (dead.length ? ` — ${dead.join(', ')}` : ''));

const unclaimed = [...new Set(claims)].filter(k => !(k in ACTIONS));
const missing = Object.keys(ACTIONS).filter(k => claims.indexOf(k) < 0);
ck(unclaimed.length === 0 && missing.length === 0,
   'the action list matches the branches that exist'
   + (unclaimed.length ? ` — unlisted: ${unclaimed.join(', ')}` : '')
   + (missing.length ? ` — listed but gone: ${missing.join(', ')}` : ''));

const drifted = Object.keys(ACTIONS).filter(k => emitted[k] !== ACTIONS[k]);
ck(drifted.length === 0, 'each action is emitted from the places it was emitted from'
   + (drifted.length
      ? ` — ${drifted.map(k => `data-${k} now ${emitted[k]}, expected ${ACTIONS[k]}`).join('; ')}`
        + '\n       if that is a new tap, give it its own name; if it is the same'
        + '\n       action in another place, update the count in tests/source.js'
      : ''));

const stray = Object.keys(emitted).filter(k => !(k in ACTIONS) && !(k in NOT_ACTIONS));
ck(stray.length === 0, 'every data- attribute is either an action or listed as not one'
   + (stray.length ? ` — ${stray.map(k => 'data-' + k).join(', ')}` : ''));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
