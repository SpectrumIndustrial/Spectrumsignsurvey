/* A one-file static server for index.html. The app is a single file, so this
   is all the hosting a test needs. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./paths');

/* The published app is served with a strict Content-Security-Policy that
   forbids outbound requests. Serving the same headers here is what proved the
   postcode look-up had to work offline. */
const CSP = "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; "
          + "connect-src 'self' blob: data:; img-src 'self' data: blob:;";

function serve(port, opts) {
  const withCsp = opts && opts.csp;
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      const f = path.join(ROOT, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
      fs.readFile(f, (err, data) => {
        if (err) { res.writeHead(404); return res.end('not found'); }
        const h = { 'Content-Type': 'text/html; charset=utf-8' };
        if (withCsp) h['Content-Security-Policy'] = CSP;
        res.writeHead(200, h);
        res.end(data);
      });
    });
    s.listen(port, () => resolve(s));
  });
}

module.exports = { serve, CSP };
