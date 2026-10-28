/* Test photographs, drawn rather than committed.

   The suites need real JPEGs — the app re-encodes them through a canvas on
   export, so a one-pixel placeholder wouldn't exercise anything. Committing
   several megabytes of sample photos to the repo to get that is a poor trade,
   so they are rendered once with the browser that's already running and cached
   in tests/.out. Delete that directory to regenerate them. */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { OUT, EXECUTABLE } = require('./paths');

/* Enough shape and colour variation that JPEG can't compress it to nothing:
   a flat fill would encode to a few KB and hide any size problem. */
const SCENE = `<style>
  html,body{margin:0;height:100%;overflow:hidden;background:#20242b}
  .s{position:absolute;inset:0}
  .sky{background:linear-gradient(#8fb3d9,#dfe8f0 55%,#c9c2b4)}
  .wall{position:absolute;left:0;right:0;bottom:0;height:58%;
        background:repeating-linear-gradient(0deg,#9c9186 0 38px,#8b8177 38px 42px),
                   repeating-linear-gradient(90deg,rgba(0,0,0,.16) 0 2px,transparent 2px 96px)}
  .sign{position:absolute;left:26%;top:22%;width:30%;height:34%;background:#0b7a3b;
        border:14px solid #fff;box-shadow:0 18px 40px rgba(0,0,0,.45)}
  .sign i{position:absolute;inset:18%;background:#fff;
          clip-path:polygon(50% 0,100% 38%,78% 38%,78% 100%,22% 100%,22% 38%,0 38%)}
  .pipe{position:absolute;right:8%;top:0;bottom:0;width:9%;
        background:linear-gradient(90deg,#5a616b,#aeb6c1 40%,#3f454d)}
  .grain{position:absolute;inset:0;opacity:.22;
         background-image:radial-gradient(#fff 1px,transparent 1px),radial-gradient(#000 1px,transparent 1px);
         background-size:7px 7px,11px 11px;background-position:0 0,3px 4px}
</style>
<div class="s sky"></div><div class="wall"></div><div class="pipe"></div>
<div class="sign"><i></i></div><div class="s grain"></div>`;

async function ensurePhotos() {
  const files = {
    landscape: path.join(OUT, 'photo-landscape.jpg'),
    portrait: path.join(OUT, 'photo-portrait.jpg')
  };
  if (fs.existsSync(files.landscape) && fs.existsSync(files.portrait)) return files;

  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  for (const [name, size] of [['landscape', [1600, 1200]], ['portrait', [1200, 1600]]]) {
    const ctx = await browser.newContext({ viewport: { width: size[0], height: size[1] } });
    const page = await ctx.newPage();
    await page.setContent(SCENE);
    await page.waitForTimeout(120);
    fs.writeFileSync(files[name], await page.screenshot({ type: 'jpeg', quality: 88 }));
    await ctx.close();
  }
  await browser.close();
  return files;
}

/* Read one as a Buffer, generating it first if this is a clean checkout. */
async function photo(kind) {
  const files = await ensurePhotos();
  return fs.readFileSync(files[kind || 'landscape']);
}

module.exports = { ensurePhotos, photo };
