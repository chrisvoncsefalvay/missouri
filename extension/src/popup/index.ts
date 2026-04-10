(async function popupScript(): Promise<void> {
  type PageTheme = "light" | "dark";
  type PopupAnnotation = {
    id: string;
    type: "free" | "element" | "highlight" | "draw";
    authorName?: string | null;
    note: string;
    label: string | null;
    colorIndex: number;
    resolved: boolean;
    updatedAt: string;
  };
  type PopupState = {
    pageKey: string;
    pageUrl: string;
    pageTheme: PageTheme;
    mode: "idle" | "annotate";
    placementMode: string | null;
    overlayVisible: boolean;
    annotationCount: number;
    annotations: PopupAnnotation[];
  };
  type StateResponse = {
    ok?: boolean;
    state?: PopupState;
  };

  const ICONS: Record<string, string> = {
    focus:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="3"/><path d="M2 8h2M12 8h2M8 2v2M8 12v2"/></svg>',
    edit: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 2.5l2 2L5 13H3v-2z"/></svg>',
    trash:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h10M6 4V3h4v1M5 4v8.5a1 1 0 001 1h4a1 1 0 001-1V4"/></svg>'
  };

  const refs = {
    brandMark: document.getElementById("brand-mark") as HTMLButtonElement,
    pageTitle: document.getElementById("page-title") as HTMLElement,
    pageUrl: document.getElementById("page-url") as HTMLElement,
    modeChip: document.getElementById("mode-chip") as HTMLElement,
    themeChip: document.getElementById("theme-chip") as HTMLElement,
    annotationCount: document.getElementById("annotation-count") as HTMLElement,
    elementCount: document.getElementById("element-count") as HTMLElement,
    freeCount: document.getElementById("free-count") as HTMLElement,
    reviewCount: document.getElementById("review-count") as HTMLElement,
    toggleMode: document.getElementById("toggle-mode") as HTMLButtonElement,
    startHighlight: document.getElementById("start-highlight") as HTMLButtonElement,
    toggleOverlay: document.getElementById("toggle-overlay") as HTMLButtonElement,
    statusWhisper: document.getElementById("status-whisper") as HTMLElement,
    listSummary: document.getElementById("list-summary") as HTMLElement,
    annotationList: document.getElementById("annotation-list") as HTMLElement
  };

  let currentState: PopupState | null = null;
  let whisperTimer: number | null = null;
  let whisperLocked = false;

  refs.brandMark.addEventListener("click", () => {
    const note = nextFieldNote(currentState);
    refs.brandMark.dataset.glint = "true";
    window.setTimeout(() => {
      refs.brandMark.dataset.glint = "false";
    }, 520);
    setWhisper(note, true);
  });

  refs.toggleMode.addEventListener("click", () =>
    performAction(
      (tabId) => sendToTab(tabId, { type: "TOGGLE_MODE" }),
      (state) =>
        state.mode === "annotate"
          ? "Annotation mode is live. Click the page to leave precise context."
          : "Review layer paused. Your notes stay exactly where they are."
    )
  );
  refs.startHighlight.addEventListener("click", () =>
    performAction(
      (tabId) => sendToTab(tabId, { type: "TOGGLE_HIGHLIGHT" }),
      () => "Highlight mode is ready. Mark the copy you want the model to notice."
    )
  );
  refs.toggleOverlay.addEventListener("click", () =>
    performAction(
      (tabId) => sendToTab(tabId, { type: "TOGGLE_OVERLAY" }),
      (state) =>
        state.overlayVisible
          ? "Overlay restored. Your review layer is visible again."
          : "Overlay tucked away. The context stays saved for later."
    )
  );

  await refresh();

  async function refresh(): Promise<PopupState | null> {
    const tab = await getActiveTab();
    if (!tab?.id || !tab.url) {
      renderUnavailable();
      return null;
    }

    refs.pageTitle.textContent = summarizeHost(tab.url);
    refs.pageUrl.textContent = normalizePageUrl(tab.url);

    const response = await sendToTab<StateResponse>(tab.id, { type: "GET_STATE" });
    if (!response?.ok || !response.state) {
      renderUnavailable();
      return null;
    }

    const state = response.state;
    renderState(state);
    return state;
  }

  function renderUnavailable(): void {
    currentState = null;
    whisperLocked = false;
    if (whisperTimer != null) {
      window.clearTimeout(whisperTimer);
      whisperTimer = null;
    }

    applyTheme("light");
    refs.pageTitle.textContent = "Unsupported page";
    refs.pageUrl.textContent = "Content script unavailable on this tab.";
    refs.modeChip.textContent = "Unavailable";
    refs.modeChip.dataset.state = "idle";
    refs.themeChip.textContent = "Extension off";
    refs.themeChip.dataset.state = "light";
    refs.annotationCount.textContent = "0";
    refs.elementCount.textContent = "0";
    refs.freeCount.textContent = "0";
    refs.reviewCount.textContent = "0";
    refs.listSummary.textContent = "Open a live page to start a review layer.";
    refs.statusWhisper.textContent = "Open a supported page and Missouri will slip into place.";
    refs.statusWhisper.dataset.mode = "ambient";
    refs.toggleMode.dataset.state = "idle";
    refs.startHighlight.dataset.state = "idle";
    refs.toggleOverlay.dataset.state = "muted";

    const emptyMsg = document.createElement("p");
    emptyMsg.className = "empty-state";
    emptyMsg.textContent = "Open a web page to annotate.";
    refs.annotationList.replaceChildren(emptyMsg);

    refs.toggleMode.disabled = true;
    refs.startHighlight.disabled = true;
    refs.toggleOverlay.disabled = true;
  }

  function renderState(state: PopupState): void {
    currentState = state;
    applyTheme(state.pageTheme);
    refs.toggleMode.disabled = false;
    refs.startHighlight.disabled = false;
    refs.toggleOverlay.disabled = false;

    const counts = countAnnotations(state.annotations);
    const reviewCount = counts.highlight + counts.draw;

    setMetricValue(refs.annotationCount, state.annotationCount);
    setMetricValue(refs.elementCount, counts.element);
    setMetricValue(refs.freeCount, counts.free);
    setMetricValue(refs.reviewCount, reviewCount);

    refs.modeChip.textContent = formatModeChip(state);
    refs.modeChip.dataset.state = state.mode === "annotate" ? "active" : "idle";
    refs.themeChip.textContent = `${capitalize(state.pageTheme)} page`;
    refs.themeChip.dataset.state = state.pageTheme;

    refs.toggleMode.textContent =
      state.mode === "annotate" ? "Exit annotation mode" : "Enter annotation mode";
    refs.toggleMode.dataset.state = state.mode === "annotate" ? "active" : "idle";

    refs.startHighlight.textContent =
      state.mode === "annotate" && state.placementMode === "highlight"
        ? "Highlighting live"
        : "Highlight review";
    refs.startHighlight.dataset.state =
      state.mode === "annotate" && state.placementMode === "highlight" ? "active" : "idle";

    refs.toggleOverlay.textContent = state.overlayVisible ? "Hide overlay" : "Show overlay";
    refs.toggleOverlay.dataset.state = state.overlayVisible ? "idle" : "muted";
    refs.listSummary.textContent = makeListSummary(state, counts);
    syncAmbientWhisper(state);

    refs.annotationList.replaceChildren();

    if (!state.annotations.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = deriveEmptyStateMessage(state);
      refs.annotationList.appendChild(empty);
      return;
    }

    const annotations = [...state.annotations].sort(
      (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    );

    for (const annotation of annotations) {
      refs.annotationList.appendChild(makeAnnotationCard(annotation));
    }
  }

  function makeAnnotationCard(annotation: PopupAnnotation): HTMLElement {
    const card = document.createElement("article");
    card.className = "annotation-card";

    const tone = getAnnotationTone(annotation);

    const badge = document.createElement("span");
    badge.className = "annotation-badge";
    badge.dataset.type = tone.type;
    badge.textContent = annotation.label || tone.label;
    badge.style.background = annotationColor(annotation.colorIndex ?? 0);

    const body = document.createElement("div");
    body.className = "annotation-body";

    const note = document.createElement("p");
    note.className = "annotation-note";
    note.textContent = annotation.note;

    const meta = document.createElement("div");
    meta.className = "annotation-meta";

    const typeLabel = document.createElement("span");
    typeLabel.className = "annotation-type";
    typeLabel.textContent = tone.text;

    const time = document.createElement("span");
    time.textContent = formatTime(annotation.updatedAt);

    meta.append(typeLabel, time);

    if (annotation.type === "element") {
      const status = document.createElement("span");
      status.textContent = annotation.resolved ? "Visible" : "Needs reattach";
      meta.appendChild(status);
    }

    body.append(note, meta);

    const actions = document.createElement("div");
    actions.className = "annotation-actions";

    actions.appendChild(
      makeIconAction("focus", "Focus annotation", ICONS.focus, () =>
        performAction(async (tabId) => {
          await sendToTab(tabId, { type: "FOCUS_ANNOTATION", id: annotation.id });
        }, () => "Jumped to that annotation on the page.")
      )
    );

    actions.appendChild(
      makeIconAction("edit", "Edit note", ICONS.edit, () => {
        enterEditMode(card, annotation);
      })
    );

    actions.appendChild(
      makeIconAction("delete danger", "Delete annotation", ICONS.trash, () =>
        performAction(async (tabId) => {
          await sendToTab(tabId, { type: "DELETE_ANNOTATION", id: annotation.id });
        }, () => "Annotation removed. Missouri keeps the review trail tidy.")
      )
    );

    card.append(badge, body, actions);
    return card;
  }

  function enterEditMode(card: HTMLElement, annotation: PopupAnnotation): void {
    card.classList.add("editing");

    const body = card.querySelector(".annotation-body") as HTMLElement | null;
    const actions = card.querySelector(".annotation-actions") as HTMLElement | null;
    if (body) body.style.display = "none";
    if (actions) actions.style.display = "none";

    const editArea = document.createElement("div");
    editArea.className = "annotation-edit-area";

    const textarea = document.createElement("textarea");
    textarea.value = annotation.note;
    textarea.placeholder = "Add a note...";

    const editActions = document.createElement("div");
    editActions.className = "annotation-edit-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "edit-btn cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => exitEditMode(card));

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "edit-btn save";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", () => {
      card.classList.add("is-saving");
      void performAction(async (tabId) => {
        await sendToTab(tabId, {
          type: "SAVE_ANNOTATION",
          annotation: { id: annotation.id, note: textarea.value }
        });
      }, () => "Note refreshed. The updated context is ready for the next pass.");
    });

    editActions.append(cancelBtn, saveBtn);
    editArea.append(textarea, editActions);
    card.appendChild(editArea);

    textarea.focus();
  }

  function exitEditMode(card: HTMLElement): void {
    card.classList.remove("editing");
    const editArea = card.querySelector(".annotation-edit-area");
    if (editArea) editArea.remove();

    const body = card.querySelector(".annotation-body") as HTMLElement | null;
    const actions = card.querySelector(".annotation-actions") as HTMLElement | null;
    if (body) body.style.display = "";
    if (actions) actions.style.display = "";
  }

  function makeIconAction(
    className: string,
    title: string,
    svgHTML: string,
    onClick: () => void
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "icon-action " + className;
    btn.type = "button";
    btn.title = title;
    btn.setAttribute("aria-label", title);
    btn.innerHTML = svgHTML;
    btn.addEventListener("click", onClick);
    return btn;
  }

  async function performAction(
    callback: (tabId: number) => Promise<unknown>,
    getMessage: (state: PopupState) => string
  ): Promise<void> {
    const state = await withActiveTab(callback);
    if (state) {
      setWhisper(getMessage(state), true);
    }
  }

  function applyTheme(theme: PageTheme): void {
    document.documentElement.dataset.theme = theme;
  }

  function countAnnotations(annotations: PopupAnnotation[]): Record<string, number> {
    return annotations.reduce(
      (acc, annotation) => {
        acc[annotation.type] = (acc[annotation.type] ?? 0) + 1;
        return acc;
      },
      { free: 0, element: 0, highlight: 0, draw: 0 } as Record<string, number>
    );
  }

  function formatModeChip(state: PopupState): string {
    if (state.mode !== "annotate") {
      return "Passive";
    }

    switch (state.placementMode) {
      case "free":
        return "Placing free pins";
      case "element":
        return "Anchoring to elements";
      case "highlight":
        return "Review highlighting";
      case "draw":
        return "Sketch review";
      default:
        return "Annotation mode";
    }
  }

  function makeListSummary(
    state: PopupState,
    counts: Record<string, number>
  ): string {
    const activeKinds = [
      counts.element ? `${counts.element} anchored` : "",
      counts.free ? `${counts.free} free` : "",
      counts.highlight + counts.draw ? `${counts.highlight + counts.draw} review` : ""
    ].filter(Boolean);

    const overlay = state.overlayVisible ? "overlay on" : "overlay hidden";
    return activeKinds.length ? `${activeKinds.join(" · ")} · ${overlay}` : overlay;
  }

  function deriveEmptyStateMessage(state: PopupState): string {
    if (state.mode === "annotate" && state.placementMode === "highlight") {
      return "Highlight mode is ready. Mark the exact copy you want the model to see.";
    }

    if (state.mode === "annotate") {
      return "Start with an anchored note when you want context to survive a page refresh.";
    }

    return "No annotations yet. Enter annotation mode to leave context for yourself or your agent.";
  }

  function syncAmbientWhisper(state: PopupState): void {
    if (whisperLocked) {
      return;
    }

    refs.statusWhisper.dataset.mode = "ambient";
    refs.statusWhisper.textContent = ambientWhisper(state);
  }

  function ambientWhisper(state: PopupState): string {
    if (!state.overlayVisible) {
      return "Overlay hidden. Your saved context is still waiting behind the curtain.";
    }

    if (!state.annotations.length && state.mode === "annotate") {
      return "Anchored notes tend to age better than free pins when the page shifts.";
    }

    if (state.placementMode === "highlight") {
      return "Highlight mode shines when you want the model to quote exact copy back to you.";
    }

    if (state.annotations.length > 0) {
      const cues = [
        "Keep notes short and specific. Missouri works best when the prompt trail stays crisp.",
        "A few precise annotations usually beat a page full of commentary.",
        "Review passes go fastest when anchors point to stable UI, not transient decoration."
      ];
      return cues[state.annotations.length % cues.length];
    }

    return "Missouri is calm by default. Add context only where the next review pass really needs it.";
  }

  function setWhisper(message: string, transient = false): void {
    refs.statusWhisper.dataset.mode = transient ? "flash" : "ambient";
    refs.statusWhisper.textContent = message;
    refs.statusWhisper.classList.remove("is-refreshing");
    void refs.statusWhisper.offsetWidth;
    refs.statusWhisper.classList.add("is-refreshing");

    if (whisperTimer != null) {
      window.clearTimeout(whisperTimer);
      whisperTimer = null;
    }

    whisperLocked = transient;
    if (transient) {
      whisperTimer = window.setTimeout(() => {
        whisperLocked = false;
        if (currentState) {
          syncAmbientWhisper(currentState);
        }
      }, 2800);
    }
  }

  function nextFieldNote(state: PopupState | null): string {
    const notes = [
      "Field note: highlight mode is the fastest way to show an agent the exact words that matter.",
      "Field note: anchored notes usually survive refreshes better than free-position comments.",
      "Field note: hiding the overlay never clears the saved context underneath it.",
      "Field note: concise notes make cleaner prompts and faster review loops."
    ];

    const seed = state ? state.annotationCount + (state.mode === "annotate" ? 1 : 0) : 0;
    const nextIndex = (Number(refs.brandMark.dataset.noteIndex || "0") + seed + 1) % notes.length;
    refs.brandMark.dataset.noteIndex = String(nextIndex);
    return notes[nextIndex];
  }

  function setMetricValue(element: HTMLElement, value: number): void {
    const next = String(value);
    if (element.textContent !== next) {
      element.textContent = next;
      element.classList.remove("is-updating");
      void element.offsetWidth;
      element.classList.add("is-updating");
    } else {
      element.textContent = next;
    }
  }

  function getAnnotationTone(
    annotation: PopupAnnotation
  ): { type: string; text: string; label: string } {
    if (annotation.type === "highlight") {
      return { type: "highlight", text: "Highlight", label: "H" };
    }
    if (annotation.type === "draw") {
      return { type: "draw", text: "Drawn path", label: "D" };
    }
    if (annotation.type === "free") {
      return { type: "free", text: "Free pin", label: "F" };
    }
    if (annotation.resolved) {
      return { type: "element", text: "Element anchor", label: "E" };
    }
    return { type: "detached", text: "Detached anchor", label: "!" };
  }

  function annotationColor(index: number): string {
    const palette = ["#1c2735", "#2667d9", "#b5781f", "#7b56c9"];
    return palette[index % palette.length];
  }

  function summarizeHost(url: string): string {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  }

  function capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function formatTime(ts: string): string {
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

  async function withActiveTab(
    callback: (tabId: number) => Promise<unknown>
  ): Promise<PopupState | null> {
    const tab = await getActiveTab();
    if (!tab?.id) return null;
    await callback(tab.id);
    return await refresh();
  }

  async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] ?? null;
  }

  async function sendToTab<T>(
    tabId: number,
    message: Record<string, unknown>
  ): Promise<T | null> {
    try {
      return (await chrome.tabs.sendMessage(tabId, message)) as T;
    } catch (_error) {
      return null;
    }
  }

  function normalizePageUrl(url: string): string {
    const next = new URL(url);
    next.hash = "";
    return next.toString();
  }
})();
