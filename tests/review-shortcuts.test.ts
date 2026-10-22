import { expect, it } from "vite-plus/test";
import { parseDiffFromFile } from "@pierre/diffs";
import { diffNavigationLines, reviewShortcut } from "../client/review-shortcuts";
import { lineComment } from "../client/review-comments";

const key = (key: string, extra: Partial<KeyboardEvent> = {}) =>
  ({ key, ...extra }) as KeyboardEvent;

it("leaves typing, host chords, composition and browser behavior alone", () => {
  expect(reviewShortcut(key("j"), true)).toBeUndefined();
  for (const modifier of [
    "ctrlKey",
    "metaKey",
    "altKey",
    "shiftKey",
    "isComposing",
    "defaultPrevented",
  ])
    expect(reviewShortcut(key("r", { [modifier]: true }), false)).toBeUndefined();
  expect(reviewShortcut(key("?", { shiftKey: true }), false)).toBeUndefined();
  expect(reviewShortcut(key("h"), false)).toBe("h");
  expect(reviewShortcut(key("Tab"), false)).toBeUndefined();
  expect(reviewShortcut(key("Enter"), false)).toBeUndefined();
  for (const action of ["r", "z", "c", "h", "/"])
    expect(reviewShortcut(key(action, { repeat: true }), false)).toBeUndefined();
  for (const action of ["j", "k", "n", "p"])
    expect(reviewShortcut(key(action, { repeat: true }), false)).toBe(action);
});

it("navigates replacements in old/new order with valid comment anchors", () => {
  const diff = parseDiffFromFile(
    { name: "file", contents: "before\nremoved\nafter\n" },
    { name: "file", contents: "before\nfirst\nsecond\nafter\n" },
  );
  const lines = diffNavigationLines(diff);
  expect(lines).toEqual([
    { lineNumber: 1, side: "additions" },
    { lineNumber: 2, side: "deletions" },
    { lineNumber: 2, side: "additions" },
    { lineNumber: 3, side: "additions" },
    { lineNumber: 4, side: "additions" },
  ]);
  expect(
    lines.map(
      (line) =>
        lineComment(diff, "file", line.side === "deletions" ? "old" : "new", line.lineNumber)
          .context.targetLine.content,
    ),
  ).toEqual(["before", "removed", "first", "second", "after"]);
});

it("skips folded gaps and handles added, deleted and empty files without phantom lines", () => {
  const before = Array.from({ length: 100 }, (_, index) => `line ${index + 1}`);
  const after = [...before];
  after[5] = "changed";
  after[90] = "also changed";
  const diff = parseDiffFromFile(
    { name: "file", contents: before.join("\n") },
    { name: "file", contents: after.join("\n") },
  );
  const lines = diffNavigationLines(diff);
  expect(lines.some((line) => line.lineNumber === 50)).toBe(false);
  expect(lines.filter((line) => line.side === "deletions").map((line) => line.lineNumber)).toEqual([
    6, 91,
  ]);
  expect(
    diffNavigationLines(parseDiffFromFile(null, { name: "file", contents: "one\ntwo" })),
  ).toEqual([
    { lineNumber: 1, side: "additions" },
    { lineNumber: 2, side: "additions" },
  ]);
  expect(diffNavigationLines(parseDiffFromFile({ name: "file", contents: "gone" }, null))).toEqual([
    { lineNumber: 1, side: "deletions" },
  ]);
  expect(diffNavigationLines(parseDiffFromFile(null, { name: "file", contents: "" }))).toEqual([]);
});
