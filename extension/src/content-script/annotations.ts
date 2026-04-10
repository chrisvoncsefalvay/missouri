import type { Annotation, StoredData } from "./types";
import { state, refs, renderedIds, CURRENT_SCHEMA_VERSION, getActiveMarkerColors } from "./state";
import { undoStack } from "./undo";
import { makeId, storageKeyForPage } from "./utils";
import { captureElementAnchor, findAnchoredElement, resolveTextRange } from "./anchoring";
import { render } from "./markers";

let hasWarnedStorageUnavailable = false;

function isRecoverableStorageError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("Extension context invalidated")
    || message.includes("IO error")
    || message.includes("LOCK")
    || message.includes("LockFile");
}

function warnStorageUnavailable(operation: string, error: unknown): void {
  if (hasWarnedStorageUnavailable) {
    return;
  }
  hasWarnedStorageUnavailable = true;
  console.warn(`Missouri: storage unavailable during ${operation}; continuing without persisted data`, error);
}

function markStorageDegraded(operation: string, error: unknown): void {
  const changed = !state.storageDegraded;
  state.storageDegraded = true;
  warnStorageUnavailable(operation, error);
  if (changed && refs.root) {
    render();
  }
}

function markStorageHealthy(): void {
  state.storageDegraded = false;
}

export function migrateStoredData(raw: any): StoredData {
  if (Array.isArray(raw)) {
    return { schemaVersion: 1, annotations: raw };
  }
  if (raw && typeof raw === "object" && typeof raw.schemaVersion === "number") {
    const data = raw as StoredData;
    return data;
  }
  return { schemaVersion: CURRENT_SCHEMA_VERSION, annotations: [] };
}

export async function saveDraft(draft: any): Promise<void> {
  const now = new Date().toISOString();
  const existing = draft.id ? state.annotations.find((item) => item.id === draft.id) : null;

  const annotation: Annotation = {
    id: draft.id || makeId(),
    type: draft.type,
    authorName: draft.authorName ?? existing?.authorName ?? null,
    pageUrl: state.pageUrl,
    pageKey: state.pageKey,
    note: draft.note,
    label: draft.label || existing?.label || null,
    colorIndex: draft.colorIndex ?? existing?.colorIndex ?? state.stickyColorIndex,
    letter: existing?.letter || null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    drawPoints: draft.drawPoints || existing?.drawPoints || null,
    anchor: draft.type === "draw" ? null : (draft.type === "highlight" ? draft.textAnchor : (draft.type === "free" ? null : captureElementAnchor(draft.element))),
    position: {
      pageX: Math.round(draft.pageX),
      pageY: Math.round(draft.pageY)
    },
    resolved: true
  };

  const next = existing
    ? state.annotations.map((item) => (item.id === annotation.id ? { ...item, ...annotation } : item))
    : [...state.annotations, annotation];

  if (!existing && (annotation.type === "free" || annotation.type === "element")) {
    state.placedMarkerIds.add(annotation.id);
  }
  if (!existing && annotation.type === "highlight") {
    state.placedHighlightIds.add(annotation.id);
  }

  state.stickyColorIndex = annotation.colorIndex;
  await persistAnnotations(next);
}

export async function upsertAnnotationFromPopup(annotation: any): Promise<void> {
  if (!annotation?.id) {
    return;
  }

  const next = state.annotations.map((item) =>
    item.id === annotation.id
      ? {
          ...item,
          authorName: annotation.authorName ?? item.authorName ?? null,
          note: annotation.note?.trim() || item.note,
          updatedAt: new Date().toISOString()
        }
      : item
  );

  await persistAnnotations(next);
}

export async function deleteAnnotation(id: string): Promise<void> {
  const deleted = state.annotations.find((item) => item.id === id);
  if (deleted) {
    undoStack.push({ type: "delete", annotation: { ...deleted } });
  }
  const next = state.annotations.filter((item) => item.id !== id);
  await persistAnnotations(next);
  showUndoToast();
}

export async function executeUndo(): Promise<boolean> {
  const action = undoStack.undo();
  if (!action) return false;

  if (action.type === "delete") {
    const next = [...state.annotations, action.annotation];
    await persistAnnotations(next);
    return true;
  }
  return false;
}

let toastEl: HTMLElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showUndoToast(): void {
  if (!refs.root) return;
  dismissUndoToast();

  const toast = document.createElement("div");
  toast.className = "mo-undo-toast mo-marker-visible";

  const msg = document.createElement("span");
  msg.textContent = "Annotation deleted";

  const undoBtn = document.createElement("button");
  undoBtn.className = "mo-undo-btn";
  undoBtn.textContent = "Undo";
  undoBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await executeUndo();
    dismissUndoToast();
  });

  toast.append(msg, undoBtn);
  refs.root.appendChild(toast);
  toastEl = toast;

  toastTimer = setTimeout(() => dismissUndoToast(), 5000);
}

function dismissUndoToast(): void {
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  if (toastEl) {
    toastEl.remove();
    toastEl = null;
  }
}

export function triggerWipeAnimation(): void {
  const layer = refs.layer;
  if (!layer) { persistAnnotations([]); renderedIds.clear(); return; }

  const allEls = [
    ...Array.from(layer.querySelectorAll(".mo-marker-pin")),
    ...Array.from(layer.querySelectorAll(".mo-text-highlight-rect")),
    ...Array.from(layer.querySelectorAll(".mo-drawings-svg path")),
    ...Array.from(layer.querySelectorAll(".mo-anchor-line")),
    ...Array.from(layer.querySelectorAll(".mo-marker-note"))
  ];

  if (allEls.length === 0) { persistAnnotations([]); renderedIds.clear(); return; }

  const directions = ["mo-wipe-yeet-left", "mo-wipe-yeet-right", "mo-wipe-yeet-up", "mo-wipe-splat"];

  allEls.forEach((el) => {
    const dir = directions[Math.floor(Math.random() * directions.length)];
    const delay = Math.random() * 200;
    (el as HTMLElement).style.animationDelay = `${delay}ms`;
    el.classList.add(dir);
  });

  setTimeout(async () => {
    renderedIds.clear();
    await persistAnnotations([]);
  }, 600);
}

export async function persistAnnotations(nextAnnotations: Annotation[]): Promise<void> {
  state.annotations = normalizeAnnotations(nextAnnotations);
  try {
    await chrome.storage.local.set({
      [storageKeyForPage(state.pageKey)]: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        annotations: state.annotations
      }
    });
    markStorageHealthy();
  } catch (e: any) {
    if (e.message?.includes("Extension context invalidated")) {
      console.warn("Missouri: extension was reloaded — please refresh the page");
      return;
    }
    if (isRecoverableStorageError(e)) {
      markStorageDegraded("annotation save", e);
      render();
      return;
    }
    throw e;
  }
  render();
}

export async function loadAnnotations(): Promise<void> {
  const key = storageKeyForPage(state.pageKey);
  try {
    const stored = await chrome.storage.local.get(key);
    const raw = stored[key];
    const migrated = migrateStoredData(raw);

    if (raw !== undefined && (!raw || Array.isArray(raw) || raw.schemaVersion !== CURRENT_SCHEMA_VERSION)) {
      try {
        await chrome.storage.local.set({ [key]: migrated });
      } catch (error) {
        if (!isRecoverableStorageError(error)) {
          throw error;
        }
        markStorageDegraded("annotation migration", error);
      }
    }

    markStorageHealthy();
    state.annotations = normalizeAnnotations(migrated.annotations);
    if (state.annotations.length > 0) {
      state.stickyColorIndex = state.annotations[state.annotations.length - 1].colorIndex ?? 0;
    }
  } catch (error) {
    if (!isRecoverableStorageError(error)) {
      throw error;
    }
    markStorageDegraded("annotation load", error);
    state.annotations = [];
  }
  render();
}

export async function loadSettings(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get("mo_settings");
    if (stored.mo_settings) {
      state.settings = { ...state.settings, ...stored.mo_settings };
      state.overlayVisible = state.settings.overlayVisible;
    }
    markStorageHealthy();
  } catch (error) {
    if (!isRecoverableStorageError(error)) {
      throw error;
    }
    markStorageDegraded("settings load", error);
  }
}

export async function saveSettings(): Promise<void> {
  try {
    await chrome.storage.local.set({ mo_settings: state.settings });
    markStorageHealthy();
  } catch (error) {
    if (!isRecoverableStorageError(error)) {
      throw error;
    }
    markStorageDegraded("settings save", error);
  }
  render();
}

export function normalizeAnnotations(annotations: Annotation[]): Annotation[] {
  return annotations.map((annotation) => resolveAnnotation(annotation));
}

export function resolveAnnotation(annotation: Annotation): Annotation {
  if (annotation.type === "draw") {
    return { ...annotation, resolved: true };
  }

  if (annotation.type === "highlight") {
    const range = annotation.anchor ? resolveTextRange(annotation.anchor as any) : null;
    return { ...annotation, resolved: Boolean(range), _resolvedRange: range };
  }

  if (annotation.type !== "element" || !annotation.anchor) {
    return {
      ...annotation,
      resolved: annotation.type === "free" ? true : Boolean(annotation.resolved)
    };
  }

  const element = findAnchoredElement(annotation.anchor);
  if (!element) {
    return { ...annotation, resolved: false, elementCenter: null };
  }

  const rect = element.getBoundingClientRect();
  const center = {
    pageX: Math.round(window.scrollX + rect.left + rect.width / 2),
    pageY: Math.round(window.scrollY + rect.top + rect.height / 2)
  };
  return {
    ...annotation,
    resolved: true,
    elementCenter: center,
    position: annotation.dragged ? annotation.position : center
  };
}

export function nextLabel(): string {
  const markers = getNumberedAnnotations();
  return String(markers.length + 1);
}

export function markerDisplayLabel(id: string): string | null {
  if (!id) return null;
  const markers = getNumberedAnnotations();
  const idx = markers.findIndex((a) => a.id === id);
  return idx >= 0 ? String(idx + 1) : null;
}

export function getNumberedAnnotations(): Annotation[] {
  return state.annotations.filter((a) => a.type !== "highlight" && a.type !== "draw");
}

export function backrementLabel(label: string): string {
  const parts = label.split(".");
  const parent = parts.slice(0, -1).join(".") || label;
  const siblings = state.annotations
    .filter((a) => a.label && a.label.startsWith(parent + "."))
    .map((a) => {
      const sub = a.label!.slice(parent.length + 1).split(".")[0];
      return parseInt(sub, 10);
    })
    .filter((n) => !isNaN(n));
  const nextSub = (siblings.length ? Math.max(...siblings) : 0) + 1;
  return `${parent}.${nextSub}`;
}

export function deincrementLabel(label: string): string {
  const parts = label.split(".");
  if (parts.length <= 1) return label;
  const grandparent = parts.slice(0, -2).join(".");
  const siblings = state.annotations
    .filter((a) => {
      if (!a.label) return false;
      if (grandparent) return a.label.startsWith(grandparent + ".") && a.label.split(".").length === parts.length - 1;
      return !a.label.includes(".") || a.label.split(".").length === 1;
    })
    .map((a) => {
      const seg = grandparent ? a.label!.slice(grandparent.length + 1).split(".")[0] : a.label!.split(".")[0];
      return parseInt(seg, 10);
    })
    .filter((n) => !isNaN(n));
  const nextNum = (siblings.length ? Math.max(...siblings) : 0) + 1;
  return grandparent ? `${grandparent}.${nextNum}` : String(nextNum);
}

export function getUsedLetters(): Set<string> {
  return new Set(
    state.annotations
      .filter((a) => a.letter)
      .map((a) => a.letter!)
  );
}

export function nextFreeLetter(): string | null {
  const used = getUsedLetters();
  for (let i = 0; i < 26; i++) {
    const ch = String.fromCharCode(65 + i);
    if (!used.has(ch)) return ch;
  }
  return null;
}

export function formatAnnotationForLLM(a: Annotation): string {
  const lines: string[] = [];
  const label = a.label || markerDisplayLabel(a.id) || "?";
  lines.push(`## Annotation ${label}`);
  lines.push(`- **Type:** ${a.type}`);
  if (a.note) lines.push(`- **Note:** ${a.note}`);

  const anchor = a.anchor as any;
  if (a.type === "highlight" && anchor?.selectedText) {
    lines.push(`- **Selected text:** "${anchor.selectedText}"`);
  }
  if (a.type === "element" && anchor) {
    lines.push(`- **Element:** \`<${anchor.tagName}>\``);
    if (anchor.selector) lines.push(`- **CSS selector:** \`${anchor.selector}\``);
    if (anchor.text) lines.push(`- **Text content:** "${anchor.text.slice(0, 120)}"`);
    if (Array.isArray(anchor.domPath)) lines.push(`- **DOM path:** \`${JSON.stringify(anchor.domPath)}\``);
  }
  if (a.type === "free") {
    lines.push(`- **Position:** page (${a.position.pageX}, ${a.position.pageY})`);
  }
  lines.push(`- **Color:** ${getActiveMarkerColors()[a.colorIndex % getActiveMarkerColors().length].fill}`);
  lines.push(`- **Created:** ${a.createdAt}`);

  return lines.join("\n");
}

export function copySingleAnnotation(a: Annotation): void {
  const text = [
    `# Missouri Annotation — ${state.pageUrl}`,
    "",
    formatAnnotationForLLM(a),
    "",
    "---",
    `_Page: ${state.pageUrl}_`
  ].join("\n");
  navigator.clipboard.writeText(text).catch(() => {});
}

export function copyAnnotationsToClipboard(): void {
  if (!state.annotations.length) return;
  const numbered = getNumberedAnnotations();
  const lines = [
    `# Missouri Annotations — ${state.pageUrl}`,
    "",
    `${numbered.length} annotation(s) on this page.`,
    ""
  ];
  for (const a of numbered) {
    lines.push(formatAnnotationForLLM(a));
    lines.push("");
  }
  lines.push("---");
  lines.push(`_Page: ${state.pageUrl}_`);
  navigator.clipboard.writeText(lines.join("\n")).catch(() => {});
}
