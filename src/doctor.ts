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

import { browserDirs, EXTENSION_IDS, HOST_NAME, type HostManifest } from './install.js';
import { endpointPath } from './socket-path.js';
import { ask } from './socket-client.js';

export interface Check {
  ok: boolean;
  label: string;
  detail: string;
  /** What to do about it, when there is something to do. */
  fix?: string;
}

const extensionRoot = (): string => join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Is the compiled host on disk?
 *
 * Only that. It used to also require an execute bit on native-host.js, which was
 * wrong and made a plain rebuild look broken: Chrome runs the launcher, and the
 * launcher runs `node native-host.js`, so node reads this file rather than
 * executing it. tsc writes 644 and that is correct. The execute bit that matters
 * belongs to the launcher, and the registration check below tests that one.
 */
function checkBuild(): Check {
  const host = join(dirname(fileURLToPath(import.meta.url)), 'native-host.js');
  return existsSync(host)
    ? { ok: true, label: 'build', detail: 'the host is built' }
    : { ok: false, label: 'build', detail: `${host} is missing`, fix: 'npm run build' };
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
    // This is the file Chrome executes, so a missing execute bit is fatal and
    // silent: Chrome simply never starts the host.
    if ((statSync(manifest.path).mode & 0o111) === 0) {
      problems.push(`${browser}: its launcher ${manifest.path} is not executable`);
      continue;
    }
    // The launcher names an absolute interpreter precisely so Chrome does not
    // need a PATH. If that interpreter has since moved, Chrome fails with
    // nothing but "Native host has exited", so it is checked here instead.
    const launcher = readFileSync(manifest.path, 'utf8');
    const interpreter = /exec "([^"]+)"|"([^"]+)" "/.exec(launcher);
    const node = interpreter?.[1] ?? interpreter?.[2];
    if (node && !existsSync(node)) {
      problems.push(`${browser}: its launcher runs ${node}, which no longer exists`);
      continue;
    }
    const missing = EXTENSION_IDS.filter(
      (id) => !manifest.allowed_origins.includes(`chrome-extension://${id}/`));
    if (missing.length > 0) {
      problems.push(
        `${browser}: allowlists ${manifest.allowed_origins.join(', ')}, which is missing ${missing.join(', ')}`);
      continue;
    }
    found.push(browser);
  }

  if (problems.length > 0) {
    return { ok: false, label: 'registration', detail: problems.join('; '), fix: 'yoke install' };
  }
  if (found.length === 0) {
    return {
      ok: false,
      label: 'registration',
      detail: 'no browser has the host registered',
      fix: 'yoke install',
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
    const { extension, attached } = await ask('ping', {}, { timeoutMs: 3_000 });
    // Reported because a tab left attached wears Chrome's debugging bar and
    // refuses DevTools, and nothing used to say how many were in that state.
    const held = attached?.length ?? 0;
    const holding = held === 0
      ? ''
      : `, holding ${held} tab(s): ${attached.join(', ')}. Release them with release_tab.`;
    return { ok: true, label: 'extension', detail: `answered, version ${extension}${holding}` };
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
