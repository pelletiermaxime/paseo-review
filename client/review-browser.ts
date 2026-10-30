import { CodeView, parseDiffFromFile, preloadHighlighter } from "@pierre/diffs";
import type { CodeViewItem, CodeViewOptions } from "@pierre/diffs";
import { Editor } from "@pierre/diffs/edit";
import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import {
  currentDraftSnapshot,
  persistedReviewState,
  reopenChangedViewedFiles,
  viewedFileVersions,
  type ReviewTabState,
} from "./review-state";
import type { CommentState } from "./review-comments";
import type { ReviewComparison, ReviewFile, ReviewSnapshot } from "../shared/review";
import { reviewFingerprint } from "../shared/review";
import { lineComment, type FeedbackAgent, type ReviewAttachment } from "./review-comments";
import { createCommentUI, type CommentAnnotation } from "./review-comment-ui";
import { diffNavigationLines, reviewShortcut, reviewShortcuts } from "./review-shortcuts";
import { observeReviewActivation } from "./review-activation";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];
interface Bridge {
  state: ReviewTabState;
  onStateChange(state: ReviewTabState): void;
  colors: Colors;
  snapshot(comparison: ReviewComparison, baseRef: string): Promise<ReviewSnapshot>;
  viewed(snapshotId: string, path: string, value: boolean): Promise<{ viewed: boolean }>;
  save(snapshotId: string, path: string, contents: string): Promise<{ changed: boolean }>;
  openEditor(snapshotId: string, path: string): Promise<{ launched: boolean }>;
  agents(): Promise<FeedbackAgent[]>;
  send(agentId: string, attachment: ReviewAttachment): Promise<void>;
}
function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/^Request failed: /, "")
    .replace(/\s+requestType=.*$/, "");
}

export async function mountReview(host: HTMLElement, bridge: Bridge): Promise<() => void> {
  await preloadHighlighter({
    themes: ["pierre-dark", "pierre-light"],
    langs: ["typescript", "javascript", "json", "text"],
    preferredHighlighter: "highlights",
  });
  let disposed = false;
  let busy = false;
  const restored = structuredClone(bridge.state);
  let draft = restored.draft ?? undefined;
  const commentState: CommentState = { drafts: restored.comments, sending: false };
  let snapshot: ReviewSnapshot | undefined = draft?.snapshot;
  let comparison = draft?.snapshot.comparison ?? restored.comparison;
  let baseRef = restored.baseRef;
  let diffStyle = restored.diffStyle;
  let overflow = restored.overflow;
  let initialLoad = true;
  let version = 0;
  const collapsed = new Set(restored.collapsed);
  const opening = new Set<string>();
  const items = new Map<string, CodeViewItem<CommentAnnotation>>();
  const unavailableCards = new Map<string, HTMLElement>();
  const unavailable = document.createElement("div");
  let visiblePaths: string[] = [];
  let activePath = restored.activePath ?? undefined;
  const root = document.createElement("section");
  root.dataset.diffReview = "ready";
  root.tabIndex = 0;
  root.setAttribute("aria-label", "Workspace review");
  root.style.cssText = `display:flex;flex-direction:column;height:100%;min-height:240px;min-width:0;font:13px system-ui;color:${bridge.colors.foreground};background:${bridge.colors.surface0}`;
  const toolbar = document.createElement("div");
  toolbar.style.cssText =
    "display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:10px;border-bottom:1px solid " +
    bridge.colors.border;
  const progress = document.createElement("strong");
  const status = document.createElement("output");
  status.setAttribute("aria-live", "polite");
  status.style.cssText =
    "display:block;padding:7px 10px;min-height:18px;font-size:12px;white-space:pre-wrap";
  const body = document.createElement("div");
  body.style.cssText = "display:flex;flex:1;min-height:0;min-width:0;overflow:hidden";
  const tree = document.createElement("nav");
  tree.setAttribute("aria-label", "Changed files");
  tree.style.cssText = `width:240px;min-width:150px;max-width:40%;overflow:auto;padding:8px;border-right:1px solid ${bridge.colors.border}`;
  const viewport = document.createElement("div");
  viewport.style.cssText = "flex:1;min-width:0;min-height:0;position:relative;overflow:auto";
  body.append(tree, viewport);
  root.append(toolbar, status, body);
  host.append(root);
  const message = (text: string) => {
    if (!disposed) status.textContent = text;
  };
  const button = (label: string, action: () => void) => {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.style.cssText = `font:inherit;color:${bridge.colors.foreground};background:${bridge.colors.surface1};border:1px solid ${bridge.colors.border};border-radius:5px;padding:5px 8px;cursor:pointer`;
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      action();
    });
    return element;
  };
  const refresh = button("Refresh", () => {
    void load();
  });
  const scope = document.createElement("select");
  scope.setAttribute("aria-label", "Review scope");
  scope.style.cssText = `font:inherit;color:${bridge.colors.foreground};background:${bridge.colors.surface1};border:1px solid ${bridge.colors.border};border-radius:5px;padding:5px 8px`;
  for (const [value, label] of [
    ["head-worktree", "Uncommitted changes"],
    ["branch-worktree", "Whole branch"],
  ]) {
    const option = document.createElement("option");
    option.value = value!;
    option.textContent = label!;
    scope.append(option);
  }
  scope.value = comparison;
  const base = document.createElement("input");
  base.type = "text";
  base.value = baseRef;
  base.maxLength = 200;
  base.placeholder = "Base branch (auto)";
  base.setAttribute("aria-label", "Base branch");
  base.title =
    "Compare from the common ancestor with this branch. Leave empty to detect the default branch.";
  base.style.cssText = scope.style.cssText + ";width:170px";
  function updateScopeControls() {
    scope.disabled = base.disabled = busy || draft !== undefined;
    base.hidden = comparison !== "branch-worktree";
    base.placeholder = snapshot?.baseRef ?? "Base branch (auto)";
    scope.title = draft ? "Save or Cancel the active edit before switching review scope." : "";
  }
  function changeScope() {
    if (busy || draft !== undefined) return;
    comparison = scope.value as ReviewComparison;
    baseRef = base.value.trim();
    snapshot = undefined;
    initialLoad = false;
    collapsed.clear();
    activePath = undefined;
    items.clear();
    unavailableCards.clear();
    unavailable.replaceChildren();
    viewer.clearSelectedLines();
    viewer.setItems([]);
    tree.replaceChildren();
    progress.textContent = "";
    persist();
    comments.refresh();
    updateScopeControls();
    void load();
  }
  scope.addEventListener("change", changeScope);
  base.addEventListener("change", changeScope);
  base.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      base.blur();
    }
  });
  const layout = button(diffStyle === "unified" ? "Split" : "Unified", () => {
    diffStyle = diffStyle === "unified" ? "split" : "unified";
    layout.textContent = diffStyle === "unified" ? "Split" : "Unified";
    viewer.setOptions({ ...options, diffStyle, overflow });
    persist();
  });
  const collapseAll = button("Collapse all", () => setAllCollapsed(true));
  const expandAll = button("Expand all", () => setAllCollapsed(false));
  const wrap = document.createElement("input");
  wrap.type = "checkbox";
  wrap.checked = overflow === "wrap";
  const wrapLabel = document.createElement("label");
  wrapLabel.style.cssText = "display:flex;align-items:center;gap:5px";
  wrapLabel.append(wrap, "Wrap lines");
  wrap.addEventListener("change", () => {
    overflow = wrap.checked ? "wrap" : "scroll";
    viewer.setOptions({ ...options, diffStyle, overflow });
    persist();
  });
  const search = document.createElement("input");
  search.type = "search";
  search.value = restored.filter;
  search.placeholder = "Filter files…";
  search.setAttribute("aria-label", "Filter changed files");
  search.style.cssText = `font:inherit;color:${bridge.colors.foreground};background:${bridge.colors.surface1};border:1px solid ${bridge.colors.border};border-radius:5px;padding:5px 8px;min-width:120px`;
  search.addEventListener("input", () => render());
  const unviewed = document.createElement("input");
  unviewed.type = "checkbox";
  unviewed.checked = restored.unviewedOnly;
  const unviewedLabel = document.createElement("label");
  unviewedLabel.style.cssText = "display:flex;align-items:center;gap:5px";
  unviewedLabel.append(unviewed, "Unviewed only");
  unviewed.addEventListener("change", () => render());
  const help = document.createElement("div");
  help.hidden = true;
  help.setAttribute("aria-label", "Review keyboard shortcuts");
  help.style.cssText = `padding:10px;border-bottom:1px solid ${bridge.colors.border};max-height:35%;overflow:auto`;
  const helpText = document.createElement("p");
  helpText.textContent =
    "Click the diff or focus this panel to use shortcuts. File edits pause review shortcuts. j/k follow diff hunks, skipping folded context; click any expanded context line to comment there.";
  const helpTable = document.createElement("table");
  for (const [key, description] of reviewShortcuts) {
    const row = helpTable.insertRow();
    row.insertCell().textContent = key;
    row.insertCell().textContent = description;
  }
  const shortcuts = button("Shortcuts", () => {
    help.hidden = !help.hidden;
    shortcuts.setAttribute("aria-expanded", String(!help.hidden));
    root.focus({ preventScroll: true });
  });
  shortcuts.setAttribute("aria-expanded", "false");
  help.append(helpText, helpTable);
  root.insertBefore(help, status);
  search.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    root.focus({ preventScroll: true });
  });
  toolbar.append(
    progress,
    scope,
    base,
    refresh,
    layout,
    collapseAll,
    expandAll,
    wrapLabel,
    search,
    unviewedLabel,
    shortcuts,
  );
  const comments = createCommentUI({
    ...bridge,
    state: commentState,
    onChange: persist,
    container: root,
    button,
    snapshot: () => snapshot,
    editing: () => draft !== undefined,
    update: (path) => {
      if (!disposed) updateFile(path);
    },
    jump: (path) => {
      activePath = path;
      search.value = "";
      unviewed.checked = false;
      collapsed.delete(path);
      render();
      updateFile(path);
      jumpToFile(path);
    },
    message,
  });
  // Keep feedback controls above the scrolling file area.
  root.append(status, body);

  function toggleFile(path: string) {
    const file = snapshot?.files.find((file) => file.path === path);
    if (!file?.fingerprint) {
      if (file) message(`${file.path}: Diff unavailable. ${file.reason ?? ""}`);
      return;
    }
    activePath = path;
    const top = viewer.getTopForItem(path);
    const scrollTop = viewer.getScrollTop();
    // A pinned header can be visible even though its original position is above the viewport.
    const headerOutsideViewport =
      top !== undefined && (top < scrollTop - 1 || top >= scrollTop + viewer.getHeight());
    if (collapsed.has(path)) collapsed.delete(path);
    else collapsed.add(path);
    updateFile(path);
    if (collapsed.has(path) && headerOutsideViewport)
      viewer.scrollTo({ type: "item", id: path, align: "start", behavior: "instant" });
  }

  function typingTarget(event: Event) {
    return event
      .composedPath()
      .some(
        (node) =>
          node instanceof Element &&
          node.matches(
            "input, textarea, select, [contenteditable]:not([contenteditable=false]), [role=textbox], [role=combobox]",
          ),
      );
  }

  viewport.addEventListener(
    "pointerdown",
    (event) => {
      const path = event.composedPath();
      const item = viewer.getRenderedItems().find(({ element }) => path.includes(element));
      activePath = item?.id;
      if (
        !typingTarget(event) &&
        !path.some(
          (node) => node instanceof Element && node.matches("button, a, label, [role=button]"),
        )
      )
        root.focus({ preventScroll: true });
    },
    true,
  );

  const followScroll = () => {
    activePath = undefined;
    viewer.clearSelectedLines();
  };
  viewport.addEventListener("wheel", followScroll, { passive: true });
  viewport.addEventListener("touchmove", followScroll, { passive: true });

  function currentPath() {
    const container = viewport.getBoundingClientRect();
    const visibleCard = (card: HTMLElement) => {
      const bounds = card.getBoundingClientRect();
      return bounds.bottom > container.top && bounds.top < container.bottom;
    };
    const activeCard = activePath ? unavailableCards.get(activePath) : undefined;
    if (activeCard && visibleCard(activeCard)) return activePath;
    for (const [path, card] of unavailableCards) {
      if (visibleCard(card)) return path;
    }
    const top = viewer.getScrollTop();
    const bottom = top + viewer.getHeight();
    const index = visiblePaths.findIndex((path, index) => {
      const next = visiblePaths[index + 1];
      return (
        (next === undefined ? viewer.getScrollHeight() : (viewer.getTopForItem(next) ?? 0)) > top
      );
    });
    if (activePath && visiblePaths.includes(activePath)) {
      const activeIndex = visiblePaths.indexOf(activePath);
      const next = visiblePaths[activeIndex + 1];
      const start = viewer.getTopForItem(activePath) ?? 0;
      const end = next === undefined ? viewer.getScrollHeight() : (viewer.getTopForItem(next) ?? 0);
      if (start < bottom && end > top) return activePath;
    }
    return visiblePaths[Math.max(0, index)];
  }

  function moveLine(path: string, direction: number) {
    const item = items.get(path);
    if (item?.type !== "diff") return;
    if (collapsed.delete(path)) updateFile(path);
    const lines = diffNavigationLines(item.fileDiff);
    const selection = viewer.getSelectedLines();
    const range = selection?.id === path ? selection.range : undefined;
    let index = range
      ? lines.findIndex((line) => line.lineNumber === range.start && line.side === range.side)
      : -1;
    // Context clicked on the old side has a corresponding new-side navigation row.
    if (index < 0 && range?.side === "deletions") {
      const target = lineComment(item.fileDiff, path, "old", range.start).context.targetLine;
      index = lines.findIndex(
        (line) => line.side === "additions" && line.lineNumber === target.newLineNumber,
      );
    }
    if (index < 0) {
      const rendered = viewer.getRenderedItems().find((item) => item.id === path);
      const localTop = viewer.getScrollTop() - (viewer.getTopForItem(path) ?? 0);
      const anchor =
        rendered?.type === "diff" ? rendered.instance.getNumericScrollAnchor(localTop) : undefined;
      const newLine =
        anchor?.side === "deletions"
          ? lineComment(item.fileDiff, path, "old", anchor.lineNumber).context.targetLine
              .newLineNumber
          : anchor?.lineNumber;
      index = anchor
        ? lines.findIndex(
            (line) =>
              (line.side === anchor.side && line.lineNumber === anchor.lineNumber) ||
              (line.side === "additions" && newLine != null && line.lineNumber >= newLine),
          )
        : 0;
      if (index < 0) index = lines.length - 1;
    } else index = Math.min(lines.length - 1, Math.max(0, index + direction));
    const line = lines[index];
    if (!line) return;
    activePath = path;
    viewer.setSelectedLines({
      id: path,
      range: { start: line.lineNumber, end: line.lineNumber, side: line.side },
    });
    viewer.scrollTo({ type: "line", id: path, ...line, align: "nearest", behavior: "instant" });
  }

  function addComment(path: string, side: "old" | "new", line: number) {
    const file = snapshot?.files.find((file) => file.path === path);
    const item = items.get(path);
    if (!snapshot || !file?.fingerprint || item?.type !== "diff") return;
    if (draft?.path === path) {
      message("Save or Cancel this file's edits before adding a line comment.");
      return;
    }
    activePath = path;
    try {
      comments.add({
        id: crypto.randomUUID(),
        path,
        root: snapshot.root,
        fingerprint: file.fingerprint,
        comment: lineComment(item.fileDiff, path, side, line),
        editing: true,
      });
    } catch (error) {
      message(errorMessage(error));
    }
  }

  root.addEventListener("keydown", (event) => {
    if (!root.getClientRects().length || root.getBoundingClientRect().height === 0) return;
    if (event.key === "Escape" && !typingTarget(event) && !help.hidden) {
      event.preventDefault();
      event.stopPropagation();
      help.hidden = true;
      shortcuts.setAttribute("aria-expanded", "false");
      root.focus({ preventScroll: true });
      return;
    }
    const key = reviewShortcut(event, typingTarget(event));
    if (!key || draft !== undefined) return;
    event.preventDefault();
    event.stopPropagation();
    if (key === "h") {
      shortcuts.click();
      return;
    }
    if (key === "/") {
      search.focus();
      search.select();
      return;
    }
    if (busy) return;
    const path = currentPath();
    if (!path) return;
    activePath = path;
    if (key === "n" || key === "p") {
      const index = Math.min(
        visiblePaths.length - 1,
        Math.max(0, visiblePaths.indexOf(path) + (key === "n" ? 1 : -1)),
      );
      activePath = visiblePaths[index];
      viewer.clearSelectedLines();
      jumpToFile(activePath!);
      root.focus({ preventScroll: true });
      persist();
    } else if (key === "z") toggleFile(path);
    else if (key === "r") {
      const file = snapshot?.files.find((file) => file.path === path);
      if (file && reviewFingerprint(file)) void mark(file, !file.viewed);
    } else if (key === "j" || key === "k") moveLine(path, key === "j" ? 1 : -1);
    else if (key === "c") {
      const selection = viewer.getSelectedLines();
      if (selection?.id === path && !collapsed.has(path))
        addComment(
          path,
          selection.range.side === "deletions" ? "old" : "new",
          selection.range.start,
        );
      else message("Select a line with j/k or click its line number before commenting.");
    }
  });
  viewport.addEventListener("click", (event) => {
    const path = event.composedPath();
    if (!path.some((node) => node instanceof Element && node.hasAttribute("data-diffs-header")))
      return;
    if (
      path.some(
        (node) =>
          node instanceof Element &&
          node.matches(
            "button, input, label, select, textarea, a, [role=button], [contenteditable]",
          ),
      )
    )
      return;
    const item = viewer.getRenderedItems().find(({ element }) => path.includes(element));
    if (item) toggleFile(item.id);
  });

  function setAllCollapsed(value: boolean) {
    if (!snapshot) return;
    for (const file of snapshot.files) {
      if (value) collapsed.add(file.path);
      else collapsed.delete(file.path);
    }
    render();
  }

  function collapseViewedFiles() {
    let changed = false;
    for (const file of snapshot?.files ?? []) {
      if (file.viewed && !collapsed.has(file.path)) {
        collapsed.add(file.path);
        changed = true;
      }
    }
    return changed;
  }

  function updateFile(relative: string) {
    const item = items.get(relative);
    if (item) {
      item.version = ++version;
      item.collapsed = collapsed.has(relative);
      item.edit = draft?.path === relative;
      if (item.type === "diff") item.annotations = item.edit ? [] : comments.annotations(relative);
      viewer.updateItem({ ...item });
    }
    for (const [path, card] of unavailableCards) {
      const checkbox = card.querySelector<HTMLInputElement>('input[type="checkbox"]');
      const file = snapshot?.files.find((file) => file.path === path);
      if (checkbox) checkbox.disabled = busy || !file || !reviewFingerprint(file);
    }
    refresh.disabled = busy || draft !== undefined;
    updateScopeControls();
    comments.refresh();
    persist();
  }

  async function mark(file: ReviewFile, value: boolean) {
    if (!snapshot || busy) return;
    let scrollToHeader = false;
    busy = true;
    updateFile(file.path);
    try {
      await bridge.viewed(snapshot.id, file.path, value);
      scrollToHeader = value;
      file.viewed = value;
      if (value) collapsed.add(file.path);
      else collapsed.delete(file.path);
      message(value ? `Viewed: ${file.path}` : `Unviewed: ${file.path}`);
    } catch (error) {
      message(errorMessage(error));
    } finally {
      busy = false;
      if (!disposed) {
        updateFile(file.path);
        render();
        if (scrollToHeader && viewer.getItem(file.path))
          viewer.scrollTo({ type: "item", id: file.path, align: "start", behavior: "instant" });
      }
    }
  }

  function edit(file: ReviewFile) {
    if (!snapshot || draft !== undefined || busy || !file.editable || file.newContents === null)
      return;
    draft = { snapshot, path: file.path, contents: file.newContents };
    if (file.oldPath && file.oldContents === file.newContents) {
      items.delete(file.path);
      viewer.removeItem(file.path);
    }
    collapsed.delete(file.path);
    updateFile(file.path);
    render();
    message(`Editing ${file.path}. Save or Cancel explicitly. Refresh is paused while editing.`);
  }

  function cancel(file: ReviewFile) {
    if (busy) return;
    draft = undefined;
    if (file.oldPath && file.oldContents === file.newContents) {
      items.delete(file.path);
      viewer.removeItem(file.path);
    }
    updateFile(file.path);
    render();
    void load();
    message(`Draft discarded: ${file.path}`);
  }

  async function save(file: ReviewFile) {
    if (!draft || draft.path !== file.path || busy) return;
    busy = true;
    updateFile(file.path);
    try {
      const current = await bridge.snapshot(comparison, baseRef);
      const snapshotId = currentDraftSnapshot(draft, current);
      const contents = viewer.getEditor(file.path)?.getText() ?? draft.contents;
      const result = await bridge.save(snapshotId, file.path, contents);
      draft = undefined;
      file.newContents = contents;
      file.viewed = result.changed ? false : file.viewed;
      file.editable = false;
      file.fingerprint = null;
      file.reason = "Saved. Refresh to edit this file again.";
      items.delete(file.path);
      viewer.removeItem(file.path);
      busy = false;
      await load();
      message(`${result.changed ? "Saved" : "No content change"}: ${file.path}`);
    } catch (error) {
      message(errorMessage(error));
    } finally {
      busy = false;
      updateFile(file.path);
      render();
    }
  }

  function header(file: ReviewFile) {
    const controls = document.createElement("div");
    controls.style.cssText = "display:flex;align-items:center;gap:8px;font:12px system-ui";
    if (file.oldPath && file.oldContents === file.newContents) {
      const renamed = document.createElement("span");
      renamed.textContent =
        draft?.path === file.path ? `Renamed from ${file.oldPath}` : "Renamed — no content changes";
      controls.append(renamed);
    }
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = file.viewed;
    checkbox.disabled = busy || !reviewFingerprint(file);
    checkbox.setAttribute("aria-label", `Viewed ${file.path}`);
    checkbox.addEventListener("click", (event) => event.stopPropagation());
    checkbox.addEventListener("change", () => {
      void mark(file, checkbox.checked);
    });
    const label = document.createElement("label");
    label.style.cssText = "display:flex;align-items:center;gap:4px";
    label.append(checkbox, "Viewed");
    controls.append(label);
    if (file.modeChange) {
      const mode = document.createElement("span");
      mode.textContent = `Mode ${file.modeChange}`;
      controls.append(mode);
    }
    const active = draft?.path === file.path;
    if (active) {
      const saveButton = button("Save", () => {
        void save(file);
      });
      saveButton.disabled = busy;
      const cancelButton = button("Cancel", () => cancel(file));
      cancelButton.disabled = busy;
      controls.append(saveButton, cancelButton);
    } else if (file.editable) {
      const editButton = button("Edit", () => edit(file));
      editButton.disabled = busy || draft !== undefined;
      controls.append(editButton);
    } else {
      const reason = document.createElement("span");
      reason.textContent = "Read-only";
      reason.title = file.reason ?? "Read-only file";
      controls.append(reason);
    }
    if (file.kind !== "deleted") {
      const open = button("↗", () => void openEditor(file, open));
      open.dataset.openEditor = file.path;
      open.setAttribute("aria-label", `Open ${file.path} in external editor`);
      open.title = "Open in external editor";
      open.disabled = opening.has(file.path);
      controls.append(open);
    }
    if (file.fingerprint)
      controls.append(
        button(collapsed.has(file.path) ? "Expand" : "Collapse", () => toggleFile(file.path)),
      );
    return controls;
  }
  const options: CodeViewOptions<CommentAnnotation, undefined> = {
    renderCodeViewHeader: () => unavailable,
    stickyHeaders: true,
    unsafeCSS:
      "[data-diffs-header] { cursor: pointer; } [data-metadata] > [data-additions-count] { order: -1; } [data-change-type=rename-pure] [data-additions-count], [data-change-type=rename-pure] [data-deletions-count] { display: none; }",
    overflow,
    enableGutterUtility: true,
    enableLineSelection: true,
    onSelectedLinesChange: (selection) => {
      if (selection) {
        activePath = selection.id;
        persist();
      }
    },
    onGutterUtilityClick: (range, context) => {
      addComment(context.item.id, range.side === "deletions" ? "old" : "new", range.start);
    },
    renderAnnotation: (annotation) => comments.renderAnnotation(annotation.metadata.id),
    preferredHighlighter: "highlights",
    createEditor: (type, config) =>
      new Editor(type, {
        ...config,
        onAttach: (editor) => {
          if (!editor.getViewState().selections?.length) {
            editor.setSelections([
              {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 0 },
                direction: "none",
              },
            ]);
          }
          editor.focus();
        },
      }),
    onItemEditChange: (event, item) => {
      if (draft?.path === item.id) {
        draft.contents = event.editor.getText();
        persist();
      }
    },
    onItemEditComplete: () => "reject",
    renderHeaderPrefix: (_file, context) => {
      const path = context.item.id;
      const expanded = !collapsed.has(path);
      const toggle = button(expanded ? "▾" : "▸", () => toggleFile(path));
      toggle.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${path}`);
      toggle.setAttribute("aria-expanded", String(expanded));
      toggle.title = `${expanded ? "Collapse" : "Expand"} ${path}`;
      toggle.style.cssText += ";padding:0;min-width:20px;background:transparent;border:0";
      return toggle;
    },
    renderHeaderMetadata: (_file, context) => {
      const file = snapshot?.files.find((file) => file.path === context.item.id);
      return file ? header(file) : null;
    },
  };
  const viewer = new CodeView({ ...options, diffStyle });
  viewer.setup(viewport);
  const stopActivation = observeReviewActivation(root, () => {
    if (disposed || busy || draft !== undefined) return;
    if (collapseViewedFiles()) render();
    void load(true);
  });

  function appendLineCounts(row: HTMLElement, additions: number, deletions: number) {
    const counts = document.createElement("span");
    counts.style.cssText =
      "display:flex;gap:5px;flex-shrink:0;font-size:12px;font-variant-numeric:tabular-nums";
    const added = document.createElement("span");
    added.dataset.additionsCount = "";
    added.textContent = `+${additions}`;
    added.style.color = bridge.colors.statusSuccess;
    const removed = document.createElement("span");
    removed.dataset.deletionsCount = "";
    removed.textContent = `−${deletions}`;
    removed.style.color = bridge.colors.statusDanger;
    if (additions > 0 || deletions === 0) counts.append(added);
    if (deletions > 0 || additions === 0) counts.append(removed);
    counts.setAttribute("aria-hidden", "true");
    row.append(counts);
  }

  async function openEditor(file: ReviewFile, control: HTMLButtonElement) {
    if (!snapshot || opening.has(file.path)) return;
    opening.add(file.path);
    control.disabled = true;
    try {
      await bridge.openEditor(snapshot.id, file.path);
      message(`Editor launched for ${file.path}.`);
    } catch (error) {
      message(errorMessage(error));
    } finally {
      opening.delete(file.path);
      if (!disposed) {
        // Virtualization or a Viewed change may have replaced the header while launching.
        for (const button of root.querySelectorAll<HTMLButtonElement>("[data-open-editor]"))
          if (button.dataset.openEditor === file.path) button.disabled = false;
      }
    }
  }

  function persist() {
    bridge.onStateChange(
      persistedReviewState({
        version: 1,
        initialized: true,
        comparison,
        baseRef,
        diffStyle,
        overflow,
        filter: search.value,
        unviewedOnly: unviewed.checked,
        collapsed: [...collapsed],
        viewedVersions: snapshot ? viewedFileVersions(snapshot) : {},
        activePath: activePath ?? null,
        draft: draft ?? null,
        comments: commentState.drafts,
      }),
    );
  }

  function jumpToFile(path: string) {
    const card = unavailableCards.get(path);
    if (card) card.scrollIntoView({ block: "start" });
    else viewer.scrollTo({ type: "item", id: path, align: "start", behavior: "instant" });
  }

  function render() {
    updateScopeControls();
    if (disposed || !snapshot) return;
    comments.refresh();
    const unavailableCount = snapshot.files.filter((file) => file.fingerprint === null).length;
    progress.textContent = `${snapshot.files.filter((file) => file.viewed).length} / ${snapshot.files.length} Viewed${unavailableCount ? ` · ${unavailableCount} diffs unavailable` : ""}`;
    refresh.disabled = busy || draft !== undefined;
    const visible = snapshot.files.filter(
      (file) =>
        draft?.path === file.path ||
        ((!unviewed.checked || !file.viewed) &&
          [file.path, file.oldPath ?? ""].some((path) =>
            path.toLowerCase().includes(search.value.toLowerCase()),
          )),
    );
    // Unavailable files use ordinary cards and never enter Pierre's file renderer.
    visiblePaths = [
      ...visible.filter((file) => !file.fingerprint),
      ...visible.filter((file) => file.fingerprint),
    ].map((file) => file.path);
    unavailableCards.clear();
    unavailable.replaceChildren();
    for (const file of visible.filter((file) => !file.fingerprint)) {
      const card = document.createElement("section");
      card.setAttribute("aria-label", `Diff unavailable: ${file.path}`);
      card.style.cssText = `padding:12px;border-bottom:1px solid ${bridge.colors.border}`;
      const title = document.createElement("strong");
      title.textContent = file.path;
      title.style.cssText = "display:block;overflow-wrap:anywhere;margin-bottom:8px";
      const reason = document.createElement("p");
      reason.textContent = `Diff unavailable. ${file.reason ?? "Unsupported file."}`;
      reason.style.cssText = "margin:8px 0 0;overflow-wrap:anywhere";
      const controls = header(file);
      controls.style.flexWrap = "wrap";
      card.append(title, controls, reason);
      unavailableCards.set(file.path, card);
      unavailable.append(card);
    }
    tree.replaceChildren();
    const folders = new Map<string, HTMLElement>([["", tree]]);
    const folderCounts = new Map<
      string,
      {
        summary: HTMLElement;
        row: HTMLElement;
        additions: number;
        deletions: number;
        reviewable: boolean;
      }
    >();
    for (const file of visible) {
      const parts = file.path.split("/");
      const ancestors: string[] = [];
      let prefix = "";
      let parent: HTMLElement = tree;
      for (const part of parts.slice(0, -1)) {
        prefix += part + "/";
        ancestors.push(prefix);
        let folder = folders.get(prefix);
        if (!folder) {
          const details = document.createElement("details");
          details.open = true;
          const summary = document.createElement("summary");
          summary.style.cssText = "cursor:pointer;padding:3px 0";
          summary.setAttribute("aria-label", prefix.slice(0, -1));
          const row = document.createElement("span");
          row.style.cssText =
            "display:inline-flex;align-items:center;gap:8px;width:calc(100% - 18px);vertical-align:middle";
          const name = document.createElement("span");
          name.textContent = part;
          name.style.cssText =
            "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
          row.append(name);
          summary.append(row);
          folderCounts.set(prefix, {
            summary,
            row,
            additions: 0,
            deletions: 0,
            reviewable: false,
          });
          folder = document.createElement("div");
          folder.style.paddingLeft = "12px";
          details.append(summary, folder);
          parent.append(details);
          folders.set(prefix, folder);
        }
        parent = folder;
      }
      if (file.fingerprint && !items.has(file.path)) {
        const contents = draft?.path === file.path ? draft.contents : file.newContents;
        // A pure rename has no diff body to attach an editor to. Edit its full new file.
        const pureRenameDraft =
          draft?.path === file.path && file.oldPath && file.oldContents === file.newContents;
        const item: CodeViewItem<CommentAnnotation> = !pureRenameDraft
          ? {
              id: file.path,
              type: "diff",
              fileDiff: parseDiffFromFile(
                file.oldContents === null
                  ? null
                  : { name: file.oldPath ?? file.path, contents: file.oldContents },
                contents === null ? null : { name: file.path, contents },
              ),
              annotations: comments.annotations(file.path),
            }
          : {
              id: file.path,
              type: "file",
              file: { name: file.path, contents: contents ?? "" },
            };
        if (item.type === "diff") {
          // Stable while this displayed content is unchanged, including virtualization.
          // Restored edit text differs from the snapshot and must have a separate key.
          item.fileDiff.cacheKey = `${file.path}:${file.fingerprint}${draft?.path === file.path ? `:draft:${crypto.randomUUID()}` : ""}`;
        }
        item.version = ++version;
        item.edit = draft?.path === file.path;
        if (item.edit && item.type === "diff") item.annotations = [];
        item.collapsed = collapsed.has(file.path);
        items.set(file.path, item);
      }
      const jump = button("", () => {
        activePath = file.path;
        viewer.clearSelectedLines();
        jumpToFile(file.path);
        root.focus({ preventScroll: true });
        persist();
        if (file.reason) message(`${file.path}: ${file.reason}`);
      });
      jump.title = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
      jump.style.cssText +=
        ";display:flex;align-items:center;gap:8px;width:100%;min-width:0;border:0;background:transparent;text-align:left;padding:4px 2px";
      const filename = document.createElement("span");
      filename.textContent = `${file.viewed ? "✓ " : ""}${parts.at(-1)}`;
      filename.style.cssText =
        "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      jump.append(filename);
      if (file.oldPath) {
        const renamed = document.createElement("span");
        renamed.textContent = "R";
        renamed.setAttribute("aria-hidden", "true");
        renamed.style.cssText = `flex-shrink:0;font-size:11px;color:${bridge.colors.statusSuccess}`;
        jump.append(renamed);
      }
      const item = items.get(file.path);
      if (item?.type === "diff") {
        let additions = 0;
        let deletions = 0;
        for (const hunk of item.fileDiff.hunks) {
          additions += hunk.additionLines;
          deletions += hunk.deletionLines;
        }
        if (!file.oldPath || additions || deletions) appendLineCounts(jump, additions, deletions);
        for (const path of ancestors) {
          const counts = folderCounts.get(path)!;
          counts.reviewable = true;
          counts.additions += additions;
          counts.deletions += deletions;
        }
        jump.setAttribute(
          "aria-label",
          `${file.path}${file.oldPath ? `, renamed from ${file.oldPath}` : ""}${file.viewed ? ", Viewed" : ""}, ${additions} added lines, ${deletions} removed lines`,
        );
      }
      parent.append(jump);
    }
    for (const [path, counts] of folderCounts) {
      if (!counts.reviewable) continue;
      appendLineCounts(counts.row, counts.additions, counts.deletions);
      counts.summary.setAttribute(
        "aria-label",
        `${path.slice(0, -1)}, ${counts.additions} added lines, ${counts.deletions} removed lines`,
      );
    }
    viewer.setItems(
      visible
        .filter((file) => file.fingerprint)
        .map((file) => {
          const item = items.get(file.path)!;
          item.version = ++version;
          item.collapsed = collapsed.has(file.path);
          return { ...item };
        }),
    );
    persist();
  }

  async function load(automatic = false) {
    if (disposed) return;
    if (busy || draft !== undefined) {
      if (!automatic) message("Save or Cancel the active draft before refreshing.");
      return;
    }
    busy = true;
    refresh.disabled = true;
    updateScopeControls();
    message(
      comparison === "branch-worktree"
        ? "Reading whole branch changes…"
        : "Reading uncommitted changes…",
    );
    try {
      const next = await bridge.snapshot(comparison, baseRef);
      if (disposed) return;
      const previousViewed = snapshot
        ? viewedFileVersions(snapshot)
        : initialLoad
          ? restored.viewedVersions
          : {};
      snapshot = next;
      if (!initialLoad) activePath = undefined;
      viewer.clearSelectedLines();
      if (!initialLoad || !restored.initialized) collapseViewedFiles();
      reopenChangedViewedFiles(collapsed, previousViewed, next);
      initialLoad = false;
      items.clear();
      render();
      if (activePath && viewer.getItem(activePath))
        viewer.scrollTo({ type: "item", id: activePath, align: "start", behavior: "instant" });
      message(
        next.files.length
          ? (next.warning ?? "")
          : comparison === "branch-worktree"
            ? `No changes compared with the merge base of ${next.baseRef}.`
            : "No uncommitted changes compared with HEAD.",
      );
    } catch (error) {
      message(errorMessage(error));
    } finally {
      busy = false;
      if (!disposed) {
        refresh.disabled = draft !== undefined;
        render();
      }
    }
  }
  if (draft) {
    const restoringDraft = draft;
    render();
    if (activePath && viewer.getItem(activePath))
      viewer.scrollTo({ type: "item", id: activePath, align: "start", behavior: "instant" });
    message("Restored unsaved draft. Save or Cancel explicitly.");
    try {
      const current = await bridge.snapshot(comparison, baseRef);
      if (draft === restoringDraft) {
        currentDraftSnapshot(restoringDraft, current);
        restoringDraft.snapshot = current;
        snapshot = current;
        initialLoad = false;
        items.clear();
        render();
        if (activePath && viewer.getItem(activePath))
          viewer.scrollTo({ type: "item", id: activePath, align: "start", behavior: "instant" });
      }
    } catch (error) {
      if (draft === restoringDraft) message(errorMessage(error));
    }
  } else await load();
  return () => {
    disposed = true;
    stopActivation();
    comments.dispose();
    viewer.cleanUp();
    root.remove();
  };
}
