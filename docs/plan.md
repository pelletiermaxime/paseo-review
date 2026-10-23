# TODO

Only unfinished, agreed work belongs here. Remove completed items. Keep usage in the [README](../README.md) and test procedures in the [verification map](verification.md).

## Automatic refresh on tab return

Live UI verification remains:

- [ ] Complete the [host doctor checks](verification.md#doctor) and reach a usable plugin panel. A running daemon alone is insufficient.
- [ ] Verify initial opening, returning to a retained tab, and ordinary resizing using [Viewed and refresh](verification/viewed-refresh.md).
- [ ] Verify that returning during an edit preserves the draft and that refreshed comments retain their text and reject stale anchors.

## External editor

- [ ] Verify settings persistence, the diff-header button and the resulting editor window in the actual host using [External editor](verification/external-editor.md).
