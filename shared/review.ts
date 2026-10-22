import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const workspace = z.object({ workspaceId: z.string().min(1).max(200) });
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
  input: workspace,
  output: z.object({
    id: z.string(),
    comparison: z.literal("head-worktree"),
    root: z.string(),
    files: z.array(file),
    warning: z.string().nullable(),
  }),
});
const displayed = workspace.extend({ snapshotId: z.string(), path: z.string() });
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
