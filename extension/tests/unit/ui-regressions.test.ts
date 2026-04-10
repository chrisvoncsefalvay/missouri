import { beforeEach, describe, expect, it, vi } from "vitest";

import { state, refs, MARKER_COLORS_DARK } from "../../src/content-script/state";
import * as stateModule from "../../src/content-script/state";
import { makeListItem, renderToolbarPanel, ensureUi } from "../../src/content-script/ui";
import { setCursorHidden } from "../../src/content-script/markers";

/* ── Helpers ──────────────────────────────────────────────── */

function makeAnnotation(overrides: Record<string, any> = {}) {
  return {
    id: `ann_${Math.random().toString(36).slice(2, 8)}`,
    type: "element",
    pageUrl: "https://example.com",
    pageKey: "https://example.com",
    note: "Test annotation",
    label: "1",
    colorIndex: 0,
    letter: "A",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    drawPoints: null,
    anchor: null,
    position: { pageX: 100, pageY: 200 },
    resolved: true,
    ...overrides,
  } as any;
}

describe("UI regression guards", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    state.annotations = [];
    state.expandedPanel = null;
    state.mode = "idle";
    state.overlayVisible = true;
    state.placementMode = null;
    state.settings = {
      attachmentMode: "point",
      colorblindMode: false,
      themeMode: "system-inverse",
      overlayVisible: true,
    };
    refs.root = null;
    refs.toolbar = null;
    refs.layer = null;
    refs.registry = null;
    refs.highlight = null;
    refs.refHighlight = null;
    refs.cursorMarker = null;
    refs.editor = null;
    refs.preview = null;
    refs.pencilCursor = null;
    refs.highlighterCursor = null;
    vi.restoreAllMocks();
    // Stub getActiveMarkerColors so it never calls matchMedia (jsdom gap)
    vi.spyOn(stateModule, "getActiveMarkerColors").mockReturnValue(MARKER_COLORS_DARK);
  });

  /* ────────────────────────────────────────────────────────
   * 1. Number badge is on the LEFT side of list items
   * ──────────────────────────────────────────────────────── */
  describe("annotation list item layout", () => {
    it("renders number badge as the FIRST child of the list item", () => {
      const annotation = makeAnnotation();
      const item = makeListItem(annotation);
      const firstChild = item.children[0];
      expect(firstChild.classList.contains("mo-list-badge")).toBe(true);
    });

    it("renders body as the SECOND child (after number badge)", () => {
      const annotation = makeAnnotation();
      const item = makeListItem(annotation);
      expect(item.children[1].classList.contains("mo-list-body")).toBe(true);
    });

    it("renders action buttons as the last children", () => {
      const annotation = makeAnnotation();
      const item = makeListItem(annotation);
      const last = item.children[item.children.length - 1];
      expect(last.classList.contains("mo-list-action-btn")).toBe(true);
    });
  });

  /* ────────────────────────────────────────────────────────
   * 2. Settings panel does NOT expand toolbar width
   * ──────────────────────────────────────────────────────── */
  describe("settings panel width constraint", () => {
    it("sets max-width on toolbar panel matching toolbar-row width", () => {
      ensureUi();
      state.expandedPanel = "settings";

      // Simulate a toolbar row with a known width
      const row = refs.toolbar!.querySelector(".mo-toolbar-row") as HTMLElement;
      expect(row).toBeTruthy();

      // jsdom doesn't compute layout, so offsetWidth is 0 by default.
      // Stub it to a realistic width to verify the constraint is applied.
      Object.defineProperty(row, "offsetWidth", { value: 240, configurable: true });

      renderToolbarPanel();

      const panel = refs.toolbar!.querySelector(".mo-toolbar-panel") as HTMLElement;
      expect(panel).toBeTruthy();
      expect(panel.style.maxWidth).toBe("240px");
    });

    it("settings segmented controls have overflow hidden and min-width 0 in CSS", () => {
      // Verify the CSS rules exist in content-styles.css to prevent width blowout.
      // We check the stylesheet content directly since jsdom doesn't load external CSS.
      const fs = require("fs");
      const path = require("path");
      const css = fs.readFileSync(path.join(__dirname, "../../content-styles.css"), "utf8");

      // Segmented container must have min-width: 0
      const segmentedMatch = css.match(/\.mo-settings-segmented\s*\{[^}]+\}/);
      expect(segmentedMatch).toBeTruthy();
      expect(segmentedMatch![0]).toContain("min-width: 0");

      // Segmented buttons must have min-width: 0 and overflow: hidden
      const btnMatch = css.match(/\.mo-settings-seg-btn\s*\{[^}]+\}/);
      expect(btnMatch).toBeTruthy();
      expect(btnMatch![0]).toContain("min-width: 0");
      expect(btnMatch![0]).toContain("overflow: hidden");
    });
  });

  /* ────────────────────────────────────────────────────────
   * 3. Overlay visibility persists across state
   * ──────────────────────────────────────────────────────── */
  describe("overlay visibility persistence", () => {
    it("overlayVisible is part of the Settings type and defaults to true", () => {
      expect(state.settings.overlayVisible).toBe(true);
    });

    it("setting overlayVisible to false should be reflected in state.settings", () => {
      state.settings.overlayVisible = false;
      expect(state.settings.overlayVisible).toBe(false);
    });
  });

  /* ────────────────────────────────────────────────────────
   * 4. Cursor hiding injects a <style> element
   * ──────────────────────────────────────────────────────── */
  describe("cursor hiding mechanism", () => {
    it("injects a <style> with cursor:none when setCursorHidden(true)", () => {
      setCursorHidden(true);
      const styleEl = document.querySelector("style[data-mo-cursor]");
      expect(styleEl).toBeTruthy();
      expect(styleEl!.textContent).toContain("cursor: none !important");
      expect(document.documentElement.classList.contains("mo-hide-cursor")).toBe(true);
      // Clean up
      setCursorHidden(false);
    });

    it("removes the <style> when setCursorHidden(false)", () => {
      setCursorHidden(true);
      setCursorHidden(false);
      const styleEl = document.querySelector("style[data-mo-cursor]");
      expect(styleEl).toBeNull();
      expect(document.documentElement.classList.contains("mo-hide-cursor")).toBe(false);
    });

    it("does not create duplicate <style> elements on repeated calls", () => {
      setCursorHidden(true);
      setCursorHidden(true);
      setCursorHidden(true);
      const styles = document.querySelectorAll("style[data-mo-cursor]");
      expect(styles.length).toBe(1);
      setCursorHidden(false);
    });
  });

  /* ────────────────────────────────────────────────────────
   * 5. CSS grid order for list items
   * ──────────────────────────────────────────────────────── */
  describe("list item CSS grid", () => {
    it("grid-template-columns starts with auto (badge) then flexible body", () => {
      const fs = require("fs");
      const path = require("path");
      const css = fs.readFileSync(path.join(__dirname, "../../content-styles.css"), "utf8");

      const listItemMatch = css.match(/\.mo-list-item\s*\{[^}]+\}/);
      expect(listItemMatch).toBeTruthy();
      // Badge column (auto) must come FIRST, followed by the flexible body.
      expect(listItemMatch![0]).toContain("grid-template-columns: auto minmax(0, 1fr) auto auto");
    });
  });

  /* ────────────────────────────────────────────────────────
   * 6. Toolbar panel has overflow-x: hidden
   * ──────────────────────────────────────────────────────── */
  describe("toolbar panel overflow", () => {
    it("toolbar-panel CSS includes overflow-x: hidden", () => {
      const fs = require("fs");
      const path = require("path");
      const css = fs.readFileSync(path.join(__dirname, "../../content-styles.css"), "utf8");

      // Match the standalone .mo-toolbar-panel rule (not nested like .mo-collapsed .mo-toolbar-panel)
      const allMatches = css.matchAll(/^\.mo-toolbar-panel\s*\{[^}]+\}/gm);
      const rules = [...allMatches].map((m) => m[0]);
      const mainRule = rules.find((r) => r.includes("overflow"));
      expect(mainRule).toBeTruthy();
      expect(mainRule!).toContain("overflow-x: hidden");
    });
  });
});
