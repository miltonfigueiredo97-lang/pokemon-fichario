// CI guard: every asset version in index.html must match sw.js (BUILD_VERSION,
// CACHE_NAME and the app shell list), otherwise phones keep stale code.
import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');
const fail = (msg) => { console.error('build check: ' + msg); process.exitCode = 1; };

const build = (sw.match(/BUILD_VERSION = '([^']+)'/) || [])[1];
if (!build) fail('BUILD_VERSION not found in sw.js');
const cacheName = (sw.match(/CACHE_NAME = '([^']+)'/) || [])[1] || '';
if (cacheName !== 'pokemon-binder-v' + String(build).replace(/\./g, '-')) fail(`CACHE_NAME ${cacheName} does not match build ${build}`);
const htmlBuild = (html.match(/POKEMON_BINDER_BUILD='V([^']+)'/) || [])[1];
if (htmlBuild !== build) fail(`index.html build ${htmlBuild} != sw.js ${build}`);

const assets = [...html.matchAll(/(?:href|src)="(\/[^"?]+\.(?:css|js))\?v=([^"]+)"/g)];
if (!assets.length) fail('no versioned assets in index.html');
for (const [, path, v] of assets) {
  if (v !== build) fail(`${path}?v=${v} in index.html (expected ${build})`);
  if (!sw.includes(`'${path}?v=${build}'`)) fail(`${path}?v=${build} missing from sw.js app shell`);
  if (!fs.existsSync('.' + path)) fail(`${path} does not exist`);
}
if (!process.exitCode) console.log(`build check ok: ${build}, ${assets.length} assets`);
