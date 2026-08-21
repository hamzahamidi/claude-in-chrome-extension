# claude-in-chrome-extension

A small Chrome extension that does one thing the [`cic`](https://github.com/hamzahamidi/claude-in-chrome-cli) command line cannot do for itself: **move a tab you name into Claude's tab group**, so Claude can drive a page you already have open.

It reads the list of tabs and tab groups, and it moves one tab into one group. It never navigates, clicks, injects scripts or reads page content. Driving pages is the Claude in Chrome bridge's job, and keeping that line sharp is what makes these permissions defensible.

## Why it has to be an extension

Tab groups are extension-only surface. Every other route was measured and closed:

| Route | Result |
| --- | --- |
| Page JavaScript through the bridge | `chrome` exposes only `loadTimes, csi, app`; `chrome.tabs` and `chrome.tabGroups` are `undefined` |
| Chrome DevTools Protocol | No `tabGroup` surface anywhere across its 51 domains, and `Target.TargetInfo` carries no group field |
| Chrome's AppleScript dictionary | Addresses `application, window, tab, bookmark folder, bookmark item`; no group vocabulary |
| Chrome session files on disk | Group membership is recorded, but an emptied group leaves no trace: Chromium writes no group-lifecycle command |

So without an extension, using a tab you already have open means asking you to drag it into the group by hand.

## What it enables

```sh
cic adopt "pull/29" get_page_text
```

`cic` asks this extension for the tab list, resolves the one tab matching `pull/29`, and has it moved into Claude's group. No dragging.

Adoption is deliberately loud rather than gated behind a prompt, because installing this extension is the grant:

- the tab and what adopting allows are announced before anything moves
- more than one match adopts nothing and lists the candidates, because guessing would silently hand Claude the wrong page
- hosts listed in `~/.config/cic/never-adopt` are never adopted
- every adoption is appended to `~/.cache/cic/adoptions.log`

## Install

Published builds install from the Chrome Web Store. To run it from source:

1. `cic extension install` — registers the native messaging host with the browsers on your machine
2. `chrome://extensions` → Developer mode → **Load unpacked** → pick this directory
3. `cic extension status` — should report `connected`

The extension id must be `oceljemfocgfidhhdlbojkbkmlbfclna`. It is pinned by the `key` in `manifest.json`, because native messaging allowlists by id and an unpacked load would otherwise get a fresh one each time. A different id means native messaging will refuse to connect.

## How it talks to the CLI

Chrome owns the host process: it spawns it when this extension calls `connectNative`, and kills it when the extension disconnects. So the CLI cannot start it and needs a second hop.

```
extension  --connectNative-->  host (spawned by Chrome)  --unix socket-->  cic
```

The socket lives in a 0700 directory the user owns rather than on a TCP port, because whoever reaches that endpoint can move tabs in a logged-in browser. The host and the socket ship with `cic`, not here.

## Permissions

| Permission | Why |
| --- | --- |
| `tabs` | Reading titles and URLs is how a tab is matched by name, and moving one needs its id |
| `tabGroups` | Reading the groups a tab can be moved into |
| `nativeMessaging` | The only channel to a local command line that opens no network port |

No host permissions, no content scripts, no remote code. The service worker is the whole extension.

## Separate on purpose

This lives apart from `claude-in-chrome-cli` because it publishes on a different clock: the CLI ships whenever it is ready, while an extension update waits on Chrome Web Store review, which is typically days and can be weeks. Tying the CLI's releases to that would be the tail wagging the dog.

`cic` never requires this. With the extension absent, `.adopt` falls back to asking you to move the tab yourself, and every other command is unaffected.

## License

MIT, same as the CLI.
