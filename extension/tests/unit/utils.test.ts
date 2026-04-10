import { describe, it, expect } from "vitest";
import {
  makeId,
  clamp,
  hexToRgba,
  getPageKey,
  storageKeyForPage,
  pointsToSvgPath,
  inferThemeFromCssColor,
} from "../../src/content-script/utils";

describe("makeId", () => {
  it("returns a unique string starting with marker_", () => {
    const id = makeId();
    expect(id).toMatch(/^marker_[a-z0-9]+_[a-z0-9]+$/);
  });

  it("returns unique ids on consecutive calls", () => {
    const ids = new Set(Array.from({ length: 100 }, () => makeId()));
    expect(ids.size).toBe(100);
  });
});

describe("clamp", () => {
  it("clamps below min", () => expect(clamp(-5, 0, 10)).toBe(0));
  it("clamps above max", () => expect(clamp(15, 0, 10)).toBe(10));
  it("passes through in range", () => expect(clamp(5, 0, 10)).toBe(5));
  it("handles equal min/max", () => expect(clamp(5, 3, 3)).toBe(3));
});

describe("hexToRgba", () => {
  it("converts hex to rgba", () => {
    expect(hexToRgba("#ff0000", "0.5")).toBe("rgba(255, 0, 0, 0.5)");
  });
  it("handles black", () => {
    expect(hexToRgba("#000000", "1")).toBe("rgba(0, 0, 0, 1)");
  });
  it("handles white", () => {
    expect(hexToRgba("#ffffff", "0.3")).toBe("rgba(255, 255, 255, 0.3)");
  });
});

describe("getPageKey", () => {
  it("strips hash from URL", () => {
    expect(getPageKey("https://example.com/page#section")).toBe("https://example.com/page");
  });
  it("preserves query params", () => {
    expect(getPageKey("https://example.com/page?q=1#top")).toBe("https://example.com/page?q=1");
  });
  it("handles URL without hash", () => {
    expect(getPageKey("https://example.com/page")).toBe("https://example.com/page");
  });
});

describe("storageKeyForPage", () => {
  it("prefixes with page::", () => {
    expect(storageKeyForPage("https://example.com")).toBe("page::https://example.com");
  });
});

describe("pointsToSvgPath", () => {
  it("returns empty for < 2 points", () => {
    expect(pointsToSvgPath([{ x: 0, y: 0 }])).toBe("");
  });
  it("creates line for 2 points", () => {
    expect(pointsToSvgPath([{ x: 0, y: 0 }, { x: 10, y: 10 }])).toBe("M 0 0 L 10 10");
  });
  it("creates quadratic curves for 3+ points", () => {
    const path = pointsToSvgPath([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }]);
    expect(path).toContain("Q");
    expect(path).toContain("M 0 0");
  });
});

describe("inferThemeFromCssColor", () => {
  it("detects dark rgb colors", () => {
    expect(inferThemeFromCssColor("rgb(24, 30, 41)")).toBe("dark");
  });

  it("detects light rgba colors", () => {
    expect(inferThemeFromCssColor("rgba(248, 249, 251, 0.95)")).toBe("light");
  });

  it("returns null for transparent colors", () => {
    expect(inferThemeFromCssColor("rgba(0, 0, 0, 0)")).toBeNull();
  });
});
