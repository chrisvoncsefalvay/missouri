import { state } from "./state";
import { saveDraft } from "./annotations";

export async function createAnnotationFromApi(params: any): Promise<any> {
  const type = params.annotationType || params.type || "free";
  const note = params.note || "";
  const colorIndex = params.colorIndex ?? 3;
  const authorName = params.authorName || "Agent";

  if (type === "element" && params.selector) {
    const element = document.querySelector(params.selector);
    if (!element) return { ok: false, error: `Element not found for selector: ${params.selector}` };
    const rect = element.getBoundingClientRect();
    const pageX = rect.left + window.scrollX + rect.width / 2;
    const pageY = rect.top + window.scrollY + Math.min(rect.height / 2, 30);
    await saveDraft({
      type: "element",
      authorName,
      note,
      colorIndex,
      element,
      pageX,
      pageY
    });
    const created = state.annotations[state.annotations.length - 1];
    return { ok: true, data: created };
  }

  const pageX = params.pageX ?? 100;
  const pageY = params.pageY ?? 100;
  await saveDraft({
    type: "free",
    authorName,
    note,
    colorIndex,
    pageX,
    pageY
  });
  const created = state.annotations[state.annotations.length - 1];
  return { ok: true, data: created };
}

export function highlightElementFromApi(selector: string): any {
  if (!selector) return { ok: false, error: "Missing selector" };
  const element = document.querySelector(selector);
  if (!element) return { ok: false, error: `Element not found: ${selector}` };

  const rect = element.getBoundingClientRect();
  element.scrollIntoView({ behavior: "smooth", block: "center" });

  const overlay = document.createElement("div");
  overlay.style.cssText = `
    position: fixed;
    left: ${rect.left - 4}px;
    top: ${rect.top - 4}px;
    width: ${rect.width + 8}px;
    height: ${rect.height + 8}px;
    border: 2px solid rgba(37, 99, 235, 0.7);
    border-radius: 8px;
    background: rgba(37, 99, 235, 0.04);
    pointer-events: none;
    z-index: 2147483646;
    transition: opacity 0.5s ease-out;
  `;
  document.body.appendChild(overlay);
  setTimeout(() => { overlay.style.opacity = "0"; }, 2500);
  setTimeout(() => overlay.remove(), 3200);

  return { ok: true, data: { selector, tagName: element.tagName.toLowerCase() } };
}
