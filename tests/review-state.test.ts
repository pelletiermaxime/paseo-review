import { expect, it } from "vite-plus/test";
import { parseDiffFromFile } from "@pierre/diffs";
import type { ReviewSnapshot } from "../shared/review";
import { lineComment, commentIsCurrent } from "../client/review-comments";
import {
  currentDraftSnapshot,
  defaultReviewTabState,
  persistedReviewState,
  reviewHasDrafts,
  reviewTabSchema,
} from "../client/review-state";

const file = {
  path: "example.ts",
  oldPath: null,
  oldContents: "before\n",
  newContents: "after\n",
  fingerprint: "captured-bytes",
  viewed: false,
  editable: true,
  reason: null,
  modeChange: null,
  kind: "modified" as const,
};
const snapshot: ReviewSnapshot = {
  id: "old-token",
  root: "/repository",
  comparison: "head-worktree",
  files: [file, { ...file, path: "other.ts" }],
  warning: null,
};

it("restores independent tabs from JSON with view preferences, file edits and unfinished comments", () => {
  const diff = parseDiffFromFile(
    { name: file.path, contents: file.oldContents },
    { name: file.path, contents: file.newContents },
  );
  const state = persistedReviewState({
    ...defaultReviewTabState,
    diffStyle: "split",
    overflow: "scroll",
    filter: "example",
    unviewedOnly: true,
    collapsed: ["other.ts"],
    activePath: file.path,
    draft: { snapshot, path: file.path, contents: "unsaved\n" },
    comments: [
      {
        id: "comment",
        root: snapshot.root,
        path: file.path,
        fingerprint: file.fingerprint,
        editing: true,
        input: "unfinished feedback",
        comment: lineComment(diff, file.path, "new", 1),
      },
    ],
  });
  const restored = reviewTabSchema.parse(JSON.parse(JSON.stringify(state)));
  expect(restored).toEqual(state);
  expect(restored.draft!.snapshot.files.map((entry) => entry.path)).toEqual([file.path]);
  expect(snapshot.files).toHaveLength(2);
  expect(reviewHasDrafts(restored)).toBe(true);
  const secondTab = reviewTabSchema.parse(JSON.parse(JSON.stringify(state)));
  restored.comments[0]!.input = "changed in first tab";
  restored.collapsed.push("example.ts");
  expect(secondTab.comments[0]!.input).toBe("unfinished feedback");
  expect(secondTab.collapsed).toEqual(["other.ts"]);
  expect(commentIsCurrent(secondTab.comments[0]!, snapshot)).toBe(true);
  expect(
    commentIsCurrent(secondTab.comments[0]!, {
      ...snapshot,
      files: [{ ...file, fingerprint: "external-change" }],
    }),
  ).toBe(false);
});

it("treats all unsent comments as modified and rejects malformed or old persisted state", () => {
  expect(reviewHasDrafts(defaultReviewTabState)).toBe(false);
  expect(reviewHasDrafts({ draft: null, comments: [{}] as never[] })).toBe(true);
  for (const value of [
    undefined,
    {},
    { ...defaultReviewTabState, version: 2 },
    {
      ...defaultReviewTabState,
      comments: [{ comment: { body: "missing anchors" } }],
    },
  ])
    expect(reviewTabSchema.safeParse(value).success).toBe(false);
});

it("rebinds a restored edit to a fresh save token only when the root and captured file still match", () => {
  const draft = { snapshot, path: file.path, contents: "unsaved\n" };
  const fresh = { ...snapshot, id: "fresh-token" };
  expect(currentDraftSnapshot(draft, fresh)).toBe("fresh-token");
  for (const current of [
    { ...fresh, root: "/other-repository" },
    { ...fresh, files: [] },
    { ...fresh, files: [{ ...file, fingerprint: "external-change" }] },
    { ...fresh, files: [{ ...file, editable: false }] },
  ])
    expect(() => currentDraftSnapshot(draft, current)).toThrow("draft is kept");
  expect(draft.contents).toBe("unsaved\n");
  expect(draft.snapshot.id).toBe("old-token");
});
