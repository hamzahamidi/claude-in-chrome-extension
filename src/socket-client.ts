// Talking to the extension through the host's socket.
//
// Every call here is allowed to fail with a reason. The extension is optional
// infrastructure: it may not be installed, or Chrome may not have started the
// host yet, and a caller has to be able to tell that apart from a real error.
import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';

import { endpointPath } from './native-host.js';
import {
  PROTOCOL,
  type ArgsOf,
  type OperationName,
  type ResultOf,
  type SocketReply,
} from './protocol.js';

const DEFAULT_TIMEOUT_MS = 15_000;

/** The extension cannot be reached. Never a bug on its own. */
export class ExtensionUnavailable extends Error {
  override readonly name = 'ExtensionUnavailable';
}

const isSocketReply = (value: unknown): value is SocketReply =>
  typeof value === 'object' && value !== null && 'ok' in value;

/**
 * One request over the socket, one reply.
 *
 * The host owns request matching, so this only has to write a line and read the
 * first one back.
 */
export function ask<K extends OperationName>(
  op: K,
  args: ArgsOf<K> = {} as ArgsOf<K>,
  { timeoutMs = DEFAULT_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<ResultOf<K>> {
  const socketPath = endpointPath();
  return new Promise<ResultOf<K>>((resolve, reject) => {
    if (process.platform !== 'win32' && !existsSync(socketPath)) {
      reject(new ExtensionUnavailable(
        'the extension is not connected. Run `chrome-live install`, then load it in Chrome.'));
      return;
    }

    const socket = createConnection(socketPath);
    let text = '';
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) { return; }
      settled = true;
      socket.destroy();
      action();
    };

    const timer = setTimeout(
      () => finish(() => reject(new ExtensionUnavailable('the extension did not answer in time'))),
      timeoutMs + 2_000);

    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ op, args, timeoutMs })}\n`);
    });

    socket.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8');
      const cut = text.indexOf('\n');
      if (cut === -1) { return; }
      clearTimeout(timer);

      let reply: unknown;
      try { reply = JSON.parse(text.slice(0, cut)); } catch {
        finish(() => reject(new ExtensionUnavailable('the host sent something unreadable')));
        return;
      }
      if (!isSocketReply(reply)) {
        finish(() => reject(new ExtensionUnavailable('the host sent an unrecognised reply')));
        return;
      }
      if (reply.protocol !== undefined && reply.protocol !== PROTOCOL) {
        finish(() => reject(new ExtensionUnavailable(
          `the host speaks protocol ${reply.protocol} and this build speaks ${PROTOCOL}; update whichever is older`)));
        return;
      }
      if (!reply.ok) {
        finish(() => reject(new Error(reply.error)));
        return;
      }
      finish(() => resolve(reply.data as ResultOf<K>));
    });

    socket.on('error', (failure: Error) => {
      clearTimeout(timer);
      finish(() => reject(new ExtensionUnavailable(`the extension is not reachable: ${failure.message}`)));
    });
  });
}

/** Whether the extension answers at all. Used by `status`, never to gate a call. */
export async function available(): Promise<boolean> {
  try {
    await ask('ping', {}, { timeoutMs: 2_000 });
    return true;
  } catch {
    return false;
  }
}
