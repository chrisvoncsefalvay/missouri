/* ── Missouri – background service worker ─────────────────────────────────── */

const COMMAND_TO_MESSAGE: Record<string, string> = {
  "toggle-annotation-mode": "TOGGLE_MODE",
  "toggle-overlay-visibility": "TOGGLE_OVERLAY",
  "toggle-highlight-mode": "TOGGLE_HIGHLIGHT"
};

const CURRENT_SCHEMA_VERSION = 1;
const DEFAULT_MCP_PORT = 18462;
const RECONNECT_INTERVAL_MS = 3000;
const KEEPALIVE_ALARM = "missouri-mcp-keepalive";

// Suppress unused variable warning — kept for future reconnect logic
void RECONNECT_INTERVAL_MS;

let ws: WebSocket | null = null;
let mcpEnabled = false;
let mcpPort: number = DEFAULT_MCP_PORT;
let mcpSecret: string | null = null;
let hasWarnedStorageUnavailable = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

type ActiveTabOptions = {
  pageUrl?: string;
  requireContentScript?: boolean;
};

function isRecoverableStorageError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("IO error")
    || message.includes("LOCK")
    || message.includes("LockFile");
}

function warnStorageUnavailable(operation: string, error: unknown): void {
  if (hasWarnedStorageUnavailable) {
    return;
  }
  hasWarnedStorageUnavailable = true;
  console.warn(`Missouri background: storage unavailable during ${operation}; using in-memory defaults`, error);
}

async function ensureMcpSecret(): Promise<void> {
  const bytes = new Uint8Array(16);
  try {
    const stored = await chrome.storage.local.get("mo_mcp_secret");
    if (stored.mo_mcp_secret) {
      mcpSecret = stored.mo_mcp_secret as string;
      return;
    }

    crypto.getRandomValues(bytes);
    mcpSecret = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    await chrome.storage.local.set({ mo_mcp_secret: mcpSecret });
  } catch (error) {
    if (!isRecoverableStorageError(error)) {
      throw error;
    }
    crypto.getRandomValues(bytes);
    mcpSecret = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    warnStorageUnavailable("MCP secret setup", error);
  }
}

// ── Original command / action handlers ───────────────────────────────────────

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

  const tab = await getActiveTab({ requireContentScript: true });
  if (!tab?.id) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { type: messageType });
  } catch (error) {
    console.debug("Unable to deliver extension command", command, error);
  }
});

// ── MCP WebSocket bridge ─────────────────────────────────────────────────────

async function loadMcpSettings(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get("mo_settings");
    const settings = (stored.mo_settings as Record<string, any>) || {};
    mcpEnabled = Boolean(settings.mcpEnabled);
    mcpPort = (settings.mcpPort as number) || DEFAULT_MCP_PORT;
  } catch (error) {
    if (!isRecoverableStorageError(error)) {
      throw error;
    }
    mcpEnabled = false;
    mcpPort = DEFAULT_MCP_PORT;
    warnStorageUnavailable("MCP settings load", error);
  }
}

function connectWebSocket(): void {
  if (!mcpEnabled) return;
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;

  try {
    ws = new WebSocket(`ws://127.0.0.1:${mcpPort}`);
  } catch (err) {
    console.debug("[missouri-mcp] WebSocket construction failed:", err);
    ws = null;
    scheduleReconnect();
    return;
  }

  let authenticated = false;

  ws.addEventListener("open", () => {
    console.debug("[missouri-mcp] Connected, sending auth...");
    ws!.send(JSON.stringify({ type: "AUTH", secret: mcpSecret }));
  });

  ws.addEventListener("close", () => {
    console.debug("[missouri-mcp] Disconnected from MCP server");
    ws = null;
    authenticated = false;
    broadcastMcpStatus(false);
    scheduleReconnect();
  });

  ws.addEventListener("error", () => {
    ws = null;
    authenticated = false;
    scheduleReconnect();
  });

  ws.addEventListener("message", async (event: MessageEvent) => {
    let parsed: any;
    try {
      parsed = JSON.parse(
        typeof event.data === "string" ? event.data : await (event.data as Blob).text()
      );
    } catch {
      console.debug("[missouri-mcp] Bad message from MCP server");
      return;
    }

    if (!authenticated) {
      if (parsed.type === "AUTH_OK") {
        authenticated = true;
        console.debug("[missouri-mcp] Authenticated with MCP server");
        clearReconnectTimer();
        broadcastMcpStatus(true);
      } else {
        console.debug("[missouri-mcp] Auth failed, closing");
        ws!.close();
      }
      return;
    }

    handleMcpCommand(parsed);
  });
}

function disconnectWebSocket(): void {
  clearReconnectTimer();
  if (ws) {
    ws.close();
    ws = null;
  }
  broadcastMcpStatus(false);
}

function clearReconnectTimer(): void {
  if (!reconnectTimer) {
    return;
  }
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function scheduleReconnect(): void {
  if (!mcpEnabled) {
    clearReconnectTimer();
    return;
  }
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return;
  }
  if (reconnectTimer) {
    return;
  }
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    ensureMcpSecret()
      .then(() => connectWebSocket())
      .catch((error) => {
        console.debug("[missouri-mcp] Reconnect setup failed:", error);
        scheduleReconnect();
      });
  }, RECONNECT_INTERVAL_MS);
}

function broadcastMcpStatus(connected: boolean): void {
  chrome.runtime.sendMessage({ type: "MCP_STATUS", connected }).catch(() => {});
}

function isMcpConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

function sendToMcp(response: Record<string, any>): void {
  if (!isMcpConnected()) return;
  ws!.send(JSON.stringify(response));
}

// ── MCP command dispatch ─────────────────────────────────────────────────────

async function handleMcpCommand(request: any): Promise<void> {
  const { id, command, params } = request as {
    id: string;
    command: string;
    params: any;
  };

  try {
    let result: Record<string, any>;
    switch (command) {
      case "GET_ACTIVE_TAB":
        result = await cmdGetActiveTab();
        break;
      case "LIST_PAGES":
        result = await cmdListPages();
        break;
      case "LIST_ANNOTATIONS":
        result = await cmdListAnnotations(params);
        break;
      case "GET_ANNOTATION":
        result = await cmdGetAnnotation(params);
        break;
      case "CREATE_ANNOTATION":
        result = await cmdRelayToTab("MCP_CREATE_ANNOTATION", params);
        break;
      case "UPDATE_ANNOTATION":
        result = await cmdUpdateAnnotation(params);
        break;
      case "DELETE_ANNOTATION":
        result = await cmdRelayToTab("MCP_DELETE_ANNOTATION", params);
        break;
      case "FOCUS_ANNOTATION":
        result = await cmdRelayToTab("FOCUS_ANNOTATION", params);
        break;
      case "SCREENSHOT_ANNOTATION":
        result = await cmdScreenshot(params);
        break;
      case "HIGHLIGHT_ELEMENT":
        result = await cmdRelayToTab("MCP_HIGHLIGHT_ELEMENT", params);
        break;
      default:
        result = { ok: false, error: `Unknown command: ${command}` };
    }
    sendToMcp({ id, ...result });
  } catch (err) {
    sendToMcp({ id, ok: false, error: String(err) });
  }
}

// ── Command implementations ──────────────────────────────────────────────────

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  return getActiveTabWithOptions();
}

function normalizeTabUrl(url: string | undefined): string | null {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

async function getTabState(tabId: number): Promise<Record<string, any> | null> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "GET_STATE" });
    if ((response as any)?.ok && (response as any)?.state) {
      return (response as any).state as Record<string, any>;
    }
  } catch {
    // Tab does not currently have a reachable Missouri content script.
  }

  return null;
}

async function getActiveTabWithOptions(options: ActiveTabOptions = {}): Promise<chrome.tabs.Tab | null> {
  const normalizedTargetUrl = normalizeTabUrl(options.pageUrl);
  const tabs = await chrome.tabs.query({});
  const candidates = tabs
    .filter((tab) => tab.id !== undefined && normalizeTabUrl(tab.url) !== null)
    .sort((left, right) => {
      const activeDelta = Number(Boolean(right.active)) - Number(Boolean(left.active));
      if (activeDelta !== 0) {
        return activeDelta;
      }
      return (right.lastAccessed ?? 0) - (left.lastAccessed ?? 0);
    });

  let fallback: chrome.tabs.Tab | null = null;
  for (const tab of candidates) {
    const tabUrl = normalizeTabUrl(tab.url);
    if (!tabUrl) {
      continue;
    }
    if (normalizedTargetUrl && tabUrl !== normalizedTargetUrl) {
      continue;
    }

    fallback ??= tab;

    const state = await getTabState(tab.id!);
    if (!state) {
      continue;
    }

    const stateUrl = normalizeTabUrl(state.pageUrl as string | undefined);
    if (!normalizedTargetUrl || stateUrl === normalizedTargetUrl) {
      return tab;
    }
  }

  if (options.requireContentScript) {
    return null;
  }

  return fallback;
}

async function cmdGetActiveTab(): Promise<Record<string, any>> {
  const tab = await getActiveTab();
  if (!tab) return { ok: false, error: "No active tab" };
  return { ok: true, data: { url: tab.url, title: tab.title, tabId: tab.id } };
}

async function cmdListPages(): Promise<Record<string, any>> {
  const all = await chrome.storage.local.get(null);
  const pages: Array<{ pageUrl: string; annotationCount: number }> = [];
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith("page::")) continue;
    const annotations = Array.isArray(value)
      ? value
      : ((value as any)?.annotations ?? []);
    if (Array.isArray(annotations)) {
      pages.push({ pageUrl: key.slice(6), annotationCount: annotations.length });
    }
  }
  return { ok: true, data: pages };
}

async function cmdListAnnotations(params: any): Promise<Record<string, any>> {
  let pageUrl = params?.pageUrl as string | undefined;
  if (!pageUrl) {
    const tab = await getActiveTab();
    if (!tab?.url) return { ok: false, error: "No active tab or URL provided" };
    pageUrl = normalizeTabUrl(tab.url) ?? undefined;
    if (!pageUrl) return { ok: false, error: "No active tab or URL provided" };
  }
  const key = `page::${pageUrl}`;
  const stored = await chrome.storage.local.get(key);
  const raw = stored[key];
  const annotations = Array.isArray(raw) ? raw : ((raw as any)?.annotations ?? []);
  return { ok: true, data: { pageUrl, annotations } };
}

async function cmdGetAnnotation(params: any): Promise<Record<string, any>> {
  const targetId = params?.id as string | undefined;
  if (!targetId) return { ok: false, error: "Missing annotation id" };

  const all = await chrome.storage.local.get(null);
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith("page::")) continue;
    const annotations = Array.isArray(value)
      ? value
      : ((value as any)?.annotations ?? []);
    if (!Array.isArray(annotations)) continue;
    const found = (annotations as any[]).find((a) => a.id === targetId);
    if (found) return { ok: true, data: found };
  }
  return { ok: false, error: `Annotation '${targetId}' not found` };
}

async function cmdUpdateAnnotation(params: any): Promise<Record<string, any>> {
  const { id, note } = (params ?? {}) as { id?: string; note?: string };
  if (!id || !note) return { ok: false, error: "Missing id or note" };

  const all = await chrome.storage.local.get(null);
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith("page::")) continue;
    const annotations = [
      ...(Array.isArray(value) ? value : ((value as any)?.annotations ?? []))
    ] as any[];
    if (!Array.isArray(annotations)) continue;
    const idx = annotations.findIndex((a) => a.id === id);
    if (idx === -1) continue;
    annotations[idx] = { ...annotations[idx], note, updatedAt: new Date().toISOString() };
    const stored = Array.isArray(value)
      ? { schemaVersion: CURRENT_SCHEMA_VERSION, annotations }
      : { ...(value as object), annotations };
    await chrome.storage.local.set({ [key]: stored });

    const tab = await getActiveTab({
      pageUrl: key.slice(6),
      requireContentScript: true
    });
    if (tab?.id) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: "SAVE_ANNOTATION",
          annotation: { id, note }
        });
      } catch {
        // content script may not be available
      }
    }
    return { ok: true, data: annotations[idx] };
  }
  return { ok: false, error: `Annotation '${id}' not found` };
}

async function cmdRelayToTab(type: string, params: any): Promise<Record<string, any>> {
  const tab = await getActiveTab({
    pageUrl: params?.pageUrl as string | undefined,
    requireContentScript: true
  });
  if (!tab?.id) return { ok: false, error: "No reachable Missouri tab" };
  try {
    const message = params && typeof params === "object"
      ? { ...params, type, annotationType: params.type, authorName: params.authorName }
      : { type };
    const response = await chrome.tabs.sendMessage(tab.id, message);
    return (response as Record<string, any>) || { ok: true };
  } catch (err) {
    return { ok: false, error: `Content script unreachable: ${err}` };
  }
}

async function cmdScreenshot(params: any): Promise<Record<string, any>> {
  const tab = await getActiveTab({ requireContentScript: true });
  if (!tab?.id) return { ok: false, error: "No reachable Missouri tab" };

  let bounds: any;
  try {
    const res = await chrome.tabs.sendMessage(tab.id, {
      type: "MCP_GET_ANNOTATION_BOUNDS",
      id: params?.id
    });
    if (!(res as any)?.ok)
      return { ok: false, error: (res as any)?.error || "Could not locate annotation on page" };
    bounds = (res as any).data;
  } catch (err) {
    return { ok: false, error: `Content script unreachable: ${err}` };
  }

  let dataUrl: string;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId!, { format: "png" });
  } catch (err) {
    return { ok: false, error: `Screenshot failed: ${err}` };
  }

  const padding: number = (params?.padding as number) ?? 150;
  return {
    ok: true,
    data: {
      imageDataUrl: dataUrl,
      bounds,
      padding,
      width: (bounds.width as number) + padding * 2,
      height: (bounds.height as number) + padding * 2
    }
  };
}

// ── Settings sync + lifecycle ────────────────────────────────────────────────

chrome.storage.onChanged.addListener(
  (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== "local" || !changes.mo_settings) return;
    const newSettings = (changes.mo_settings.newValue as Record<string, any>) || {};
    const wasEnabled = mcpEnabled;
    const oldPort = mcpPort;

    mcpEnabled = Boolean(newSettings.mcpEnabled);
    mcpPort = (newSettings.mcpPort as number) || DEFAULT_MCP_PORT;

    if (mcpEnabled && (!wasEnabled || mcpPort !== oldPort)) {
      disconnectWebSocket();
      ensureMcpSecret().then(() => connectWebSocket());
      chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 });
    } else if (!mcpEnabled && wasEnabled) {
      disconnectWebSocket();
      chrome.alarms.clear(KEEPALIVE_ALARM);
    }
  }
);

chrome.alarms.onAlarm.addListener((alarm: chrome.alarms.Alarm) => {
  if (alarm.name === KEEPALIVE_ALARM && mcpEnabled) {
    ensureMcpSecret().then(() => connectWebSocket());
  }
});

// On startup, load settings and connect if enabled
loadMcpSettings()
  .then(async () => {
    await ensureMcpSecret();
    if (mcpEnabled) {
      connectWebSocket();
      scheduleReconnect();
      chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 });
    }
  })
  .catch((error) => {
    console.error("Missouri background failed to initialize", error);
  });

// Respond to status queries from popup / content script
chrome.runtime.onMessage.addListener(
  (
    message: any,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void
  ) => {
    if (message?.type === "GET_MCP_STATUS") {
      const payload: Record<string, any> = {
        connected: isMcpConnected(),
        enabled: mcpEnabled,
        port: mcpPort,
        mode: "local-stdio",
        requiresSecret: false,
        recommendedCommand: "claude mcp add missouri -- node /path/to/missouri-mcp-server/dist/index.js"
      };
      if (sender.id === chrome.runtime.id) {
        payload.secret = mcpSecret;
      }
      sendResponse(payload);
      return false;
    }
  }
);
