# Keyboard shortcuts

Navigate and review without taking keys away from typing fields or the host.

## Sub-features

- `keys-file`: Filtered file navigation and boundaries.
- `keys-line`: Old/new line order and comment focus.
- `keys-controls`: Viewed, collapse, search and help.
- `keys-guards`: Typing, composition, edits, modifiers and hidden panels.

## How to get to it (user POV)

Focus/click the panel. Open **Shortcuts** or press `h` for help. Comment submission starts inside its textarea.

## Driving it with Paseo browser tools

Preconditions: [common fixture](../verification.md), at least two visible files and an old/new replacement in `OVERVIEW.md`.

| Action                           | Expected result                                                                |
| -------------------------------- | ------------------------------------------------------------------------------ |
| `n` / `p`                        | Next/previous filtered file; stop at boundaries                                |
| `j` / `k`                        | Follow unified hunk order, old removals before new additions; skip folded gaps |
| `c`                              | Focus a comment at the highlighted side/line                                   |
| `r`                              | Toggle Viewed; checking collapses/returns to that header                       |
| `z`                              | Toggle collapse with the same visible/pinned-header rule as the button         |
| `/` then Escape                  | Focus search, then return focus to the panel                                   |
| `h` / **Shortcuts**, then Escape | Open help through each entry point, then close it                              |
| Ctrl/Cmd+Enter in a comment      | Add/apply locally; plain Enter is a newline                                    |

Run the matrix in unified and split layouts. Scroll manually, then press `j`: navigation restarts near the viewport instead of the old cursor.

Type shortcut letters in search, comments and the file editor; require normal typing. During an edit, focus the panel and require review shortcuts paused. Modifier chords, composition and hidden retained panels must not activate actions. Repeat may navigate but must not repeatedly toggle.

Run `vp test run tests/review-shortcuts.test.ts tests/review-comments.test.ts` for guards and anchors.

## Gotchas

- Paseo reserves `?`; plugin help uses `h`.
- Record which keys the tool actually delivered. Constructed events prove handlers, not physical chords or macOS behavior.
- Cancel/delete test drafts; never send feedback as a keyboard test.
