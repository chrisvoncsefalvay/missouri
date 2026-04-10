import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const DEFAULT_URL = process.env.MISSOURI_CDP_TEST_URL || "https://example.com";

class CDPClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) {
          return;
        }

        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
          return;
        }

        pending.resolve(message.result);
        return;
      }

      for (const listener of this.listeners) {
        listener(message);
      }
    };

    ws.onerror = () => {
      for (const [, pending] of this.pending) {
        pending.reject(new Error("WebSocket error"));
      }
      this.pending.clear();
    };

    ws.onclose = () => {
      for (const [, pending] of this.pending) {
        pending.reject(new Error("WebSocket closed"));
      }
      this.pending.clear();
    };
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out connecting to ${url}`)), 5000);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`Could not open websocket ${url}`));
      };
    });

    return new CDPClient(ws);
  }

  async send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) {
      payload.sessionId = sessionId;
    }

    const result = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    this.ws.send(JSON.stringify(payload));
    return result;
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async waitForEvent(method, { sessionId, predicate, timeout = 5000 } = {}) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        dispose();
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeout);

      const dispose = this.onEvent((message) => {
        if (message.method !== method) {
          return;
        }

        if (sessionId && message.sessionId !== sessionId) {
          return;
        }

        if (predicate && !predicate(message.params || {})) {
          return;
        }

        clearTimeout(timer);
        dispose();
        resolve(message.params || {});
      });
    });
  }

  close() {
    this.ws.close();
  }
}

function findDevToolsActivePort() {
  const home = homedir();
  const candidates = [
    process.env.MISSOURI_DEVTOOLS_ACTIVE_PORT,
    join(home, "snap", "chromium", "common", "chromium", "DevToolsActivePort"),
    join(home, ".config", "chromium", "DevToolsActivePort"),
    join(home, ".config", "google-chrome", "DevToolsActivePort")
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "Could not find DevToolsActivePort. Set MISSOURI_DEVTOOLS_ACTIVE_PORT if your Chromium profile lives elsewhere."
  );
}

async function getBrowserWSEndpoint() {
  const portFile = findDevToolsActivePort();
  const [port, path] = readFileSync(portFile, "utf8").trim().split("\n");

  if (!port || !path) {
    throw new Error(`Malformed DevToolsActivePort file: ${portFile}`);
  }

  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (response.ok) {
      const payload = await response.json();
      if (payload.webSocketDebuggerUrl) {
        return {
          portFile,
          wsEndpoint: payload.webSocketDebuggerUrl
        };
      }
    }
  } catch {
    // Fall back to the port file if the HTTP discovery endpoint is unavailable.
  }

  return {
    portFile,
    wsEndpoint: `ws://127.0.0.1:${port}${path}`
  };
}

async function getMissouriWorker(context) {
  for (const worker of context) {
    if (!worker.url.startsWith("chrome-extension://")) {
      continue;
    }

    try {
      const { sessionId } = await worker.client.send("Target.attachToTarget", {
        targetId: worker.targetId,
        flatten: true
      });

      await worker.client.send("Runtime.enable", {}, sessionId);
      const evaluation = await worker.client.send("Runtime.evaluate", {
        expression: "JSON.stringify({ id: chrome.runtime.id, manifest: chrome.runtime.getManifest() })",
        returnByValue: true
      }, sessionId);

      const payload = JSON.parse(evaluation.result.value);
      if (payload.manifest?.name === "Missouri") {
        return { sessionId, extensionId: payload.id, manifest: payload.manifest };
      }

      await worker.client.send("Target.detachFromTarget", { sessionId });
    } catch {
      continue;
    }
  }

  throw new Error("Missouri service worker not found in attached Chromium session.");
}

async function evaluate(client, sessionId, expression) {
  const response = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  }, sessionId);

  return response.result.value;
}

async function poll(client, sessionId, expression, { timeout = 10000, interval = 250 } = {}) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const value = await evaluate(client, sessionId, expression);
    if (value) {
      return value;
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`Timed out waiting for condition: ${expression}`);
}

async function toggleModeThroughWorker(client, sessionId) {
  const result = await evaluate(
    client,
    sessionId,
    `new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        const [tab] = tabs;
        if (!tab?.id) {
          resolve({ ok: false, error: 'No active tab' });
          return;
        }

        try {
          const response = await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_MODE' });
          resolve({ ok: true, response });
        } catch (error) {
          resolve({ ok: false, error: String(error) });
        }
      });
    })`
  );

  if (!result?.ok) {
    throw new Error(result?.error || "Failed to toggle annotation mode");
  }
}

async function main() {
  const { portFile, wsEndpoint } = await getBrowserWSEndpoint();
  console.log(`Using ${portFile}`);
  console.log(`Connecting to ${wsEndpoint}`);

  const client = await CDPClient.connect(wsEndpoint);
  try {
    const targetResult = await client.send("Target.getTargets");
    const serviceWorkers = targetResult.targetInfos
      .filter((target) => target.type === "service_worker")
      .map((target) => ({
        client,
        targetId: target.targetId,
        url: target.url
      }));

    const { sessionId: workerSessionId, manifest, extensionId } = await getMissouriWorker(serviceWorkers);
    console.log(`Found Missouri ${manifest.version} (${extensionId})`);

    const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
    const attached = await client.send("Target.attachToTarget", {
      targetId,
      flatten: true
    });
    const pageSessionId = attached.sessionId;

    await client.send("Page.enable", {}, pageSessionId);
    await client.send("Runtime.enable", {}, pageSessionId);
    await client.send("Page.bringToFront", {}, pageSessionId);
    await client.send("Page.navigate", { url: DEFAULT_URL }, pageSessionId);
    await client.waitForEvent("Page.loadEventFired", { sessionId: pageSessionId, timeout: 10000 });

    await poll(client, pageSessionId, "Boolean(document.querySelector('#mo-marker-root'))", {
      timeout: 10000
    });

    await toggleModeThroughWorker(client, workerSessionId);

    const state = await poll(
      client,
      pageSessionId,
      `(() => {
        const root = document.querySelector('#mo-marker-root');
        if (!root || root.getAttribute('data-mode') !== 'annotate') {
          return null;
        }

        return {
          mode: root.getAttribute('data-mode'),
          url: location.href
        };
      })()`,
      { timeout: 5000 }
    );

    console.log(JSON.stringify({
      ok: true,
      url: state.url,
      mode: state.mode
    }, null, 2));
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
