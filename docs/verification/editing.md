# Inline editing

Make small changes to current contents with explicit Save/Cancel and conflict protection.

## Sub-features

- `edit-save` / `edit-cancel`: Explicit persistence or discard.
- `edit-retain`: Collapse, filters, virtualization and panel remounts.
- `edit-conflict`: External changes and retained drafts.
- `edit-readonly`: Unsupported targets and encoding/mode preservation.

## How to get to it (user POV)

Choose **Edit** in a file header. Ordinary diffs edit the new side; pure moves open the full current file.

## Driving it with Paseo browser tools

Preconditions: [common fixture](../verification.md); record the target's bytes and mode.

- **Save.** Edit `scratch/a.ts`, type a unique line and **Save**. Require success, disk readback with the line, refreshed diff/counts and reset Viewed when contents changed.
- **Cancel.** Start another edit, type a different line and **Cancel**. Require unchanged disk bytes and a closed editor.
- **One editor.** Try **Edit** elsewhere during an edit. Require no second editor and disabled Refresh.
- **Retention.** Keep an unsaved line through collapse/expand, layout changes, filtering and scrolling far enough for CodeView to remove/recreate the rendered item. Require the same draft and unchanged disk bytes. Repeat with tab return and panel close/reopen.
- **Conflict.** Change the target externally during an edit, then **Save**. Require a conflict, retained draft and untouched external disk contents. Cancel and Refresh must load the external version.
- **Read-only.** Inspect `scratch/binary.bin` and `scratch/crlf.txt`. Require a reason and no writable editor. Preserve CRLF bytes; unsupported binary content cannot be marked Viewed.
- **Boundaries.** Run `vp test run tests/review-service.test.ts` for traversal, metadata paths, links, permissions, encodings, byte limits, stale tokens, relocation, concurrent saves and mode preservation.

## Gotchas

- Save mutates the disposable clone, not the source checkout.
- Collapse, layout, virtualization and teardown must not save automatically.
- Tokens expire after one hour. Client/plugin reload and app restart do not preserve drafts.
- Conflict checks are optimistic; external writers do not share the plugin lock.
