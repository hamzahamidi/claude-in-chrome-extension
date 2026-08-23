// The DevTools Protocol side of the extension.
//
// Everything here exists because of one hard fact: an extension cannot dispatch
// trusted input. Events synthesised from a content script arrive with
// isTrusted false, and a great many pages ignore them, so "click this button"
// cannot be done from page JavaScript at all. chrome.debugger is the only route
// an extension has to Input.dispatchMouseEvent and friends, which produce events
// indistinguishable from a person's.
//
// Two consequences that cannot be engineered away, and are documented rather
// than hidden. Attaching shows Chrome's "started debugging this browser" infobar
// on the tab. And Chrome allows one debugger client per target, so a tab with
// DevTools open cannot be driven, and a tab being driven cannot have DevTools
// opened on it.
import type { ConsoleMessage, NetworkRequest } from '../protocol.js';

/** How much history to keep per tab, so a long-lived attachment cannot grow without bound. */
const BUFFER_LIMIT = 500;

interface TabState {
  console: ConsoleMessage[];
  network: NetworkRequest[];
  /** Whether this attachment was made by us, and so is ours to detach. */
  attached: boolean;
  /** Whether the tab was successfully told to keep painting. See keepPainting. */
  painting: boolean;
}

const state = new Map<number, TabState>();

const stateFor = (tabId: number): TabState => {
  let existing = state.get(tabId);
  if (!existing) {
    existing = { console: [], network: [], attached: false, painting: false };
    state.set(tabId, existing);
  }
  return existing;
};

const push = <T>(buffer: T[], entry: T): void => {
  buffer.push(entry);
  if (buffer.length > BUFFER_LIMIT) { buffer.shift(); }
};

/**
 * Records console and network events for tabs we are attached to.
 *
 * Registered once for the whole extension rather than per tab: chrome.debugger
 * delivers every attached target through this one listener, and adding it per
 * attachment would leak a listener per tab.
 */
chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  if (tabId === undefined) { return; }
  const tab = state.get(tabId);
  if (!tab) { return; }

  if (method === 'Runtime.consoleAPICalled') {
    const event = params as { type?: string; args?: Array<{ value?: unknown; description?: string }> };
    const text = (event.args ?? [])
      .map((arg) => (arg.value !== undefined ? String(arg.value) : arg.description ?? ''))
      .join(' ');
    push(tab.console, { level: event.type ?? 'log', text, at: Date.now() });
    return;
  }

  if (method === 'Log.entryAdded') {
    const entry = (params as { entry?: { level?: string; text?: string; url?: string; lineNumber?: number } }).entry;
    if (entry) {
      push(tab.console, {
        level: entry.level ?? 'info',
        text: entry.text ?? '',
        ...(entry.url === undefined ? {} : { url: entry.url }),
        ...(entry.lineNumber === undefined ? {} : { line: entry.lineNumber }),
        at: Date.now(),
      });
    }
    return;
  }

  if (method === 'Runtime.exceptionThrown') {
    const details = (params as { exceptionDetails?: { text?: string; exception?: { description?: string } } })
      .exceptionDetails;
    push(tab.console, {
      level: 'error',
      text: details?.exception?.description ?? details?.text ?? 'uncaught exception',
      at: Date.now(),
    });
    return;
  }

  if (method === 'Network.requestWillBeSent') {
    const event = params as { request?: { method?: string; url?: string }; type?: string };
    push(tab.network, {
      method: event.request?.method ?? 'GET',
      url: event.request?.url ?? '',
      ...(event.type === undefined ? {} : { type: event.type }),
      at: Date.now(),
    });
    return;
  }

  if (method === 'Network.responseReceived') {
    const event = params as { response?: { url?: string; status?: number } };
    // Fills in the status on the most recent matching request rather than
    // recording a second row for the same exchange.
    const match = [...tab.network].reverse().find((entry) => entry.url === event.response?.url);
    if (match && event.response?.status !== undefined) { match.status = event.response.status; }
  }
});

// Chrome detaches when a tab closes, DevTools opens, or the user dismisses the
// infobar. Forgetting the state keeps a later attach from looking already-done.
chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId !== undefined) { state.delete(source.tabId); }
});

chrome.tabs.onRemoved.addListener((tabId) => { state.delete(tabId); });

const send = <T>(tabId: number, method: string, params?: object): Promise<T> =>
  chrome.debugger.sendCommand({ tabId }, method, params) as Promise<T>;

/**
 * Attaches to a tab if it is not already attached, and enables the domains whose
 * events we buffer.
 *
 * Idempotent, because every operation calls it: a caller should not have to know
 * whether some earlier call already attached.
 */
export async function attach(tabId: number): Promise<{ attachedNow: boolean }> {
  const tab = stateFor(tabId);
  if (tab.attached) { return { attachedNow: false }; }
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : String(failure);
    // Chrome's own wording when DevTools holds the target. Worth translating,
    // because "another debugger" is not obviously "close your DevTools".
    if (/already attached/i.test(message)) {
      throw new Error(
        `tab ${tabId} already has a debugger attached, which is usually DevTools being open on it. `
        + 'Chrome allows one debugger client per tab, so close DevTools there and retry.');
    }
    throw failure;
  }
  tab.attached = true;
  // Enabled together so console and network history accumulate from the moment
  // the tab is first driven, rather than only after someone asks for them.
  await Promise.all([
    send(tabId, 'Runtime.enable'),
    send(tabId, 'Log.enable'),
    send(tabId, 'Network.enable'),
    send(tabId, 'Page.enable'),
  ]);
  tab.painting = await keepPainting(tabId);
  return { attachedNow: true };
}

/**
 * Makes a tab produce frames even while it is not the selected tab.
 *
 * Without this, input dispatched to a tab that has never rendered goes nowhere
 * and reports success. Nothing rejects the event: RenderWidgetHostImpl's input
 * filter has no visibility check at all. The renderer simply never runs the
 * frame that would process it, because the compositor stops asking for frames
 * when the widget is not visible.
 *
 * setFocusEmulationEnabled takes a visible capturer handle on the WebContents,
 * which releases that deferral while leaving the tab unselected in the strip and
 * the window untouched. It is what Playwright sends once per page for the same
 * reason, and it survives navigation, so once per attachment is enough.
 *
 * The command is experimental, so a Chrome that refuses it must still work:
 * a screenshot takes a weaker (hidden) capturer handle that also releases the
 * deferral, and is the measured fallback.
 */
async function keepPainting(tabId: number): Promise<boolean> {
  try {
    await send(tabId, 'Emulation.setFocusEmulationEnabled', { enabled: true });
    return true;
  } catch {
    try {
      await send(tabId, 'Page.captureScreenshot', { format: 'jpeg', quality: 1 });
    } catch { /* Nothing else to try: input on this tab may not land. */ }
    return false;
  }
}

export async function detach(tabId: number): Promise<boolean> {
  const tab = state.get(tabId);
  state.delete(tabId);
  if (!tab?.attached) { return false; }
  try { await chrome.debugger.detach({ tabId }); return true; } catch { return false; }
}

/**
 * The tabs currently attached, so a caller can see what is still being held.
 *
 * An attached tab wears Chrome's debugging bar and refuses DevTools, so one
 * forgotten after a job is finished is a visible nuisance with no other symptom.
 */
export const attachedTabIds = (): number[] =>
  [...state.entries()].filter(([, tab]) => tab.attached).map(([tabId]) => tabId);

export const consoleFor = (tabId: number, limit: number): ConsoleMessage[] =>
  (state.get(tabId)?.console ?? []).slice(-limit);

export const networkFor = (tabId: number, limit: number): NetworkRequest[] =>
  (state.get(tabId)?.network ?? []).slice(-limit);

export async function evaluate(
  tabId: number,
  expression: string,
): Promise<{ value: string; type: string; threw: boolean }> {
  await attach(tabId);
  const reply = await send<{
    result?: { type?: string; value?: unknown; description?: string };
    exceptionDetails?: { text?: string; exception?: { description?: string } };
  }>(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    // The page's own world, so it sees the page's variables. An isolated world
    // would answer questions about a context nobody asked about.
    userGesture: true,
  });
  if (reply.exceptionDetails) {
    return {
      value: reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text ?? 'threw',
      type: 'error',
      threw: true,
    };
  }
  const result = reply.result ?? {};
  const value = result.value === undefined
    ? result.description ?? 'undefined'
    : typeof result.value === 'string' ? result.value : JSON.stringify(result.value);
  return { value, type: result.type ?? 'undefined', threw: false };
}

export async function screenshot(
  tabId: number,
  format: 'png' | 'jpeg',
  quality?: number,
): Promise<{ base64: string; format: string }> {
  await attach(tabId);
  // Page.captureScreenshot rather than chrome.tabs.captureVisibleTab, which can
  // only photograph the active tab of a window. Going through CDP is what makes
  // a background tab capturable at all.
  const reply = await send<{ data: string }>(tabId, 'Page.captureScreenshot', {
    format,
    ...(format === 'jpeg' && quality !== undefined ? { quality } : {}),
    captureBeyondViewport: false,
  });
  return { base64: reply.data, format };
}

/** Where an element is on screen, in viewport coordinates. */
export interface Point { x: number; y: number }

export async function clickAt(
  tabId: number,
  point: Point,
  button: 'left' | 'right' | 'middle',
  clickCount: number,
): Promise<void> {
  await attach(tabId);
  const base = { x: point.x, y: point.y, button, clickCount };
  await send(tabId, 'Input.dispatchMouseEvent', { ...base, type: 'mouseMoved', button: 'none' });
  await send(tabId, 'Input.dispatchMouseEvent', { ...base, type: 'mousePressed' });
  await send(tabId, 'Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' });
}

export async function insertText(tabId: number, text: string): Promise<void> {
  await attach(tabId);
  // Input.insertText rather than a keydown per character: it is one round trip
  // instead of hundreds, and it handles characters no single key produces.
  await send(tabId, 'Input.insertText', { text });
}

export async function pressKey(tabId: number, key: string): Promise<void> {
  await attach(tabId);
  const named: Record<string, { code: string; keyCode: number; text?: string }> = {
    Enter: { code: 'Enter', keyCode: 13, text: '\r' },
    Tab: { code: 'Tab', keyCode: 9 },
    Escape: { code: 'Escape', keyCode: 27 },
    Backspace: { code: 'Backspace', keyCode: 8 },
    ArrowUp: { code: 'ArrowUp', keyCode: 38 },
    ArrowDown: { code: 'ArrowDown', keyCode: 40 },
    ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
    ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  };
  const spec = named[key];
  if (!spec) {
    throw new Error(`unknown key ${JSON.stringify(key)}. Known: ${Object.keys(named).join(', ')}`);
  }
  const common = { key, code: spec.code, windowsVirtualKeyCode: spec.keyCode, nativeVirtualKeyCode: spec.keyCode };
  await send(tabId, 'Input.dispatchKeyEvent', {
    ...common,
    type: spec.text === undefined ? 'keyDown' : 'keyDown',
    ...(spec.text === undefined ? {} : { text: spec.text }),
  });
  await send(tabId, 'Input.dispatchKeyEvent', { ...common, type: 'keyUp' });
}

export async function scrollBy(tabId: number, point: Point, dx: number, dy: number): Promise<void> {
  await attach(tabId);
  await send(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: point.x,
    y: point.y,
    deltaX: dx,
    deltaY: dy,
  });
}
