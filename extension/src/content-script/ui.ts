import { state, refs, ROOT_ID, REGISTRY_ID, ICON, MARKER_COLORS } from "./state";
import { clamp, animateOut, formatRelativeTime } from "./utils";
import { render, hideHighlight, updateAllColorDots, updatePencilCursorColor, updateCursorMarkerColor, updateHighlighterCursorColor } from "./markers";
import { saveDraft, deleteAnnotation, persistAnnotations, nextLabel, markerDisplayLabel, backrementLabel, deincrementLabel, triggerWipeAnimation, copyAnnotationsToClipboard, copySingleAnnotation, saveSettings, getNumberedAnnotations } from "./annotations";
import { setPlacementMode, toggleToolbarPanel as _toggleToolbarPanel, focusAnnotation } from "./interaction";

const SKILL_INSTALL_COMMAND = "npx skills add chrisvoncsefalvay/missouri";

const SKILL_INSTALL_TARGETS: Array<{
  label: string;
  docsUrl?: string;
  setupNote?: string;
}> = [
  {
    label: "Claude Code",
    docsUrl: "https://code.claude.com/docs/en/skills"
  },
  {
    label: "Cursor",
    docsUrl: "https://cursor.com/docs/context/skills",
    setupNote: "Requires Cursor Nightly and Agent Skills enabled."
  },
  {
    label: "Copilot",
    docsUrl: "https://code.visualstudio.com/docs/copilot/customization/agent-skills"
  },
  {
    label: "Gemini",
    docsUrl: "https://geminicli.com/docs/cli/skills/",
    setupNote: "Requires Gemini CLI preview and Skills enabled in /settings."
  }
];

function getAnnotationAuthorName(draft: { authorName?: string | null }): string {
  return draft.authorName?.trim() || "You";
}

function flashButtonLabel(button: HTMLButtonElement, text: string, resetText: string): void {
  button.textContent = text;
  window.setTimeout(() => {
    button.textContent = resetText;
  }, 1500);
}

function makeSkillInstallButton(target: { label: string; docsUrl?: string }): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mo-info-link mo-info-install-btn";
  button.textContent = target.label;
  button.title = `Copy ${SKILL_INSTALL_COMMAND}`;

  button.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(SKILL_INSTALL_COMMAND).then(() => {
      flashButtonLabel(button, "Copied", target.label);
    }).catch(() => {
      flashButtonLabel(button, "Copy failed", target.label);
    });
  });

  if (target.docsUrl) {
    button.addEventListener("auxclick", (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      window.open(target.docsUrl, "_blank", "noopener");
    });
  }

  return button;
}

export function ensureUi(): void {
  if (refs.root?.isConnected) {
    return;
  }

  refs.root = document.getElementById(ROOT_ID) as HTMLElement | null;
  if (refs.root?.isConnected) {
    refs.toolbar = refs.root.querySelector(".mo-toolbar") as HTMLElement | null;
    refs.layer = refs.root.querySelector('[data-role="marker-layer"]') as HTMLElement | null;
    refs.registry = refs.root.querySelector(`#${REGISTRY_ID}`) as HTMLElement | null;
    return;
  }

  const root = document.createElement("div");
  root.id = ROOT_ID;

  const toolbar = document.createElement("div");
  toolbar.className = "mo-toolbar mo-marker-visible";

  const collapseBtn = document.createElement("button");
  collapseBtn.type = "button";
  collapseBtn.className = "mo-collapse-btn";
  collapseBtn.title = "Drag to move toolbar. Click to collapse.";

  const collapseLogo = document.createElement("img");
  collapseLogo.className = "mo-collapse-logo";
  collapseLogo.src = chrome.runtime.getURL("icons/logo-32.png");
  collapseLogo.alt = "Missouri";
  collapseLogo.draggable = false;
  collapseBtn.appendChild(collapseLogo);

  let toolbarDrag: { startX: number; startY: number; origLeft: number; origTop: number; moved: boolean } | null = null;
  let fadeTimer: ReturnType<typeof setTimeout> | null = null;

  function startCollapsedFade(tb: HTMLElement): void {
    stopCollapsedFade(tb);
    fadeTimer = window.setTimeout(() => {
      tb.classList.add("mo-collapsed-idle");
    }, 2200);
  }

  function stopCollapsedFade(tb: HTMLElement): void {
    if (fadeTimer) {
      clearTimeout(fadeTimer);
      fadeTimer = null;
    }
    tb.classList.remove("mo-collapsed-idle");
  }

  collapseBtn.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const rect = toolbar.getBoundingClientRect();
    toolbarDrag = {
      startX: e.clientX,
      startY: e.clientY,
      origLeft: rect.left,
      origTop: rect.top,
      moved: false
    };

    const onMove = (ev: MouseEvent) => {
      if (!toolbarDrag) return;

      const dx = ev.clientX - toolbarDrag.startX;
      const dy = ev.clientY - toolbarDrag.startY;
      if (!toolbarDrag.moved && Math.abs(dx) + Math.abs(dy) > 3) {
        toolbarDrag.moved = true;
      }

      toolbar.style.right = "auto";
      toolbar.style.left = `${clamp(toolbarDrag.origLeft + dx, 8, window.innerWidth - toolbar.offsetWidth - 8)}px`;
      toolbar.style.top = `${clamp(toolbarDrag.origTop + dy, 8, window.innerHeight - toolbar.offsetHeight - 8)}px`;
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup", onUp, true);

      if (!toolbarDrag?.moved) {
        state.toolbarCollapsed = !state.toolbarCollapsed;
        toolbar.classList.toggle("mo-collapsed", state.toolbarCollapsed);
        if (state.toolbarCollapsed) startCollapsedFade(toolbar);
        else stopCollapsedFade(toolbar);
      }

      toolbarDrag = null;
    };

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
  });

  toolbar.addEventListener("mouseenter", () => {
    if (state.toolbarCollapsed) stopCollapsedFade(toolbar);
  });

  toolbar.addEventListener("mouseleave", () => {
    if (state.toolbarCollapsed) startCollapsedFade(toolbar);
  });

  const seg1 = makeSegment();
  const freeBtn = makeIconButton("Free marker", ICON.free, () => setPlacementMode("free"));
  freeBtn.dataset.role = "free";
  const elemBtn = makeIconButton("Element marker", ICON.element, () => setPlacementMode("element"));
  elemBtn.dataset.role = "element";
  const highlightBtn = makeIconButton("Highlight text", ICON.highlight, () => setPlacementMode("highlight"));
  highlightBtn.dataset.role = "highlight";

  for (const btn of [freeBtn, elemBtn, highlightBtn]) {
    const dot = document.createElement("span");
    dot.className = "mo-btn-color-dot";
    dot.style.background = MARKER_COLORS[state.stickyColorIndex % MARKER_COLORS.length].fill;
    btn.appendChild(dot);
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      state.stickyColorIndex = (state.stickyColorIndex + 1) % MARKER_COLORS.length;
      updateAllColorDots();
      updatePencilCursorColor();
      updateCursorMarkerColor();
      updateHighlighterCursorColor();
    });
  }

  const drawBtn = document.createElement("button");
  drawBtn.className = "mo-toolbar-btn";
  drawBtn.title = "Freehand draw (right-click to cycle color)";
  drawBtn.innerHTML = ICON.draw;
  drawBtn.dataset.role = "draw";
  const drawDot = document.createElement("span");
  drawDot.className = "mo-btn-color-dot";
  drawDot.style.background = MARKER_COLORS[state.stickyColorIndex % MARKER_COLORS.length].fill;
  drawBtn.appendChild(drawDot);
  drawBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setPlacementMode("draw");
  });
  drawBtn.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    state.stickyColorIndex = (state.stickyColorIndex + 1) % MARKER_COLORS.length;
    updateAllColorDots();
    updatePencilCursorColor();
    updateCursorMarkerColor();
    updateHighlighterCursorColor();
  });
  seg1.append(freeBtn, elemBtn, highlightBtn, drawBtn);

  const seg2 = makeSegment();
  const listBtn = makeIconButton("Annotations list", ICON.list, () => _toggleToolbarPanel("list"));
  listBtn.dataset.role = "list";
  const copyBtn = makeIconButton("Copy annotations", ICON.copy, () => copyAnnotationsToClipboard());

  let wipeConfirmTimer: ReturnType<typeof setTimeout> | null = null;
  const wipeBtn = makeIconButton("Wipe all annotations", ICON.sponge, () => {
    if (wipeBtn.classList.contains("mo-wipe-confirm")) {
      if (wipeConfirmTimer) {
        clearTimeout(wipeConfirmTimer);
        wipeConfirmTimer = null;
      }
      wipeBtn.classList.remove("mo-wipe-confirm");
      wipeBtn.title = "Wipe all annotations";
      triggerWipeAnimation();
      return;
    }

    wipeBtn.classList.add("mo-wipe-confirm");
    wipeBtn.title = "Click again to wipe!";
    wipeConfirmTimer = window.setTimeout(() => {
      wipeBtn.classList.remove("mo-wipe-confirm");
      wipeBtn.title = "Wipe all annotations";
      wipeConfirmTimer = null;
    }, 3000);
  });
  wipeBtn.dataset.role = "wipe";
  seg2.append(listBtn, copyBtn, wipeBtn);

  const seg3 = makeSegment();
  const settingsBtn = makeIconButton("Settings", ICON.settings, () => _toggleToolbarPanel("settings"));
  settingsBtn.dataset.role = "settings";
  const hideBtn = makeIconButton("Hide overlay", ICON.hide, () => {
    state.mode = "idle";
    state.placementMode = null;
    state.overlayVisible = false;
    state.settings.overlayVisible = false;
    saveSettings();
    closeEditor();
    hideHighlight();
    closeToolbarPanel();
    render();
  });
  seg3.append(settingsBtn, hideBtn);

  const toolbarRow = document.createElement("div");
  toolbarRow.className = "mo-toolbar-row";
  toolbarRow.append(
    collapseBtn,
    makeDivider(),
    seg1,
    makeDivider(),
    seg2,
    makeDivider(),
    seg3
  );
  toolbar.appendChild(toolbarRow);

  const layer = document.createElement("div");
  layer.setAttribute("data-role", "marker-layer");

  const registry = document.createElement("section");
  registry.id = REGISTRY_ID;
  registry.setAttribute("data-mo-marker-registry", "true");
  registry.setAttribute("aria-hidden", "true");

  root.append(toolbar, layer, registry);
  document.documentElement.appendChild(root);

  refs.root = root;
  refs.toolbar = toolbar;
  refs.layer = layer;
  refs.registry = registry;
}

export function makeIconButton(title: string, svgHtml: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "mo-toolbar-btn";
  btn.title = title;
  btn.innerHTML = svgHtml;
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return btn;
}

export function makeSegment(): HTMLDivElement {
  const seg = document.createElement("div");
  seg.className = "mo-toolbar-segment";
  return seg;
}

export function makeDivider(): HTMLDivElement {
  const div = document.createElement("div");
  div.className = "mo-toolbar-divider";
  return div;
}

export function openEditor(draft: any): void {
  closeEditor();
  state.editingDraft = draft;

  const editor = document.createElement("div");
  editor.className = "mo-compact-editor mo-marker-visible";

  positionEditorAwayFromPin(editor, draft);
  makeEditorDraggable(editor);

  const hasNote = draft.note && draft.note.trim().length > 0;

  let currentLabel = draft.label || markerDisplayLabel(draft.id) || nextLabel();
  let currentColorIndex = draft.colorIndex ?? state.stickyColorIndex;

  const labelBadge = document.createElement("span");
  labelBadge.className = "mo-compact-label";
  labelBadge.textContent = currentLabel;
  labelBadge.style.cursor = "pointer";
  labelBadge.title = "Click to change colour";

  function updateBadgeColor() {
    const c = MARKER_COLORS[currentColorIndex % MARKER_COLORS.length];
    labelBadge.style.background = c.fill;
    labelBadge.style.color = "#fff";
    labelBadge.dataset.colorIdx = String(currentColorIndex % MARKER_COLORS.length);
  }
  updateBadgeColor();

  labelBadge.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    currentColorIndex = (currentColorIndex + 1) % MARKER_COLORS.length;
    state.stickyColorIndex = currentColorIndex;
    updateBadgeColor();
    if (draft.id) {
      const updated = state.annotations.map((a) =>
        a.id === draft.id ? { ...a, colorIndex: currentColorIndex } : a
      );
      persistAnnotations(updated);
    }
  });

  if (hasNote) {
    const thread = document.createElement("div");
    thread.className = "mo-thread-view";

    const comment = document.createElement("div");
    comment.className = "mo-thread-comment";
    const author = document.createElement("span");
    author.className = "mo-thread-author";
    author.textContent = getAnnotationAuthorName(draft);
    const body = document.createElement("div");
    body.className = "mo-thread-body";
    body.textContent = draft.note;
    comment.append(author, body);
    thread.appendChild(comment);
    editor.appendChild(thread);
  }

  const textarea = document.createElement("textarea");
  textarea.className = "mo-compact-input";
  textarea.placeholder = hasNote ? "Reply\u2026" : "Add a note\u2026";
  textarea.rows = 1;
  textarea.value = hasNote ? "" : (draft.note || "");
  textarea.addEventListener("input", () => {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  });

  const saveBtn = document.createElement("button");
  saveBtn.className = "mo-compact-btn mo-compact-submit";
  saveBtn.title = "Save";
  saveBtn.innerHTML = ICON.send;
  saveBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const newText = textarea.value.trim();
    const finalNote = hasNote
      ? (draft.note + (newText ? "\n\n" + newText : ""))
      : newText;
    await saveDraft({ ...draft, note: finalNote, label: currentLabel, colorIndex: currentColorIndex });
    closeEditor();
    render();
  });

  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      saveBtn.click();
      return;
    }
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      currentLabel = backrementLabel(currentLabel);
      labelBadge.textContent = currentLabel;
      return;
    }
    if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      currentLabel = deincrementLabel(currentLabel);
      labelBadge.textContent = currentLabel;
      return;
    }
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "mo-compact-btn mo-compact-cancel";
  deleteBtn.title = "Delete";
  deleteBtn.innerHTML = ICON.trash;
  deleteBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (draft.id) await deleteAnnotation(draft.id);
    closeEditor();
    render();
  });

  const actions = document.createElement("div");
  actions.className = "mo-compact-actions";
  actions.append(labelBadge, deleteBtn, saveBtn);

  editor.append(textarea, actions);
  refs.root!.appendChild(editor);
  refs.editor = editor;
  textarea.focus();
}

export function openHighlightEditor(draft: any): void {
  closeEditor();
  state.editingDraft = draft;

  const editor = document.createElement("div");
  editor.className = "mo-compact-editor mo-marker-visible";

  const markerY = draft.pageY - window.scrollY;
  const above = markerY > window.innerHeight / 2;
  editor.style.left = `${clamp(draft.pageX - window.scrollX, 8, window.innerWidth - 328)}px`;
  editor.style.top = `${above ? clamp(markerY - 140, 8, window.innerHeight - 80) : clamp(markerY + 28, 8, window.innerHeight - 130)}px`;

  makeEditorDraggable(editor);

  const hasNote = draft.note && draft.note.trim().length > 0;

  if (hasNote) {
    const thread = document.createElement("div");
    thread.className = "mo-thread-view";
    const comment = document.createElement("div");
    comment.className = "mo-thread-comment";
    const author = document.createElement("span");
    author.className = "mo-thread-author";
    author.textContent = getAnnotationAuthorName(draft);
    const body = document.createElement("div");
    body.className = "mo-thread-body";
    body.textContent = draft.note;
    comment.append(author, body);
    thread.appendChild(comment);
    editor.appendChild(thread);
  }

  const textarea = document.createElement("textarea");
  textarea.className = "mo-compact-input";
  textarea.placeholder = hasNote ? "Reply\u2026" : "Add a note\u2026";
  textarea.rows = 1;
  textarea.value = hasNote ? "" : "";
  textarea.addEventListener("input", () => {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  });

  let hlColorIndex = draft.colorIndex ?? state.stickyColorIndex;
  const hlLabelBadge = document.createElement("span");
  hlLabelBadge.className = "mo-compact-label";
  hlLabelBadge.innerHTML = ICON.highlight;
  hlLabelBadge.style.cursor = "pointer";
  hlLabelBadge.title = "Click to change colour";

  function updateHlBadgeColor() {
    const c = MARKER_COLORS[hlColorIndex % MARKER_COLORS.length];
    hlLabelBadge.style.background = c.fill;
    hlLabelBadge.style.color = "#fff";
    hlLabelBadge.dataset.colorIdx = String(hlColorIndex % MARKER_COLORS.length);
  }
  updateHlBadgeColor();

  hlLabelBadge.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    hlColorIndex = (hlColorIndex + 1) % MARKER_COLORS.length;
    state.stickyColorIndex = hlColorIndex;
    updateHlBadgeColor();
    if (draft.id) {
      const updated = state.annotations.map((a) =>
        a.id === draft.id ? { ...a, colorIndex: hlColorIndex } : a
      );
      persistAnnotations(updated);
    }
  });

  const saveBtn = document.createElement("button");
  saveBtn.className = "mo-compact-btn mo-compact-submit";
  saveBtn.title = "Save";
  saveBtn.innerHTML = ICON.send;
  saveBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const newText = textarea.value.trim();
    const finalNote = hasNote
      ? (draft.note + (newText ? "\n\n" + newText : ""))
      : newText;
    await saveDraft({ ...draft, note: finalNote, colorIndex: hlColorIndex });
    closeEditor();
    render();
  });

  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      saveBtn.click();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeEditor();
      render();
    }
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "mo-compact-btn mo-compact-cancel";
  deleteBtn.title = "Delete";
  deleteBtn.innerHTML = ICON.trash;
  deleteBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (draft.id) await deleteAnnotation(draft.id);
    closeEditor();
    render();
  });

  const actions = document.createElement("div");
  actions.className = "mo-compact-actions";
  actions.append(hlLabelBadge, deleteBtn, saveBtn);

  editor.append(textarea, actions);
  refs.root!.appendChild(editor);
  refs.editor = editor;
  textarea.focus();
}

export function closeEditor(): void {
  if (refs.editor) {
    animateOut(refs.editor, "mo-closing");
    refs.editor = null;
  }
  if (state.editingDraft && !state.editingDraft.id) {
    dismissPreviewMarker();
  }
  state.editingDraft = null;
}

export function showPreviewMarker(draft: any): void {
  clearPreviewMarker();
  const marker = document.createElement("div");
  marker.className = "mo-marker mo-marker-visible mo-marker-preview";
  marker.dataset.markerType = draft.type;
  marker.style.left = `${draft.pageX - window.scrollX}px`;
  marker.style.top = `${draft.pageY - window.scrollY}px`;

  const pin = document.createElement("div");
  pin.className = "mo-marker-pin";

  const btn = document.createElement("div");
  btn.className = "mo-preview-dot";
  btn.textContent = nextLabel();

  const tail = document.createElement("div");
  tail.className = "mo-preview-tail";

  pin.append(btn, tail);
  marker.appendChild(pin);
  refs.layer!.appendChild(marker);
  refs.preview = marker;
}

export function clearPreviewMarker(): void {
  if (refs.preview) {
    refs.preview.remove();
    refs.preview = null;
  }
}

export function dismissPreviewMarker(): void {
  if (refs.preview) {
    refs.preview.classList.add("mo-puff-out");
    const el = refs.preview;
    refs.preview = null;
    el.addEventListener("animationend", () => el.remove(), { once: true });
    setTimeout(() => { if (el.parentNode) el.remove(); }, 500);
  }
}

export function toggleToolbarPanel(name: string): void {
  state.expandedPanel = state.expandedPanel === name ? null : name;
  renderToolbarPanel();
}

export function closeToolbarPanel(): void {
  state.expandedPanel = null;
  renderToolbarPanel();
}

export function renderToolbarPanel(): void {
  const existing = refs.toolbar?.querySelector(".mo-toolbar-panel");
  if (existing) existing.remove();

  const listBtn = refs.root?.querySelector('[data-role="list"]') as HTMLElement | null;
  const settingsBtn = refs.root?.querySelector('[data-role="settings"]') as HTMLElement | null;
  if (listBtn) listBtn.dataset.active = String(state.expandedPanel === "list");
  if (settingsBtn) settingsBtn.dataset.active = String(state.expandedPanel === "settings");

  if (!state.expandedPanel || !refs.toolbar) return;

  const panel = document.createElement("div");
  panel.className = "mo-toolbar-panel";
  const toolbarRow = refs.toolbar.querySelector(".mo-toolbar-row") as HTMLElement | null;
  if (toolbarRow && toolbarRow.offsetWidth > 0) {
    panel.style.maxWidth = `${toolbarRow.offsetWidth}px`;
  }

  if (state.expandedPanel === "list") {
    renderListPanelContent(panel);
  } else if (state.expandedPanel === "settings") {
    renderSettingsPanelContent(panel);
  }

  refs.toolbar.appendChild(panel);
}

export function renderListPanelContent(panel: HTMLElement): void {
  const title = document.createElement("strong");
  title.className = "mo-panel-title";
  title.textContent = "Annotations";
  panel.appendChild(title);

  const numbered = getNumberedAnnotations();

  if (!numbered.length) {
    const empty = document.createElement("span");
    empty.className = "mo-list-empty";
    empty.textContent = "No numbered annotations yet.";
    panel.appendChild(empty);
  } else {
    for (const annotation of numbered) {
      panel.appendChild(makeListItem(annotation));
    }
  }
}

export function renderSettingsPanelContent(panel: HTMLElement): void {
  const title = document.createElement("strong");
  title.className = "mo-panel-title";
  title.textContent = "Settings";
  panel.appendChild(title);

  /* ── Markers group ─────────────────────── */
  const markersGroup = document.createElement("div");
  markersGroup.className = "mo-settings-group";

  const attachLabel = document.createElement("span");
  attachLabel.className = "mo-settings-label";
  attachLabel.textContent = "Attachment mode";
  markersGroup.appendChild(attachLabel);

  const attachSeg = document.createElement("div");
  attachSeg.className = "mo-settings-segmented";
  const modes: Array<{ value: string; label: string }> = [
    { value: "point", label: "Point" },
    { value: "orthogonal", label: "Orthogonal" },
    { value: "leadline", label: "Lead lines" }
  ];
  for (const mode of modes) {
    const btn = document.createElement("button");
    btn.className = "mo-settings-seg-btn";
    btn.textContent = mode.label;
    btn.dataset.active = String(state.settings.attachmentMode === mode.value);
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      state.settings.attachmentMode = mode.value as any;
      saveSettings();
      renderToolbarPanel();
    });
    attachSeg.appendChild(btn);
  }
  markersGroup.appendChild(attachSeg);

  const cbRow = document.createElement("label");
  cbRow.className = "mo-settings-toggle";
  const cbLabel = document.createElement("span");
  cbLabel.textContent = "Colorblind patterns";
  const cbCheck = document.createElement("input");
  cbCheck.type = "checkbox";
  cbCheck.checked = state.settings.colorblindMode;
  cbCheck.addEventListener("change", () => {
    state.settings.colorblindMode = cbCheck.checked;
    saveSettings();
  });
  cbRow.append(cbLabel, cbCheck);
  markersGroup.appendChild(cbRow);

  panel.appendChild(markersGroup);

  /* ── Info group ────────────────────────── */
  const infoGroup = document.createElement("div");
  infoGroup.className = "mo-settings-group mo-info-group";

  const infoRow = document.createElement("div");
  infoRow.className = "mo-info-row";

  const infoLogo = document.createElement("img");
  infoLogo.src = chrome.runtime.getURL("icons/logo-32.png");
  infoLogo.alt = "Missouri";
  infoLogo.className = "mo-info-logo";
  infoLogo.draggable = false;
  infoRow.appendChild(infoLogo);

  const infoText = document.createElement("div");
  infoText.className = "mo-info-text";

  const infoName = document.createElement("span");
  infoName.className = "mo-info-name";
  infoName.textContent = "Missouri";

  const manifest = chrome.runtime.getManifest();
  const infoVersion = document.createElement("span");
  infoVersion.className = "mo-info-version";
  infoVersion.textContent = `v${manifest.version}`;

  infoText.append(infoName, infoVersion);
  infoRow.appendChild(infoText);
  infoGroup.appendChild(infoRow);

  const infoLinks = document.createElement("div");
  infoLinks.className = "mo-info-links";

  const ghLink = document.createElement("a");
  ghLink.className = "mo-info-link";
  ghLink.href = "https://github.com/chrisvoncsefalvay/missouri";
  ghLink.target = "_blank";
  ghLink.rel = "noopener";
  ghLink.textContent = "GitHub";

  const bugLink = document.createElement("a");
  bugLink.className = "mo-info-link";
  bugLink.href = "https://github.com/chrisvoncsefalvay/missouri/issues";
  bugLink.target = "_blank";
  bugLink.rel = "noopener";
  bugLink.textContent = "Report a bug";

  infoLinks.append(ghLink, bugLink);
  infoGroup.appendChild(infoLinks);

  const installBlock = document.createElement("div");
  installBlock.className = "mo-info-install-block";

  const installTitle = document.createElement("span");
  installTitle.className = "mo-info-install-title";
  installTitle.textContent = "Install skill";
  installBlock.appendChild(installTitle);

  const installButtons = document.createElement("div");
  installButtons.className = "mo-info-install-buttons";
  for (const target of SKILL_INSTALL_TARGETS) {
    installButtons.appendChild(makeSkillInstallButton(target));
  }
  installBlock.appendChild(installButtons);

  const installCommand = document.createElement("code");
  installCommand.className = "mo-info-install-command";
  installCommand.textContent = SKILL_INSTALL_COMMAND;
  installBlock.appendChild(installCommand);

  const installNote = document.createElement("p");
  installNote.className = "mo-info-install-note";
  installNote.textContent = "Click a button to copy the install command for that agent. Middle-click opens that agent's skills docs. Run it from your project root so npx skills can auto-detect the right harness.";
  installBlock.appendChild(installNote);

  const setupNotes = SKILL_INSTALL_TARGETS.map((target) => target.setupNote).filter((note): note is string => Boolean(note));
  if (setupNotes.length) {
    const setupList = document.createElement("ul");
    setupList.className = "mo-info-install-list";
    for (const note of setupNotes) {
      const item = document.createElement("li");
      item.textContent = note;
      setupList.appendChild(item);
    }
    installBlock.appendChild(setupList);
  }

  infoGroup.appendChild(installBlock);

  if (state.storageDegraded) {
    const storageWarning = document.createElement("p");
    storageWarning.className = "mo-info-storage-warning";
    storageWarning.textContent = "Storage is temporarily unavailable, so Missouri is running without saved settings or annotations. This usually means Chromium has this profile locked elsewhere. Close other Chromium windows using the same profile, then reload the extension or refresh this page.";
    infoGroup.appendChild(storageWarning);
  }

  panel.appendChild(infoGroup);
}

export function makeListItem(annotation: any): HTMLElement {
  const item = document.createElement("div");
  item.className = "mo-list-item";

  const numberBadge = document.createElement("span");
  numberBadge.className = "mo-list-number mo-list-badge";
  const color = MARKER_COLORS[annotation.colorIndex % MARKER_COLORS.length];
  numberBadge.style.background = color.fill;
  numberBadge.textContent = annotation.label || markerDisplayLabel(annotation.id) || "?";

  const body = document.createElement("div");
  body.className = "mo-list-body";
  body.title = "Focus annotation";
  body.tabIndex = 0;
  body.addEventListener("click", () => focusAnnotation(annotation.id));
  body.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      focusAnnotation(annotation.id);
    }
  });

  const notePreview = document.createElement("span");
  notePreview.className = "mo-list-note";
  if (annotation.note) {
    notePreview.textContent = annotation.note;
  } else {
    notePreview.textContent = "No note";
    notePreview.classList.add("mo-list-note-empty");
  }

  body.appendChild(notePreview);

  const meta = document.createElement("div");
  meta.className = "mo-list-meta";

  const typeNames: Record<string, string> = {
    free: "Free",
    element: "Element",
    highlight: "Highlight",
    draw: "Draw"
  };
  const typePill = document.createElement("span");
  typePill.className = "mo-list-type-pill";
  typePill.dataset.type = annotation.type;
  typePill.textContent = typeNames[annotation.type] || annotation.type;
  meta.appendChild(typePill);

  if (annotation.updatedAt) {
    const time = document.createElement("span");
    time.className = "mo-list-time";
    time.textContent = formatRelativeTime(annotation.updatedAt);
    meta.appendChild(time);
  }

  body.appendChild(meta);
  const copyBtn = makeListIconButton(ICON.copy, () => {
    copySingleAnnotation(annotation);
  });
  copyBtn.title = "Copy for LLM";
  const deleteBtn = makeListIconButton(ICON.trash, async () => {
    await deleteAnnotation(annotation.id);
    render();
  });
  deleteBtn.classList.add("mo-icon-btn-danger");
  deleteBtn.title = "Delete";

  item.append(numberBadge, body, copyBtn, deleteBtn);
  return item;
}

export function makeListIconButton(svgHtml: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "mo-icon-btn mo-list-action-btn";
  btn.innerHTML = svgHtml;
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return btn;
}

export function makeEditorDraggable(editor: HTMLElement): void {
  let dragState: { startX: number; startY: number; origLeft: number; origTop: number } | null = null;

  const onMouseDown = (e: MouseEvent) => {
    if ((e.target as Element).closest("textarea, button, .mo-compact-input")) return;
    e.preventDefault();
    dragState = {
      startX: e.clientX,
      startY: e.clientY,
      origLeft: editor.offsetLeft,
      origTop: editor.offsetTop
    };
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("mouseup", onMouseUp, true);
    editor.style.cursor = "grabbing";
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!dragState) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    editor.style.left = `${clamp(dragState.origLeft + dx, 8, window.innerWidth - editor.offsetWidth - 8)}px`;
    editor.style.top = `${clamp(dragState.origTop + dy, 8, window.innerHeight - editor.offsetHeight - 8)}px`;
  };

  const onMouseUp = () => {
    dragState = null;
    editor.style.cursor = "";
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("mouseup", onMouseUp, true);
  };

  editor.addEventListener("mousedown", onMouseDown);
}

export function positionEditorAwayFromPin(editor: HTMLElement, draft: any): void {
  const EDITOR_W = 320;
  const EDITOR_H_EST = 120;
  const GAP = 12;
  const markerX = draft.pageX - window.scrollX;
  const markerY = draft.pageY - window.scrollY;

  let tailAngleRad = 0;
  if (draft.dragAngle != null) {
    tailAngleRad = draft.dragAngle;
  } else if (draft.dragged && draft.elementCenter) {
    const dx = draft.elementCenter.pageX - draft.pageX;
    const dy = draft.elementCenter.pageY - draft.pageY;
    tailAngleRad = Math.atan2(dx, -dy);
  }

  const awayX = -Math.sin(tailAngleRad);
  const awayY = Math.cos(tailAngleRad);

  let editorLeft = markerX + awayX * (EDITOR_W / 2 + GAP) - EDITOR_W / 2;
  let editorTop = markerY + awayY * (EDITOR_H_EST / 2 + GAP + 20) - EDITOR_H_EST / 2;

  editorLeft = clamp(editorLeft, 8, window.innerWidth - EDITOR_W - 8);
  editorTop = clamp(editorTop, 8, window.innerHeight - EDITOR_H_EST - 8);

  editor.style.left = `${editorLeft}px`;
  editor.style.top = `${editorTop}px`;
}
