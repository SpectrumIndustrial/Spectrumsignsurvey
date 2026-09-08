# Tests

The app is a single `index.html` with no build step, so these tests do what a
person would do: serve that file, open it in a real browser, tap through it,
and check what comes out.

## Running them

```
npm install                              # once
npx playwright install chromium          # once — the browser itself
npm test                                 # all five suites
```

One suite on its own:

```
npm run test:signs
```

A failure prints the check that failed and exits non-zero. Anything the run
produced — spreadsheets, PDFs, the generated test photographs — is left in
`tests/.out/`, which is git-ignored. Delete that directory to start clean.

## The suites

| Suite | What it covers |
| --- | --- |
| `source.js` | Reads `index.html` without a browser. Catches the mistakes that fail *silently*: an icon key that resolves to nothing, a preset naming a sign that doesn't exist, a zone split across the list. |
| `regression.js` | The whole survey: areas, sign statuses, notes, the catalogue, custom products and signs, photos, undo, renaming and duplicating areas, the theme, and both exports. |
| `postcode.js` | The offline postcode look-up, served with the same Content-Security-Policy as the published app so it can't quietly fall back to the network. |
| `custom-part-link.js` | Custom parts carry size and material into the spreadsheet, and the link from a line back to its photo. |
| `signs.js` | Every preset resolves to the signs it names, and every sign draws a badge that stays inside its own box. |

## Test photographs

The photo tests need real JPEGs — the app re-encodes them through a canvas on
export, so a placeholder wouldn't exercise anything. Rather than commit several
megabytes of sample photos, `tests/lib/photos.js` draws them with the browser
that's already running and caches them in `tests/.out/`.

## Adding a check

Put it in the suite it belongs to and follow the shape already there: a `ck(...)`
or `step(...)` call with a sentence describing what should be true, not what the
code does. When you fix a bug, add the check that would have caught it — every
check in `source.js` exists because something got through the browser tests.
