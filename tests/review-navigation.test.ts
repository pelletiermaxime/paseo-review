import { expect, it } from "vite-plus/test";
import { parseDiffFromFile } from "@pierre/diffs";
import { diffChangeLines, nextReviewChange } from "../client/review-navigation";
import { lineComment } from "../client/review-comments";

function changedFile(id = "file") {
  const before = Array.from({ length: 100 }, (_, index) => `line ${index + 1}`);
  const after = [...before];
  after[5] = "first change";
  after[8] = "nearby change";
  after[90] = "distant change";
  return {
    id,
    fileDiff: parseDiffFromFile(
      { name: id, contents: before.join("\n") },
      { name: id, contents: after.join("\n") },
    ),
  };
}

it("stops once per change block, including separate changes inside one hunk", () => {
  const { fileDiff } = changedFile();
  expect(fileDiff.hunks).toHaveLength(2);
  const lines = diffChangeLines(fileDiff);
  expect(lines).toEqual([
    { lineNumber: 6, side: "deletions" },
    { lineNumber: 9, side: "deletions" },
    { lineNumber: 91, side: "deletions" },
  ]);
  for (const line of lines)
    expect(lineComment(fileDiff, "file", "old", line.lineNumber).context.targetLine.type).toBe(
      "remove",
    );
});

it("navigates both directions across only the supplied files and stops at boundaries", () => {
  const first = changedFile("first");
  const last = { id: "last", fileDiff: parseDiffFromFile(null, { name: "last", contents: "new" }) };
  const files = [first, { id: "unavailable" }, last];
  const start = nextReviewChange(files, undefined, 1)!;
  expect(start).toEqual({ id: "first", lineNumber: 6, side: "deletions" });
  const second = nextReviewChange(files, { id: start.id, line: start }, 1)!;
  const third = nextReviewChange(files, { id: second.id, line: second }, 1)!;
  const end = nextReviewChange(files, { id: third.id, line: third }, 1)!;
  expect(end).toEqual({ id: "last", lineNumber: 1, side: "additions" });
  expect(nextReviewChange(files, { id: end.id, line: end }, 1)).toBeUndefined();
  expect(nextReviewChange(files, { id: start.id, line: start }, -1)).toBeUndefined();
  expect(nextReviewChange(files, { id: end.id, line: end }, -1)).toEqual(third);
  expect(nextReviewChange([last], undefined, -1)).toEqual(end);
  expect(nextReviewChange(files, { id: "unavailable" }, 1)).toEqual(end);
  expect(nextReviewChange(files, { id: "unavailable" }, -1)).toEqual(third);
});

it("uses unified order from either side and from expanded context between hunks", () => {
  const file = changedFile();
  for (const side of ["additions", "deletions"] as const) {
    expect(nextReviewChange([file], { id: file.id, line: { lineNumber: 7, side } }, 1)).toEqual({
      id: "file",
      lineNumber: 9,
      side: "deletions",
    });
    expect(nextReviewChange([file], { id: file.id, line: { lineNumber: 50, side } }, -1)).toEqual({
      id: "file",
      lineNumber: 9,
      side: "deletions",
    });
    expect(nextReviewChange([file], { id: file.id, line: { lineNumber: 50, side } }, 1)).toEqual({
      id: "file",
      lineNumber: 91,
      side: "deletions",
    });
  }
  // The added side of a replacement follows that replacement's removed lines.
  expect(
    nextReviewChange(
      [file],
      {
        id: file.id,
        line: { lineNumber: 6, side: "additions" },
      },
      -1,
    ),
  ).toEqual({ id: "file", lineNumber: 6, side: "deletions" });
});

it("includes an exact viewport anchor on first use but advances an existing selection", () => {
  const file = changedFile();
  const current = { id: file.id, line: { lineNumber: 6, side: "deletions" as const } };
  expect(nextReviewChange([file], { ...current, inclusive: true }, 1)?.lineNumber).toBe(6);
  expect(nextReviewChange([file], current, 1)?.lineNumber).toBe(9);
  expect(nextReviewChange([file], { id: file.id }, 1)?.lineNumber).toBe(6);
  expect(nextReviewChange([file], { id: file.id }, -1)?.lineNumber).toBe(91);
});

it("keeps old/new positions aligned when changes shift the line numbers", () => {
  const file = {
    id: "shifted",
    fileDiff: parseDiffFromFile(
      { name: "shifted", contents: "head\nremove\ncontext\nreplace\nend\n" },
      { name: "shifted", contents: "head\ncontext\none\ntwo\nend\ninsert\n" },
    ),
  };
  expect(diffChangeLines(file.fileDiff)).toEqual([
    { lineNumber: 2, side: "deletions" },
    { lineNumber: 4, side: "deletions" },
    { lineNumber: 6, side: "additions" },
  ]);
  for (const line of [
    { lineNumber: 3, side: "deletions" as const },
    { lineNumber: 2, side: "additions" as const },
  ]) {
    expect(nextReviewChange([file], { id: file.id, line }, 1)).toEqual({
      id: "shifted",
      lineNumber: 4,
      side: "deletions",
    });
    expect(nextReviewChange([file], { id: file.id, line }, -1)).toEqual({
      id: "shifted",
      lineNumber: 2,
      side: "deletions",
    });
  }
  expect(
    nextReviewChange(
      [file],
      {
        id: file.id,
        line: { lineNumber: 5, side: "deletions" },
      },
      1,
    ),
  ).toEqual({ id: "shifted", lineNumber: 6, side: "additions" });
});

it("handles insertions, deletions, pure renames and empty diffs without phantom stops", () => {
  expect(diffChangeLines(parseDiffFromFile(null, { name: "new", contents: "one\ntwo" }))).toEqual([
    { lineNumber: 1, side: "additions" },
  ]);
  expect(diffChangeLines(parseDiffFromFile({ name: "gone", contents: "one\ntwo" }, null))).toEqual([
    { lineNumber: 1, side: "deletions" },
  ]);
  const pureRename = parseDiffFromFile(
    { name: "before", contents: "same" },
    { name: "after", contents: "same" },
  );
  expect(diffChangeLines(pureRename)).toEqual([]);
  expect(diffChangeLines(parseDiffFromFile(null, { name: "empty", contents: "" }))).toEqual([]);
  expect(nextReviewChange([{ id: "rename", fileDiff: pureRename }], undefined, 1)).toBeUndefined();
  expect(nextReviewChange([], undefined, -1)).toBeUndefined();
});
