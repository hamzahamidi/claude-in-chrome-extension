// The page, described as things you can act on.
//
// Coordinates are deliberately not the interface. A caller told to click
// (412, 233) is guessing, and one reflow makes the guess wrong; worse, it cannot
// tell afterwards whether it hit what it meant. So a snapshot hands back
// references, and acting on a reference resolves it back to the element that was
// described.
//
// The injected function is self-contained on purpose: chrome.scripting
// serialises it and runs it in the page, so it can close over nothing from here.
import type { ElementRef } from '../protocol.js';

/** What the injected function returns, before it crosses back. */
export interface RawSnapshot {
  url: string;
  title: string
  elements: Array<ElementRef & { x: number; y: number }>;
}

/**
 * Collects interactive elements, tags each with a stable reference, and stashes
 * the mapping on the page so a later click can resolve it.
 *
 * Runs in the page. Everything it needs is defined inside it.
 */
export function collectSnapshot(maxElements: number): RawSnapshot {
  const SELECTOR = [
    'a[href]', 'button', 'input', 'select', 'textarea', 'summary',
    '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
    '[role="tab"]', '[role="menuitem"]', '[role="option"]', '[contenteditable="true"]',
    '[onclick]', '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  const visible = (element: Element): boolean => {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) { return false; }
    const style = getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
  };

  const nameOf = (element: Element): string => {
    const aria = element.getAttribute('aria-label');
    if (aria) { return aria.trim(); }
    const input = element as HTMLInputElement;
    if (input.labels && input.labels.length > 0) {
      return (input.labels[0]?.innerText ?? '').trim();
    }
    if (input.placeholder) { return input.placeholder.trim(); }
    const title = element.getAttribute('title');
    if (title) { return title.trim(); }
    const alt = element.getAttribute('alt');
    if (alt) { return alt.trim(); }
    return ((element as HTMLElement).innerText ?? element.textContent ?? '').trim().slice(0, 120);
  };

  const roleOf = (element: Element): string => {
    const explicit = element.getAttribute('role');
    if (explicit) { return explicit; }
    const tag = element.tagName.toLowerCase();
    if (tag === 'a') { return 'link'; }
    if (tag === 'button' || tag === 'summary') { return 'button'; }
    if (tag === 'select') { return 'combobox'; }
    if (tag === 'textarea') { return 'textbox'; }
    if (tag === 'input') {
      const type = (element as HTMLInputElement).type;
      if (type === 'checkbox' || type === 'radio' || type === 'submit' || type === 'button') { return type; }
      // Its own role rather than textbox, so a password field stays visible to a
      // caller that has to type into it while its value can be withheld.
      // Collapsing it into textbox is what made the value impossible to redact.
      if (type === 'password') { return 'password'; }
      return 'textbox';
    }
    return 'generic';
  };

  const isSecret = (element: Element): boolean =>
    element.tagName.toLowerCase() === 'input' && (element as HTMLInputElement).type === 'password';

  const registry = new Map<string, Element>();
  const elements: RawSnapshot['elements'] = [];
  let index = 0;

  for (const element of Array.from(document.querySelectorAll(SELECTOR))) {
    if (elements.length >= maxElements) { break; }
    if (!visible(element)) { continue; }
    index += 1;
    const ref = `e${index}`;
    registry.set(ref, element);
    const rect = element.getBoundingClientRect();
    const input = element as HTMLInputElement;
    elements.push({
      ref,
      role: roleOf(element),
      name: nameOf(element),
      tag: element.tagName.toLowerCase(),
      ...(input.value && !isSecret(element) ? { value: String(input.value).slice(0, 80) } : {}),
      ...(input.disabled ? { disabled: true } : {}),
      // Centre point, kept for the click path and never shown to a caller.
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
    });
  }

  // Parked on the window so a later resolve can find the same elements without
  // re-walking the DOM, which would renumber everything.
  (window as unknown as { __yokeRefs?: Map<string, Element> }).__yokeRefs = registry;
  return { url: location.href, title: document.title, elements };
}

/** What sits at the point a click is about to be sent to. */
export interface Located {
  x: number;
  y: number;
  found: boolean;
  /**
   * Whether the topmost element at that point is the one the ref names.
   * `self` and `nested` both mean the click reaches the named element, because
   * an event on a descendant or an ancestor still triggers it. `covered` means
   * something unrelated is on top, which is the cookie banner case.
   */
  hit?: 'self' | 'nested' | 'covered' | 'nothing';
  /** What is actually on top, when it is not the named element. */
  topmost?: string;
}

/**
 * Where a reference is now, resolved in the page, and what is on top of it.
 *
 * Re-read at click time rather than trusted from the snapshot, because a page
 * that scrolled or reflowed since would otherwise be clicked in the wrong place.
 * The hit test is here rather than in the caller because it has to happen at the
 * same moment as the measurement: anything later is a different page.
 */
export function locateRef(ref: string): Located {
  const registry = (window as unknown as { __yokeRefs?: Map<string, Element> }).__yokeRefs;
  const element = registry?.get(ref);
  if (!element) { return { x: 0, y: 0, found: false }; }
  element.scrollIntoView({ block: 'center', inline: 'center' });
  const rect = element.getBoundingClientRect();
  const x = Math.round(rect.left + rect.width / 2);
  const y = Math.round(rect.top + rect.height / 2);

  const top = document.elementFromPoint(x, y);
  const describe = (node: Element): string => {
    const id = node.id ? `#${node.id}` : '';
    const first = node.classList.length > 0 ? `.${node.classList[0]}` : '';
    return `${node.tagName.toLowerCase()}${id}${first}`;
  };

  let hit: Located['hit'];
  if (!top) { hit = 'nothing'; } else if (top === element) { hit = 'self'; } else if (
    element.contains(top) || top.contains(element)
  ) { hit = 'nested'; } else { hit = 'covered'; }

  return {
    x,
    y,
    found: true,
    hit,
    ...(hit === 'covered' && top ? { topmost: describe(top) } : {}),
  };
}
