// Registering the native messaging host with the browsers on this machine.
//
// Chrome will only launch a host declared in a manifest at a fixed path, and will
// only connect an extension whose id appears in that manifest's allowed_origins.
// Both halves are why this exists: the id is pinned by the key in the
// extension's manifest, and this manifest has to be written into each browser's
// own directory.
import { chmodSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// Reverse DNS on the GitHub namespace rather than a domain, because that is the
// ownership actually demonstrable here. Chrome reads this string by exact match
// from a file on the user's disk, so changing it breaks every existing install.
export const HOST_NAME = 'io.github.hamzahamidi.yoke';

/**
 * Derived from the public key pinned in the extension's manifest. Chrome computes
 * it the same way, so a mismatch means the extension was built with a different
 * key and native messaging will refuse to connect.
 */
export const EXTENSION_ID = 'oceljemfocgfidhhdlbojkbkmlbfclna';

export interface HostManifest {
  name: string;
  description: string;
  path: string;
  type: 'stdio';
  allowed_origins: string[];
}

export interface InstallResult {
  written: Array<[browser: string, file: string]>;
  skipped: Array<[browser: string, reason: string]>;
  extensionId: string;
  hostName: string;
  platform: NodeJS.Platform;
}

/**
 * Where each browser looks for host manifests.
 *
 * Per-user directories only. A system-wide install needs root and would register
 * the host for every account on the machine, which is not something a command
 * line should arrange on someone's behalf.
 */
export function browserDirs(
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): Array<[browser: string, dir: string]> {
  if (platform === 'darwin') {
    const support = join(home, 'Library', 'Application Support');
    return [
      ['Chrome', join(support, 'Google', 'Chrome', 'NativeMessagingHosts')],
      ['Chrome Beta', join(support, 'Google', 'Chrome Beta', 'NativeMessagingHosts')],
      ['Chromium', join(support, 'Chromium', 'NativeMessagingHosts')],
      ['Edge', join(support, 'Microsoft Edge', 'NativeMessagingHosts')],
      ['Brave', join(support, 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts')],
    ];
  }
  if (platform === 'win32') {
    // Windows declares this in the registry rather than on disk, so the caller
    // is told what to do instead of being silently skipped.
    return [];
  }
  const config = process.env['XDG_CONFIG_HOME'] ?? join(home, '.config');
  return [
    ['Chrome', join(config, 'google-chrome', 'NativeMessagingHosts')],
    ['Chromium', join(config, 'chromium', 'NativeMessagingHosts')],
    ['Edge', join(config, 'microsoft-edge', 'NativeMessagingHosts')],
    ['Brave', join(config, 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts')],
  ];
}

/**
 * Writes a launcher that runs the host with an absolute node path.
 *
 * Chrome executes the manifest's `path` directly, and a Chrome started from the
 * Dock or Finder inherits a minimal PATH: on macOS typically
 * /usr/bin:/bin:/usr/sbin:/sbin. A `#!/usr/bin/env node` shebang therefore fails
 * to resolve for anyone whose node came from Homebrew, nvm, asdf or Volta, which
 * is nearly everyone, and the failure surfaces only as "Native host has exited".
 * Baking in the interpreter that is running this install removes the guess.
 */
function writeLauncher(hostPath: string, nodePath: string = process.execPath): string {
  if (process.platform === 'win32') {
    // Chrome runs .bat through the shell, and %~dp0 keeps it relocatable.
    const batch = join(dirname(hostPath), 'yoke-host.bat');
    writeFileSync(batch, `@echo off\r\n"${nodePath}" "${hostPath}" %*\r\n`);
    return batch;
  }
  const launcher = join(dirname(hostPath), 'yoke-host.sh');
  writeFileSync(launcher, `#!/bin/sh\nexec "${nodePath}" "${hostPath}" "$@"\n`, { mode: 0o755 });
  chmodSync(launcher, 0o755);
  return launcher;
}

export const manifestFor = (hostPath: string): HostManifest => ({
  name: HOST_NAME,
  description: 'yoke native messaging host',
  path: hostPath,
  type: 'stdio',
  allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
});

/**
 * Writes the manifest into every browser directory whose parent already exists.
 *
 * Only where the browser is actually installed: creating a Brave directory on a
 * machine with no Brave leaves litter for something that is not there.
 */
export function install({
  hostPath,
  platform = process.platform,
  home = homedir(),
}: { hostPath: string; platform?: NodeJS.Platform; home?: string }): InstallResult {
  if (!existsSync(hostPath)) {
    throw new Error(`the host script is not at ${hostPath}`);
  }
  try { chmodSync(hostPath, 0o755); } catch { /* read-only install; reported below */ }

  // The manifest points at a launcher rather than at the host, so Chrome never
  // has to find node on a PATH it does not have.
  const launcher = writeLauncher(hostPath);
  const body = `${JSON.stringify(manifestFor(launcher), null, 2)}\n`;
  const written: InstallResult['written'] = [];
  const skipped: InstallResult['skipped'] = [];

  for (const [browser, dir] of browserDirs(platform, home)) {
    if (!existsSync(dirname(dir))) { skipped.push([browser, 'not installed']); continue; }
    try {
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${HOST_NAME}.json`);
      writeFileSync(file, body);
      written.push([browser, file]);
    } catch (failure) {
      skipped.push([browser, failure instanceof Error ? failure.message : String(failure)]);
    }
  }
  return { written, skipped, extensionId: EXTENSION_ID, hostName: HOST_NAME, platform };
}

export function uninstall({
  platform = process.platform,
  home = homedir(),
}: { platform?: NodeJS.Platform; home?: string } = {}): { removed: Array<[string, string]> } {
  const removed: Array<[string, string]> = [];
  for (const [browser, dir] of browserDirs(platform, home)) {
    const file = join(dir, `${HOST_NAME}.json`);
    try { unlinkSync(file); removed.push([browser, file]); } catch { /* not there */ }
  }
  return { removed };
}
