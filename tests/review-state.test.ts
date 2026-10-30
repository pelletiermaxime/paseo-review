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
  reopenChangedViewedFiles,
  viewedFileVersions,
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

it("retains unavailable-file Viewed versions and drops them when their metadata changes", () => {
  const unavailable = {
    ...file,
    fingerprint: null,
    viewedFingerprint: "metadata-v1",
    viewed: true,
    editable: false,
    oldContents: null,
    newContents: null,
  };
  const previous = { ...snapshot, files: [unavailable] };
  expect(viewedFileVersions(previous)).toEqual({ "example.ts": "metadata-v1" });
  const collapsed = new Set([file.path]);
  reopenChangedViewedFiles(collapsed, viewedFileVersions(previous), previous);
  expect(collapsed.has(file.path)).toBe(true);
  reopenChangedViewedFiles(collapsed, viewedFileVersions(previous), {
    ...previous,
    files: [{ ...unavailable, viewed: false, viewedFingerprint: "metadata-v2" }],
  });
  expect(collapsed.has(file.path)).toBe(false);
});

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
    viewedVersions: { "other.ts": file.fingerprint },
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
  expect(secondTab.viewedVersions).toEqual({ "other.ts": file.fingerprint });
  expect(commentIsCurrent(secondTab.comments[0]!, snapshot)).toBe(true);
  expect(
    commentIsCurrent(secondTab.comments[0]!, {
      ...snapshot,
      files: [{ ...file, fingerprint: "external-change" }],
    }),
  ).toBe(false);
});

it("persists branch selection and defaults legacy tabs to uncommitted changes", () => {
  const { comparison: _comparison, baseRef: _baseRef, ...legacy } = defaultReviewTabState;
  expect(reviewTabSchema.parse(legacy)).toMatchObject({ comparison: "head-worktree", baseRef: "" });
  const branch = persistedReviewState({
    ...defaultReviewTabState,
    comparison: "branch-worktree",
    baseRef: "origin/develop",
  });
  expect(reviewTabSchema.parse(JSON.parse(JSON.stringify(branch)))).toEqual(branch);
});

it("reopens changed Viewed files on refresh while retaining unchanged and manual collapses", () => {
  const previous: ReviewSnapshot = {
    ...snapshot,
    files: [
      { ...file, viewed: true },
      { ...file, path: "other.ts", viewed: true },
      { ...file, path: "manual.ts" },
      { ...file, path: "removed.ts", viewed: true },
    ],
  };
  const collapsed = new Set(previous.files.map((entry) => entry.path));
  const current: ReviewSnapshot = {
    ...previous,
    id: "fresh-token",
    files: [
      { ...file, fingerprint: "changed-by-agent", newContents: "changed again\n" },
      { ...file, path: "other.ts", viewed: true },
      { ...file, path: "manual.ts", fingerprint: "manual-file-changed" },
    ],
  };
  reopenChangedViewedFiles(collapsed, viewedFileVersions(previous), current);
  expect([...collapsed]).toEqual(["other.ts", "manual.ts"]);
});

it("reopens stale Viewed collapses after restoring a tab, including cross-tab acknowledgements", () => {
  const restored = reviewTabSchema.parse(
    JSON.parse(
      JSON.stringify(
        persistedReviewState({
          ...defaultReviewTabState,
          initialized: true,
          collapsed: [file.path, "manual.ts"],
          viewedVersions: { [file.path]: file.fingerprint },
        }),
      ),
    ),
  );
  for (const viewed of [false, true]) {
    const collapsed = new Set(restored.collapsed);
    reopenChangedViewedFiles(collapsed, restored.viewedVersions, {
      ...snapshot,
      files: [{ ...file, fingerprint: "new-version", viewed }],
    });
    expect([...collapsed]).toEqual(["manual.ts"]);
  }
});

it("reopens unviewed files once when restoring state saved before Viewed versions were recorded", () => {
  const { viewedVersions: _versions, ...legacy } = defaultReviewTabState;
  const restored = reviewTabSchema.parse({
    ...legacy,
    initialized: true,
    collapsed: [file.path, "other.ts"],
  });
  expect(restored.viewedVersions).toBeUndefined();
  const collapsed = new Set(restored.collapsed);
  const current = {
    ...snapshot,
    files: [file, { ...file, path: "other.ts", viewed: true }],
  };
  reopenChangedViewedFiles(collapsed, restored.viewedVersions, current);
  expect([...collapsed]).toEqual(["other.ts"]);

  const upgraded = persistedReviewState({
    ...restored,
    collapsed: [...collapsed],
    viewedVersions: viewedFileVersions(current),
  });
  // After migration, manually collapsing an unviewed file is respected again.
  collapsed.add(file.path);
  reopenChangedViewedFiles(collapsed, upgraded.viewedVersions, current);
  expect([...collapsed]).toEqual(["other.ts", file.path]);
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
    { ...fresh, comparison: "branch-worktree" as const },
    { ...fresh, baseRef: "other-base" },
    { ...fresh, files: [] },
    { ...fresh, files: [{ ...file, fingerprint: "external-change" }] },
    { ...fresh, files: [{ ...file, editable: false }] },
  ])
    expect(() => currentDraftSnapshot(draft, current)).toThrow("draft is kept");
  expect(draft.contents).toBe("unsaved\n");
  expect(draft.snapshot.id).toBe("old-token");
});
