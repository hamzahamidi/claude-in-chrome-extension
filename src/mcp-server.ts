// A stdio MCP server for the browser you are already signed in to.
//
// Register this with any MCP client and it gets browser automation against your
// real Chrome profile, with no tab-group boundary: every tab in every window is
// addressable, not only the ones inside some managed group.
//
// Three processes, because Chrome's rules say so:
//
//   extension  --connectNative-->  native-host  --unix socket-->  this server
//
// Chrome will only ever spawn the native host itself, so a client cannot talk to
// the extension directly and the socket in between is not optional.
import { createInterface } from 'node:readline';

import { ask, ExtensionUnavailable } from './socket-client.js';

export const SERVER_NAME = 'chrome-live';
export const SERVER_VERSION = '0.1.0';
export const PROTOCOL_VERSION = '2024-11-05';

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number;
  method: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
}

/** origin and path only, so a tab listing never leaks a token in a query string. */
export function shownUrl(url: string, full = false): string {
  if (full) { return url; }
  try {
    const parsed = new URL(url);
    // A wrapper scheme's path can itself be a URL with credentials in it, so
    // anything that is not plain http shows only its scheme.
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') { return parsed.protocol; }
    return `${parsed.origin}${parsed.pathname === '/' ? '' : parsed.pathname}`;
  } catch {
    return '(unparseable url)';
  }
}

export const TOOLS = [
  {
    name: 'list_tabs',
    description:
      'List every open tab in the browser, across all windows, with its id, title and URL. '
      + 'Unlike a tab-group-scoped bridge this sees the whole browser, so any tab it returns can '
      + 'be passed straight to the other tools. URLs are reduced to origin and path by default, '
      + 'because a raw URL can carry credentials, a session token or a query string; pass '
      + 'full_urls to opt out.',
    inputSchema: {
      type: 'object',
      properties: {
        full_urls: {
          type: 'boolean',
          default: false,
          description: 'Return raw URLs instead of origin and path.',
        },
      },
    },
  },
  {
    name: 'list_tab_groups',
    description:
      "List the browser's tab groups with their ids, titles and colours, including groups that "
      + 'hold no tabs, which nothing outside an extension can see.',
    inputSchema: { type: 'object', properties: {} },
  },
] as const;

const text = (value: string): ToolResult => ({ content: [{ type: 'text', text: value }] });
const failed = (value: string): ToolResult => ({ content: [{ type: 'text', text: value }], isError: true });

export async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (name === 'list_tabs') {
    const { tabs } = await ask('listTabs');
    if (tabs.length === 0) {
      return text('No tabs reported, which should not happen while a browser is open.');
    }
    const full = args['full_urls'] === true;
    const lines = tabs.map((tab) => `${tab.id}\t${shownUrl(tab.url, full)}\t${tab.title.slice(0, 80)}`);
    return text(`${tabs.length} open tab(s), every window included.\nid\turl\ttitle\n${lines.join('\n')}`);
  }

  if (name === 'list_tab_groups') {
    const [{ groups }, { tabs }] = await Promise.all([ask('listGroups'), ask('listTabs')]);
    if (groups.length === 0) { return text('No tab groups.'); }
    const lines = groups.map((group) => {
      const members = tabs.filter((tab) => tab.groupId === group.id).length;
      return `${group.id}\t${JSON.stringify(group.title)}\t${group.color}\t${members} tab(s)`;
    });
    return text(`${groups.length} group(s).\nid\ttitle\tcolour\tmembers\n${lines.join('\n')}`);
  }

  return failed(`unknown tool: ${name}`);
}

export async function handle(request: JsonRpcRequest): Promise<unknown> {
  if (request.method === 'initialize') {
    return {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    };
  }
  if (request.method === 'tools/list') { return { tools: TOOLS }; }
  if (request.method === 'tools/call') {
    const params = request.params ?? {};
    return callTool(params.name ?? '', params.arguments ?? {});
  }
  throw new Error(`unknown method: ${request.method}`);
}

export function main(): void {
  const lines = createInterface({ input: process.stdin, terminal: false });
  const send = (object: unknown): void => { process.stdout.write(`${JSON.stringify(object)}\n`); };

  lines.on('line', (raw: string) => {
    const line = raw.trim();
    if (!line) { return; }

    let request: JsonRpcRequest;
    try { request = JSON.parse(line) as JsonRpcRequest; } catch { return; }
    // A notification carries no id and must never be answered.
    if (request.id === undefined) { return; }
    const id = request.id;

    handle(request)
      .then((result) => { send({ jsonrpc: '2.0', id, result }); })
      .catch((thrown: unknown) => {
        // An unreachable extension is a condition to report, not a crash: the
        // client should be told to install or load it rather than see a dead
        // server.
        const message = thrown instanceof ExtensionUnavailable || thrown instanceof Error
          ? thrown.message
          : String(thrown);
        send({ jsonrpc: '2.0', id, error: { code: -32000, message } });
      });
  });
}
