# Chrome Web Store listing

Everything the dashboard asks for, ready to paste. The dashboard cannot be
automated: Chrome refuses both `chrome.scripting` and `chrome.debugger` on the
extensions gallery, so every field here has to be entered by hand.

Build both artefacts from the repository:

    npm run package      # dist/store/yoke-<version>.zip
    npm run screenshot   # docs/store/screenshot-1280x800.png

The zip holds the contents of `extension/`, not the folder itself, which is the
usual way this is rejected: a package whose manifest is not at the root is
invalid. `npm run package` checks that before it finishes, and refuses when
package.json and the extension manifest disagree on the version.

## Store listing tab

**Name** (45 characters max)

    Yoke

**Short description** (132 characters max, currently 111)

    Let MCP clients drive your signed in Chrome: tabs, page text, trusted input, screenshots, console, and network.

**Category**

    Developer Tools

**Language**

    English (United States)

**Detailed description**

    Yoke lets an AI agent or command line tool drive the Chrome you are already
    signed in to, through the Model Context Protocol.

    Unlike a headless browser, there is nothing to log into again. Your sessions,
    cookies, extensions and open tabs are already there, because it is your
    browser.

    WHAT IT DOES

    - Sees every tab in every window, not a managed subset
    - Reads page text, and describes interactive elements so a client can act on
      them by name rather than by guessing coordinates
    - Sends real clicks and keystrokes that pages cannot distinguish from yours
    - Screenshots any tab, including one in the background
    - Reports console messages and network requests for tabs it is driving
    - Puts every tab it touches into a visible tab group, so you can always see
      what is under automation

    HOW IT WORKS

    Yoke is two halves. This extension is one; the other is a local MCP server
    installed from npm:

        npm install -g yoke-mcp
        yoke install

    The extension talks to that server through a native messaging host on your
    own machine. Nothing leaves your computer by way of Yoke.

    The extension does nothing on its own. With no client connected it sits idle:
    there is no popup, no button, and no background activity.

    BEFORE YOU INSTALL

    This gives a local program broad control of a browser you are signed into. It
    can read page content, run JavaScript and send input on any site you point it
    at. Install it only for tools you would trust with that.

    A tab being driven shows Chrome's own "started debugging this browser" bar.
    That is Chrome telling you the truth and Yoke does not hide it.

    Open source, MIT licensed: https://github.com/hamzahamidi/yoke

## Privacy tab

**Single purpose** (a single, clear purpose is required)

    Yoke gives a local Model Context Protocol client controlled access to the
    user's own browser, so that automation tools and AI assistants can read and
    operate pages in the browser session the user is already using.

**Permission justifications**

`tabs`

    Needed to list tabs across every window with their ids, and to open, navigate
    and close a tab the client names. The client addresses every tab by id, so it
    must be able to enumerate them.

`tabGroups`

    Used to put the tabs Yoke drives into one visibly named group, so the user can
    see at a glance which tabs are under automation. It is a transparency feature,
    and no functionality depends on the grouping.

`nativeMessaging`

    Yoke's other half is a local MCP server installed from npm. Native messaging
    is the only mechanism by which an extension can communicate with a program on
    the user's machine, and Chrome will only start such a host itself, so this
    permission is what makes the product possible at all.

`scripting`

    Used to read the visible text of a page and to describe its interactive
    elements (links, buttons, form fields) so a client can act on them by
    reference. Injected only into a tab the client names, never automatically.

`debugger`

    Required for two things an extension cannot otherwise do. First, trusted
    input: an event synthesised from a content script arrives with isTrusted
    false and is ignored by many sites, so chrome.debugger is the only route to
    input a page treats as real. Second, capturing a tab that is not in the
    foreground, which chrome.tabs.captureVisibleTab cannot do. It also supplies
    the console and network history Yoke reports. Attached only to a tab the
    client names, and released on request.

`<all_urls>`

    Yoke cannot know in advance which sites its user will work on, so it cannot
    ship a fixed host list. The user chooses the tab, per call, by id. Narrowing
    this to per site permissions granted at first use is planned: see
    https://github.com/hamzahamidi/yoke/blob/main/ROADMAP.md

**Data usage disclosures**

Answer these as follows, which is accurate:

| Question | Answer |
| --- | --- |
| Collects personally identifiable information | No |
| Collects health information | No |
| Collects financial and payment information | No |
| Collects authentication information | No |
| Collects personal communications | No |
| Collects location | No |
| Collects web history | No |
| Collects user activity | No |
| Collects website content | No |

Yoke transmits nothing off the machine and stores nothing beyond an in-memory
console and network buffer that dies with the tab. Data passes to the local
client the user connected, which is not collection by the extension.

Then certify all three statements, which hold:

- I do not sell or transfer user data to third parties, outside of the approved
  use cases
- I do not use or transfer user data for purposes that are unrelated to my
  item's single purpose
- I do not use or transfer user data to determine creditworthiness or for
  lending purposes

**Privacy policy URL**

    https://github.com/hamzahamidi/yoke/blob/main/PRIVACY.md

## Graphic assets

| Asset | Size | Required |
| --- | --- | --- |
| Store icon | 128x128 PNG | yes, use `extension/icons/128.png` |
| Screenshot | 1280x800 or 640x400 PNG | yes, use `docs/store/screenshot-1280x800.png` |
| Small promo tile | 440x280 PNG | no |
| Marquee promo tile | 1400x560 PNG | no |

## After uploading, before publishing

Do this while the item is still a draft, because it is what keeps native
messaging working.

Open the item's **Package** tab and copy two things:

1. The **item id**, a 32 letter string. It will NOT be
   `oceljemfocgfidhhdlbojkbkmlbfclna`: the store assigns its own id, and per
   Chrome's documentation for the `key` field the public key flows from the store
   into the manifest rather than the other way.
2. The **public key**.

The id goes into `EXTENSION_IDS` in `src/install.ts`, alongside the existing one.
`allowed_origins` is a list, so a source install and a store install both keep
working. A store install with only the old id in the list fails silently: Chrome
refuses the connection and reports nothing.
