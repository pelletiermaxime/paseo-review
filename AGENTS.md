# Project instructions

- Never commit or push without explicit user approval. Preserve existing work.
- This is a standalone Paseo 0.12.0 plugin. Keep the SDK and manifest pinned to that version.
- Keep UI in `client/`, daemon code in `server/`, contracts in `shared/`, and entry files at the root.
- Use VitePlus: `vp install`, `vp fmt`, `vp check`, `vp run test`. Separate functions with a blank line.
- Use public Paseo SDK/UI exports and `@pierre/diffs` for rendering and editing. Keep browser code behind the platform guard.
- Save and Cancel must be explicit. Validate paths and detect external changes on the daemon; preserve drafts on errors, collapse and teardown. Editing must not stage files or change repository history.
- Tie Viewed markers to the exact per-file diff displayed.
- Verify UI changes in the actual Paseo host and distinguish runtime evidence from static checks.

Use docs/plan.md only for unfinished work. Use docs/verification.md and its feature recipes for repeatable checks; report run results in the change or PR, not as a diary in those files.
