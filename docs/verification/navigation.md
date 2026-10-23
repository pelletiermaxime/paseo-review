# Review navigation

Browse local changes with a file tree beside a scrolling diff and control how much content is visible.

## Sub-features

- `nav-entry`: New tab and command-center entry points.
- `nav-tree`: Nested paths, jumps, file/folder totals and search.
- `nav-layout`: Unified/split, wrapping and unchanged context.
- `nav-collapse`: Individual/all collapse and sticky-header scrolling.

## How to get to it (user POV)

- Choose **New tab → Workspace Review**.
- From the workspace command center, choose **Open Workspace Review**.

## Driving it with Paseo browser tools

Preconditions: complete the [launch/doctor steps](../verification.md); use the common fixture.

- **Entry points.** Open from each entry point. Require the same controls and fixture paths; capture which entry point was used.
- **Tree/counts.** Expand `scratch/nested`. Require `a.ts +2`, `nested/b.ts +1` and `nested +1`. Sum all reviewable descendants once for the `scratch` total; binary content contributes no invented count. The tracked `OVERVIEW.md` change supplies both positive/negative counts. Additions must precede deletions in tree rows and diff headers.
- **Search/jump.** Fill **Filter changed files** with `nested/b.ts`. Require that file and its ancestors, each totaling +1. Clear it and require the full tree again. Click an entry and require the matching diff header in view.
- **Layout/wrapping.** Jump to `scratch/long.txt`. Toggle **Split** / **Unified** and **Wrap lines**. Require wrapping when enabled and horizontal scrolling when disabled, in both layouts. Restore unified/wrapped.
- **Sticky header.** Jump to `scratch/many.ts` and scroll well into it. Require its filename, Viewed and edit controls to stay visible; scrolling into another file hands the pinned header over.
- **Individual collapse.** Exercise header background/name, arrow, **Collapse**, and `z`. With the original header in the viewport, compare its position and scrollTop before/after: neither should jump. With a pinned header whose original position is above the viewport, collapse returns to that file's original header. **Edit** and **Viewed** keep their separate actions.
- **All files.** Use **Collapse all** / **Expand all** with and without search. Clear the filter and require the command to have affected hidden files too.
- **Context.** Jump to `server/repository.ts`, which has one fixture change in the middle of a long tracked file. Activate the unchanged-context separators above and below that hunk. Require additional real source lines matching the base/current file without new addition/deletion counts.

## Gotchas

- Folder totals follow search and **Unviewed only**, regardless of whether the folder is folded.
- Unsupported entries can have no line counts.
- Repeat collapse with edit/comment drafts using their recipes; collapse must not save or discard either.
