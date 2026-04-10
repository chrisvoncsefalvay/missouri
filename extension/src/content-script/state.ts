import type { State, Refs, MarkerColor } from "./types";
import { getPageKey, getPageUrl } from "./utils";

export const ROOT_ID = "mo-marker-root";
export const REGISTRY_ID = "mo-marker-registry";
export const REGISTRY_EVENT = "__mo_marker_registry_update__";
export const STORAGE_PREFIX = "page::";

export const CURRENT_SCHEMA_VERSION = 1;

export const ROTATE_RADIUS = 76;
export const MARKER_EXCLUSION_RADIUS = 40;
export const MIN_TARGET_AREA = 20 * 20;
export const MAX_TARGET_AREA_RATIO = 0.6;

export const ANNOTATABLE_PRIORITY = [
  "button", "a", "input", "textarea", "select", "img", "video", "audio",
  "svg", "canvas", "table", "form", "details",
  "[role]", "section", "article", "main", "nav", "aside", "header", "footer",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "blockquote", "pre", "code", "li", "figcaption", "figure", "label",
  "div", "span"
];

export const ICON: Record<string, string> = {
  free: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m4 4 7.07 17 2.51-7.39L21 11.07z"/></svg>',
  element: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 9 5 12 1.8-5.2L21 14z"/><path d="m7.2 2.2.8 2.9"/><path d="m5.1 8-2.9-.8"/><path d="m14 5-.8 2.9"/><path d="m2.2 16.8 2.9-.8"/></svg>',
  list: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 12h-5"/><path d="M15 8h-5"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2"/></svg>',
  copy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
  settings: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/></svg>',
  hide: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.7 5.1A10.7 10.7 0 0 1 22 12c-.3.7-.7 1.4-1.2 2"/><path d="M14 14.2a3 3 0 0 1-4.2-4.2"/><path d="M17.5 17.5A10.7 10.7 0 0 1 2 12a10.7 10.7 0 0 1 4.5-5.2"/><path d="m2 2 20 20"/></svg>',
  send: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/></svg>',
  x: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>',
  highlight: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>',
  draw: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>',
  sponge: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>',
  focus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M2 12h4M18 12h4M12 2v4M12 18v4"/></svg>'
};

export const MARKER_COLORS: MarkerColor[] = [
  { fill: "#1c2735", border: "rgba(255, 255, 255, 0.22)", tail: "#1c2735" },
  { fill: "#2667d9", border: "rgba(255, 255, 255, 0.22)", tail: "#2667d9" },
  { fill: "#b5781f", border: "rgba(255, 255, 255, 0.22)", tail: "#b5781f" },
  { fill: "#7b56c9", border: "rgba(255, 255, 255, 0.22)", tail: "#7b56c9" }
];

export const state: State = {
  pageKey: getPageKey(location.href),
  pageUrl: getPageUrl(location.href),
  annotations: [],
  storageDegraded: false,
  mcpConnected: null,
  mode: "idle",
  placementMode: null,
  overlayVisible: true,
  toolbarCollapsed: false,
  hoveredElement: null,
  _lastClientX: 0,
  _lastClientY: 0,
  editingDraft: null,
  lastKnownHref: location.href,
  dragging: null,
  lastDragWasMove: false,
  placing: null,
  focusedMarkerId: null,
  _shiftDown: false,
  stickyColorIndex: 0,
  placedMarkerIds: new Set<string>(),
  placedHighlightIds: new Set<string>(),
  drawing: null,
  expandedPanel: null,
  settings: {
    attachmentMode: "point",
    colorblindMode: false,
    mcpEnabled: false,
    mcpPort: 18462
  }
};

export const renderedIds = new Set<string>();

export const refs: Refs = {
  root: null,
  layer: null,
  registry: null,
  toolbar: null,
  highlight: null,
  refHighlight: null,
  cursorMarker: null,
  editor: null,
  preview: null,
  pencilCursor: null,
  highlighterCursor: null
};
