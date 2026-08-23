// Renders the store screenshot from docs/store/screenshot.html.
//
// The store requires at least one screenshot at exactly 1280x800 or 640x400, so
// the source is HTML in the repository rather than an image someone made once:
// the copy can be corrected without redrawing anything, and the result is
// reproducible by whoever ships the next version.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const page = join(root, 'docs', 'store', 'screenshot.html');
const out = join(root, 'docs', 'store', 'screenshot-1280x800.png');

const chromes = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];
const chrome = chromes.find((path) => existsSync(path));
if (chrome === undefined) {
  throw new Error(`no Chrome found. Looked in:\n  ${chromes.join('\n  ')}`);
}

execFileSync(chrome, [
  '--headless', '--disable-gpu', '--hide-scrollbars',
  '--window-size=1280,800', `--screenshot=${out}`, `file://${page}`,
], { stdio: 'ignore' });

// Checked rather than trusted: the store rejects anything that is not exactly
// 1280x800 or 640x400, and a wrong window-size fails silently as a resized image.
const png = readFileSync(out);
const width = png.readUInt32BE(16);
const height = png.readUInt32BE(20);
if (width !== 1280 || height !== 800) {
  throw new Error(`rendered ${width}x${height}, and the store wants exactly 1280x800`);
}
console.log(`docs/store/screenshot-1280x800.png\n  ${png.length} bytes, ${width}x${height}`);
