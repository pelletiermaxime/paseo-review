import { expect, it, vi } from "vite-plus/test";
import { parseDiffFromFile } from "@pierre/diffs";
import type { PaseoApi } from "@getpaseo/client";
import type { ReviewSnapshot } from "../shared/review";
import {
  commentIsCurrent,
  deliverComments,
  lineComment,
  listFeedbackAgents,
  sendFeedback,
  type CommentDraft,
  type CommentState,
  type ReviewAttachment,
} from "../client/review-comments";

const diff = parseDiffFromFile(
  { name: "example.ts", contents: "before\nremove\nafter\nlast\n" },
  { name: "example.ts", contents: "before\nadd one\nadd two\nafter\nlast\n" },
);
const snapshot = {
  root: "/repo",
  files: [{ path: "example.ts", fingerprint: "version-1" }],
} as ReviewSnapshot;
function draft(id = "comment-1"): CommentDraft {
  const comment = lineComment(diff, "example.ts", "new", 3);
  comment.body = "Please explain this change.";
  return { id, comment, root: "/repo", fingerprint: "version-1", editing: false };
}

it("anchors removals, additions and unchanged lines to the correct old/new number", () => {
  expect(lineComment(diff, "example.ts", "old", 2).context.targetLine).toEqual({
    oldLineNumber: 2,
    newLineNumber: null,
    type: "remove",
    content: "remove",
  });
  expect(lineComment(diff, "example.ts", "new", 3).context.targetLine).toEqual({
    oldLineNumber: null,
    newLineNumber: 3,
    type: "add",
    content: "add two",
  });
  expect(lineComment(diff, "example.ts", "old", 3).context.targetLine).toEqual({
    oldLineNumber: 3,
    newLineNumber: 4,
    type: "context",
    content: "after",
  });
  const comment = lineComment(diff, "example.ts", "new", 3);
  expect(comment.context.lines.map((line) => line.type)).toEqual([
    "context",
    "remove",
    "add",
    "add",
    "context",
    "context",
  ]);
  expect(() => lineComment(diff, "example.ts", "new", 99)).toThrow("displayed diff");
});

it("handles added/deleted files, no final newline, distant hunks and expanded unchanged lines", () => {
  const added = parseDiffFromFile(null, { name: "new", contents: "first\nlast" });
  expect(lineComment(added, "new", "new", 2).context.targetLine).toEqual({
    oldLineNumber: null,
    newLineNumber: 2,
    type: "add",
    content: "last",
  });
  const deleted = parseDiffFromFile({ name: "gone", contents: "removed" }, null);
  expect(lineComment(deleted, "gone", "old", 1).context.targetLine.content).toBe("removed");
  const old = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
  const next = [...old];
  next.splice(1, 1, "replacement", "extra");
  next[89] = "another change";
  const large = parseDiffFromFile(
    { name: "large", contents: old.join("\n") },
    { name: "large", contents: next.join("\n") },
  );
  expect(large.hunks.length).toBeGreaterThan(1);
  expect(lineComment(large, "large", "new", 50).context.targetLine).toEqual({
    oldLineNumber: 49,
    newLineNumber: 50,
    type: "context",
    content: "line 49",
  });
  expect(lineComment(large, "large", "new", 90).context.targetLine.content).toBe("another change");
  expect(lineComment(large, "large", "old", 100).context.targetLine.newLineNumber).toBe(101);
});

it("sends Paseo's structured review attachment and clears only the acknowledged batch", async () => {
  const state: CommentState = { drafts: [draft()], sending: false };
  let release!: () => void;
  const send = vi.fn(
    (_attachment: ReviewAttachment) =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const result = deliverComments(state, snapshot, send);
  expect(state.sending).toBe(true);
  const attachment = send.mock.calls[0]?.[0];
  expect(attachment).toEqual({
    type: "review",
    mimeType: "application/paseo-review",
    mode: "uncommitted",
    baseRef: null,
    cwd: "/repo",
    comments: [draft().comment],
  });
  await expect(deliverComments(state, snapshot, send)).rejects.toThrow("already");
  state.drafts.push(draft("new-during-send"));
  release();
  expect(await result).toBe(1);
  expect(state.drafts.map((entry) => entry.id)).toEqual(["new-during-send"]);
  expect(state.sending).toBe(false);
});

it("retains drafts on send failure and blocks unfinished or changed-file comments", async () => {
  const state: CommentState = { drafts: [draft()], sending: false };
  const failure = vi.fn().mockRejectedValue(new Error("offline"));
  await expect(deliverComments(state, snapshot, failure)).rejects.toThrow("offline");
  expect(state.drafts).toHaveLength(1);
  expect(state.sending).toBe(false);
  const send = vi.fn();
  state.drafts[0]!.editing = true;
  await expect(deliverComments(state, snapshot, send)).rejects.toThrow("Finish");
  state.drafts[0]!.editing = false;
  const changed = { ...snapshot, files: [{ ...snapshot.files[0]!, fingerprint: "version-2" }] };
  expect(commentIsCurrent(state.drafts[0]!, changed)).toBe(false);
  await expect(deliverComments(state, changed, send)).rejects.toThrow("changed");
  expect(commentIsCurrent(state.drafts[0]!, { ...snapshot, root: "/moved" })).toBe(false);
  expect(commentIsCurrent(state.drafts[0]!, { ...snapshot, files: [] })).toBe(false);
  expect(send).not.toHaveBeenCalled();
});

it("lists every page and offers only live agents in the current workspace", async () => {
  const agent = (
    id: string,
    workspaceId = "workspace",
    status = "idle",
    archivedAt: string | null = null,
  ) => ({ agent: { id, workspaceId, status, archivedAt, title: "Agent", provider: "codex" } });
  const list = vi
    .fn()
    .mockResolvedValueOnce({
      entries: [agent("mine"), agent("other", "elsewhere")],
      pageInfo: { hasMore: true, nextCursor: "next" },
    })
    .mockResolvedValueOnce({
      entries: [
        agent("second"),
        agent("closed", "workspace", "closed"),
        agent("archived", "workspace", "idle", "today"),
      ],
      pageInfo: { hasMore: false, nextCursor: null },
    });
  const paseo = { agents: { list } } as unknown as PaseoApi;
  expect((await listFeedbackAgents(paseo, "workspace")).map((agent) => agent.id)).toEqual([
    "mine",
    "second",
  ]);
  expect(list.mock.calls[1]![0].page.cursor).toBe("next");
});

it("sends readable comments with unchanged review context, revalidates the recipient and uses steering", async () => {
  const agent = {
    workspaceId: "workspace",
    archivedAt: null,
    status: "running",
    refresh: vi.fn().mockResolvedValue({ agent: {} }),
    send: vi.fn().mockResolvedValue(undefined),
  };
  const paseo = { agents: { ref: vi.fn(() => agent) } } as unknown as PaseoApi;
  const attachment = {
    type: "review" as const,
    mimeType: "application/paseo-review" as const,
    cwd: "/repo",
    mode: "uncommitted" as const,
    comments: [
      draft().comment,
      {
        ...lineComment(diff, "folder with spaces/example.ts", "old", 2),
        body: "Keep this behavior.\nIt is still needed for older clients.",
      },
    ],
  };
  const original = structuredClone(attachment);
  await sendFeedback(paseo, "workspace", "chosen", attachment);
  expect(agent.send).toHaveBeenCalledWith(
    "Please address this code review.\n\n" +
      "1. example.ts (new line 3)\nPlease explain this change.\n\n" +
      "2. folder with spaces/example.ts (old line 2)\nKeep this behavior.\nIt is still needed for older clients.",
    { attachments: [original], activeTurnBehavior: "steer" },
  );
  expect(attachment).toEqual(original);
  agent.send.mockClear();
  agent.workspaceId = "another-workspace";
  await expect(sendFeedback(paseo, "workspace", "chosen", attachment)).rejects.toThrow(
    "this workspace",
  );
  expect(agent.send).not.toHaveBeenCalled();
  agent.workspaceId = "workspace";
  agent.status = "closed";
  await expect(sendFeedback(paseo, "workspace", "chosen", attachment)).rejects.toThrow("available");
});
