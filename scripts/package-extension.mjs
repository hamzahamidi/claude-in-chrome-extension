// Builds the zip the Chrome Web Store wants, into dist/store/.
//
// The store takes a zip of the extension's CONTENTS, not of a folder containing
// them, which is the usual way this goes wrong: a zip with extension/ at the top
// is rejected for having no manifest at its root.
//
// No archiver dependency, because the project ships none: this shells out to the
// zip tool each platform already has.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const manifest = JSON.parse(readFileSync(join(root, 'extension', 'manifest.json'), 'utf8'));

if (manifest.version !== version) {
  throw new Error(
    `extension/manifest.json says ${manifest.version} and package.json says ${version}. `
    + 'Run npm run check:versions.');
}

const outDir = join(root, 'dist', 'store');
const zipPath = join(outDir, `yoke-${version}.zip`);
mkdirSync(outDir, { recursive: true });
rmSync(zipPath, { force: true });

const source = join(root, 'extension');
if (process.platform === 'win32') {
  // -Path with \* takes the contents rather than the directory itself.
  execFileSync('powershell', [
    '-NoProfile', '-Command',
    `Compress-Archive -Path '${source}\\*' -DestinationPath '${zipPath}' -Force`,
  ], { stdio: 'inherit' });
} else {
  execFileSync('zip', ['-qr', zipPath, '.', '-x', '*.DS_Store'], { cwd: source, stdio: 'inherit' });
}

// A zip whose manifest is not at the root is the failure worth catching here
// rather than in the dashboard, which says only that the package is invalid.
const listing = process.platform === 'win32'
  ? execFileSync('powershell', ['-NoProfile', '-Command',
    `Add-Type -A System.IO.Compression.FileSystem; `
    + `[IO.Compression.ZipFile]::OpenRead('${zipPath}').Entries.FullName`], { encoding: 'utf8' })
  : execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' });

const entries = listing.split('\n').map((line) => line.trim()).filter(Boolean);
if (!entries.includes('manifest.json')) {
  throw new Error(`manifest.json is not at the root of the zip. Entries: ${entries.join(', ')}`);
}

console.log(`dist/store/yoke-${version}.zip`);
console.log(`  ${statSync(zipPath).size} bytes, ${entries.length} entries`);
console.log(`  manifest.json at the root: yes, version ${manifest.version}`);
