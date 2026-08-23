// Messages between the popup and the service worker.
//
// Separate from protocol.ts because these never cross the native messaging
// boundary: they are internal to the extension, and mixing them into the wire
// protocol would imply the host could send them.

/** Popup to service worker. */
export type PopupRequest =
  | { kind: 'status' }
  | { kind: 'releaseAll' };

/** Service worker to popup. */
export type PopupReply =
  | { kind: 'status'; connected: boolean; version: string; host: string; attached: number[] }
  | { kind: 'released'; count: number };
