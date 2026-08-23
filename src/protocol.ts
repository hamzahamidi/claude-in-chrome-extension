// The shapes the three processes agree on.
//
// One file so the extension, the host and the server cannot drift: a request the
// server can send is exactly a request the extension knows how to answer, and
// the compiler is what enforces that rather than a comment asking nicely.

/** Bumped when a message shape changes in a way an older peer cannot read. */
export const PROTOCOL = 1;

export interface TabInfo {
  id: number;
  windowId: number;
  /** `-1` when the tab is in no group. */
  groupId: number;
  title: string;
  url: string;
}

export interface GroupInfo {
  id: number;
  title: string;
  color: string;
  windowId: number;
  collapsed: boolean;
}

/** Every operation the extension implements, and what each one answers with. */
export interface Operations {
  ping: { args: Record<string, never>; result: { extension: string } };
  listTabs: { args: Record<string, never>; result: { tabs: TabInfo[] } };
  listGroups: { args: Record<string, never>; result: { groups: GroupInfo[] } };
}

export type OperationName = keyof Operations;
export type ArgsOf<K extends OperationName> = Operations[K]['args'];
export type ResultOf<K extends OperationName> = Operations[K]['result'];

/** Host to extension. `id` is the host's, and comes back untouched. */
export interface Request<K extends OperationName = OperationName> {
  id: number;
  op: K;
  args?: ArgsOf<K>;
}

/** Extension to host. */
export type Response =
  | { id: number; ok: true; data: unknown }
  | { id: number; ok: false; error: string };

/** Host to a socket client. */
export type SocketReply =
  | { ok: true; data: unknown; protocol: number }
  | { ok: false; error: string; protocol?: number };

/** A socket client to the host. One JSON object per line. */
export interface SocketRequest {
  op: OperationName;
  args?: Record<string, unknown>;
  timeoutMs?: number;
}

export const isResponse = (value: unknown): value is Response =>
  typeof value === 'object' && value !== null && 'id' in value && 'ok' in value;
