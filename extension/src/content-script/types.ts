export interface MarkerColor {
  fill: string;
  border: string;
  tail: string;
}

export interface Position {
  pageX: number;
  pageY: number;
}

export interface ElementAnchor {
  selector: string;
  domPath: number[];
  text: string;
  tagName: string;
}

export interface TextRangeAnchor {
  type: "textRange";
  selectedText: string;
  startPath: number[];
  startOffset: number;
  endPath: number[];
  endOffset: number;
}

export interface Annotation {
  id: string;
  type: "free" | "element" | "highlight" | "draw";
  authorName?: string | null;
  pageUrl: string;
  pageKey: string;
  note: string;
  label: string | null;
  colorIndex: number;
  letter: string | null;
  createdAt: string;
  updatedAt: string;
  drawPoints: Array<{ x: number; y: number }> | null;
  anchor: ElementAnchor | TextRangeAnchor | null;
  position: Position;
  resolved: boolean;
  elementCenter?: Position | null;
  dragged?: boolean;
  dragAngle?: number | null;
  dragAnchor?: Position | null;
  _resolvedRange?: Range | null;
}

export interface Settings {
  attachmentMode: "point" | "orthogonal" | "leadline";
  colorblindMode: boolean;
  mcpEnabled: boolean;
  mcpPort: number;
}

export interface State {
  pageKey: string;
  pageUrl: string;
  annotations: Annotation[];
  storageDegraded: boolean;
  mcpConnected: boolean | null;
  mode: "idle" | "annotate";
  placementMode: string | null;
  overlayVisible: boolean;
  toolbarCollapsed: boolean;
  hoveredElement: Element | null;
  _lastClientX: number;
  _lastClientY: number;
  editingDraft: any;
  lastKnownHref: string;
  dragging: DragState | null;
  lastDragWasMove: boolean;
  placing: PlacingState | null;
  focusedMarkerId: string | null;
  _shiftDown: boolean;
  stickyColorIndex: number;
  placedMarkerIds: Set<string>;
  placedHighlightIds: Set<string>;
  drawing: DrawingState | null;
  expandedPanel: string | null;
  settings: Settings;
}

export interface Refs {
  root: HTMLElement | null;
  layer: HTMLElement | null;
  registry: HTMLElement | null;
  toolbar: HTMLElement | null;
  highlight: HTMLElement | null;
  refHighlight: HTMLElement | null;
  cursorMarker: HTMLElement | null;
  editor: HTMLElement | null;
  preview: HTMLElement | null;
  pencilCursor: HTMLElement | null;
  highlighterCursor: HTMLElement | null;
}

export interface DragState {
  markerId: string;
  startClientX: number;
  startClientY: number;
  origPageX: number;
  origPageY: number;
  anchorPageX: number;
  anchorPageY: number;
  moved: boolean;
  liveLine?: HTMLElement[] | null;
  floatingDot?: HTMLElement | null;
}

export interface PlacingState {
  draft: any;
  startClientX: number;
  startClientY: number;
  origPageX: number;
  origPageY: number;
  moved: boolean;
}

export interface DrawingState {
  points: Array<{ x: number; y: number }>;
  colorIndex: number;
  svg: SVGSVGElement;
  path: SVGPathElement;
}

export interface StoredData {
  schemaVersion: number;
  annotations: Annotation[];
}
