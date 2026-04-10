/* ── Missouri – background service worker ─────────────────────────────────── */

const COMMAND_TO_MESSAGE: Record<string, string> = {
  "toggle-annotation-mode": "TOGGLE_MODE",
  "toggle-overlay-visibility": "TOGGLE_OVERLAY",
  "toggle-highlight-mode": "TOGGLE_HIGHLIGHT"
};

chrome.action.onClicked.addListener(async (tab: chrome.tabs.Tab) => {
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_MODE" });
  } catch (error) {
    console.debug("Unable to toggle Missouri", error);
  }
});

chrome.commands.onCommand.addListener(async (command: string) => {
  const messageType = COMMAND_TO_MESSAGE[command];
  if (!messageType) return;

  const tab = await getActiveTab();
  if (!tab?.id) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { type: messageType });
  } catch (error) {
    console.debug("Unable to deliver extension command", command, error);
  }
});

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab ?? null;
}
