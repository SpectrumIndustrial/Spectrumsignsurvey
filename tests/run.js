/* Runs every suite and fails the whole thing if any of them fails.

   Each suite is a separate process on its own port, so one crashing can't
   take the others with it, and a failure names the suite it came from. */
const { spawn } = require('child_process');
const path = require('path');
const { ensurePhotos } = require('./lib/photos');

const SUITES = [
  ['Sign library and presets (source)', 'source.js'],
  ['Survey, exports and undo', 'regression.js'],
  ['Postcode look-up', 'postcode.js'],
  ['Custom parts and photo links', 'custom-part-link.js'],
  ['Sign presets and badges', 'signs.js']
];

function run(file) {
  return new Promise(resolve => {
    const p = spawn(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
    p.on('close', code => resolve(code));
  });
}

(async () => {
  /* Draw the test photographs once up front rather than letting four suites
     race to create the same files. */
  await ensurePhotos();

  const failed = [];
  for (const [title, file] of SUITES) {
    console.log('\n── ' + title + '  (' + file + ')');
    if (await run(file) !== 0) failed.push(title);
  }

  console.log('\n' + '─'.repeat(52));
  if (failed.length) {
    console.log('FAILED: ' + failed.join(', '));
    process.exit(1);
  }
  console.log('All ' + SUITES.length + ' suites passed.');
})();
