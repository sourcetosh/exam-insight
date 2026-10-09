// Zero-dependency static server for the Exam Insight prototype.
// Usage: node serve.mjs [port]   (default 5310)
// If .cert/key.pem and .cert/cert.pem exist, HTTPS is also served on port + 1.
// Phones on the LAN need the HTTPS address: browsers only allow the camera on
// https:// or localhost. The certificate is self-signed, so the phone shows a
// warning once ("Advanced → Proceed").
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(fileURLToPath(new URL('.', import.meta.url)));
const port = Number(process.argv[2] || process.env.PORT || 5310);
const httpsPort = port + 1;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

async function handler(req, res) {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (path.endsWith('/')) path += 'index.html';
    if (path.startsWith('/.cert')) { res.writeHead(403).end(); return; }
    const file = normalize(join(root, path));
    if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) {
      res.writeHead(403).end();
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
}

function lanAddresses() {
  return Object.values(networkInterfaces()).flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'))
    .map((a) => a.address);
}

createServer(handler).listen(port, () => {
  console.log(`Exam Insight running at http://localhost:${port}`);
  for (const ip of lanAddresses()) console.log(`  LAN (no camera): http://${ip}:${port}`);
});

const keyFile = join(root, '.cert', 'key.pem');
const certFile = join(root, '.cert', 'cert.pem');
if (existsSync(keyFile) && existsSync(certFile)) {
  createHttpsServer({ key: readFileSync(keyFile), cert: readFileSync(certFile) }, handler)
    .on('error', (e) => console.log(`HTTPS not started: ${e.message}`))
    .listen(httpsPort, () => {
      for (const ip of lanAddresses()) console.log(`  LAN with camera: https://${ip}:${httpsPort}  (self-signed: tap Advanced → Proceed once)`);
    });
}
