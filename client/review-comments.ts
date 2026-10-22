import type { PaseoApi, PaseoAgentSendOptions } from "@getpaseo/client";
import type { FileDiffMetadata } from "@pierre/diffs";
import type { ReviewSnapshot } from "../shared/review";

export type ReviewAttachment = Extract<
  NonNullable<PaseoAgentSendOptions["attachments"]>[number],
  { type: "review" }
>;
type ReviewComment = ReviewAttachment["comments"][number];
type ContextLine = ReviewComment["context"]["targetLine"];
export interface CommentDraft {
  id: string;
  path: string;
  root: string;
  fingerprint: string;
  comment: ReviewComment;
  editing: boolean;
  input?: string;
}
export interface CommentState {
  drafts: CommentDraft[];
  sending: boolean;
  changed?: () => void;
}
// Like edit drafts, these survive panel remounts in this client plugin lifetime.
const states = new Map<string, CommentState>();
export function commentState(key: string): CommentState {
  let state = states.get(key);
  if (!state) states.set(key, (state = { drafts: [], sending: false }));
  return state;
}

/** Build context from the displayed full diff, including expanded unchanged lines. */
export function lineComment(
  diff: FileDiffMetadata,
  filePath: string,
  side: "old" | "new",
  lineNumber: number,
): ReviewComment {
  const lines: ContextLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  const add = (type: ContextLine["type"]) => {
    const oldLineNumber = type === "add" ? null : ++oldIndex;
    const newLineNumber = type === "remove" ? null : ++newIndex;
    const content =
      type === "remove" ? diff.deletionLines[oldIndex - 1] : diff.additionLines[newIndex - 1];
    lines.push({ oldLineNumber, newLineNumber, type, content: content.replace(/\r?\n$/, "") });
  };
  for (const hunk of diff.hunks) {
    for (const block of hunk.hunkContent) {
      while (oldIndex < block.deletionLineIndex && newIndex < block.additionLineIndex)
        add("context");
      if (block.type === "context") {
        for (let i = 0; i < block.lines; i++) add("context");
      } else {
        for (let i = 0; i < block.deletions; i++) add("remove");
        for (let i = 0; i < block.additions; i++) add("add");
      }
    }
  }
  while (oldIndex < diff.deletionLines.length && newIndex < diff.additionLines.length)
    add("context");
  const index = lines.findIndex((line) =>
    side === "old" ? line.oldLineNumber === lineNumber : line.newLineNumber === lineNumber,
  );
  if (!Number.isInteger(lineNumber) || lineNumber < 1 || index < 0)
    throw new Error("This line is not part of the displayed diff.");
  const context = lines.slice(Math.max(0, index - 3), index + 4);
  const oldLines = context.filter((line) => line.oldLineNumber !== null);
  const newLines = context.filter((line) => line.newLineNumber !== null);
  return {
    filePath: side === "old" ? (diff.prevName ?? filePath) : filePath,
    side,
    lineNumber,
    body: "",
    context: {
      hunkHeader: `@@ -${oldLines[0]?.oldLineNumber ?? 0},${oldLines.length} +${newLines[0]?.newLineNumber ?? 0},${newLines.length} @@`,
      targetLine: lines[index]!,
      lines: context,
    },
  };
}

export function commentIsCurrent(draft: CommentDraft, snapshot: ReviewSnapshot): boolean {
  return (
    draft.root === snapshot.root &&
    snapshot.files.some(
      (file) => file.path === draft.path && file.fingerprint === draft.fingerprint,
    )
  );
}

export interface FeedbackAgent {
  id: string;
  label: string;
}
export async function listFeedbackAgents(
  paseo: Pick<PaseoApi, "agents">,
  workspaceId: string,
): Promise<FeedbackAgent[]> {
  const agents = new Map<string, FeedbackAgent>();
  let cursor: string | undefined;
  const cursors = new Set<string>();
  do {
    const page = await paseo.agents.list({
      filter: { includeArchived: false, includeInternal: false, includeBackground: false },
      page: { limit: 100, ...(cursor ? { cursor } : {}) },
    });
    for (const { agent } of page.entries) {
      if (agent.workspaceId === workspaceId && !agent.archivedAt && agent.status !== "closed")
        agents.set(agent.id, {
          id: agent.id,
          label: `${agent.title || agent.provider} · ${agent.status} · ${agent.id.slice(-6)}`,
        });
    }
    cursor = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
    if (cursor && cursors.has(cursor)) throw new Error("Agent listing returned a repeated page.");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return [...agents.values()];
}

export async function sendFeedback(
  paseo: Pick<PaseoApi, "agents">,
  workspaceId: string,
  agentId: string,
  attachment: ReviewAttachment,
): Promise<void> {
  const agent = paseo.agents.ref(agentId);
  const current = await agent.refresh();
  if (
    !current ||
    agent.workspaceId !== workspaceId ||
    agent.archivedAt ||
    agent.status === "closed"
  )
    throw new Error("Choose an available agent in this workspace, then try again.");
  // Paseo delivers review attachments to the agent but doesn't display them in this chat flow.
  const text = [
    "Please address this code review.",
    ...attachment.comments.map(
      (comment, index) =>
        `${index + 1}. ${comment.filePath} (${comment.side} line ${comment.lineNumber})\n${comment.body}`,
    ),
  ].join("\n\n");
  await agent.send(text, {
    attachments: [attachment],
    activeTurnBehavior: "steer",
  });
}

/** Clear only the captured batch after acknowledgement; errors preserve every draft. */
export async function deliverComments(
  state: CommentState,
  snapshot: ReviewSnapshot,
  send: (attachment: ReviewAttachment) => Promise<void>,
): Promise<number> {
  if (state.sending) throw new Error("Feedback is already being sent.");
  if (!state.drafts.length) throw new Error("Add a line comment first.");
  if (state.drafts.some((draft) => draft.editing || !draft.comment.body.trim()))
    throw new Error("Finish or cancel your comment drafts before sending.");
  if (state.drafts.some((draft) => !commentIsCurrent(draft, snapshot)))
    throw new Error(
      "Some commented files changed. Review and recreate those comments before sending.",
    );
  const batch = [...state.drafts];
  state.sending = true;
  try {
    await send({
      type: "review",
      mimeType: "application/paseo-review",
      cwd: snapshot.root,
      mode: "uncommitted",
      baseRef: null,
      comments: batch.map((draft) => structuredClone(draft.comment)),
    });
    const ids = new Set(batch.map((draft) => draft.id));
    state.drafts = state.drafts.filter((draft) => !ids.has(draft.id));
    return batch.length;
  } finally {
    state.sending = false;
    state.changed?.();
  }
}
