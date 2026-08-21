// The one thing the CLI cannot do for itself.
//
// Tab groups are extension-only surface: page JavaScript sees a `chrome` object
// holding nothing but loadTimes, csi and app; CDP has no tab-group domain at all
// across its 51 domains; Chrome's AppleScript dictionary has no group vocabulary.
// So moving a tab into Claude's group, which is what makes an existing tab
// drivable, has to happen here or not at all.
//
// This deliberately does very little. It enumerates tabs and groups and it moves
// one named tab into one named group. It never navigates, clicks, reads page
// content or injects anything: driving pages is the bridge's job, and keeping
// that line sharp is what makes this extension's permissions defensible.
'use strict';

const HOST = 'com.hamzahamidi.cic';

let port = null;

/** chrome.tabs ids are SessionID::id(), the same numbers the bridge reports. */
const describeTab = (tab) => ({
  id: tab.id,
  windowId: tab.windowId,
  groupId: tab.groupId,
  title: tab.title,
  url: tab.url,
});

const describeGroup = (group) => ({
  id: group.id,
  title: group.title,
  color: group.color,
  windowId: group.windowId,
  collapsed: group.collapsed,
});

/**
 * Moves one tab into the group that holds `anchorTabId`.
 *
 * Groups are per-window, so a tab in another window has to be moved there first
 * and the caller is told that happened: a tab silently jumping windows is
 * exactly the kind of surprise this should never spring on someone.
 */
async function adopt({ tabId, anchorTabId }) {
  const anchor = await chrome.tabs.get(anchorTabId);
  if (anchor.groupId === undefined || anchor.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
    throw new Error(`the anchor tab ${anchorTabId} is not in a group, so there is nothing to adopt into`);
  }
  const target = await chrome.tabs.get(tabId);
  let movedWindows = false;
  if (target.windowId !== anchor.windowId) {
    await chrome.tabs.move(tabId, { windowId: anchor.windowId, index: -1 });
    movedWindows = true;
  }
  await chrome.tabs.group({ tabIds: [tabId], groupId: anchor.groupId });
  const after = await chrome.tabs.get(tabId);
  return {
    tabId: after.id,
    groupId: after.groupId,
    movedWindows,
    inGroup: after.groupId === anchor.groupId,
  };
}

async function handle(message) {
  switch (message.op) {
    case 'ping':
      return { extension: chrome.runtime.getManifest().version };
    case 'listTabs':
      return { tabs: (await chrome.tabs.query({})).map(describeTab) };
    case 'listGroups':
      return { groups: (await chrome.tabGroups.query({})).map(describeGroup) };
    case 'adopt':
      return adopt(message.args || {});
    default:
      throw new Error(`unknown op ${message.op}`);
  }
}

function connect() {
  if (port) { return; }
  try {
    port = chrome.runtime.connectNative(HOST);
  } catch (failure) {
    console.log('cic helper: native host unavailable', failure && failure.message);
    return;
  }

  port.onMessage.addListener(async (message) => {
    if (!message || message.id === undefined) { return; }
    try {
      const data = await handle(message);
      port.postMessage({ id: message.id, ok: true, data });
    } catch (failure) {
      port.postMessage({ id: message.id, ok: false, error: String((failure && failure.message) || failure) });
    }
  });

  // The worker is kept alive by the open port, and a dropped port means the host
  // went away. Reconnecting on a delay is what lets `cic extension install`
  // followed by a first command work without the user reloading anything.
  port.onDisconnect.addListener(() => {
    port = null;
    setTimeout(connect, 1000);
  });
}

chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect();
