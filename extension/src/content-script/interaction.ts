import { state, refs, getActiveMarkerColors, MARKER_EXCLUSION_RADIUS, ROTATE_RADIUS } from "./state";
import { pointsToSvgPath, clipLineToRectEdge, detectPageTheme, createAnchorLineSvg, orthogonalSegments, leadlineSegments } from "./utils";
import { render, renderMarkers, hideHighlight, showHighlightForElement, showRefHighlight, updateCursorMarker, updatePencilCursor, updatePencilCursorColor, updateCursorMarkerColor, updateHighlighterCursorColor, updateAllColorDots, hideCursorMarker, setCursorHidden } from "./markers";
import { closeEditor, openEditor, closeToolbarPanel, showPreviewMarker, clearPreviewMarker, renderToolbarPanel as uiRenderToolbarPanel } from "./ui";
import { saveDraft, deleteAnnotation, persistAnnotations, nextFreeLetter, executeUndo, saveSettings } from "./annotations";
import { getAnnotatableTarget, zoomElementSelection, captureTextRangeAnchor, findAnchoredElement } from "./anchoring";

export function handleKeydown(event: KeyboardEvent): void {
  if ((event.key === "z" || event.key === "Z") && (event.metaKey || event.ctrlKey) && !event.shiftKey) {
    if (state.mode === "annotate") {
      event.preventDefault();
      event.stopPropagation();
      executeUndo();
      return;
    }
  }
  if (event.key === "Escape") {
    closeEditor();
    clearPlacementMode();
    closeToolbarPanel();
    state.focusedMarkerId = null;
    if (state.mode === "annotate") {
      render();
    }
    return;
  }
  if (state.mode === "annotate" && state.placementMode && !refs.editor?.contains(event.target as Node)) {
    event.preventDefault();
    event.stopPropagation();
  }
  if ((event.key === "Backspace" || event.key === "Delete") && state.focusedMarkerId) {
    event.preventDefault();
    const id = state.focusedMarkerId;
    state.focusedMarkerId = null;
    deleteAnnotation(id).then(() => render());
  }

  if (state.mode === "annotate" && state.placementMode === "element" && state.hoveredElement) {
    if (event.key === "w" || event.key === "W") {
      event.preventDefault();
      event.stopPropagation();
      zoomElementSelection(-1);
      return;
    }
    if (event.key === "s" || event.key === "S") {
      event.preventDefault();
      event.stopPropagation();
      zoomElementSelection(1);
      return;
    }
  }
}

export function handlePointerMove(event: MouseEvent): void {
  if (state.dragging) return;
  state._lastClientX = event.clientX;
  state._lastClientY = event.clientY;

  const overUi = refs.toolbar?.contains(event.target as Node) || refs.editor?.contains(event.target as Node);
  const inMarkerMode = state.placementMode === "free" || state.placementMode === "element";
  const nearMarker = inMarkerMode && !overUi && isNearExistingMarker(event.clientX, event.clientY);

  /* When hovering toolbar/editor: restore native cursor, fully hide custom cursors */
  if (overUi) {
    setCursorHidden(false);
    if (refs.cursorMarker) refs.cursorMarker.style.display = "none";
    if (refs.pencilCursor) refs.pencilCursor.style.display = "none";
    if (refs.highlighterCursor) refs.highlighterCursor.style.display = "none";
  } else {
    if (refs.cursorMarker) {
      refs.cursorMarker.style.display = "";
      refs.cursorMarker.classList.toggle("mo-cursor-suppressed", nearMarker);
      setCursorHidden(true);
      updateCursorMarker(event.clientX, event.clientY);
    }
    if (refs.pencilCursor) {
      refs.pencilCursor.style.display = "";
      setCursorHidden(true);
      updatePencilCursor(event.clientX, event.clientY);
    }
    if (refs.highlighterCursor) {
      refs.highlighterCursor.style.display = "";
      refs.highlighterCursor.style.left = `${event.clientX}px`;
      refs.highlighterCursor.style.top = `${event.clientY}px`;
      setCursorHidden(true);
    }
  }

  if (state.mode !== "annotate" || state.placementMode !== "element") {
    hideHighlight();
    return;
  }

  if (state.hoveredElement) {
    const rect = state.hoveredElement.getBoundingClientRect();
    const inBounds =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (inBounds && document.contains(state.hoveredElement)) {
      showHighlightForElement(state.hoveredElement);
      return;
    }
  }

  const target = getAnnotatableTarget(event.target);
  if (!target) {
    hideHighlight();
    return;
  }

  state.hoveredElement = target;
  showHighlightForElement(target);
}

export function handlePageClick(event: MouseEvent): void {
  if (refs.toolbar?.contains(event.target as Node)) return;
  if (refs.editor?.contains(event.target as Node)) return;

  if (refs.editor) {
    event.preventDefault();
    event.stopPropagation();
    closeEditor();
    render();
    return;
  }

  if (state.mode !== "annotate" || !state.placementMode) return;
  event.preventDefault();
  event.stopPropagation();
  if (state.lastDragWasMove) {
    state.lastDragWasMove = false;
  }
}

export function handleContextMenu(event: MouseEvent): void {
  if (state.mode !== "annotate" || !state.placementMode) return;
  if (refs.toolbar?.contains(event.target as Node) || refs.editor?.contains(event.target as Node)) return;
  event.preventDefault();
  state.stickyColorIndex = (state.stickyColorIndex + 1) % getActiveMarkerColors().length;
  updatePencilCursorColor();
  updateCursorMarkerColor();
  updateHighlighterCursorColor();
  updateAllColorDots();
}

export function handleMouseDown(event: MouseEvent): void {
  if (state.mode !== "annotate") return;
  if (refs.editor?.contains(event.target as Node)) return;
  if (refs.toolbar?.contains(event.target as Node)) return;

  if (state.placementMode !== "highlight" && state.placementMode !== "draw") {
    const btn = (event.target as Element).closest(".mo-marker-pin button, .mo-preview-dot, .mo-floating-drag-dot");
    if (btn) {
      const marker = btn.closest(".mo-marker");
      const markerId = marker ? (marker as HTMLElement).dataset.markerId : (btn as HTMLElement).dataset.detachedBallFor;
      if (!markerId) return;
      const annotation = markerId ? state.annotations.find((a) => a.id === markerId) : null;
      if (!annotation) return;

      const anchorX = annotation.dragAnchor?.pageX ?? annotation.elementCenter?.pageX ?? annotation.position.pageX;
      const anchorY = annotation.dragAnchor?.pageY ?? annotation.elementCenter?.pageY ?? annotation.position.pageY;

      state.dragging = {
        markerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        origPageX: annotation.position.pageX,
        origPageY: annotation.position.pageY,
        anchorPageX: anchorX,
        anchorPageY: anchorY,
        moved: false
      };
      event.preventDefault();
      return;
    }
  }

  if (state.placementMode === "draw") {
    if (refs.toolbar?.contains(event.target as Node)) return;
    event.preventDefault();

    const color = getActiveMarkerColors()[state.stickyColorIndex % getActiveMarkerColors().length];
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "mo-draw-preview-svg");
    svg.setAttribute("width", String(window.innerWidth));
    svg.setAttribute("height", String(window.innerHeight));
    svg.style.cssText = "position:fixed;top:0;left:0;pointer-events:none;z-index:2147483646;overflow:visible;";
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("stroke", color.fill);
    path.setAttribute("stroke-width", "3");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("opacity", "0.8");
    svg.appendChild(path);
    refs.root!.appendChild(svg);

    state.drawing = {
      points: [{ x: event.pageX, y: event.pageY }],
      colorIndex: state.stickyColorIndex,
      svg,
      path
    };
    return;
  }

  if (!state.placementMode || state.placementMode === "highlight") return;

  if (refs.editor) return;

  if (isNearExistingMarker(event.clientX, event.clientY)) return;

  event.preventDefault();

  let pX = event.pageX;
  let pY = event.pageY;
  let placedElement: Element | null = null;

  if (state.placementMode === "element") {
    const target = state.hoveredElement || getAnnotatableTarget(event.target);
    if (!target) return;
    // Skip if this element already has an annotation
    const alreadyAnnotated = state.annotations.some(
      (a) => a.type === "element" && a.anchor && findAnchoredElement(a.anchor) === target
    );
    if (alreadyAnnotated) return;
    const rect = target.getBoundingClientRect();
    pX = window.scrollX + rect.left + rect.width / 2;
    pY = window.scrollY + rect.top + rect.height / 2;
    placedElement = target;
  }

  const draft = {
    type: state.placementMode,
    pageX: pX,
    pageY: pY,
    element: placedElement
  };
  showPreviewMarker(draft);

  state.placing = {
    draft,
    startClientX: event.clientX,
    startClientY: event.clientY,
    origPageX: pX,
    origPageY: pY,
    moved: false
  };
}

export function handleMouseDrag(event: MouseEvent): void {
  if (state.drawing) {
    const last = state.drawing.points[state.drawing.points.length - 1];
    const dx = event.pageX - last.x;
    const dy = event.pageY - last.y;
    if (dx * dx + dy * dy < 9) return;
    state.drawing.points.push({ x: event.pageX, y: event.pageY });
    const scrolled = state.drawing.points.map((p) => ({
      x: p.x - window.scrollX,
      y: p.y - window.scrollY
    }));
    state.drawing.path.setAttribute("d", pointsToSvgPath(scrolled));
    return;
  }

  if (state.placing) {
    const dx = event.clientX - state.placing.startClientX;
    const dy = event.clientY - state.placing.startClientY;
    if (!state.placing.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
    state.placing.moved = true;

    const newPageX = state.placing.origPageX + dx;
    const newPageY = state.placing.origPageY + dy;
    state.placing.draft.pageX = newPageX;
    state.placing.draft.pageY = newPageY;

    if (refs.preview) {
      refs.preview.style.left = `${newPageX - window.scrollX}px`;
      refs.preview.style.top = `${newPageY - window.scrollY}px`;
    }
    return;
  }

  if (!state.dragging) return;

  const dx = event.clientX - state.dragging.startClientX;
  const dy = event.clientY - state.dragging.startClientY;

  if (!state.dragging.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
  state.dragging.moved = true;

  const newPageX = state.dragging.origPageX + dx;
  const newPageY = state.dragging.origPageY + dy;

  const marker = refs.layer!.querySelector(`[data-marker-id="${state.dragging.markerId}"]`) as HTMLElement | null;
  if (!marker) return;

  marker.classList.add("mo-dragging");

  const staticBall = refs.layer!.querySelector(`[data-detached-ball-for="${state.dragging.markerId}"]`) as HTMLElement | null;
  if (staticBall) staticBall.style.display = "none";

  const ancX = state.dragging.anchorPageX;
  const ancY = state.dragging.anchorPageY;
  const distFromAnchor = Math.hypot(newPageX - ancX, newPageY - ancY);

  const pin = marker.querySelector(".mo-marker-pin") as HTMLElement;
  const mode = state.settings.attachmentMode;

  if (state.dragging.liveLine) {
    state.dragging.liveLine.forEach((el) => el.remove());
    state.dragging.liveLine = null;
  }
  if (state.dragging.floatingDot) {
    state.dragging.floatingDot.remove();
    state.dragging.floatingDot = null;
  }

  const annotation = state.annotations.find((a) => a.id === state.dragging!.markerId);
  const colorIdx = annotation?.colorIndex ?? 0;
  const color = getActiveMarkerColors()[colorIdx % getActiveMarkerColors().length];

  if (distFromAnchor <= ROTATE_RADIUS) {
    marker.style.left = `${ancX - window.scrollX}px`;
    marker.style.top = `${ancY - window.scrollY}px`;
    marker.style.display = "";
    const origBtn = pin.querySelector("button") as HTMLElement | null;
    if (origBtn) origBtn.style.opacity = "";
    const adx = newPageX - ancX;
    const ady = newPageY - ancY;
    if (Math.abs(adx) + Math.abs(ady) > 3) {
      const angleDeg = Math.atan2(adx, -ady) * 180 / Math.PI;
      pin.style.setProperty("--pin-angle", `${Math.round(angleDeg)}deg`);
    }
  } else if (mode === "point") {
    marker.style.left = `${newPageX - window.scrollX}px`;
    marker.style.top = `${newPageY - window.scrollY}px`;
    const adx = ancX - newPageX;
    const ady = ancY - newPageY;
    const angleDeg = Math.atan2(-adx, ady) * 180 / Math.PI;
    pin.style.setProperty("--pin-angle", `${Math.round(angleDeg)}deg`);
  } else {
    marker.style.left = `${ancX - window.scrollX}px`;
    marker.style.top = `${ancY - window.scrollY}px`;
    const adx = newPageX - ancX;
    const ady = newPageY - ancY;
    const angleDeg = Math.atan2(adx, -ady) * 180 / Math.PI;
    pin.style.setProperty("--pin-angle", `${Math.round(angleDeg)}deg`);

    const origBtn = pin.querySelector("button") as HTMLElement | null;
    if (origBtn) origBtn.style.opacity = "0";
    const pinArrow = pin.querySelector(".mo-marker-arrow") as HTMLElement | null;
    if (pinArrow) pinArrow.style.display = "none";

    const floatDot = document.createElement("div");
    floatDot.className = "mo-floating-drag-dot mo-marker-visible";
    floatDot.style.left = `${newPageX - window.scrollX}px`;
    floatDot.style.top = `${newPageY - window.scrollY}px`;
    floatDot.style.background = color.fill;
    floatDot.style.border = `2.5px solid ${color.border}`;
    const btn = pin.querySelector("button");
    floatDot.textContent = btn ? btn.textContent : "";
    refs.layer!.appendChild(floatDot);
    state.dragging.floatingDot = floatDot;

    const sx = newPageX - window.scrollX;
    const sy = newPageY - window.scrollY;
    let ex = ancX - window.scrollX;
    let ey = ancY - window.scrollY;

    const anchoredEl = annotation?.anchor ? findAnchoredElement(annotation.anchor) : null;
    if (anchoredEl) {
      const elRect = anchoredEl.getBoundingClientRect();
      const edge = clipLineToRectEdge(sx, sy, ex, ey, elRect);
      ex = edge.x;
      ey = edge.y;
    }

    const segments = mode === "orthogonal"
      ? orthogonalSegments(sx, sy, ex, ey)
      : leadlineSegments(sx, sy, ex, ey);

    if (segments.length > 0) {
      const lineSvg = createAnchorLineSvg({
        segments,
        color: color.fill,
        arrowAt: "end",
        extraClass: "mo-drag-live-line"
      });
      refs.layer!.appendChild(lineSvg);
      state.dragging.liveLine = [lineSvg];
    }
  }
}

export async function handleMouseUp(event: MouseEvent): Promise<void> {
  if (state.drawing) {
    const { points, colorIndex, svg } = state.drawing;
    state.drawing = null;
    svg.remove();
    if (points.length >= 2) {
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      const cx = Math.round((Math.min(...xs) + Math.max(...xs)) / 2);
      const cy = Math.round((Math.min(...ys) + Math.max(...ys)) / 2);
      await saveDraft({
        type: "draw",
        pageX: cx,
        pageY: cy,
        drawPoints: points,
        colorIndex
      });
      render();
    }
    return;
  }

  if (state.mode === "annotate" && state.placementMode === "highlight" && !state.dragging) {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const text = range.toString().trim();
      if (text.length > 0 && !refs.root!.contains(range.commonAncestorContainer)) {
        const rects = Array.from(range.getClientRects());
        if (rects.length > 0) {
          const firstRect = rects[0];
          const anchor = captureTextRangeAnchor(range, text);
          const pX = window.scrollX + firstRect.left;
          const pY = window.scrollY + firstRect.top;
          sel.removeAllRanges();
          await saveDraft({
            type: "highlight",
            pageX: pX,
            pageY: pY,
            textAnchor: anchor,
            note: ""
          });
          render();
          return;
        }
      }
    }
  }

  if (state.placing) {
    const { draft, moved } = state.placing;
    state.placing = null;

    if (moved) {
      state.lastDragWasMove = true;
    }
    clearPreviewMarker();
    await saveDraft({ ...draft, note: "" });
    render();
    return;
  }

  if (!state.dragging) return;

  const { markerId, moved, anchorPageX, anchorPageY, liveLine, floatingDot } = state.dragging;
  const dx = event.clientX - state.dragging.startClientX;
  const dy = event.clientY - state.dragging.startClientY;
  const newPageX = state.dragging.origPageX + dx;
  const newPageY = state.dragging.origPageY + dy;

  if (liveLine) liveLine.forEach((el) => el.remove());
  if (floatingDot) floatingDot.remove();

  const marker = refs.layer!.querySelector(`[data-marker-id="${markerId}"]`) as HTMLElement | null;
  if (marker) {
    marker.classList.remove("mo-dragging");
    const origBtn = marker.querySelector(".mo-marker-pin button") as HTMLElement | null;
    if (origBtn) origBtn.style.opacity = "";
    const pinArrow = marker.querySelector(".mo-marker-arrow") as HTMLElement | null;
    if (pinArrow) pinArrow.style.display = "";
  }

  state.lastDragWasMove = moved;
  state.dragging = null;

  if (!moved) return;

  const annotation = state.annotations.find((a) => a.id === markerId);
  if (!annotation) return;

  const distFromAnchor = Math.hypot(newPageX - anchorPageX, newPageY - anchorPageY);

  if (distFromAnchor <= ROTATE_RADIUS) {
    const adx = newPageX - anchorPageX;
    const ady = newPageY - anchorPageY;
    const angle = Math.atan2(adx, -ady);
    const next = state.annotations.map((a) =>
      a.id === markerId
        ? { ...a, dragged: true, dragAngle: angle, dragAnchor: null }
        : a
    );
    await persistAnnotations(next);
  } else {
    const dragAngle = Math.atan2(newPageX - anchorPageX, -(newPageY - anchorPageY));
    const mode = state.settings.attachmentMode;
    const dragAnchor = mode !== "point"
      ? { pageX: Math.round(anchorPageX), pageY: Math.round(anchorPageY) }
      : null;
    const next = state.annotations.map((a) =>
      a.id === markerId
        ? {
            ...a,
            dragged: true,
            dragAnchor,
            dragAngle,
            position: { pageX: Math.round(newPageX), pageY: Math.round(newPageY) }
          }
        : a
    );
    await persistAnnotations(next);
  }
}

export function toggleMode(): void {
  if (state.mode === "annotate" && state.overlayVisible) {
    state.mode = "idle";
    state.placementMode = null;
    closeEditor();
    hideHighlight();
    closeToolbarPanel();
  } else {
    state.mode = "annotate";
    state.overlayVisible = true;
    state.toolbarCollapsed = false;
  }
  state.settings.overlayVisible = state.overlayVisible;
  saveSettings();
}

export function setPlacementMode(mode: string): void {
  if (state.mode !== "annotate") {
    state.mode = "annotate";
  }
  const wasActive = state.placementMode === mode;
  if (state.drawing) {
    if (state.drawing.svg) state.drawing.svg.remove();
    state.drawing = null;
  }
  closeEditor();
  hideHighlight();
  state.placementMode = wasActive ? null : mode;
  render();
}

export function clearPlacementMode(): void {
  state.placementMode = null;
  hideHighlight();
  render();
}

export function isNearExistingMarker(clientX: number, clientY: number): boolean {
  if (!refs.layer) return false;
  const pins = refs.layer.querySelectorAll(".mo-marker-pin");
  for (const pin of Array.from(pins)) {
    const rect = pin.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dist = Math.hypot(clientX - cx, clientY - cy);
    if (dist < MARKER_EXCLUSION_RADIUS) return true;
  }
  return false;
}

export function focusAnnotation(id: string): void {
  const annotation = state.annotations.find((item) => item.id === id);
  if (!annotation) {
    return;
  }

  window.scrollTo({
    left: 0,
    top: Math.max(annotation.position.pageY - Math.round(window.innerHeight * 0.35), 0),
    behavior: "smooth"
  });
}

export function toggleToolbarPanel(name: string): void {
  state.expandedPanel = state.expandedPanel === name ? null : name;
  uiRenderToolbarPanel();
}

function getPublicState() {
  return {
    pageKey: state.pageKey,
    pageUrl: state.pageUrl,
    pageTheme: detectPageTheme(),
    mode: state.mode,
    placementMode: state.placementMode,
    overlayVisible: state.overlayVisible,
    annotationCount: state.annotations.length,
    annotations: state.annotations
  };
}

export { getPublicState };
