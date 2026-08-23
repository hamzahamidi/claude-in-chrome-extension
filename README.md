# yoke

[![npm](https://img.shields.io/npm/v/yoke-mcp?color=0e8fa3)](https://www.npmjs.com/package/yoke-mcp)
[![tests](https://github.com/hamzahamidi/yoke/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/hamzahamidi/yoke/actions/workflows/test.yml)
[![provenance](https://img.shields.io/badge/npm-signed%20provenance-0e8fa3)](https://www.npmjs.com/package/yoke-mcp#provenance)
[![node](https://img.shields.io/node/v/yoke-mcp)](https://nodejs.org)
[![dependencies](https://img.shields.io/badge/runtime%20deps-0-0e8fa3)](package.json)
[![license](https://img.shields.io/npm/l/yoke-mcp)](LICENSE)

yoke lets an MCP client drive the Chrome profile you already use. It can work with every tab in every window, read pages, click and type, take screenshots, and inspect console and network activity. Your signed in sessions, cookies, extensions, and open tabs stay available.

That is the reason to use yoke instead of starting a fresh browser through Playwright or Puppeteer. It works where you already work.

Chrome requires a three part bridge:

```text
MCP client  <--stdio-->  yoke mcp server  <--Unix socket-->  native host  <--connectNative-->  Chrome extension
```

The MCP client starts `yoke mcp`. Chrome starts the native messaging host when the extension connects to it. The server reaches that host through a local socket. A client cannot connect straight to the extension because Chrome only gives native messaging connections to hosts that Chrome started.

The project and repository are named `yoke`. The npm package is `yoke-mcp` because the bare package name belongs to an unrelated project. The command is `yoke`, and the extension is displayed as Yoke.

## Why yoke exists

yoke grew out of measurements of Anthropic's Claude in Chrome MCP bridge. That bridge could only see and act on tabs in its own managed group, and each reply included its full tab list with raw URLs. Those limits could not be fixed by an outside client. yoke addresses every tab by id and redacts URLs by default. [MOTIVATION.md](MOTIVATION.md) records the observations behind those choices.

yoke is not affiliated with or endorsed by Anthropic or Google. It works with any client that speaks Model Context Protocol.

## Install from source

yoke is not on the Chrome Web Store. You must build it from source and load the extension unpacked.

You need Node 22 or later and a Chromium based browser. The manifest requires Chrome 116 or later. Chrome, Chromium, Edge, and Brave registration paths are present. Only macOS has been exercised so far.

### 1. Clone and build

```sh
git clone https://github.com/hamzahamidi/yoke.git
cd yoke
npm install
npm run build
node dist/cli.js install
```

Do not skip the build. `extension/manifest.json` loads `extension/browser/background.js`, and `extension/browser/` is generated output that is not stored in Git.

`node dist/cli.js install` registers the native messaging host with each Chrome family browser it finds. If the `yoke` binary is already on your `PATH`, `yoke install` runs the same command.

On Windows, `yoke install` does not complete registration. It prints a registry instruction instead of changing the registry. The Windows and Linux paths have not been tested yet.

### 2. Load the extension

In Chrome, Chromium, or Brave:

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Choose **Load unpacked**.
4. Select the `extension/` directory inside the clone, not the repository root.

In Edge, use `edge://extensions` and follow the same steps.

The extension id must be `oceljemfocgfidhhdlbojkbkmlbfclna`. A public key in `extension/manifest.json` pins that id. The native host manifest allowlists it, so native messaging will refuse a build with a different id.

The native messaging host id is `io.github.hamzahamidi.yoke`.

### 3. Check every connection

```sh
node dist/cli.js doctor
```

When setup is complete, the last line is:

```text
Working. Every link in the chain answered.
```

If something is wrong, `doctor` stops after the first broken link, names it, and prints a suggested fix. It checks the compiled host, browser registration, local socket, extension reply, and whether tabs are visible.

For a shorter connection check, run:

```sh
node dist/cli.js status
```

## Connect an MCP client

An MCP client needs to start the command `yoke` with the argument `mcp`.

If you want the binary from this checkout on your `PATH`, run this once from the repository:

```sh
npm link
```

A typical MCP server entry then looks like this:

```json
{
  "mcpServers": {
    "yoke": {
      "command": "yoke",
      "args": ["mcp"]
    }
  }
}
```

Clients use different names and locations for their MCP configuration. If you do not want to run `npm link`, set the command to `node` and pass the absolute path to `dist/cli.js` before `mcp`.

## What it can do

yoke exposes 19 MCP tools. They are grouped here by the job they help with.

| Job | Tools | What they do |
| --- | --- | --- |
| Work with tabs | `list_tabs`, `list_tab_groups`, `open_tab`, `navigate`, `close_tab`, `group_tabs`, `ungroup_tabs` | See every window, open background tabs, visit HTTP or HTTPS URLs, close tabs, and manage Chrome tab groups. |
| Read a page | `get_page_text`, `read_page`, `find`, `screenshot` | Read visible text, describe interactive elements, find a matching element, or capture a foreground or background tab. |
| Act on a page | `click`, `type_text`, `press_key`, `scroll`, `run_javascript` | Use trusted input by element reference, scroll the page, or evaluate JavaScript in the page's own world. |
| Debug a page | `read_console`, `read_network`, `release_tab` | Read recorded console and network activity, then detach yoke and clear that tab's buffers. |

Any tool that acts on an existing tab requires an explicit `tab_id` obtained from `list_tabs`. There is no active tab default. yoke never acts on whichever tab you happen to be viewing because no tab was named.

`read_page` returns references such as `e1` for interactive elements. `click`, `type_text`, `press_key`, and reference based scrolling use those references. A reference expires when the page navigates or renders the element again, so call `read_page` again when a reference is stale.

`navigate` and `open_tab` accept HTTP and HTTPS URLs. New tabs open in the background unless the caller asks to focus one.

### Tab groups

Every tab opened by yoke goes into a cyan group titled `yoke`, so the tab strip names what is driving those tabs. Pass `group_title` to `open_tab` for a different label, which is worth doing when more than one agent works in the same browser. The extension creates that group when needed and reuses a group with the same title in the same window. Reuse comes from Chrome's current group state, so it still works after Chrome has stopped and restarted the extension service worker. You do not collect a row of identical group pills.

Any tab yoke drives or reads joins the group as well, whether or not it opened that tab, so the strip always shows what is under automation. Tabs are never moved between windows to achieve it. Grouping is visual only, so no tool depends on it to find a tab. `ungroup_tabs` removes tabs from their group without closing them. When the group becomes empty, Chrome removes its pill.

### URL redaction

yoke reduces URLs in tool output to origin and path by default. Query strings and fragments are omitted because they can contain session tokens or credentials. Non HTTP wrapper URLs are reduced to their scheme because their path can contain another full URL.

`list_tabs` accepts `full_urls: true` when a caller needs raw URLs. The other tools that print URLs currently keep them redacted.

## Permissions and access

Installing Yoke gives a local MCP client broad control over the browser profile where you are signed in. It can read site content, run JavaScript, send trusted input, and observe network activity. That can include private accounts and private data. Install it only for MCP clients and agents you trust with that access.

The extension requests these permissions:

| Permission | What yoke uses it for | What the grant means |
| --- | --- | --- |
| `tabs` | List tabs in every window, including ids, titles, URLs, and group membership. Open, navigate, and close named tabs. | The extension can see which pages are open and can change the tab strip. |
| `tabGroups` | List groups, create or reuse them, set their title and colour, and ungroup tabs. | The extension can inspect and change tab grouping in every window. |
| `nativeMessaging` | Connect to the local host named `io.github.hamzahamidi.yoke`. | The extension can exchange data with a program installed on your computer. |
| `scripting` | Inject the functions that read visible text, collect interactive elements, and resolve element references. | The extension can read and run code inside allowed pages. |
| `debugger` | Use the DevTools Protocol for trusted clicks and typing, JavaScript evaluation, background tab screenshots, console messages, and network requests. | The extension gets deep control and inspection access on each tab it attaches to. |
| `host_permissions: ["<all_urls>"]` | Let `scripting` work on ordinary sites regardless of host. | The site grant is broad. It is not limited to a list of sites chosen during installation. Per site permission is future work. |

Chrome's own pages and the Chrome Web Store still block page script injection. yoke reports that restriction instead of returning an empty page.

### Why the debugger permission is required

An extension cannot create trusted input through page JavaScript. A click made by a content script reaches the page with `isTrusted: false`, and many sites ignore it. `chrome.debugger` is the extension route to `Input.dispatchMouseEvent`, which creates input the page cannot distinguish from a person's input.

Chrome shows its "started debugging this browser" bar when yoke drives a tab. This is expected. Chrome also permits one debugger client per tab. A tab with DevTools open cannot be driven by yoke, and DevTools cannot open on a tab while yoke is attached. Call `release_tab` to detach yoke, remove the bar, and make the tab available to DevTools.

The same permission lets `screenshot` capture a background tab. `chrome.tabs.captureVisibleTab` can only capture the active tab in a window.

## Local connection and process lifetime

The bridge does not open a TCP port. On macOS and Linux, the native host listens on a Unix socket inside a directory readable only by your user account. The socket itself is also restricted to that account. Windows uses a named pipe.

Chrome owns the native host process. It starts the host when the extension calls `connectNative` and stops it when that connection closes. This is why the Unix socket between the MCP server and host is required.

yoke has zero runtime dependencies. TypeScript and the Chrome type declarations are used only during the build.

## Commands

After `npm link`, the command surface is:

| Command | Purpose |
| --- | --- |
| `yoke install` | Register the native messaging host with each detected Chrome family browser. |
| `yoke doctor` | Check each link from the build through tab visibility and suggest the first fix. |
| `yoke status` | Report whether the extension answers and print the local socket path. |
| `yoke uninstall` | Remove the native host registration. |
| `yoke mcp` | Run the MCP server over standard input and standard output. This is what an MCP client starts. |

From a checkout that has not been linked, replace `yoke` with `node dist/cli.js` in these commands.

## Current limits

1. yoke is young and pre 1.0. Tool names, arguments, and results can change.
2. Only macOS has been exercised. Linux and Windows install paths are written but untested. On Windows, `yoke install` prints a manual registry step but does not make the registry change.
3. The project has one offline test file, `test/mcp-server.test.ts`. It checks the MCP surface and URL redaction, but this is not yet a well tested browser project.
4. A driven tab shows Chrome's debugging bar and cannot share its debugger slot with DevTools.
5. Element references expire after navigation or a page render. Console and network history starts when yoke first attaches to that tab, not before.
6. Screenshots capture the page viewport, not browser chrome such as the address bar or tab strip.
7. Chrome's internal pages cannot be read or driven. Neither can the Chrome Web Store or the extensions gallery: Chrome refuses both `chrome.scripting` and `chrome.debugger` there, so no extension can automate them, including this one. Publishing an extension is therefore a manual job by design.

## Uninstall

Remove the browser's native host registration with:

```sh
yoke uninstall
```

Then remove Yoke from the browser's extensions page. If you linked the checkout with npm, remove that link with:

```sh
npm unlink --global yoke-mcp
```

## License

[MIT](LICENSE)
