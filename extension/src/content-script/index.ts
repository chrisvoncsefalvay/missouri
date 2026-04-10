import { state } from "./state";
import { getPageKey, getPageUrl } from "./utils";
import { render, renderMarkers, hideHighlight } from "./markers";
import { ensureUi, closeEditor, closeToolbarPanel } from "./ui";
import { loadAnnotations, loadSettings, upsertAnnotationFromPopup, deleteAnnotation, saveSettings } from "./annotations";
import { handleKeydown, handlePointerMove, handlePageClick, handleMouseDown, handleMouseDrag, handleMouseUp, handleContextMenu, toggleMode, setPlacementMode, focusAnnotation, getPublicState } from "./interaction";
import { normalizeSettings } from "./state";

init().catch((error) => {
  console.error("Missouri failed to initialize", error);
});

async function init(): Promise<void> {
  await loadSettings();
  ensureUi();
  bindEvents();
  await loadAnnotations();
  render();
  watchLocationChanges();
}

function bindEvents(): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    handleRuntimeMessage(message)
      .then((payload) => sendResponse(payload))
      .catch((error) => {
        console.error("Extension message handling failed", error);
        sendResponse({ ok: false, error: String(error) });
      });

    return true;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes.mo_settings?.newValue) {
      return;
    }

    state.settings = normalizeSettings(changes.mo_settings.newValue);
    render();
  });

  document.addEventListener("keydown", handleKeydown, true);
  document.addEventListener("keydown", (e) => { state._shiftDown = e.shiftKey; }, true);
  document.addEventListener("keyup", (e) => { state._shiftDown = e.shiftKey; }, true);
  document.addEventListener("mousemove", handlePointerMove, true);
  document.addEventListener("click", handlePageClick, true);
  window.addEventListener("scroll", () => renderMarkers(), true);
  window.addEventListener("resize", () => renderMarkers(), true);
  document.addEventListener("mousedown", handleMouseDown, true);
  document.addEventListener("mousemove", handleMouseDrag, true);
  document.addEventListener("mouseup", handleMouseUp, true);
  document.addEventListener("contextmenu", handleContextMenu, true);
  document.addEventListener("dragstart", (e) => {
    if (state.mode === "annotate" && (state.placementMode === "highlight" || state.placementMode === "draw")) {
      e.preventDefault();
    }
  }, true);
}

async function handleRuntimeMessage(message: any): Promise<any> {
  switch (message?.type) {
    case "TOGGLE_MODE":
      toggleMode();
      return { ok: true, state: getPublicState() };
    case "TOGGLE_HIGHLIGHT":
      setPlacementMode("highlight");
      return { ok: true, state: getPublicState() };
    case "TOGGLE_OVERLAY":
      state.overlayVisible = !state.overlayVisible;
      state.settings.overlayVisible = state.overlayVisible;
      if (!state.overlayVisible) {
        state.mode = "idle";
        state.placementMode = null;
        closeEditor();
        hideHighlight();
        closeToolbarPanel();
      }
      await saveSettings();
      render();
      return { ok: true, state: getPublicState() };
    case "GET_STATE":
      return { ok: true, state: getPublicState() };
    case "SET_MODE":
      state.mode = message.enabled ? "annotate" : "idle";
      if (!message.enabled) {
        state.placementMode = null;
      }
      render();
      return { ok: true, state: getPublicState() };
    case "SET_OVERLAY_VISIBILITY":
      state.overlayVisible = Boolean(message.visible);
      state.settings.overlayVisible = state.overlayVisible;
      await saveSettings();
      render();
      return { ok: true, state: getPublicState() };
    case "SAVE_ANNOTATION":
      await upsertAnnotationFromPopup(message.annotation);
      return { ok: true, state: getPublicState() };
    case "DELETE_ANNOTATION":
      await deleteAnnotation(message.id);
      return { ok: true, state: getPublicState() };
    case "FOCUS_ANNOTATION":
      focusAnnotation(message.id);
      return { ok: true };
    default:
      return { ok: false, error: "Unknown message type" };
  }
}

function watchLocationChanges(): void {
  window.setInterval(async () => {
    if (location.href === state.lastKnownHref) {
      return;
    }

    const nextPageKey = getPageKey(location.href);
    if (nextPageKey === state.pageKey) {
      state.lastKnownHref = location.href;
      return;
    }

    state.lastKnownHref = location.href;
    state.pageKey = nextPageKey;
    state.pageUrl = getPageUrl(location.href);
    state.annotations = [];
    closeEditor();
    closeToolbarPanel();
    hideHighlight();
    await loadAnnotations();
    render();
  }, 750);
}
