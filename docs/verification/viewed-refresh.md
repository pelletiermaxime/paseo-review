# Viewed and refresh

Acknowledge exact displayed versions and obtain current changes when opening or returning to the panel.

## Sub-features

- `viewed-toggle`: Collapse/return to the same header; unchecking expands.
- `viewed-persist`: Persistence and per-file version invalidation.
- `viewed-filter`: Unviewed-only paths and totals.
- `refresh-activation`: Opening, retained-tab return, split focus, resize and edit guards.
- `refresh-comments`: Retained comments and stale-anchor rejection.

## How to get to it (user POV)

Use **Viewed** or `r`, **Unviewed only** / **Refresh**, or leave and return to the review tab.

## Driving it with Paseo browser tools

Preconditions: [common fixture](../verification.md), no active edits or test comments.

- **Toggle.** Scroll into `scratch/a.ts` and check **Viewed scratch/a.ts**. Require checked state, collapse and return to that same header. Uncheck: it expands without explicit navigation elsewhere. Repeat with `r`.
- **Filter.** Mark it Viewed, enable **Unviewed only**, and require it hidden with recomputed folder totals. Disable the filter; require the checked entry again.
- **Unavailable diff.** Add a file larger than 512 KiB and a binary file in the disposable fixture. Require ordinary cards above the diffs with an explicit reason, no Expand/Edit control and an enabled Viewed checkbox. Tree jumps and `n/p/r` must work on these entries. With **Unviewed only** enabled, checking Viewed hides the card and tree entry and updates the total. Refresh: it stays hidden. Change the file, including a same-size rewrite: Refresh clears Viewed and restores its card. Open the external editor only if that action is part of the run. Paths whose version cannot safely be identified keep Viewed disabled.
- **Persist/reopen.** Refresh and close/reopen only the review panel. Require the marker still checked and the file collapsed. Expand it, switch to another Paseo tab and return: it collapses again.
- **Exact version.** Change only `scratch/nested/b.ts` on disk and Refresh; `a.ts` stays Viewed and collapsed. Change `a.ts` and Refresh; its marker clears and its updated diff expands. Repeat by changing a Viewed file while on another tab and returning, then by changing it while the app is closed and restoring the tab. A manually collapsed, unviewed file should keep its collapse state. Service tests also cover acknowledging an older displayed version after disk contents change.
- **Initial opening.** Close the panel, change a fixture externally and reopen. Require current contents/counts without pressing Refresh.
- **Retained return.** Switch to an existing agent/terminal tab without sending input. Change `scratch/a.ts` externally, return to the retained review tab and require updated contents/counts. A full page reload is not a substitute.
- **Split return.** Keep the review visible beside another panel. Click the other panel, change `scratch/a.ts` externally, then click in the review content; require updated contents/counts. Repeat by moving keyboard focus out of and back into the review. Further clicks and focus changes within the review must not refresh again. If the first click is **Edit**, require the editor and its draft to remain open, with refresh paused.
- **Resize/idle.** Keep the panel visible, change a fixture externally, then resize. It should retain the snapshot until **Refresh** or a tab return. Resize is not activation; there is no timer update.
- **Edit guard.** Type a distinctive unsaved edit. Leave, change that file externally and return. Repeat while moving between two visible splits. Require the draft intact and Refresh paused. Cancel explicitly, then Refresh; require the external version.
- **Comment guard.** Add a local comment, leave, change its file externally and return. Require text retained in local comments, stale status and blocked sending. An unrelated change must not stale it.

## Gotchas

- An edit or in-flight operation can skip auto-refresh. Save/Cancel, then Refresh or return again.
- App reload restores each tab’s drafts and view state. Closing a modified tab requires confirmation and discards only that tab’s state.
- Older saved tabs without Viewed-version metadata expand unviewed files once on restoration, including manual collapses. Subsequent manual collapses are preserved. Loading new plugin code requires a plugin/client reload; returning to an already-mounted tab only refreshes its data.
- Restore fixture markers; never clear the user's entire Viewed store.
