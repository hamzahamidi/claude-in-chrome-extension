// Where the host listens, in a module with no side effects.
//
// Separate from the host itself because the host is an entry point: Chrome
// executes it and it must always run. Anything that needs only the path should
// not have to import a file whose job is to start a server.
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Kept out of /tmp so another user cannot pre-create it, and out of the
 * project so it survives a rebuild.
 */
export function endpointPath(): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\chrome-live-${process.env['USERNAME'] ?? 'user'}`;
  }
  const base = process.env['XDG_RUNTIME_DIR'] ?? join(homedir(), '.cache');
  return join(base, 'chrome-live', 'extension.sock');
}
