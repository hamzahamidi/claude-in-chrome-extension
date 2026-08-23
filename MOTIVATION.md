# What the bridge cannot do, and why yoke exists

Observations of the Claude in Chrome extension and its MCP bridge (`claude --claude-in-chrome-mcp`), gathered while building [`claude-in-chrome-cli`](https://github.com/hamzahamidi/claude-in-chrome-cli) against it. Each entry says how it was established, because the interesting ones are counter-intuitive and several contradicted assumptions we started with.

These are notes on fit, not a complaint. The bridge is built for an agent holding a conversation; most of what follows only bites a programmatic client, and a few are plain bugs worth reporting upstream.

These measurements led to yoke, but yoke does not use that CLI or bridge. It is an independent Chrome extension and MCP server that works with any MCP client. Its local requirements are Node 22 or later and Chrome.

## The tab group boundary

**The bridge sees only tabs inside its own tab group.** A tab the user has open anywhere else is invisible, whatever window it is in. There is no move tool, no all-windows flag, and `select_browser` picks a browser rather than a tab. *Measured on one machine: the bridge could see 4 tabs while a session-file reader saw 29, of which 25 were outside the group.*

**Nothing can adopt a tab.** Using a page the user already has open requires the human to move it in through Chrome's own tab context menu, then the client to notice. Our client does this by snapshotting group membership and watching for a stable single addition across two polls. *Measured: it works, and it takes a human gesture every time.*

**No group API crosses the bridge.** Groups cannot be listed, named, recoloured or removed. Every group is titled `Claude (MCP)`, so once several exist they are indistinguishable. *Measured; upstream `anthropics/claude-code#86355` tracks the labelling half.*

## Group lifetime

**A group is lost permanently when its first tab closes.** Closing the group's oldest tab makes the bridge lose the entire group even while other tabs are still open in it. Those tabs then cannot be listed, driven or closed from any session, and the group's pill stays in the tab strip until a human removes it. *Measured in both directions: closing the second tab leaves the group intact and drivable; closing the first yields `Closed tab N. 1 tab(s) remain.` followed by `No MCP tab groups found`.*

**A group dies with its last tab, so every create-and-close cycle makes a new one.** Two consecutive cycles produced group ids `528130259` then `339959904`; six cycles left six distinct group tokens in Chrome's session file. A client that tidies up after itself therefore accumulates one stranded pill per run unless it deliberately keeps a tab open forever. *Measured.*

**Emptied groups are undetectable.** Chromium writes no group-lifecycle command to session data: group existence is only ever implied by a live tab's membership record. So an emptied group appears in no session snapshot and no API a client can reach. *Measured by diffing `Sessions/Session_*` around a known create-then-empty, which produced no group command at all, and confirmed across all three snapshots on disk.*

**`tabs_create_mcp` requires a group to already exist.** With none, it refuses and points at `tabs_context_mcp`. Ordering that is not obvious, and easy to get wrong in a way that only shows up on a clean browser. *Measured: `No MCP tab group exists. Use tabs_context_mcp with createIfEmpty: true first to create one.`*

## What comes back in a reply

**Every reply embeds the full open-tab list, with titles and raw URLs.** Not just the tab being acted on: every tab in the group, appended to every single reply. For one of us that meant internal staging hostnames and a Slack workspace and channel id landing in ordinary command output, which a script will happily write to a log or a CI artifact. *Measured; it is why our demo recording elides that section.*

**Replies carry `<system-reminder>` text addressed to a model.** Advice like preferring `browser_batch` arrives inside the tool result. Reasonable for an agent, noise in a data channel for a program. *Measured.*

**Structured values arrive inside prose.** A new tab's id is only ever reported as `Created new tab. Tab ID: 2099042596`, so a client has to parse a sentence to learn it. This is the one place our client reads meaning out of prose rather than a field, and a wording change upstream would break it. *Measured.*

**Reply shape is inconsistent for the same tool.** `tabs_context_mcp` answers with JSON when a group exists and with prose (`No MCP tab groups found…`) when none does, so a parser needs both paths. *Measured.*

## Tool-level gaps

**`navigate` reports success for a URL it did not visit.** Given `file:///path/to/x.html` it answered `Navigated to https://file:///path/to/x.html`: it had prefixed `https://` to the whole thing and gone to a bogus address, while reporting success. `data:` and `about:blank` are rejected outright with `Invalid URL`. *Measured; the silent mangling is the one we would call a bug.*

**Screenshots are the page viewport only, and always JPEG.** Browser chrome is never captured, so the tab strip cannot be read; and the `computer` tool exposes no format option, returning JPEG whatever the caller intends to name the file. *Measured: a 1538x784 JPEG against a 1512x949 window, and the tool schema has no format parameter.*

**A fresh tab cannot be scripted.** New tabs open on `chrome://newtab`, where `javascript_tool` answers `Cannot access a chrome:// URL`, so a client must navigate somewhere before it can evaluate anything. *Measured.*

## Dependencies

**The bridge needs the Claude Code CLI installed, and the extension signed in to the same account.** `cic` spawns `claude --claude-in-chrome-mcp`, and a mismatch surfaces as `Browser extension is not connected`. Reasonable for Claude Code users; a hard floor for anyone who only wants browser automation from a shell. *Measured.*

This is a dependency of the bridge being measured, not a yoke dependency. yoke does not spawn Claude Code and does not require an Anthropic account or sign in. It needs Node 22 or later and Chrome.

## What yoke changed

The measurements supported building an independent extension and MCP server. The table records what that decision changed and what remains a browser limit:

| Limitation | What yoke does |
| --- | --- |
| Tab group boundary | `chrome.tabs.query({})` sees every tab in every window. |
| Nothing can adopt a tab | Every existing tab is addressable by explicit id, so adoption is no longer a separate operation. |
| No group API | `chrome.tabGroups` lists groups, and yoke can group or ungroup named tabs. |
| Group lost when its first tab closes | Group identity belongs to Chrome, and no tool addresses a tab through its group. |
| Emptied groups undetectable | yoke queries Chrome's group state directly while a group exists. Emptying a group leaves its tabs open and removes the pill. |
| Tab list in every reply | A tool returns the data for its own operation. It does not append the whole tab list. |
| `<system-reminder>` in results | yoke adds no model-directed reminder text to tool results. |
| Ids inside prose | The extension protocol carries ids as fields. MCP tool results are still concise text. |
| `navigate` mangling non-http URLs | `navigate` and `open_tab` accept HTTP and HTTPS URLs and refuse other schemes without rewriting them. |
| Screenshot format and chrome capture | PNG and JPEG are explicit options, and a background tab can be captured. Browser chrome remains out of reach. |
| Needs Claude Code installed | yoke has no Claude Code dependency. Any MCP client can start `yoke mcp`. |

The cost is equally plain. The extension requests `tabs`, `tabGroups`, `nativeMessaging`, `scripting` and `debugger`, plus `host_permissions: ["<all_urls>"]`. That is broad access to a signed in browser. Trusted input and background tab screenshots require `debugger`, which brings Chrome's visible debugging bar and prevents DevTools from sharing an attached tab. Page reading requires `scripting` and access across sites. yoke also owns the browser automation surface and the three process bridge that Chrome's native messaging rules require.

That trade was accepted. The extension and MCP server in this repository are the result, and they stand on their own.

The measurements and the smallest useful upstream requests are attached at `anthropics/claude-code#75901`.
