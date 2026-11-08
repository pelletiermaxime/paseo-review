import type { FileDiffMetadata, SelectionPoint } from "@pierre/diffs";

interface NavigationFile {
  id: string;
  fileDiff?: FileDiffMetadata;
}

export interface ReviewChange extends SelectionPoint {
  id: string;
}

/** One stop per contiguous change, starting with removals for replacements. */
export function diffChangeLines(diff: FileDiffMetadata): SelectionPoint[] {
  return diff.hunks.flatMap((hunk) =>
    hunk.hunkContent.flatMap((block): SelectionPoint[] => {
      if (block.type !== "change") return [];
      if (block.deletions) return [{ lineNumber: block.deletionLineIndex + 1, side: "deletions" }];
      if (block.additions) return [{ lineNumber: block.additionLineIndex + 1, side: "additions" }];
      return [];
    }),
  );
}

/** Compare either side in unified order, including manually expanded context. */
function linePosition(diff: FileDiffMetadata, line: SelectionPoint): number {
  let position = 0;
  for (const hunk of diff.hunks) {
    for (const block of hunk.hunkContent) {
      const start =
        (line.side === "deletions" ? block.deletionLineIndex : block.additionLineIndex) + 1;
      if (line.lineNumber < start) return position - 0.5;
      const count =
        block.type === "context"
          ? block.lines
          : line.side === "deletions"
            ? block.deletions
            : block.additions;
      if (line.lineNumber < start + count)
        return (
          position +
          line.lineNumber -
          start +
          (block.type === "change" && line.side !== "deletions" ? block.deletions : 0)
        );
      position += block.type === "context" ? block.lines : block.deletions + block.additions;
    }
  }
  return position;
}

/** Files arrive in displayed order; callers pass only the currently filtered list. */
export function nextReviewChange(
  files: NavigationFile[],
  current: { id: string; line?: SelectionPoint; inclusive?: boolean } | undefined,
  direction: -1 | 1,
): ReviewChange | undefined {
  const currentIndex = current ? files.findIndex((file) => file.id === current.id) : -1;
  const ordered = direction === 1 ? files : [...files].reverse();
  for (const file of ordered) {
    if (!file.fileDiff) continue;
    const index = files.indexOf(file);
    if (currentIndex >= 0 && (index - currentIndex) * direction < 0) continue;
    const lines = diffChangeLines(file.fileDiff);
    if (direction === -1) lines.reverse();
    const position =
      index === currentIndex && current?.line
        ? linePosition(file.fileDiff, current.line)
        : undefined;
    const line = lines.find((line) => {
      if (position === undefined) return true;
      const distance = (linePosition(file.fileDiff!, line) - position) * direction;
      return distance > 0 || (current?.inclusive === true && distance === 0);
    });
    if (line) return { id: file.id, ...line };
  }
}
