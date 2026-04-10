import { state, refs, renderedIds, getActiveMarkerColors, ROTATE_RADIUS, ICON } from "./state";
import { detectPageTheme, resolveTheme, hexToRgba, pointsToSvgPath, clipLineToRectEdge, createAnchorLineSvg, orthogonalSegments, leadlineSegments } from "./utils";
import { findAnchoredElement } from "./anchoring";
import { persistAnnotations, nextFreeLetter, nextLabel } from "./annotations";
import { ensureUi } from "./ui";
import { renderToolbarPanel, openEditor, openHighlightEditor } from "./ui";

/* ── Robust cursor hiding ─────────────────────────────────────────────
 * A class-based rule in content-styles.css can be overridden by page CSS
 * with !important.  We inject a <style> directly so our rule always wins.
 */
let _cursorStyleEl: HTMLStyleElement | null = null;

export function setCursorHidden(hidden: boolean): void {
  if (hidden) {
    if (!_cursorStyleEl) {
      _cursorStyleEl = document.createElement("style");
      _cursorStyleEl.setAttribute("data-mo-cursor", "");
      _cursorStyleEl.textContent = "*, *::before, *::after { cursor: none !important; }";
      document.head.appendChild(_cursorStyleEl);
    }
    document.documentElement.classList.add("mo-hide-cursor");
  } else {
    if (_cursorStyleEl) {
      _cursorStyleEl.remove();
      _cursorStyleEl = null;
    }
    document.documentElement.classList.remove("mo-hide-cursor");
  }
}

function createArrowSvg(fillColor: string, className: string = "mo-marker-arrow"): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("viewBox", "0 0 12 8");
  svg.setAttribute("width", "12");
  svg.setAttribute("height", "8");
  const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  poly.setAttribute("points", "0,0 12,0 6,8");
  poly.setAttribute("fill", fillColor);
  svg.appendChild(poly);
  return svg;
}

export function render(): void {
  ensureUi();
  refs.root!.dataset.overlayHidden = String(!state.overlayVisible);
  refs.root!.dataset.mode = state.mode;
  refs.root!.dataset.placementMode = state.placementMode || "";
  refs.root!.dataset.colorblind = String(state.settings.colorblindMode);
  refs.root!.dataset.storageDegraded = String(state.storageDegraded);
  refs.root!.dataset.theme = resolveTheme(state.settings.themeMode);
  refs.root!.style.display = state.overlayVisible || state.mode === "annotate" ? "block" : "none";

  if (refs.toolbar) {
    refs.toolbar.classList.toggle("mo-collapsed", state.toolbarCollapsed);
  }

  const freeButton = refs.root!.querySelector('[data-role="free"]');
  const elementButton = refs.root!.querySelector('[data-role="element"]');
  const highlightButton = refs.root!.querySelector('[data-role="highlight"]');
  if (freeButton) {
    (freeButton as HTMLElement).dataset.active = String(state.placementMode === "free");
    (freeButton as HTMLElement).setAttribute("aria-pressed", String(state.placementMode === "free"));
  }
  if (elementButton) {
    (elementButton as HTMLElement).dataset.active = String(state.placementMode === "element");
    (elementButton as HTMLElement).setAttribute("aria-pressed", String(state.placementMode === "element"));
  }
  if (highlightButton) {
    (highlightButton as HTMLElement).dataset.active = String(state.placementMode === "highlight");
    (highlightButton as HTMLElement).setAttribute("aria-pressed", String(state.placementMode === "highlight"));
  }
  const drawButton = refs.root!.querySelector('[data-role="draw"]');
  if (drawButton) {
    (drawButton as HTMLElement).dataset.active = String(state.placementMode === "draw");
    (drawButton as HTMLElement).setAttribute("aria-pressed", String(state.placementMode === "draw"));
  }

  if (state.placementMode === "draw") {
    hideCursorMarker();
    hideHighlighterCursor();
    showPencilCursor();
    setCursorHidden(true);
    document.documentElement.style.setProperty("user-select", "none", "important");
    document.documentElement.style.setProperty("-webkit-user-select", "none", "important");
  } else if (state.placementMode === "highlight") {
    hideCursorMarker();
    hidePencilCursor();
    showHighlighterCursor();
    document.documentElement.style.removeProperty("user-select");
    document.documentElement.style.removeProperty("-webkit-user-select");
  } else if (state.placementMode && !refs.editor) {
    hidePencilCursor();
    hideHighlighterCursor();
    document.documentElement.style.removeProperty("user-select");
    document.documentElement.style.removeProperty("-webkit-user-select");
    showCursorMarker();
  } else {
    hideCursorMarker();
    hidePencilCursor();
    hideHighlighterCursor();
    setCursorHidden(false);
    document.documentElement.style.removeProperty("user-select");
    document.documentElement.style.removeProperty("-webkit-user-select");
  }

  renderMarkers();
  updateAllColorDots();

  renderToolbarPanel();

  if (!state.overlayVisible && state.mode === "idle") {
    hideHighlight();
  }
}

export function renderMarkers(): void {
  refs.layer!.replaceChildren();
  hideRefHighlight();

  renderTextHighlights();
  renderDrawings();

  let markerCount = 0;
  for (let i = 0; i < state.annotations.length; i++) {
    const annotation = state.annotations[i];
    if (annotation.type === "highlight" || annotation.type === "draw") continue;
    markerCount++;
    const marker = document.createElement("div");
    marker.className = "mo-marker mo-marker-visible";
    marker.dataset.markerType = annotation.type;
    marker.dataset.markerId = annotation.id;
    marker.setAttribute("data-mo-marker-id", annotation.id);
    marker.setAttribute("data-mo-marker-type", annotation.type);
    marker.setAttribute("data-mo-marker-resolved", String(annotation.resolved));
    const hasDragAnchor = annotation.dragAnchor != null;
    const tailX = hasDragAnchor ? annotation.dragAnchor!.pageX : annotation.position.pageX;
    const tailY = hasDragAnchor ? annotation.dragAnchor!.pageY : annotation.position.pageY;

    marker.style.left = `${tailX - window.scrollX}px`;
    marker.style.top = `${tailY - window.scrollY}px`;

    const pin = document.createElement("div");
    const isNew = !renderedIds.has(annotation.id);
    const justPlaced = state.placedMarkerIds.has(annotation.id);
    pin.className = justPlaced ? "mo-marker-pin mo-animate-in mo-just-placed" : "mo-marker-pin";
    if (isNew) renderedIds.add(annotation.id);
    if (justPlaced) {
      state.placedMarkerIds.delete(annotation.id);
    }

    const anchorX = annotation.elementCenter?.pageX ?? tailX;
    const anchorY = annotation.elementCenter?.pageY ?? tailY;

    if (annotation.dragged) {
      if (annotation.dragAngle != null) {
        const angleDeg = annotation.dragAngle * 180 / Math.PI;
        pin.style.setProperty("--pin-angle", `${Math.round(angleDeg)}deg`);
      } else {
        const dx = anchorX - annotation.position.pageX;
        const dy = anchorY - annotation.position.pageY;
        if (Math.abs(dx) + Math.abs(dy) > 3) {
          const angleDeg = Math.atan2(dy, dx) * 180 / Math.PI - 90;
          pin.style.setProperty("--pin-angle", `${Math.round(angleDeg)}deg`);
        }
      }
    }

    const colorIdx = annotation.colorIndex ?? 0;
    const color = getActiveMarkerColors()[colorIdx % getActiveMarkerColors().length];

    const dist = Math.hypot(annotation.position.pageX - tailX, annotation.position.pageY - tailY);
    if (annotation.dragged && dist > ROTATE_RADIUS && state.settings.attachmentMode !== "point") {
      const sx = annotation.position.pageX - window.scrollX;
      const sy = annotation.position.pageY - window.scrollY;
      let ex = tailX - window.scrollX;
      let ey = tailY - window.scrollY;

      const anchoredEl = annotation.anchor ? findAnchoredElement(annotation.anchor) : null;
      if (anchoredEl) {
        const elRect = anchoredEl.getBoundingClientRect();
        const edge = clipLineToRectEdge(sx, sy, ex, ey, elRect);
        ex = edge.x;
        ey = edge.y;
      }

      const segments = state.settings.attachmentMode === "orthogonal"
        ? orthogonalSegments(sx, sy, ex, ey)
        : leadlineSegments(sx, sy, ex, ey);

      if (segments.length > 0) {
        const lineSvg = createAnchorLineSvg({
          segments,
          color: color.fill,
          arrowAt: "end"
        });
        refs.layer!.appendChild(lineSvg);
      }
    }

    const label = annotation.label || String(markerCount);
    const isSubLabel = label.includes(".");
    marker.dataset.colorIdx = String(colorIdx % getActiveMarkerColors().length);

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.setAttribute("aria-label", annotation.note || label);
    button.title = annotation.note || label;
    button.style.background = color.fill;
    button.style.borderColor = color.border;

    if (isSubLabel) {
      marker.classList.add("mo-marker-pill");
      button.classList.add("mo-pill-btn");
    }

    if (justPlaced) {
      const wave = document.createElement("span");
      wave.className = "mo-placement-wave";
      wave.setAttribute("aria-hidden", "true");
      wave.style.borderColor = hexToRgba(color.fill, "0.26");
      wave.style.background = hexToRgba(color.fill, "0.12");
      pin.appendChild(wave);
    }

    const arrowSvg = createArrowSvg(color.tail);
    pin.appendChild(arrowSvg);

    if (hasDragAnchor && dist > ROTATE_RADIUS) {
      button.style.opacity = "0";
      button.style.pointerEvents = "none";
      arrowSvg.style.display = "none";

      const ball = document.createElement("div");
      ball.className = "mo-floating-drag-dot mo-marker-visible";
      ball.dataset.detachedBallFor = annotation.id;
      ball.style.left = `${annotation.position.pageX - window.scrollX}px`;
      ball.style.top = `${annotation.position.pageY - window.scrollY}px`;
      ball.style.background = color.fill;
      ball.style.border = `2.5px solid ${color.border}`;
      ball.style.pointerEvents = "auto";
      ball.style.cursor = "grab";
      ball.textContent = label;
      ball.addEventListener("click", (e) => { e.stopPropagation(); button.dispatchEvent(new MouseEvent("click", e)); });
      ball.addEventListener("dblclick", (e) => { e.stopPropagation(); button.dispatchEvent(new MouseEvent("dblclick", e)); });
      ball.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); button.dispatchEvent(new MouseEvent("contextmenu", e)); });
      refs.layer!.appendChild(ball);
    }

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (state.lastDragWasMove) {
        state.lastDragWasMove = false;
        return;
      }
      state.focusedMarkerId = annotation.id;
      if (annotation.type === "element" && annotation.anchor) {
        const el = findAnchoredElement(annotation.anchor);
        if (el) showRefHighlight(el);
      }
    });

    button.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openEditor({
        ...annotation,
        element: annotation.anchor ? findAnchoredElement(annotation.anchor) : null,
        pageX: annotation.position.pageX,
        pageY: annotation.position.pageY
      });
    });

    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const nextColor = ((annotation.colorIndex ?? 0) + 1) % getActiveMarkerColors().length;
      state.stickyColorIndex = nextColor;
      const updated = state.annotations.map((a) =>
        a.id === annotation.id ? { ...a, colorIndex: nextColor } : a
      );
      persistAnnotations(updated);
    });

    button.addEventListener("mouseenter", () => {
      const shiftHeld = state._shiftDown;
      if (shiftHeld) {
        const letter = annotation.letter || nextFreeLetter();
        if (!letter) {
          marker.classList.add("mo-flash");
          setTimeout(() => marker.classList.remove("mo-flash"), 400);
          return;
        }
        if (!annotation.letter) {
          const updated = state.annotations.map((a) =>
            a.id === annotation.id ? { ...a, letter } : a
          );
          persistAnnotations(updated);
        }
        button.dataset.shiftLabel = letter;
        button.dataset.origLabel = button.textContent || "";
        button.textContent = letter;
      }
    });

    button.addEventListener("mouseleave", () => {
      if (button.dataset.origLabel) {
        button.textContent = button.dataset.origLabel;
        delete button.dataset.shiftLabel;
        delete button.dataset.origLabel;
      }
    });

    const note = document.createElement("div");
    note.className = "mo-marker-note";
    const noteStrong = document.createElement("strong");
    noteStrong.textContent = annotation.type === "free" ? "Free marker" : annotation.resolved ? "Element marker" : "Detached marker";
    note.appendChild(noteStrong);
    note.appendChild(document.createTextNode(annotation.note));

    const hiddenText = document.createElement("span");
    hiddenText.className = "mo-visually-hidden";
    hiddenText.textContent = annotation.note;

    pin.appendChild(button);
    marker.append(pin, note, hiddenText);
    refs.layer!.appendChild(marker);
  }
}

export function renderTextHighlights(): void {
  const highlights = state.annotations.filter((a) => a.type === "highlight");
  for (const annotation of highlights) {
    const range = annotation._resolvedRange;
    if (!range) continue;

    let rects: DOMRect[];
    try {
      rects = Array.from(range.getClientRects());
    } catch (_e) {
      continue;
    }
    if (!rects.length) continue;

    const colorIdx = annotation.colorIndex ?? 0;
    const color = getActiveMarkerColors()[colorIdx % getActiveMarkerColors().length];
    const bgAlpha = "0.18";
    const borderAlpha = "0.45";
    const justPlaced = state.placedHighlightIds.has(annotation.id);

    const group = document.createElement("div");
    group.className = "mo-text-highlight-group mo-marker-visible";
    group.dataset.markerId = annotation.id;
    group.dataset.colorIdx = String(colorIdx % getActiveMarkerColors().length);
    group.setAttribute("data-mo-marker-id", annotation.id);
    group.setAttribute("data-mo-marker-type", "highlight");

    for (const [index, rect] of rects.entries()) {
      if (rect.width < 1 || rect.height < 1) continue;
      const variation = getHighlightVariation(annotation.id, index);
      const box = document.createElement("div");
      box.className = justPlaced ? "mo-text-highlight-rect mo-just-placed" : "mo-text-highlight-rect";
      box.style.left = `${rect.left - 2}px`;
      box.style.top = `${rect.top - 1}px`;
      box.style.width = `${rect.width + 4}px`;
      box.style.height = `${rect.height + 3}px`;
      box.style.background = `linear-gradient(180deg,
        ${hexToRgba(color.fill, "0")} 0%,
        ${hexToRgba(color.fill, "0.16")} 10%,
        ${hexToRgba(color.fill, bgAlpha)} 26%,
        ${hexToRgba(color.fill, bgAlpha)} 78%,
        ${hexToRgba(color.fill, "0.14")} 92%,
        ${hexToRgba(color.fill, "0")} 100%)`;
      box.style.borderColor = hexToRgba(color.fill, borderAlpha);
      box.style.setProperty("--hl-tilt", `${variation.tilt}deg`);
      box.style.setProperty("--hl-scale-y", String(variation.scaleY));
      box.style.setProperty("--hl-delay", `${variation.delay}ms`);
      group.appendChild(box);
    }

    group.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.focusedMarkerId = annotation.id;
    });

    group.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (state.mode === "annotate") {
        openHighlightEditor({
          ...annotation,
          pageX: annotation.position.pageX,
          pageY: annotation.position.pageY
        });
      }
    });

    group.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const nextColor = ((annotation.colorIndex ?? 0) + 1) % getActiveMarkerColors().length;
      state.stickyColorIndex = nextColor;
      const updated = state.annotations.map((a) =>
        a.id === annotation.id ? { ...a, colorIndex: nextColor } : a
      );
      persistAnnotations(updated);
    });

    refs.layer!.appendChild(group);
    if (justPlaced) {
      state.placedHighlightIds.delete(annotation.id);
    }
  }
}

function getHighlightVariation(annotationId: string, rectIndex: number): {
  tilt: number;
  scaleY: number;
  delay: number;
} {
  let seed = rectIndex * 97;
  for (let i = 0; i < annotationId.length; i++) {
    seed = (seed + annotationId.charCodeAt(i) * (i + 11)) % 9973;
  }

  return {
    tilt: ((seed % 9) - 4) * 0.18,
    scaleY: 0.96 + ((seed % 7) * 0.012),
    delay: rectIndex * 24
  };
}

export function renderDrawings(): void {
  const drawings = state.annotations.filter((a) => a.type === "draw");
  if (!drawings.length) return;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "mo-drawings-svg mo-marker-visible");
  svg.setAttribute("width", String(window.innerWidth));
  svg.setAttribute("height", String(window.innerHeight));
  svg.style.cssText = "position:fixed;top:0;left:0;pointer-events:none;overflow:visible;";

  for (const annotation of drawings) {
    const pts = annotation.drawPoints;
    if (!pts || pts.length < 2) continue;

    const scrolled = pts.map((p) => ({
      x: p.x - window.scrollX,
      y: p.y - window.scrollY
    }));

    const colorIdx = annotation.colorIndex ?? 0;
    const color = getActiveMarkerColors()[colorIdx % getActiveMarkerColors().length];

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pointsToSvgPath(scrolled));
    path.setAttribute("stroke", color.fill);
    path.setAttribute("stroke-width", "3");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("data-marker-id", annotation.id);
    path.setAttribute("data-color-idx", String(colorIdx % getActiveMarkerColors().length));
    path.style.pointerEvents = "stroke";
    path.style.cursor = "pointer";
    path.style.filter = `drop-shadow(0 1px 2px ${hexToRgba(color.fill, "0.3")})`;
    if (state.settings.colorblindMode) {
      const dashPatterns = ["8 4", "4 4 1 4", "6 3 2 3", ""];
      const dash = dashPatterns[colorIdx % getActiveMarkerColors().length];
      if (dash) path.setAttribute("stroke-dasharray", dash);
    }

    let lastClick = 0;
    path.addEventListener("click", (e) => {
      e.stopPropagation();
      const now = Date.now();
      if (now - lastClick < 350) {
        const nextColor = ((annotation.colorIndex ?? 0) + 1) % getActiveMarkerColors().length;
        const updated = state.annotations.map((a) =>
          a.id === annotation.id ? { ...a, colorIndex: nextColor } : a
        );
        state.stickyColorIndex = nextColor;
        persistAnnotations(updated);
        lastClick = 0;
        return;
      }
      lastClick = now;
      state.focusedMarkerId = annotation.id;
    });

    svg.appendChild(path);
  }

  refs.layer!.appendChild(svg);
}

export function showHighlightForElement(element: Element): void {
  const rect = element.getBoundingClientRect();
  if (!refs.highlight) {
    const highlight = document.createElement("div");
    highlight.className = "mo-highlight-box mo-marker-visible";
    refs.root!.appendChild(highlight);
    refs.highlight = highlight;
  }

  refs.highlight.style.left = `${rect.left}px`;
  refs.highlight.style.top = `${rect.top}px`;
  refs.highlight.style.width = `${rect.width}px`;
  refs.highlight.style.height = `${rect.height}px`;
}

export function hideHighlight(): void {
  refs.highlight?.remove();
  refs.highlight = null;
  state.hoveredElement = null;
}

export function showRefHighlight(element: Element): void {
  const rect = element.getBoundingClientRect();
  if (!refs.refHighlight) {
    const hl = document.createElement("div");
    hl.className = "mo-ref-highlight mo-marker-visible";
    refs.root!.appendChild(hl);
    refs.refHighlight = hl;
  }
  refs.refHighlight.style.left = `${rect.left}px`;
  refs.refHighlight.style.top = `${rect.top}px`;
  refs.refHighlight.style.width = `${rect.width}px`;
  refs.refHighlight.style.height = `${rect.height}px`;
}

export function hideRefHighlight(): void {
  refs.refHighlight?.remove();
  refs.refHighlight = null;
}

export function showCursorMarker(): void {
  const color = getActiveMarkerColors()[state.stickyColorIndex % getActiveMarkerColors().length];
  const label = nextLabel();

  if (refs.cursorMarker) {
    const dot = refs.cursorMarker.querySelector(".mo-preview-dot") as HTMLElement | null;
    if (dot) {
      dot.style.background = color.fill;
      dot.style.border = `2.5px solid ${color.border}`;
      dot.textContent = label;
    }
    const tailSvg = refs.cursorMarker.querySelector(".mo-preview-tail polygon") as SVGPolygonElement | null;
    if (tailSvg) tailSvg.setAttribute("fill", color.tail);
    refs.cursorMarker.dataset.markerType = state.placementMode || "";
    setCursorHidden(true);
    return;
  }

  const marker = document.createElement("div");
  marker.className = "mo-cursor-marker";
  marker.dataset.markerType = state.placementMode || "";

  const dot = document.createElement("div");
  dot.className = "mo-preview-dot";
  dot.style.background = color.fill;
  dot.style.border = `2.5px solid ${color.border}`;
  dot.textContent = label;

  const tail = createArrowSvg(color.tail, "mo-preview-tail");

  marker.append(dot, tail);
  refs.root!.appendChild(marker);
  refs.cursorMarker = marker;
  document.documentElement.classList.add("mo-hide-cursor");
}

export function hideCursorMarker(): void {
  if (!refs.cursorMarker) return;
  refs.cursorMarker.remove();
  refs.cursorMarker = null;
}

export function updateCursorMarker(clientX: number, clientY: number): void {
  if (!refs.cursorMarker) return;
  refs.cursorMarker.style.left = `${clientX}px`;
  refs.cursorMarker.style.top = `${clientY}px`;
  if (state.placementMode) {
    refs.cursorMarker.dataset.markerType = state.placementMode;
  }
}

export function updateCursorMarkerColor(): void {
  if (!refs.cursorMarker) return;
  const color = getActiveMarkerColors()[state.stickyColorIndex % getActiveMarkerColors().length];
  const dot = refs.cursorMarker.querySelector(".mo-preview-dot") as HTMLElement | null;
  const tailPoly = refs.cursorMarker.querySelector(".mo-preview-tail polygon") as SVGPolygonElement | null;
  if (dot) {
    dot.style.background = color.fill;
    dot.style.border = `2.5px solid ${color.border}`;
  }
  if (tailPoly) {
    tailPoly.setAttribute("fill", color.tail);
  }
}

export function showPencilCursor(): void {
  if (refs.pencilCursor) {
    setCursorHidden(true);
    return;
  }
  const cursor = document.createElement("div");
  cursor.className = "mo-cursor-pencil";
  cursor.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>';
  const dot = document.createElement("div");
  dot.className = "mo-cursor-pencil-dot";
  const color = getActiveMarkerColors()[state.stickyColorIndex % getActiveMarkerColors().length];
  dot.style.background = color.fill;
  cursor.appendChild(dot);
  refs.root!.appendChild(cursor);
  refs.pencilCursor = cursor;
  document.documentElement.classList.add("mo-hide-cursor");
}

export function hidePencilCursor(): void {
  if (!refs.pencilCursor) return;
  refs.pencilCursor.remove();
  refs.pencilCursor = null;
}

export function updatePencilCursor(clientX: number, clientY: number): void {
  if (!refs.pencilCursor) return;
  refs.pencilCursor.style.left = `${clientX}px`;
  refs.pencilCursor.style.top = `${clientY}px`;
}

export function showHighlighterCursor(): void {
  if (refs.highlighterCursor) {
    setCursorHidden(true);
    return;
  }
  const cursor = document.createElement("div");
  cursor.className = "mo-cursor-highlighter";
  const cap = document.createElement("div");
  cap.className = "mo-cursor-highlighter-cap";
  const body = document.createElement("div");
  body.className = "mo-cursor-highlighter-body";
  const band = document.createElement("div");
  band.className = "mo-cursor-highlighter-band";
  const ink = document.createElement("div");
  ink.className = "mo-cursor-highlighter-ink";
  const nib = document.createElement("div");
  nib.className = "mo-cursor-highlighter-nib";
  const color = getActiveMarkerColors()[state.stickyColorIndex % getActiveMarkerColors().length];
  ink.style.background = color.fill;
  nib.style.borderTopColor = color.fill;
  cursor.append(cap, body, band, ink, nib);
  refs.root!.appendChild(cursor);
  refs.highlighterCursor = cursor;
  document.documentElement.classList.add("mo-hide-cursor");
}

export function hideHighlighterCursor(): void {
  if (!refs.highlighterCursor) return;
  refs.highlighterCursor.remove();
  refs.highlighterCursor = null;
}

export function updatePencilCursorColor(): void {
  if (!refs.pencilCursor) return;
  const dot = refs.pencilCursor.querySelector(".mo-cursor-pencil-dot") as HTMLElement | null;
  if (dot) {
    const color = getActiveMarkerColors()[state.stickyColorIndex % getActiveMarkerColors().length];
    dot.style.background = color.fill;
  }
}

export function updateAllColorDots(): void {
  const color = getActiveMarkerColors()[state.stickyColorIndex % getActiveMarkerColors().length];
  const dots = refs.toolbar?.querySelectorAll(".mo-btn-color-dot");
  if (dots) dots.forEach((d) => { (d as HTMLElement).style.background = color.fill; });
}

export function updateHighlighterCursorColor(): void {
  if (!refs.highlighterCursor) return;
  const color = getActiveMarkerColors()[state.stickyColorIndex % getActiveMarkerColors().length];
  const ink = refs.highlighterCursor.querySelector(".mo-cursor-highlighter-ink") as HTMLElement | null;
  const nib = refs.highlighterCursor.querySelector(".mo-cursor-highlighter-nib") as HTMLElement | null;
  if (ink) ink.style.background = color.fill;
  if (nib) nib.style.borderTopColor = color.fill;
}
