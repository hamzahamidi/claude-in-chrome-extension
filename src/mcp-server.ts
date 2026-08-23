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
  /** Present only for tools that return an image, such as screenshot. */
  images?: Array<{ format: string; base64: string }>;
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
  {
    name: 'navigate',
    description:
      'Navigate one tab to a URL and wait for it to finish loading. The tab is named by id, '
      + 'never implied: there is no acting on "the active tab", because that is whatever the '
      + 'person happens to be looking at. Returns once the load reports complete, so a caller '
      + 'is not left racing the page it just asked for.',
    inputSchema: {
      type: 'object',
      required: ['tab_id', 'url'],
      properties: {
        tab_id: { type: 'number', description: 'From list_tabs.' },
        url: { type: 'string', description: 'http and https only.' },
        timeout_ms: { type: 'number', description: 'How long to wait for the load. Default 20000.' },
      },
    },
  },
  {
    name: 'open_tab',
    description:
      'Open a new tab, optionally at a URL. Opens in the background by default, because a '
      + 'script should not pull focus away from what someone is doing.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        active: { type: 'boolean', default: false, description: 'Focus the new tab.' },
      },
    },
  },
  {
    name: 'close_tab',
    description: 'Close one tab by id.',
    inputSchema: {
      type: 'object',
      required: ['tab_id'],
      properties: { tab_id: { type: 'number' } },
    },
  },
  {
    name: 'read_page',
    description:
      'The interactive elements of a page: links, buttons, inputs, each with a ref, a role and a '
      + 'name. Call this before clicking or typing, and act by ref rather than by coordinate. A '
      + 'coordinate is a guess that one reflow invalidates, and afterwards you cannot tell whether '
      + 'you hit what you meant; a ref resolves to the element that was described. Refs are only '
      + 'valid until the page navigates or re-renders.',
    inputSchema: {
      type: 'object',
      required: ['tab_id'],
      properties: {
        tab_id: { type: 'number' },
        max_elements: { type: 'number', description: 'Default 200.' },
      },
    },
  },
  {
    name: 'find',
    description:
      'The elements of a page whose name or role matches some text. A filtered read_page, for '
      + 'when you know what you are looking for.',
    inputSchema: {
      type: 'object',
      required: ['tab_id', 'text'],
      properties: { tab_id: { type: 'number' }, text: { type: 'string' } },
    },
  },
  {
    name: 'click',
    description:
      'Click an element by ref from read_page. Produces a real, trusted click through the '
      + 'DevTools Protocol, which pages cannot tell from a person; a synthesised event from page '
      + 'JavaScript arrives with isTrusted false and many sites ignore it. Attaching the debugger '
      + 'shows Chrome\'s "started debugging this browser" bar on the tab, and Chrome allows one '
      + 'debugger client per tab, so a tab with DevTools open cannot be driven.',
    inputSchema: {
      type: 'object',
      required: ['tab_id', 'ref'],
      properties: {
        tab_id: { type: 'number' },
        ref: { type: 'string', description: 'From read_page.' },
        button: { type: 'string', enum: ['left', 'right', 'middle'], default: 'left' },
        click_count: { type: 'number', default: 1, description: '2 for a double click.' },
      },
    },
  },
  {
    name: 'type_text',
    description:
      'Type into the page. Pass a ref to click it first, which is how you focus a field. Inserts '
      + 'the text in one operation rather than a keystroke at a time, so it also handles '
      + 'characters no single key produces.',
    inputSchema: {
      type: 'object',
      required: ['tab_id', 'text'],
      properties: {
        tab_id: { type: 'number' },
        text: { type: 'string' },
        ref: { type: 'string', description: 'Focus this element first.' },
        press_enter: { type: 'boolean', default: false },
      },
    },
  },
  {
    name: 'press_key',
    description: 'Press one named key: Enter, Tab, Escape, Backspace or an arrow.',
    inputSchema: {
      type: 'object',
      required: ['tab_id', 'key'],
      properties: {
        tab_id: { type: 'number' },
        key: { type: 'string' },
        ref: { type: 'string', description: 'Focus this element first.' },
      },
    },
  },
  {
    name: 'scroll',
    description: 'Scroll a page, or scroll an element into view by ref.',
    inputSchema: {
      type: 'object',
      required: ['tab_id'],
      properties: {
        tab_id: { type: 'number' },
        dy: { type: 'number', default: 400, description: 'Positive scrolls down.' },
        dx: { type: 'number', default: 0 },
        ref: { type: 'string' },
      },
    },
  },
  {
    name: 'screenshot',
    description:
      'A screenshot of a tab, returned as an image. Works on a background tab, which '
      + 'chrome.tabs.captureVisibleTab cannot do: it only photographs the active tab of a window.',
    inputSchema: {
      type: 'object',
      required: ['tab_id'],
      properties: {
        tab_id: { type: 'number' },
        format: { type: 'string', enum: ['png', 'jpeg'], default: 'png' },
        quality: { type: 'number', description: 'JPEG only, 0 to 100.' },
      },
    },
  },
  {
    name: 'run_javascript',
    description:
      "Evaluate an expression in the page's own world, so it sees the page's variables, and "
      + 'return the value. Top-level await works. A thrown error comes back as the result rather '
      + 'than as a transport failure.',
    inputSchema: {
      type: 'object',
      required: ['tab_id', 'expression'],
      properties: { tab_id: { type: 'number' }, expression: { type: 'string' } },
    },
  },
  {
    name: 'read_console',
    description:
      'Console messages and uncaught exceptions for a tab. Only what happened since the tab was '
      + 'first driven: attaching is what starts the recording, so a message from before that is '
      + 'gone. The reply says whether this call was the attachment.',
    inputSchema: {
      type: 'object',
      required: ['tab_id'],
      properties: { tab_id: { type: 'number' }, limit: { type: 'number', default: 100 } },
    },
  },
  {
    name: 'read_network',
    description:
      'Network requests for a tab, with their statuses. Same recording rule as read_console: '
      + 'history begins when the tab was first driven.',
    inputSchema: {
      type: 'object',
      required: ['tab_id'],
      properties: { tab_id: { type: 'number' }, limit: { type: 'number', default: 100 } },
    },
  },
  {
    name: 'release_tab',
    description:
      'Stop driving a tab: detaches the debugger, which removes the "started debugging" bar and '
      + 'frees the tab for DevTools. Console and network history for that tab is dropped.',
    inputSchema: {
      type: 'object',
      required: ['tab_id'],
      properties: { tab_id: { type: 'number' } },
    },
  },
  {
    name: 'get_page_text',
    description:
      'The visible text of a page, by tab id. Uses innerText rather than textContent, so it is '
      + 'what a reader would see: no script or style bodies, and layout respected. Chrome\'s own '
      + 'pages and the Web Store cannot be read, and say so rather than returning nothing.',
    inputSchema: {
      type: 'object',
      required: ['tab_id'],
      properties: {
        tab_id: { type: 'number' },
        max_chars: { type: 'number', description: 'Truncate beyond this. Default 200000.' },
      },
    },
  },
] as const;

const text = (value: string): ToolResult => ({ content: [{ type: 'text', text: value }] });
const failed = (value: string): ToolResult => ({ content: [{ type: 'text', text: value }], isError: true });

/**
 * A tab id, or a refusal naming what arrived instead.
 *
 * An MCP client hands over whatever the model produced, so a string, a float or
 * nothing at all are all realistic. Passing those through would fail somewhere
 * deeper with a worse message.
 */
function asTabId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`tab_id must be an integer from list_tabs, got ${JSON.stringify(value)}`);
  }
  return value;
}

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

  if (name === 'navigate') {
    const tabId = asTabId(args['tab_id']);
    const url = String(args['url'] ?? '');
    // Refused here rather than in the extension, because the reason is a policy
    // and policy belongs where it can be tested without a browser.
    if (!/^https?:\/\//i.test(url)) {
      return failed(`navigate takes an http or https URL, not ${JSON.stringify(url)}`);
    }
    const timeoutMs = typeof args['timeout_ms'] === 'number' ? args['timeout_ms'] : undefined;
    const moved = await ask('navigate', {
      tabId,
      url,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
    return moved.status === 'complete'
      ? text(`Navigated tab ${moved.tabId} to ${shownUrl(moved.url)}\n${moved.title}`)
      : text(`Tab ${moved.tabId} is at ${shownUrl(moved.url)} but did not report finishing loading `
        + 'within the timeout. The page may still be working.');
  }

  if (name === 'open_tab') {
    const url = args['url'] === undefined ? undefined : String(args['url']);
    if (url !== undefined && !/^https?:\/\//i.test(url)) {
      return failed(`open_tab takes an http or https URL, not ${JSON.stringify(url)}`);
    }
    const { tab } = await ask('openTab', {
      ...(url === undefined ? {} : { url }),
      active: args['active'] === true,
    });
    return text(`Opened tab ${tab.id} at ${shownUrl(tab.url)}\n${tab.title}`);
  }

  if (name === 'close_tab') {
    const { closed } = await ask('closeTab', { tabId: asTabId(args['tab_id']) });
    return text(`Closed tab ${closed}.`);
  }

  if (name === 'get_page_text') {
    const maxChars = typeof args['max_chars'] === 'number' ? args['max_chars'] : undefined;
    const page = await ask('getPageText', {
      tabId: asTabId(args['tab_id']),
      ...(maxChars === undefined ? {} : { maxChars }),
    });
    const note = page.truncated ? '\n\n[truncated]' : '';
    return text(`${page.title}\n${shownUrl(page.url)}\n---\n${page.text}${note}`);
  }

  if (name === 'read_page' || name === 'find') {
    const maxElements = typeof args['max_elements'] === 'number' ? args['max_elements'] : undefined;
    const page = await ask('readPage', {
      tabId: asTabId(args['tab_id']),
      ...(maxElements === undefined ? {} : { maxElements }),
    });
    const needle = name === 'find' ? String(args['text'] ?? '').toLowerCase() : null;
    const shown = needle === null
      ? page.elements
      : page.elements.filter((e) => `${e.name} ${e.role} ${e.tag}`.toLowerCase().includes(needle));
    if (shown.length === 0) {
      return text(needle === null
        ? 'No interactive elements found on this page.'
        : `Nothing on this page matches ${JSON.stringify(args['text'])}.`);
    }
    const rows = shown.map((e) => {
      const extra = [e.value ? `value=${JSON.stringify(e.value)}` : '', e.disabled ? 'disabled' : '']
        .filter(Boolean).join(' ');
      return `${e.ref}\t${e.role}\t${e.name.slice(0, 70)}${extra ? `\t${extra}` : ''}`;
    });
    const note = page.truncated ? '\n[truncated; raise max_elements]' : '';
    return text(`${page.title}\n${shownUrl(page.url)}\n${shown.length} element(s)\nref\trole\tname\n${rows.join('\n')}${note}`);
  }

  if (name === 'click') {
    const button = args['button'];
    const clickCount = typeof args['click_count'] === 'number' ? args['click_count'] : undefined;
    await ask('click', {
      tabId: asTabId(args['tab_id']),
      ref: String(args['ref'] ?? ''),
      ...(button === 'left' || button === 'right' || button === 'middle' ? { button } : {}),
      ...(clickCount === undefined ? {} : { clickCount }),
    });
    return text(`Clicked ${String(args['ref'])}.`);
  }

  if (name === 'type_text') {
    const ref = args['ref'] === undefined ? undefined : String(args['ref']);
    const typed = await ask('typeText', {
      tabId: asTabId(args['tab_id']),
      text: String(args['text'] ?? ''),
      ...(ref === undefined ? {} : { ref }),
      pressEnter: args['press_enter'] === true,
    });
    return text(`Typed ${typed.typed} character(s)${args['press_enter'] === true ? ' and pressed Enter' : ''}.`);
  }

  if (name === 'press_key') {
    const ref = args['ref'] === undefined ? undefined : String(args['ref']);
    const pressed = await ask('pressKey', {
      tabId: asTabId(args['tab_id']),
      key: String(args['key'] ?? ''),
      ...(ref === undefined ? {} : { ref }),
    });
    return text(`Pressed ${pressed.key}.`);
  }

  if (name === 'scroll') {
    const ref = args['ref'] === undefined ? undefined : String(args['ref']);
    const dx = typeof args['dx'] === 'number' ? args['dx'] : undefined;
    const dy = typeof args['dy'] === 'number' ? args['dy'] : undefined;
    const moved = await ask('scroll', {
      tabId: asTabId(args['tab_id']),
      ...(dx === undefined ? {} : { dx }),
      ...(dy === undefined ? {} : { dy }),
      ...(ref === undefined ? {} : { ref }),
    });
    return text(`Scrolled by ${moved.dx}, ${moved.dy}.`);
  }

  if (name === 'screenshot') {
    const format = args['format'] === 'jpeg' ? 'jpeg' : 'png';
    const quality = typeof args['quality'] === 'number' ? args['quality'] : undefined;
    const shot = await ask('screenshot', {
      tabId: asTabId(args['tab_id']),
      format,
      ...(quality === undefined ? {} : { quality }),
    }, { timeoutMs: 30_000 });
    // An image part, not base64 in a text blob: a client that can show an image
    // should get one, and a text field would be unreadable either way.
    return {
      content: [
        { type: 'text', text: `Screenshot of tab ${shot.tabId}, ${shot.format}, ${shot.bytes} bytes.` },
      ],
      images: [{ format: shot.format, base64: shot.base64 }],
    } as ToolResult;
  }

  if (name === 'run_javascript') {
    const outcome = await ask('evaluate', {
      tabId: asTabId(args['tab_id']),
      expression: String(args['expression'] ?? ''),
    }, { timeoutMs: 30_000 });
    // A thrown error is the answer, not a transport failure: the caller asked
    // what the page would do, and this is what it did.
    return outcome.threw
      ? text(`threw: ${outcome.value}`)
      : text(`${outcome.type}: ${outcome.value}`);
  }

  if (name === 'read_console') {
    const limit = typeof args['limit'] === 'number' ? args['limit'] : undefined;
    const seen = await ask('consoleMessages', {
      tabId: asTabId(args['tab_id']),
      ...(limit === undefined ? {} : { limit }),
    });
    const preface = seen.attachedNow
      ? 'Recording started with this call, so nothing from before it exists.\n'
      : '';
    if (seen.messages.length === 0) { return text(`${preface}No console messages.`); }
    const rows = seen.messages.map((m) => `${m.level}\t${m.text.slice(0, 200)}`);
    return text(`${preface}${seen.messages.length} message(s)\nlevel\ttext\n${rows.join('\n')}`);
  }

  if (name === 'read_network') {
    const limit = typeof args['limit'] === 'number' ? args['limit'] : undefined;
    const seen = await ask('networkRequests', {
      tabId: asTabId(args['tab_id']),
      ...(limit === undefined ? {} : { limit }),
    });
    const preface = seen.attachedNow
      ? 'Recording started with this call, so nothing from before it exists.\n'
      : '';
    if (seen.requests.length === 0) { return text(`${preface}No requests recorded.`); }
    const rows = seen.requests.map((r) => `${r.status ?? '...'}\t${r.method}\t${shownUrl(r.url)}`);
    return text(`${preface}${seen.requests.length} request(s)\nstatus\tmethod\turl\n${rows.join('\n')}`);
  }

  if (name === 'release_tab') {
    const released = await ask('release', { tabId: asTabId(args['tab_id']) });
    return text(released.released
      ? `Released tab ${released.tabId}: the debugging bar is gone and DevTools can attach again.`
      : `Tab ${released.tabId} was not being driven.`);
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
