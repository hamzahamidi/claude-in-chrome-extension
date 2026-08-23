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
      return 'textbox';
    }
    return 'generic';
  };

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
      ...(input.value ? { value: String(input.value).slice(0, 80) } : {}),
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

/**
 * Where a reference is now, resolved in the page.
 *
 * Re-read at click time rather than trusted from the snapshot, because a page
 * that scrolled or reflowed since would otherwise be clicked in the wrong place.
 */
export function locateRef(ref: string): { x: number; y: number; found: boolean } {
  const registry = (window as unknown as { __yokeRefs?: Map<string, Element> }).__yokeRefs;
  const element = registry?.get(ref);
  if (!element) { return { x: 0, y: 0, found: false }; }
  element.scrollIntoView({ block: 'center', inline: 'center' });
  const rect = element.getBoundingClientRect();
  return {
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(rect.top + rect.height / 2),
    found: true,
  };
}
