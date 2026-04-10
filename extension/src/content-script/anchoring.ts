import type { ElementAnchor, TextRangeAnchor } from "./types";
import { state, refs, ANNOTATABLE_PRIORITY, MIN_TARGET_AREA, MAX_TARGET_AREA_RATIO } from "./state";
import { escapeCssIdentifier } from "./utils";
import { showHighlightForElement } from "./markers";

export function captureElementAnchor(element: Element | null): ElementAnchor | null {
  if (!element) {
    return null;
  }

  return {
    selector: makeCssPath(element),
    domPath: makeDomPath(element),
    text: element.textContent?.trim().slice(0, 120) || "",
    tagName: element.tagName.toLowerCase()
  };
}

export function captureTextRangeAnchor(range: Range, selectedText: string): TextRangeAnchor {
  return {
    type: "textRange",
    selectedText,
    startPath: makeTextNodePath(range.startContainer),
    startOffset: range.startOffset,
    endPath: makeTextNodePath(range.endContainer),
    endOffset: range.endOffset
  };
}

export function findAnchoredElement(anchor: ElementAnchor | TextRangeAnchor | null): Element | null {
  if (!anchor) {
    return null;
  }

  const elemAnchor = anchor as ElementAnchor;

  if (elemAnchor.selector) {
    try {
      const match = document.querySelector(elemAnchor.selector);
      if (match) {
        return match;
      }
    } catch (_error) {
    }
  }

  if (Array.isArray(elemAnchor.domPath)) {
    const match = readDomPath(elemAnchor.domPath);
    if (match) {
      return match;
    }
  }

  if (elemAnchor.text) {
    const candidates = Array.from(document.querySelectorAll(elemAnchor.tagName || "*"));
    const match = candidates.find((element) => element.textContent?.trim().includes(elemAnchor.text));
    if (match) {
      return match;
    }
  }

  return null;
}

export function resolveTextRange(anchor: TextRangeAnchor | null): Range | null {
  if (!anchor || anchor.type !== "textRange") return null;

  const startNode = resolveTextNodePath(anchor.startPath);
  const endNode = resolveTextNodePath(anchor.endPath);
  if (startNode && endNode) {
    try {
      const range = document.createRange();
      range.setStart(startNode, Math.min(anchor.startOffset, (startNode as any).length || 0));
      range.setEnd(endNode, Math.min(anchor.endOffset, (endNode as any).length || 0));
      if (range.toString().trim() === anchor.selectedText) return range;
    } catch (_e) {}
  }

  if (anchor.selectedText) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let fullText = "";
    const nodes: Array<{ node: Node; start: number }> = [];
    while (walker.nextNode()) {
      if (refs.root && refs.root.contains(walker.currentNode)) continue;
      nodes.push({ node: walker.currentNode, start: fullText.length });
      fullText += walker.currentNode.textContent;
    }
    const idx = fullText.indexOf(anchor.selectedText);
    if (idx >= 0) {
      const endIdx = idx + anchor.selectedText.length;
      let startInfo: { node: Node; offset: number } | null = null;
      let endInfo: { node: Node; offset: number } | null = null;
      for (const n of nodes) {
        const nodeEnd = n.start + (n.node.textContent?.length || 0);
        if (!startInfo && nodeEnd > idx) {
          startInfo = { node: n.node, offset: idx - n.start };
        }
        if (!endInfo && nodeEnd >= endIdx) {
          endInfo = { node: n.node, offset: endIdx - n.start };
        }
        if (startInfo && endInfo) break;
      }
      if (startInfo && endInfo) {
        try {
          const range = document.createRange();
          range.setStart(startInfo.node, startInfo.offset);
          range.setEnd(endInfo.node, endInfo.offset);
          return range;
        } catch (_e) {}
      }
    }
  }

  return null;
}

export function makeCssPath(element: Element): string {
  const segments: string[] = [];
  let current: Element | null = element;
  while (current && current.nodeType === Node.ELEMENT_NODE && segments.length < 6) {
    let segment = current.tagName.toLowerCase();
    if (current.id) {
      segment += `#${escapeCssIdentifier(current.id)}`;
      segments.unshift(segment);
      break;
    }
    const className = Array.from(current.classList).slice(0, 2).map(escapeCssIdentifier).join(".");
    if (className) {
      segment += `.${className}`;
    }
    const siblingIndex = getElementIndex(current);
    segment += `:nth-of-type(${siblingIndex})`;
    segments.unshift(segment);
    current = current.parentElement;
  }
  return segments.join(" > ");
}

export function makeDomPath(element: Element): number[] {
  const path: number[] = [];
  let current: Element | null = element;
  while (current && current !== document.body && path.length < 8) {
    path.unshift(getElementIndex(current) - 1);
    current = current.parentElement;
  }
  return path;
}

export function readDomPath(path: number[]): Element | null {
  let current: Element = document.body;
  for (const index of path) {
    if (!current?.children?.[index]) {
      return null;
    }
    current = current.children[index];
  }
  return current;
}

export function makeTextNodePath(node: Node): number[] {
  const path: number[] = [];
  let current: Node | null = node;
  while (current && current !== document.body && current !== document.documentElement) {
    const parent: Node | null = current.parentNode;
    if (!parent) break;
    if (refs.root && refs.root.contains(current)) return path;
    const children = Array.from(parent.childNodes);
    path.unshift(children.indexOf(current as ChildNode));
    current = parent;
  }
  return path;
}

export function resolveTextNodePath(path: number[]): Node | null {
  let current: Node = document.body;
  for (const index of path) {
    if (!current?.childNodes?.[index]) return null;
    current = current.childNodes[index];
  }
  return current;
}

export function getElementIndex(element: Element): number {
  const siblings = Array.from(element.parentElement?.children || []).filter(
    (candidate) => candidate.tagName === element.tagName
  );
  return Math.max(siblings.indexOf(element) + 1, 1);
}

export function getAnnotatableTarget(start: EventTarget | null): Element | null {
  const target = start instanceof Element ? start : null;
  if (!target) return null;
  if (refs.root?.contains(target)) return null;

  const vpArea = window.innerWidth * window.innerHeight;

  let bestCandidate: Element | null = null;
  let bestPriority = ANNOTATABLE_PRIORITY.length + 1;
  let el: Element | null = target;

  while (el && el !== document.body && el !== document.documentElement) {
    if (refs.root?.contains(el)) break;

    for (let p = 0; p < ANNOTATABLE_PRIORITY.length; p++) {
      if (p >= bestPriority) break;
      try {
        if (el.matches(ANNOTATABLE_PRIORITY[p])) {
          const rect = el.getBoundingClientRect();
          const area = rect.width * rect.height;
          if (area >= MIN_TARGET_AREA && area < vpArea * MAX_TARGET_AREA_RATIO) {
            bestCandidate = el;
            bestPriority = p;
          }
          break;
        }
      } catch (_) { break; }
    }
    el = el.parentElement;
  }

  return bestCandidate;
}

export function zoomElementSelection(direction: number): void {
  const current = state.hoveredElement;
  if (!current) return;

  const cx = state._lastClientX;
  const cy = state._lastClientY;
  const vpArea = window.innerWidth * window.innerHeight;

  if (direction < 0) {
    let best: Element | null = null;
    let bestArea = Infinity;
    for (const child of Array.from(current.children)) {
      if (refs.root?.contains(child)) continue;
      const rect = child.getBoundingClientRect();
      if (cx < rect.left || cx > rect.right || cy < rect.top || cy > rect.bottom) continue;
      const area = rect.width * rect.height;
      if (area < MIN_TARGET_AREA) continue;
      if (area < bestArea) {
        best = child;
        bestArea = area;
      }
    }
    if (best) {
      state.hoveredElement = best;
      showHighlightForElement(best);
    }
  } else {
    let parent = current.parentElement;
    while (parent && parent !== document.body && parent !== document.documentElement) {
      if (refs.root?.contains(parent)) { parent = parent.parentElement; continue; }
      const rect = parent.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area >= MIN_TARGET_AREA && area < vpArea * MAX_TARGET_AREA_RATIO) {
        state.hoveredElement = parent;
        showHighlightForElement(parent);
        return;
      }
      parent = parent.parentElement;
    }
  }
}
