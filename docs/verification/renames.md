# Renames

Review a move as one entry at its new location, with old → new paths and only actual content changes.

## Sub-features

- `rename-pure`: Unstaged move with identical contents.
- `rename-edited`: Move with content changes.
- `rename-staged`: Staged and empty-file moves.
- `rename-boundaries`: Destination saves, counts and old/new comments.

## How to get to it (user POV)

Open Workspace Review after moving a tracked file, then **Refresh** or return to the tab.

## Driving it with Paseo browser tools

Preconditions: [disposable clone](../verification.md), no active edit. These commands target only that clone:

```sh
git -C "$REVIEW_REPO" restore --source=HEAD --worktree -- OVERVIEW.md
mv "$REVIEW_REPO/OVERVIEW.md" "$REVIEW_REPO/scratch/renamed.md"
```

- **Pure move.** Refresh. Require exactly one `scratch/renamed.md` entry with **R**, no separate old entry, an `OVERVIEW.md → scratch/renamed.md` header and **Renamed — no content changes**. Search each name; both must find it.
- **Edit/save.** Choose **Edit**, insert one line and **Save**. Read the destination from disk; require the line and the original path still absent. Refresh must show only +1. Folder totals count it once at the new location.
- **Staged move.** Run `git -C "$REVIEW_REPO" add -- OVERVIEW.md scratch/renamed.md` and Refresh. Require the same rename representation. Never stage the source checkout.
- **Comments/Viewed.** Run their [comment](comments.md) and [Viewed](viewed-refresh.md) checks here. Old-side feedback uses the former path, new-side feedback the current path; local jump/edit/delete still use one review entry.
- **Boundaries.** Run `vp test run tests/review-service.test.ts tests/review-comments.test.ts` from the source checkout. Require empty/staged/edited move, index/object preservation, mode, conflict and old/new feedback-path cases to pass.

## Gotchas

- A move below 50% similarity can remain separate. Copies and unsupported content are not paired.
- A pure move has no displayed diff lines to comment on until content/context is visible.
- To check read-only detection, compare fixture index bytes and Git object count before/after snapshot requests. Staging the fixture is a separate setup action.
