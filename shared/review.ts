import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const workspace = z.object({ workspaceId: z.string().min(1).max(200) });
export const reviewComparison = z.enum(["head-worktree", "branch-worktree"]);
export type ReviewComparison = z.infer<typeof reviewComparison>;
const file = z.object({
  path: z.string(),
  oldPath: z.string().nullable(),
  oldContents: z.string().nullable(),
  newContents: z.string().nullable(),
  fingerprint: z.string().nullable(),
  viewed: z.boolean(),
  editable: z.boolean(),
  reason: z.string().nullable(),
  modeChange: z.string().nullable(),
  kind: z.enum(["added", "modified", "deleted", "renamed", "unsupported"]),
});
export const snapshotRpc = defineRpc({
  name: "review.snapshot",
  input: workspace.extend({
    comparison: reviewComparison.default("head-worktree"),
    baseRef: z.string().trim().max(200).optional(),
  }),
  output: z.object({
    id: z.string(),
    comparison: reviewComparison,
    baseRef: z.string().nullable().optional(),
    root: z.string(),
    files: z.array(file),
    warning: z.string().nullable(),
  }),
});
const displayed = workspace.extend({ snapshotId: z.string(), path: z.string() });
export const openEditorRpc = defineRpc({
  name: "review.open-editor",
  input: displayed,
  output: z.object({ launched: z.boolean() }),
});
export const viewedRpc = defineRpc({
  name: "review.viewed",
  input: displayed.extend({ viewed: z.boolean() }),
  output: z.object({ viewed: z.boolean() }),
});
export const saveRpc = defineRpc({
  name: "review.save",
  input: displayed.extend({ contents: z.string().max(512 * 1024) }),
  output: z.object({ changed: z.boolean() }),
});
export type ReviewFile = z.infer<typeof file>;
export type ReviewSnapshot = z.infer<typeof snapshotRpc.output>;
