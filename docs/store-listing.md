# Chrome Web Store listing

Everything the dashboard asks for, ready to paste. The dashboard cannot be
automated: Chrome refuses both `chrome.scripting` and `chrome.debugger` on the
extensions gallery, so every field here has to be entered by hand.

Build both artefacts from the repository:

    npm run package      # dist/store/yoke-<version>.zip
    npm run screenshot   # docs/store/screenshot-1280x800.png

`npm run package` handles the two things the store rejects an upload over.

The zip holds the contents of `extension/`, not the folder itself: a package
whose manifest is not at the root is invalid, and the dashboard says only that
the package could not be uploaded.

And the `key` field is stripped from the packaged manifest. The store refuses an
upload that carries one, with "key field is not allowed in manifest" (measured,
not guessed). The repository manifest keeps its key, because that is what pins
the id `oceljemfocgfidhhdlbojkbkmlbfclna` for an unpacked load, which is the id
the native messaging host allowlists. So the two manifests differ in exactly that
one field, and the script reads the packed manifest back out of the archive to
confirm it.

It also refuses to build when package.json and the extension manifest disagree on
the version.

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

Two of these are YES, and getting them wrong is worse than a rejection: the same
tab carries the Limited Use certification, so a false answer is grounds for
removal after publication rather than something you iterate on.

Google's user data FAQ defines the test, and local processing does not exempt
anything: "by 'handle' we mean collecting, transmitting, using, or sharing user
data", and "extensions are required to disclose how they handle user data, even
when data is processed or stored locally on a user's device and is not
transmitted to external servers or third parties". It names this case directly:
"clipping or scraping content from a website that the user visits, such as taking
screenshots or capturing data from a web page".

| Question | Answer |
| --- | --- |
| Personally identifiable information | No |
| Health information | No |
| Financial and payment information | No |
| Authentication information | No |
| Personal communications | No |
| Location | No |
| Web history | No |
| User activity | **Yes** |
| Website content | **Yes** |

`Website content` because `get_page_text`, `read_page` and `screenshot` capture
page content and images. `User activity` because `read_network` reports request
metadata and `read_console` reports console output, which is monitoring activity
on the site.

`Web history` stays No: Yoke reports the tabs open right now, and never reads or
retains browsing history.

Then certify all three statements, which do hold:

- I do not sell or transfer user data to third parties, outside of the approved
  use cases
- I do not use or transfer user data for purposes that are unrelated to my
  item's single purpose
- I do not use or transfer user data to determine creditworthiness or for
  lending purposes

They hold because Yoke passes data only to the local client the user themselves
connected, which is the item's single purpose, and sends it nowhere else.

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

Done for this listing. The item id is `mebojgahcmmffbaonhnmmjhmbdbfbamm`, and as
predicted it is not `oceljemfocgfidhhdlbojkbkmlbfclna`: an upload may not carry a
`key`, so it cannot choose its id. Both are in `EXTENSION_IDS` in
`src/install.ts`, so `yoke install` allowlists both and either install works.

One sequencing rule remains, and it is absolute: **the release carrying both ids
must be on npm before the listing is visible to anyone.** A store install whose
host manifest allowlists only the unpacked id fails silently, because Chrome
refuses the connection and reports nothing on the server side. Anyone who already
ran `yoke install` needs to run it again, since nothing else rewrites that file.
