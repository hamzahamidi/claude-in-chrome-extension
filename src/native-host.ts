#!/usr/bin/env node
// The native messaging host: a relay, and nothing more.
//
// Chrome owns this process. It spawns it when the extension calls
// connectNative, talks to it over stdin and stdout using a 4-byte
// little-endian length prefix per JSON message, and kills it when the extension
// disconnects. So a client cannot be the one to start it, and needs a second hop
// to reach the extension at all.
//
// That hop is a unix socket in a 0700 directory the user owns, rather than a TCP
// port. Whoever reaches this endpoint can read every tab in a logged-in browser,
// so "any local process can connect" is not an acceptable posture; file
// permissions are the cheapest correct answer. Windows gets a named pipe, where
// the path namespace plays the same role.
import { chmodSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROTOCOL, isResponse, type Request, type SocketReply, type SocketRequest } from './protocol.js';

const DEFAULT_TIMEOUT_MS = 15_000;

/** Where the socket lives. Kept out of /tmp so another user cannot pre-create it. */
export function endpointPath(): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\chrome-live-${process.env['USERNAME'] ?? 'user'}`;
  }
  const base = process.env['XDG_RUNTIME_DIR'] ?? join(homedir(), '.cache');
  return join(base, 'chrome-live', 'extension.sock');
}

/** 0700, and verified after creation rather than assumed. */
function prepareDirectory(socketPath: string): void {
  const dir = dirname(socketPath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') { return; }
  chmodSync(dir, 0o700);
  const mode = statSync(dir).mode & 0o777;
  if (mode !== 0o700) {
    throw new Error(`${dir} is mode ${mode.toString(8)}, refusing to listen where others can reach the socket`);
  }
}

/** Chrome's framing: one 4-byte little-endian length, then that many JSON bytes. */
function writeToChrome(message: Request): void {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

function readFromChrome(onMessage: (message: unknown) => void): void {
  let buffer = Buffer.alloc(0);
  process.stdin.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (buffer.length < 4) { return; }
      const length = buffer.readUInt32LE(0);
      if (buffer.length < 4 + length) { return; }
      const body = buffer.subarray(4, 4 + length);
      buffer = buffer.subarray(4 + length);
      try { onMessage(JSON.parse(body.toString('utf8'))); } catch { /* not ours to fix */ }
    }
  });
}

export function main(): void {
  const socketPath = endpointPath();
  const waiting = new Map<number, (reply: SocketReply) => void>();
  let nextId = 1;
  let server: Server | undefined;

  const cleanup = (): void => {
    try { server?.close(); } catch { /* never listened */ }
    if (process.platform !== 'win32') {
      try { unlinkSync(socketPath); } catch { /* already gone */ }
    }
  };

  readFromChrome((message) => {
    if (!isResponse(message)) { return; }
    const settle = waiting.get(message.id);
    if (!settle) { return; }
    waiting.delete(message.id);
    settle(message.ok
      ? { ok: true, data: message.data, protocol: PROTOCOL }
      : { ok: false, error: message.error, protocol: PROTOCOL });
  });

  // Chrome closing stdin means the extension went away, so the socket must go
  // too rather than linger and accept callers it can no longer serve.
  process.stdin.on('end', () => { cleanup(); process.exit(0); });

  server = createServer((connection: Socket) => {
    let text = '';
    connection.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8');
      for (;;) {
        const cut = text.indexOf('\n');
        if (cut === -1) { return; }
        const line = text.slice(0, cut);
        text = text.slice(cut + 1);
        if (!line.trim()) { continue; }

        let request: SocketRequest;
        try {
          request = JSON.parse(line) as SocketRequest;
        } catch {
          const reply: SocketReply = { ok: false, error: 'each line must be one JSON object' };
          connection.write(`${JSON.stringify(reply)}\n`);
          continue;
        }

        const id = nextId++;
        // A silent extension must not hang the caller, and a caller that hangs
        // up must not leave the relay waiting forever.
        const timer = setTimeout(() => {
          if (!waiting.delete(id)) { return; }
          const reply: SocketReply = { ok: false, error: 'the extension did not answer' };
          try { connection.write(`${JSON.stringify(reply)}\n`); } catch { /* gone */ }
        }, request.timeoutMs ?? DEFAULT_TIMEOUT_MS);

        waiting.set(id, (reply) => {
          clearTimeout(timer);
          try { connection.write(`${JSON.stringify(reply)}\n`); } catch { /* caller hung up */ }
        });
        writeToChrome({ id, op: request.op, args: request.args as never });
      }
    });
    connection.on('error', () => { /* a caller going away is not our failure */ });
  });

  prepareDirectory(socketPath);
  // A stale socket from a host Chrome killed would otherwise block the bind.
  if (process.platform !== 'win32') {
    try { unlinkSync(socketPath); } catch { /* nothing there */ }
  }
  server.listen(socketPath, () => {
    if (process.platform !== 'win32') { chmodSync(socketPath, 0o600); }
  });

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => { cleanup(); process.exit(0); });
  }
}

// Chrome executes this file directly, so it has to run when it is the entry
// point and stay importable when it is not.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
