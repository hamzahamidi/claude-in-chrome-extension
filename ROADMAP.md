# Roadmap

Where this project is going, release by release: from reading the browser you are already signed in to, toward driving it, without a tab-group boundary and without a second browser.

Each release is small, shippable on its own, and earns exactly the permissions it needs. The non-goals are part of the plan.

## Why this exists

`claude-in-chrome-cli` was built to use the Claude in Chrome extension from a shell, and it works. What it cannot do is get past that extension's model: the bridge sees only tabs inside its own tab group, offers no group API, and loses a group permanently when its first tab closes. Those are documented with evidence in [MOTIVATION.md](MOTIVATION.md), and the measurements are attached upstream at `anthropics/claude-code#75901`.

Tab groups are extension-only surface, proven by closing every alternative: page JavaScript sees a `chrome` object holding only `loadTimes, csi, app`; the DevTools Protocol has no tab-group surface across its 51 domains; Chrome's AppleScript dictionary has no group vocabulary. So the limitation is not something a client can work around. It has to be answered by an extension, which is this one.

## Invariants

Six rules hold across every release below.

1. **No tab-group boundary, ever.** Every tab in every window is addressable. This is the reason the project exists, and a release that reintroduces a scope boundary has failed.
2. **Permissions are earned, never requested speculatively.** Each release asks for the narrowest set that makes its tools work, and the README says what each one buys. `tabs` and `tabGroups` in 0.1; `scripting` and host permissions only when a release actually reads pages; `debugger` only when one actually drives them. A reviewer and a user should both be able to see why.
3. **MCP is the interface.** One implementation serves an agent and a shell script alike, so behaviour cannot diverge between them. A convenience CLI may wrap it; it never becomes a second implementation.
4. **URLs are redacted by default.** Origin and path for http and https, bare scheme for anything else, and raw only on an explicit per-call opt-in. A tab listing is exactly where a session token gets copied into a log.
5. **The extension never acts on a tab it was not told to.** No implicit current tab, no acting on the active tab because none was named.
6. **Zero runtime dependencies.** TypeScript at build time, nothing shipped but the compiled output and the extension.

One boundary is deliberately outside the sequence: this does not become a general-purpose scraping or automation farm. It drives the browser a human is signed in to, on that human's machine, which is the only thing it is good at and the only thing that justifies the permissions.

## v0.1.0: read the browser

Theme: prove the thesis, and nothing else.

- TypeScript throughout, `strict` on, compiled to plain Node output with no runtime dependencies. Source in `src/`, extension in `extension/`, build to `dist/`.
- The three-process shape, working end to end: the extension connects to a native messaging host that Chrome spawns, the host owns a unix socket in a 0700 directory, and the MCP server connects to that socket. Chrome will only ever spawn the host itself, so this hop is not optional.
- Two tools: `list_tabs` across every window, and `list_tab_groups` including groups that hold no tabs. Permissions: `tabs` and `tabGroups`.
- `chrome-live install` writes the host manifest for every Chromium-family browser present, `status` says whether the extension is connected, `mcp` runs the server on stdio.
- The extension id is pinned by a key in its manifest, because native messaging allowlists by id and an unpacked load would otherwise get a fresh one each time. The private key never enters the repository.
- Offline tests for the MCP surface and the redaction, driven without a browser. CI on Node 22 and 24.

The acceptance test is one number: `list_tabs` returns every tab in the browser rather than the handful inside a managed group. On the machine this was designed against that is 35 against 4.

Non-goals: no page content, no navigation, no input, no publication.

## v0.2.0: act on tabs

Theme: everything you can do to a tab without touching what is inside it.

- `open_tab`, `close_tab`, `focus_tab`, and moving a tab between windows.
- Tab group operations, which the Claude bridge has none of: create, rename, recolour, add or remove a tab, and remove a group. This is also the release that can clean up the stranded `Claude (MCP)` pills that motivated the investigation, since an extension can see groups that nothing else can.
- Still `tabs` and `tabGroups` only. Nothing here needs to read a page.
- Every destructive operation names what it will affect and refuses ambiguity rather than guessing.

Non-goals: no page content yet. The permission jump belongs to its own release so it can be justified on its own.

## v0.3.0: read pages

Theme: the first release that needs to see inside a tab, and says so.

- `get_page_text`, `get_page_html` and `screenshot`, by explicit tab id.
- Adds `scripting` and the host permissions that reading a page requires. This is the release where the permission story gets materially larger, so the README grows a section on exactly what is now possible and what is still not.
- Screenshots return the format actually captured, with the format stated rather than implied by a filename. The Claude bridge returns JPEG whatever you name the file, which is the kind of small dishonesty worth not repeating.
- Reading a page is opt-in per call, never a side effect of listing tabs.

Non-goals: no input, no clicking, no typing.

## v0.4.0: drive pages

Theme: the hard one, and the one to be slowest about.

- `click`, `type`, `scroll`, `press_key`, and form filling, by tab id and by element reference rather than by coordinate where possible.
- This requires `chrome.debugger`, because ordinary extensions cannot dispatch trusted input. That brings a visible "started debugging this browser" banner and conflicts with having DevTools open on the same tab, since Chrome allows one debugger client per target. Both consequences get documented before the release, not after.
- An explicit, revocable opt-in for input: reading a page and driving a page are different grants, and a user who wants the first should not be handed the second silently.

Non-goals: no recording, no macros, no scripting language. Composition belongs to the caller.

## v0.5.0: publication

Theme: installable by someone who is not us.

- Chrome Web Store listing, with the privacy policy and permission justifications that `tabs` and `debugger` will be asked to defend. Review is typically days and can be weeks, which is why this project versions separately from anything that consumes it.
- Reproducible build from a tagged commit, so the published bundle can be checked against source. An extension asking for these permissions has to be auditable, and "trust the listing" is not auditable.
- Verify that the store honours the pinned `key` so the published id matches the one the native messaging manifest allowlists. If it does not, the host registration points at the wrong id and nothing connects, which is a failure worth finding before shipping rather than after.

## v0.6.x: stabilisation

Bug fixes only. Soak the debugger path, fix platform papercuts on Linux and Windows, and leave the tool names alone.

## v1.0.0: the contract release

1. Frozen tool names, arguments and result shapes. Changing one after 1.0 requires a major bump.
2. Three-platform CI green, including the native messaging install path.
3. A week of the maintainer's real use without an orphaned host process, a stuck socket or a lost group.
4. Every permission in the manifest traceable to a tool that needs it.
5. Zero known cases where a raw URL escapes into output that did not ask for one.

## Open decisions

Recorded rather than guessed at, because they are not implementation details.

**The name.** The repository is `claude-in-chrome-extension`, which describes what it grew out of rather than what it is. The code currently says `chrome-live`. Once this drives pages it is not "the Claude in Chrome extension's helper" in any sense, and the name should stop implying it.

**Whether a CLI ships at all.** MCP alone serves every MCP client and is less to maintain. A thin CLI is what makes this usable from cron and shell pipelines, which was the original reason `claude-in-chrome-cli` existed. Invariant 3 allows one as a wrapper; whether it earns its keep is a question for after 0.2.

**What happens to `claude-in-chrome-cli`.** It remains a correct, small client for the Claude bridge, useful to anyone who has that extension and wants it from a shell. It does not become a client of this project unless there is a reason beyond symmetry.
