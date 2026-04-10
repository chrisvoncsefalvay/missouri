import { beforeEach, describe, expect, it, vi } from "vitest";
import { highlightElementFromApi } from "../../src/content-script/page-api";

describe("content-script page API helpers", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("highlights a matching DOM element and reports its tag", () => {
    const target = document.createElement("button");
    target.id = "target";
    target.textContent = "Save";
    target.scrollIntoView = vi.fn();
    target.getBoundingClientRect = vi.fn(() => ({
      left: 30,
      top: 40,
      width: 120,
      height: 36
    })) as any;
    document.body.appendChild(target);

    const result = highlightElementFromApi("#target");

    expect(result).toEqual({
      ok: true,
      data: { selector: "#target", tagName: "button" }
    });
    expect(target.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center"
    });

    const overlay = document.body.lastElementChild as HTMLElement | null;
    expect(overlay).not.toBeNull();
    expect(overlay?.style.left).toBe("26px");
    expect(overlay?.style.top).toBe("36px");
  });

  it("returns an error when highlight is requested for a missing selector", () => {
    expect(highlightElementFromApi("#does-not-exist")).toEqual({
      ok: false,
      error: "Element not found: #does-not-exist"
    });
  });
});
