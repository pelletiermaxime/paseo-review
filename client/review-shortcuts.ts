import type { FileDiffMetadata, SelectionPoint } from "@pierre/diffs";

export const reviewShortcuts = [
  ["n / p", "Next / previous filtered file"],
  ["r", "Toggle Viewed on the current file"],
  ["z", "Collapse / expand the current file"],
  ["j / k", "Next / previous diff line"],
  ["c", "Comment on the selected line"],
  ["/", "Focus the file filter"],
  ["h", "Show / hide this help"],
  ["Escape", "Leave the filter or close this help"],
  ["Ctrl+Enter / Cmd+Enter", "Add a comment locally from its text box"],
] as const;

export function reviewShortcut(event: KeyboardEvent, typing: boolean): string | undefined {
  if (
    typing ||
    event.defaultPrevented ||
    event.isComposing ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  )
    return;
  if (event.shiftKey) return;
  if (!["n", "p", "r", "z", "j", "k", "c", "/", "h"].includes(event.key)) return;
  if (event.repeat && !["n", "p", "j", "k"].includes(event.key)) return;
  return event.key;
}

/** Canonical unified order in either layout; folded unchanged gaps are skipped. */
export function diffNavigationLines(diff: FileDiffMetadata): SelectionPoint[] {
  const lines: SelectionPoint[] = [];
  for (const hunk of diff.hunks) {
    for (const block of hunk.hunkContent) {
      if (block.type === "context") {
        for (let index = 0; index < block.lines; index++)
          lines.push({ lineNumber: block.additionLineIndex + index + 1, side: "additions" });
      } else {
        for (let index = 0; index < block.deletions; index++)
          lines.push({ lineNumber: block.deletionLineIndex + index + 1, side: "deletions" });
        for (let index = 0; index < block.additions; index++)
          lines.push({ lineNumber: block.additionLineIndex + index + 1, side: "additions" });
      }
    }
  }
  return lines;
}
