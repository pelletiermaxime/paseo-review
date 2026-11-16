# Review comments

Create old/new line feedback locally, then add a batch to a selected workspace agent's editable chat draft.

## Sub-features

- `comment-anchor`: Old/new lines, expanded context and rename paths.
- `comment-local`: Add/edit/delete and Enter/Shift+Enter.
- `comment-retain`: Collapse, filters, virtualization and stale versions.
- `comment-send`: Recipient validation, compact editable chat handoff and draft preservation.

## How to get to it (user POV)

Hover a line and choose **+**, or select one with `j/k` and press `c`. Use **Review feedback** for local comments and sending.

## Driving it with Paseo browser tools

Preconditions: [common fixture](../verification.md), no active edit. The changed `OVERVIEW.md` supplies old/new sides.

- **Anchors.** Comment on a removed line and an added line in `OVERVIEW.md`. Require correct side/number and surrounding text. Expand unchanged context in `server/repository.ts` and repeat. On a rename, old-side feedback uses the former path and new-side feedback the current path.
- **Local controls.** Type multiline feedback and **Add comment**. Edit/apply it, then delete it. Require no agent message from these actions.
- **Local list.** Click the comments icon with its pending count. Require the list in a popover without increasing toolbar height. Close it using its close button, Escape or an outside click. A path jump closes the popover and scrolls to the comment's file; deleting the final comment closes it and hides the count button.
- **Shortcut.** Repeat Add/update with Enter: the comment stays local. Shift+Enter inserts a newline. Empty text, repeat and composition must not submit. Without a selected recipient, Ctrl/Cmd+Enter keeps the comment and asks for an agent. Active file edits and stale anchors block delivery.
- **Retention.** Keep unfinished text through collapse, filtering, layout, virtualization, tab return and app reload. Require exact text. Refresh after an unrelated change: it stays current. Refresh after its file changes: retain text, mark stale and block sending until recreated.
- **Chat handoff.** Use a designated test agent. Put existing text in its chat draft, then return to the review panel. Add multiple comments including multiline text, select it in **Add feedback to agent chat**, then **Add to chat** once. Require its chat to open with the input focused and the original text preserved, followed by a compact numbered list containing each path, side, line number and full comment body, without diff excerpts or a repository header. Require no new agent message or turn. Edit the inserted text and check it stays editable. Clear locals only after successful insertion. Repeat with an empty chat draft and with the recipient's tab closed.
- **Direct shortcut.** With that test recipient selected, keep another local comment pending and press Ctrl+Enter in a new or edited comment; check Cmd+Enter on macOS where available. Require only the current comment in the chat draft. Other pending comments, including unfinished or stale ones, stay local. A failed handoff retains the current comment for retry.
- **Failures.** Run `vp test run tests/review-comments.test.ts` for failed-handoff retention, batch acknowledgement, unavailable/cross-workspace recipient rejection, preservation of text typed during navigation, and absence of direct sending. Do not send the test draft to the user's active agent.

## Gotchas

- Selecting a recipient or adding feedback does not send it.
- Old-side rename comments jump to the current entry while preserving the former path in feedback.
- SDK assertions do not prove a rendered delivered chat bubble.
- Remove only test comments; preserve existing drafts.
