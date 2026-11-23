# Spectrum Industrial — signage survey

An on-site signage compliance survey for phones. A surveyor walks a site area by
area, records which required signs are present, missing or damaged, links
products from the Spectrum catalogue, takes photographs, and exports a PDF
report and an order spreadsheet for the office.

The whole app is **`index.html`** — one file, no build step, no dependencies,
no server. Open it and it runs. Surveys are stored in the browser on that
device; nothing is uploaded.

## Working on it

Edit `index.html`, then:

```
npm install                       # once
npx playwright install chromium   # once
npm test
```

`npm test` drives the app in a real browser and checks it end to end — see
[`tests/README.md`](tests/README.md). The same suites run on every push.

## Layout

```
index.html                the app: markup, styles, logic, the product
                          catalogue and the offline postcode table
tests/                    the test suites and how to run them
.github/workflows/        CI
```
