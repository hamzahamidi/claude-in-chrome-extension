// Checks every link in the chain, and says which one is broken.
//
// There are four things between a tool call and a tab, and any of them can be
// the reason nothing works: the build, the host registration, Chrome having
// spawned the host, and the extension answering. A single "not reachable" tells
// you none of that, so this reports each link separately and names the next
// action rather than leaving it to be guessed.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { browserDirs, EXTENSION_ID, HOST_NAME, type HostManifest } from './install.js';
import { endpointPath } from './native-host.js';
import { ask } from './socket-client.js';

export interface Check {
  ok: boolean;
  label: string;
  detail: string;
  /** What to do about it, when there is something to do. */
  fix?: string;
}

const extensionRoot = (): string => join(dirname(fileURLToPath(import.meta.url)), '..');

/** Is the compiled host actually on disk, and executable by Chrome? */
function checkBuild(): Check {
  const host = join(dirname(fileURLToPath(import.meta.url)), 'native-host.js');
  if (!existsSync(host)) {
    return { ok: false, label: 'build', detail: `${host} is missing`, fix: 'npm run build' };
  }
  // Chrome executes this path directly, so a missing execute bit is fatal and
  // silent: Chrome simply never starts the host.
  const executable = (statSync(host).mode & 0o111) !== 0;
  return executable
    ? { ok: true, label: 'build', detail: 'the host is built and executable' }
    : { ok: false, label: 'build', detail: 'the host is not executable', fix: `chmod +x ${host}` };
}

/**
 * Is the host registered, and does the registration agree with this build?
 *
 * Two ways this goes wrong quietly: the manifest points at a path that no longer
 * exists, or it allowlists a different extension id, in which case Chrome
 * refuses the connection without telling anybody why.
 */
function checkRegistration(): Check {
  const dirs = browserDirs();
  if (dirs.length === 0) {
    return {
      ok: true,
      label: 'registration',
      detail: 'this platform registers the host in the registry, which is not checked here',
    };
  }

  const found: string[] = [];
  const problems: string[] = [];
  for (const [browser, dir] of dirs) {
    const file = join(dir, `${HOST_NAME}.json`);
    if (!existsSync(file)) { continue; }
    let manifest: HostManifest;
    try {
      manifest = JSON.parse(readFileSync(file, 'utf8')) as HostManifest;
    } catch {
      problems.push(`${browser}: the manifest is not valid JSON`);
      continue;
    }
    if (!existsSync(manifest.path)) {
      problems.push(`${browser}: points at ${manifest.path}, which does not exist`);
      continue;
    }
    if (!manifest.allowed_origins.includes(`chrome-extension://${EXTENSION_ID}/`)) {
      problems.push(`${browser}: allowlists ${manifest.allowed_origins.join(', ')}, not ${EXTENSION_ID}`);
      continue;
    }
    found.push(browser);
  }

  if (problems.length > 0) {
    return { ok: false, label: 'registration', detail: problems.join('; '), fix: 'chrome-live install' };
  }
  if (found.length === 0) {
    return {
      ok: false,
      label: 'registration',
      detail: 'no browser has the host registered',
      fix: 'chrome-live install',
    };
  }
  return { ok: true, label: 'registration', detail: `registered for ${found.join(', ')}` };
}

/**
 * Has Chrome started the host?
 *
 * The socket exists only while the host runs, and Chrome only runs it while the
 * extension holds the port open. So an absent socket almost always means the
 * extension is not loaded or its service worker is asleep.
 */
function checkSocket(): Check {
  const socket = endpointPath();
  if (process.platform === 'win32') {
    return { ok: true, label: 'host running', detail: 'named pipes cannot be probed by existence; the ping below is the real check' };
  }
  return existsSync(socket)
    ? { ok: true, label: 'host running', detail: socket }
    : {
      ok: false,
      label: 'host running',
      detail: `no socket at ${socket}`,
      fix: `load ${join(extensionRoot(), 'extension')} at chrome://extensions with Developer mode on`,
    };
}

/** Does the extension itself answer? */
async function checkPing(): Promise<Check> {
  try {
    const { extension } = await ask('ping', {}, { timeoutMs: 3_000 });
    return { ok: true, label: 'extension', detail: `answered, version ${extension}` };
  } catch (failure) {
    return {
      ok: false,
      label: 'extension',
      detail: failure instanceof Error ? failure.message : String(failure),
      fix: 'open chrome://extensions and check the service worker is running',
    };
  }
}

/**
 * The acceptance test for the whole project: every tab, not a group's worth.
 *
 * Reported as a count and as how many sit outside any group, because the second
 * number is the one a tab-group-scoped bridge cannot see at all.
 */
async function checkTabs(): Promise<Check> {
  try {
    const { tabs } = await ask('listTabs', {}, { timeoutMs: 5_000 });
    const ungrouped = tabs.filter((tab) => tab.groupId === -1).length;
    return {
      ok: tabs.length > 0,
      label: 'tabs visible',
      detail: `${tabs.length} tab(s), ${ungrouped} of them in no tab group`,
    };
  } catch (failure) {
    return {
      ok: false,
      label: 'tabs visible',
      detail: failure instanceof Error ? failure.message : String(failure),
    };
  }
}

/** Runs the checks in order, stopping the remote ones once a local one fails. */
export async function doctor(): Promise<Check[]> {
  const checks: Check[] = [checkBuild(), checkRegistration(), checkSocket()];
  // No point asking the extension anything when the socket is not even there:
  // the answer would be the same timeout dressed up as two failures.
  if (checks.every((check) => check.ok)) {
    checks.push(await checkPing());
    if (checks[checks.length - 1]?.ok) { checks.push(await checkTabs()); }
  }
  return checks;
}

export function render(checks: Check[]): string {
  const lines = checks.map((check) => {
    const mark = check.ok ? 'ok  ' : 'FAIL';
    const fix = check.ok || !check.fix ? '' : `\n        fix: ${check.fix}`;
    return `${mark}  ${check.label.padEnd(14)} ${check.detail}${fix}`;
  });
  const broken = checks.find((check) => !check.ok);
  lines.push('');
  lines.push(broken
    ? `Not working yet. The first thing to fix is "${broken.label}".`
    : 'Working. Every link in the chain answered.');
  return `${lines.join('\n')}\n`;
}
