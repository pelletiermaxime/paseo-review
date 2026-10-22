import type { DiffLineAnnotation } from "@pierre/diffs";
import type { ReviewSnapshot } from "../shared/review";
import {
  commentIsCurrent,
  commentState,
  deliverComments,
  type CommentDraft,
  type FeedbackAgent,
  type ReviewAttachment,
} from "./review-comments";

interface CommentUIOptions {
  key: string;
  container: HTMLElement;
  colors: { foreground: string; surface1: string; border: string };
  button: (label: string, action: () => void) => HTMLButtonElement;
  snapshot(): ReviewSnapshot | undefined;
  editing(): boolean;
  agents(): Promise<FeedbackAgent[]>;
  send(agentId: string, attachment: ReviewAttachment): Promise<void>;
  update(path: string): void;
  jump(path: string): void;
  message(text: string): void;
}
export interface CommentAnnotation {
  id: string;
  revision: number;
}

export function createCommentUI(options: CommentUIOptions) {
  const state = commentState(options.key);
  let disposed = false;
  let loading = false;
  let focusId: string | undefined;
  let revision = 0;
  const { button } = options;
  const section = document.createElement("section");
  section.setAttribute("aria-label", "Review feedback");
  section.style.cssText = `padding:8px 10px;border-bottom:1px solid ${options.colors.border};font:12px system-ui`;
  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;flex-wrap:wrap;align-items:center;gap:8px";
  const recipient = document.createElement("select");
  recipient.setAttribute("aria-label", "Send feedback to agent");
  recipient.style.cssText = `font:inherit;max-width:300px;color:${options.colors.foreground};background:${options.colors.surface1};padding:5px;border:1px solid ${options.colors.border};border-radius:5px`;
  recipient.addEventListener("change", refresh);
  const reload = button("Refresh agents", () => void loadAgents());
  const send = button("Send feedback", () => void submit());
  send.title = "Send these comments as a code review. Running agents receive steering feedback.";
  const hint = document.createElement("span");
  actions.append(recipient, reload, send, hint);
  const details = document.createElement("details");
  details.style.cssText = "max-height:180px;overflow:auto;margin-top:6px";
  const summary = document.createElement("summary");
  summary.style.cursor = "pointer";
  const list = document.createElement("div");
  details.append(summary, list);
  section.append(actions, details);
  options.container.append(section);

  function refresh() {
    if (disposed) return;
    const snapshot = options.snapshot();
    send.textContent = state.sending ? "Sending…" : `Send feedback (${state.drafts.length})`;
    send.disabled =
      state.sending ||
      options.editing() ||
      !recipient.value ||
      !snapshot ||
      !state.drafts.length ||
      state.drafts.some((draft) => draft.editing || !commentIsCurrent(draft, snapshot));
    reload.disabled = loading || state.sending;
    recipient.disabled = loading || state.sending;
    hint.textContent = options.editing()
      ? "Save or Cancel file edits before sending feedback."
      : snapshot && state.drafts.some((draft) => !commentIsCurrent(draft, snapshot))
        ? "Commented files changed. Open local comments to review and recreate them."
        : state.drafts.some((draft) => draft.editing)
          ? "Finish or Cancel your inline comment drafts before sending."
          : "Use + beside a line to comment. Running agents receive steering feedback.";
    summary.textContent = `${state.drafts.length} local comment${state.drafts.length === 1 ? "" : "s"}`;
    details.hidden = !state.drafts.length;
    list.replaceChildren();
    for (const draft of state.drafts) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:8px;padding-top:5px";
      const { filePath, side, lineNumber, body } = draft.comment;
      const stale = !snapshot || !commentIsCurrent(draft, snapshot);
      const jump = button(`${filePath}:${lineNumber} (${side})`, () => options.jump(draft.path));
      const text = document.createElement("span");
      text.style.cssText = "flex:1;white-space:pre-wrap;overflow-wrap:anywhere";
      text.textContent = `${stale ? "File changed — review and recreate this comment. " : ""}${draft.editing ? "Unfinished draft: " : ""}${draft.input ?? body}`;
      const remove = button("Delete comment", () => removeDraft(draft));
      remove.disabled = state.sending;
      row.append(jump, text, remove);
      list.append(row);
    }
  }

  async function loadAgents() {
    if (loading || state.sending) return;
    loading = true;
    refresh();
    try {
      const agents = await options.agents();
      if (disposed) return;
      const selected = recipient.value;
      recipient.replaceChildren();
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = agents.length ? "Choose agent…" : "No agents in this workspace";
      recipient.append(placeholder);
      for (const agent of agents) {
        const option = document.createElement("option");
        option.value = agent.id;
        option.textContent = agent.label;
        recipient.append(option);
      }
      if (agents.some((agent) => agent.id === selected)) recipient.value = selected;
      else if (agents.length === 1) recipient.value = agents[0]!.id;
    } catch (error) {
      options.message(
        `Could not list agents: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      loading = false;
      refresh();
    }
  }

  async function submit() {
    const snapshot = options.snapshot();
    if (!snapshot || !recipient.value || state.sending) return;
    const agentId = recipient.value;
    const paths = state.drafts.map((draft) => draft.path);
    try {
      const pending = deliverComments(state, snapshot, (attachment) =>
        options.send(agentId, attachment),
      );
      refresh();
      for (const path of paths) options.update(path);
      const count = await pending;
      options.message(
        `Sent ${count} review comment${count === 1 ? "" : "s"} to the selected agent.`,
      );
    } catch (error) {
      options.message(
        `Could not confirm feedback was sent. Comments kept. ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      refresh();
      if (!disposed) for (const path of paths) options.update(path);
    }
  }

  function removeDraft(draft: CommentDraft) {
    if (state.sending) return;
    state.drafts = state.drafts.filter((entry) => entry.id !== draft.id);
    refresh();
    options.update(draft.path);
  }

  function renderAnnotation(id: string): HTMLElement | undefined {
    const draft = state.drafts.find((entry) => entry.id === id);
    if (!draft) return;
    const card = document.createElement("div");
    card.dataset.reviewComment = id;
    card.style.cssText = `font:13px system-ui;color:${options.colors.foreground};background:${options.colors.surface1};border:1px solid ${options.colors.border};border-radius:6px;margin:8px;padding:10px;white-space:normal`;
    const label = document.createElement("div");
    label.textContent = `Comment on ${draft.comment.side} line ${draft.comment.lineNumber}`;
    label.style.marginBottom = "6px";
    card.append(label);
    if (draft.editing) {
      const input = document.createElement("textarea");
      input.setAttribute(
        "aria-label",
        `Comment on ${draft.comment.filePath} ${draft.comment.side} line ${draft.comment.lineNumber}`,
      );
      input.placeholder = "Leave feedback for the agent…";
      input.value = draft.input ?? draft.comment.body;
      input.rows = 3;
      input.disabled = state.sending;
      input.style.cssText = `display:block;box-sizing:border-box;width:100%;resize:vertical;font:inherit;color:inherit;background:transparent;border:1px solid ${options.colors.border};padding:6px;margin-bottom:6px`;
      const add = button("Add comment", () => {
        const body = (draft.input ?? draft.comment.body).trim();
        if (!body || state.sending) return;
        draft.comment.body = body;
        draft.editing = false;
        delete draft.input;
        refresh();
        options.update(draft.path);
      });
      add.title = "Add comment (Ctrl+Enter / Cmd+Enter)";
      input.setAttribute("aria-keyshortcuts", "Control+Enter Meta+Enter");
      add.disabled = state.sending || !input.value.trim();
      input.addEventListener("keydown", (event) => {
        if (
          event.key !== "Enter" ||
          (!event.ctrlKey && !event.metaKey) ||
          event.altKey ||
          event.shiftKey ||
          event.isComposing
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat && !add.disabled) add.click();
      });
      input.addEventListener("input", () => {
        draft.input = input.value;
        add.disabled = state.sending || !input.value.trim();
        refresh();
      });
      const cancel = button("Cancel comment", () => {
        if (state.sending) return;
        if (!draft.comment.body) removeDraft(draft);
        else {
          draft.editing = false;
          delete draft.input;
          refresh();
          options.update(draft.path);
        }
      });
      cancel.disabled = state.sending;
      const hint = document.createElement("div");
      hint.textContent = "Ctrl+Enter / Cmd+Enter to add comment";
      hint.style.cssText = "font-size:11px;margin-top:6px";
      card.append(input, add, cancel, hint);
      if (focusId === id) {
        requestAnimationFrame(() => {
          if (input.isConnected) input.focus();
        });
        focusId = undefined;
      }
    } else {
      const text = document.createElement("p");
      text.style.cssText = "white-space:pre-wrap;overflow-wrap:anywhere;margin:5px 0 10px";
      text.textContent = draft.comment.body;
      const edit = button("Edit comment", () => {
        if (state.sending) return;
        draft.editing = true;
        focusId = id;
        refresh();
        options.update(draft.path);
      });
      const remove = button("Delete comment", () => removeDraft(draft));
      edit.disabled = remove.disabled = state.sending;
      card.append(text, edit, remove);
    }
    return card;
  }

  const changed = () => {
    refresh();
    if (!disposed) for (const file of options.snapshot()?.files ?? []) options.update(file.path);
  };
  state.changed = changed;
  refresh();
  void loadAgents();
  return {
    refresh,
    renderAnnotation,
    add(draft: CommentDraft) {
      if (state.sending) return;
      const existing = state.drafts.find(
        (entry) =>
          entry.fingerprint === draft.fingerprint &&
          entry.root === draft.root &&
          entry.path === draft.path &&
          entry.comment.side === draft.comment.side &&
          entry.comment.lineNumber === draft.comment.lineNumber,
      );
      if (!existing) state.drafts.push(draft);
      focusId = (existing ?? draft).id;
      if (existing) existing.editing = true;
      refresh();
      options.update(draft.path);
    },

    annotations(path: string): DiffLineAnnotation<CommentAnnotation>[] {
      const snapshot = options.snapshot();
      return state.drafts
        .filter((draft) => snapshot && draft.path === path && commentIsCurrent(draft, snapshot))
        .map((draft) => ({
          side: draft.comment.side === "old" ? "deletions" : "additions",
          lineNumber: draft.comment.lineNumber,
          metadata: { id: draft.id, revision: ++revision },
        }));
    },

    dispose() {
      disposed = true;
      if (state.changed === changed) delete state.changed;
    },
  };
}
