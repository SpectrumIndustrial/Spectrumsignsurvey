/* Where things live. Resolved from this file so the tests run from any
   directory, on any machine, without an env var. */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');   // repo root
const APP = path.join(ROOT, 'index.html');
const OUT = path.join(ROOT, 'tests', '.out');       // scratch: git-ignored

fs.mkdirSync(OUT, { recursive: true });

/* Playwright is told where Chromium lives by PLAYWRIGHT_BROWSERS_PATH in the
   dev container; on a machine where it isn't set, fall back to the browser
   `npx playwright install chromium` puts on the path. */
const EXECUTABLE = fs.existsSync('/opt/pw-browsers/chromium')
  ? '/opt/pw-browsers/chromium' : undefined;

module.exports = { ROOT, APP, OUT, EXECUTABLE };
