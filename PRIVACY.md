# Privacy policy for Yoke

Last updated: 23 August 2026

Yoke handles a lot of what is on your screen, and sends none of it to us.

There is no Yoke server, no account, no analytics and no telemetry. Every hop is
between processes on your own machine. But "we receive nothing" is not the same
as "nothing is handled", and the honest version is the second one: Yoke reads
page content, captures screenshots and observes network activity when asked to,
and hands all of it to the local client you connected. Where that client sends it
next is the question worth asking, and it is answered below.

## What Yoke can see

Yoke exists to drive the browser you are already signed in to, so it can see a
great deal:

- Every tab and tab group in every window, with titles and URLs.
- The text and the interactive structure of any page it is asked to read.
- Screenshots of any tab it is asked to capture.
- Console messages and network request metadata (method, URL, status) for any tab
  it is attached to.
- Anything a page displays while it is being driven.

It reads these only when a connected client asks for a specific tab by id. There
is no background collection, no crawling, and nothing is read on a schedule.

## Where that information goes

To one place: the local program you connected. The path is

    extension  ->  native messaging host  ->  Unix socket  ->  MCP server  ->  your client

Every hop is on your computer. The socket lives in a directory readable only by
your user account. Nothing is written to a remote service by Yoke, and the
extension makes no network requests of its own.

What your client then does with what it receives is outside Yoke's control and
governed by that client's own policy. If the client is an AI assistant, page
content you ask Yoke to read will be sent to whatever model that assistant uses.
That is a property of the tool you connected, not of Yoke, and it is the main
thing to understand before installing.

## What Yoke stores

Almost nothing, and nothing that outlives the browser:

- Console messages and network requests for tabs being driven, kept in memory
  only, capped at 500 entries per tab, and discarded when the tab closes, when
  the debugger detaches, or when Chrome restarts the extension.
- No cookies, credentials, passwords, form values or browsing history are
  recorded or persisted anywhere by Yoke.

The values of password fields are deliberately excluded from what Yoke reports
about a page. The field is described so a client can type into it; its contents
are not returned.

URLs are reduced to origin and path in tool output by default, because query
strings routinely carry session tokens. A client must opt in per call to receive
a raw URL.

## Permissions and why each exists

| Permission | Why |
| --- | --- |
| `tabs` | List, open, navigate and close tabs by id, and see which group each is in. |
| `tabGroups` | Put the tabs it drives into one visible group, so you can see what is under automation. |
| `nativeMessaging` | Talk to the local host, which is the only way an extension can reach a program on your machine. |
| `scripting` | Read page text and describe interactive elements. |
| `debugger` | Send input a page cannot distinguish from yours, and capture background tabs. An extension has no other route to either. |
| `<all_urls>` | Allow the above on whichever site you ask it to work on, rather than a fixed list. |

Attaching the debugger makes Chrome display its own notification that the browser
is being debugged. That bar is Chrome telling you the truth, and Yoke does not
try to hide or suppress it.

## Data sold or shared

None. There is nobody to sell it to and no channel to share it over.

## Contact

Issues and questions: https://github.com/hamzahamidi/yoke/issues
