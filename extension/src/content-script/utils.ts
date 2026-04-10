import { STORAGE_PREFIX } from "./state";

import type { ThemeMode } from "./types";

export type PageTheme = "light" | "dark";

export function makeId(): string {
  return `marker_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function animateOut(element: HTMLElement, closingClass: string): void {
  element.classList.add(closingClass);
  const onDone = () => element.remove();
  element.addEventListener("animationend", onDone, { once: true });
  setTimeout(() => { if (element.parentNode) element.remove(); }, 400);
}

export function getPageKey(href: string): string {
  const url = new URL(href);
  url.hash = "";
  return url.toString();
}

export function getPageUrl(href: string): string {
  return getPageKey(href);
}

export function storageKeyForPage(pageKey: string): string {
  return `${STORAGE_PREFIX}${pageKey}`;
}

export function formatRelativeTime(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
  if (diff < 86400000) return Math.floor(diff / 3600000) + "h ago";
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function pointsToSvgPath(points: Array<{ x: number; y: number }>): string {
  if (points.length < 2) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  if (points.length === 2) {
    d += ` L ${points[1].x} ${points[1].y}`;
    return d;
  }
  for (let i = 1; i < points.length - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    d += ` Q ${points[i].x} ${points[i].y} ${midX} ${midY}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

export function clipLineToRectEdge(fromX: number, fromY: number, toX: number, toY: number, rect: DOMRect): { x: number; y: number } {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = fromX - cx;
  const dy = fromY - cy;
  if (dx === 0 && dy === 0) return { x: toX, y: toY };
  const hw = rect.width / 2;
  const hh = rect.height / 2;
  const scaleX = hw > 0 ? Math.abs(dx) / hw : Infinity;
  const scaleY = hh > 0 ? Math.abs(dy) / hh : Infinity;
  const scale = Math.max(scaleX, scaleY);
  if (scale === 0) return { x: toX, y: toY };
  return { x: cx + dx / scale, y: cy + dy / scale };
}

export interface AnchorLineOptions {
  segments: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  color: string;
  arrowAt: "end";
  extraClass?: string;
}

/**
 * Create an SVG anchor line matching freehand stroke style (3px, round caps)
 * with an arrowhead. Returns an absolutely-positioned SVG element.
 */
export function createAnchorLineSvg(opts: AnchorLineOptions): SVGSVGElement {
  const { segments, color, arrowAt, extraClass } = opts;
  if (segments.length === 0) {
    const empty = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    return empty;
  }

  // Compute bounding box with padding for arrowhead
  const PAD = 14;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of segments) {
    minX = Math.min(minX, s.x1, s.x2);
    minY = Math.min(minY, s.y1, s.y2);
    maxX = Math.max(maxX, s.x1, s.x2);
    maxY = Math.max(maxY, s.y1, s.y2);
  }
  const vbX = minX - PAD;
  const vbY = minY - PAD;
  const vbW = maxX - minX + PAD * 2;
  const vbH = maxY - minY + PAD * 2;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", `mo-anchor-line mo-marker-visible${extraClass ? " " + extraClass : ""}`);
  svg.setAttribute("viewBox", `${vbX} ${vbY} ${vbW} ${vbH}`);
  svg.style.cssText = `position:fixed;left:${vbX}px;top:${vbY}px;width:${vbW}px;height:${vbH}px;pointer-events:none;overflow:visible;`;

  // Solid triangular arrowhead
  const markerId = `mo-arrow-${Math.random().toString(36).slice(2, 8)}`;
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
  marker.setAttribute("id", markerId);
  marker.setAttribute("markerWidth", "4");
  marker.setAttribute("markerHeight", "4");
  marker.setAttribute("refX", "3.5");
  marker.setAttribute("refY", "2");
  marker.setAttribute("orient", "auto");
  marker.setAttribute("markerUnits", "strokeWidth");
  const arrowPath = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  arrowPath.setAttribute("points", "0,0 4,2 0,4");
  arrowPath.setAttribute("fill", color);
  marker.appendChild(arrowPath);
  defs.appendChild(marker);
  svg.appendChild(defs);

  // Draw line segments
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(s.x1));
    line.setAttribute("y1", String(s.y1));
    line.setAttribute("x2", String(s.x2));
    line.setAttribute("y2", String(s.y2));
    line.setAttribute("stroke", color);
    line.setAttribute("stroke-width", "3");
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("fill", "none");

    // Place arrowhead on the last segment
    if (i === segments.length - 1) {
      line.setAttribute("marker-end", `url(#${markerId})`);
    }

    svg.appendChild(line);
  }

  return svg;
}

/**
 * Build anchor line segments for the orthogonal attachment mode.
 */
export function orthogonalSegments(sx: number, sy: number, ex: number, ey: number): Array<{ x1: number; y1: number; x2: number; y2: number }> {
  const segs: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  const cornerX = ex;
  const cornerY = sy;
  if (Math.abs(cornerX - sx) > 1) {
    segs.push({ x1: sx, y1: sy, x2: cornerX, y2: sy });
  }
  if (Math.abs(ey - cornerY) > 1) {
    segs.push({ x1: cornerX, y1: cornerY, x2: ex, y2: ey });
  }
  return segs;
}

/**
 * Build anchor line segments for the leadline attachment mode.
 */
export function leadlineSegments(sx: number, sy: number, ex: number, ey: number): Array<{ x1: number; y1: number; x2: number; y2: number }> {
  const segs: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  const stubLen = 24;
  const stubDir = ex >= sx ? 1 : -1;
  const stubEndX = sx + stubLen * stubDir;
  segs.push({ x1: sx, y1: sy, x2: stubEndX, y2: sy });
  const leadLen = Math.hypot(ex - stubEndX, ey - sy);
  if (leadLen > 1) {
    segs.push({ x1: stubEndX, y1: sy, x2: ex, y2: ey });
  }
  return segs;
}

export function hexToRgba(hex: string, alpha: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function escapeCssIdentifier(value: string): string {
  return CSS.escape ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

export function inferThemeFromCssColor(value: string): PageTheme | null {
  const parsed = parseCssColor(value);
  if (!parsed || parsed.a === 0) {
    return null;
  }

  const toLinear = (channel: number): number => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };

  const luminance =
    0.2126 * toLinear(parsed.r) +
    0.7152 * toLinear(parsed.g) +
    0.0722 * toLinear(parsed.b);

  return luminance < 0.34 ? "dark" : "light";
}

export function detectPageTheme(doc: Document = document): PageTheme {
  const rootStyle = getComputedStyle(doc.documentElement);
  const declaredScheme = rootStyle.colorScheme.toLowerCase();

  if (declaredScheme.includes("dark") && !declaredScheme.includes("light")) {
    return "dark";
  }

  if (declaredScheme.includes("light") && !declaredScheme.includes("dark")) {
    return "light";
  }

  const body = doc.body;
  const candidates = [body, doc.documentElement];

  for (const element of candidates) {
    if (!element) {
      continue;
    }

    const inferred = inferThemeFromCssColor(getComputedStyle(element).backgroundColor);
    if (inferred) {
      return inferred;
    }
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(mode: ThemeMode): PageTheme {
  const page = detectPageTheme();
  switch (mode) {
    case "light": return "light";
    case "dark": return "dark";
    case "system": return page;
    case "system-inverse": return page === "dark" ? "light" : "dark";
  }
  return page;
}

function parseCssColor(value: string): { r: number; g: number; b: number; a: number } | null {
  const normalized = value.trim().toLowerCase();
  const rgbMatch = normalized.match(
    /^rgba?\(\s*([0-9.]+)\s*[, ]\s*([0-9.]+)\s*[, ]\s*([0-9.]+)(?:\s*[,/]\s*([0-9.]+))?\s*\)$/
  );

  if (rgbMatch) {
    return {
      r: Number(rgbMatch[1]),
      g: Number(rgbMatch[2]),
      b: Number(rgbMatch[3]),
      a: rgbMatch[4] == null ? 1 : Number(rgbMatch[4])
    };
  }

  const hexMatch = normalized.match(/^#([0-9a-f]{3,8})$/i);
  if (!hexMatch) {
    return null;
  }

  const hex = hexMatch[1];
  if (hex.length === 3 || hex.length === 4) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
      a: hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1
    };
  }

  if (hex.length === 6 || hex.length === 8) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
    };
  }

  return null;
}
