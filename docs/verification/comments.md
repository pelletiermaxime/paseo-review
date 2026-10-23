# Review comments

Create old/new line feedback locally, then explicitly send a batch to a selected workspace agent.

## Sub-features

- `comment-anchor`: Old/new lines, expanded context and rename paths.
- `comment-local`: Add/edit/delete and Ctrl/Cmd+Enter.
- `comment-retain`: Collapse, filters, virtualization and stale versions.
- `comment-send`: Recipient validation, readable message, attachment and acknowledgement.

## How to get to it (user POV)

Hover a line and choose **+**, or select one with `j/k` and press `c`. Use **Review feedback** for local comments and sending.

## Driving it with Paseo browser tools

Preconditions: [common fixture](../verification.md), no active edit. The changed `OVERVIEW.md` supplies old/new sides.

- **Anchors.** Comment on a removed line and an added line in `OVERVIEW.md`. Require correct side/number and surrounding text. Expand unchanged context in `server/repository.ts` and repeat. On a rename, old-side feedback uses the former path and new-side feedback the current path.
- **Local controls.** Type multiline feedback and **Add comment**. Edit/apply it, then delete it. Require no agent message from these actions.
- **Shortcut.** Repeat Add/update with Ctrl+Enter; check Cmd+Enter on macOS where available. Plain Enter stays a newline. Empty text, repeat and composition must not submit.
- **Retention.** Keep unfinished text through collapse, filtering, layout, virtualization and panel close/reopen. Require exact text. Refresh after an unrelated change: it stays current. Refresh after its file changes: retain text, mark stale and block sending until recreated.
- **Delivery.** Use only a designated test agent authorized for the run. Add multiple comments including multiline text, select it in **Send feedback to agent**, then **Send feedback** once. Require one received message listing every path, side, number and full body, plus the structured attachment with captured context. Clear locals only after acknowledgement. Without an authorized test recipient, report delivery as not run.
- **Failures.** Run `vp test run tests/review-comments.test.ts` for failed-send retention, batch acknowledgement, unavailable/cross-workspace recipient rejection and steering. Do not test by steering the user's active agent.

## Gotchas

- Selecting a recipient or adding feedback does not send it.
- Old-side rename comments jump to the current entry while preserving the former path in feedback.
- SDK assertions do not prove a rendered delivered chat bubble.
- Remove only test comments; preserve existing drafts.
