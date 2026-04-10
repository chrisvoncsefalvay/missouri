import { vi } from "vitest";

/* ── Browser APIs not provided by jsdom ───────────────────── */

// jsdom doesn't provide a working matchMedia — force-override it
const matchMediaMock = vi.fn().mockImplementation((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));
try {
  Object.defineProperty(window, "matchMedia", { value: matchMediaMock, writable: true, configurable: true });
} catch {
  (window as any).matchMedia = matchMediaMock;
}
try {
  Object.defineProperty(globalThis, "matchMedia", { value: matchMediaMock, writable: true, configurable: true });
} catch {
  (globalThis as any).matchMedia = matchMediaMock;
}

/* ── Chrome extension API ────────────────────────────────── */

if (!(globalThis as any).chrome) {
  (globalThis as any).chrome = {
    runtime: {
      getURL: (path: string) => `chrome-extension://fake/${path}`,
      getManifest: () => ({ version: "0.1.0-test" }),
      onMessage: { addListener: vi.fn() },
    },
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
      },
      onChanged: {
        addListener: vi.fn(),
      },
    },
  };
}
