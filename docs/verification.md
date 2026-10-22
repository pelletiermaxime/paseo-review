# Verification

Evidence collected with Paseo **0.12.0** and **@pierre/diffs 1.5.2** on 2026-10-21 and 2026-10-22. This document separates automated checks, daemon loading, real host interaction, and simulations.

## Automated checks

`vp check` passed formatting, lint, and TypeScript checks. `vp run test` passed **19 tests across five files**, including the generated-worker consistency check.

Coverage includes:

- Viewed persistence across service restart, workspace isolation, unrelated file changes, and acknowledging an old displayed version while disk content changes.
- Successful saves, external-content conflicts, single-use save tokens, wrong workspace/unknown file rejection, concurrent saves, and workspace relocation.
- Traversal, Git metadata, symlink parent/file, and hard link rejection, including a parent replaced with a symlink after capture.
- Binary/non-UTF-8/CRLF/BOM/oversized read-only handling, permission-change conflicts, mode-sensitive fingerprints, and Unix permission preservation.
- Both default highlighter theme variants and TypeScript, PHP, Rust, and Emacs Lisp grammars.
- Shortcut guards and old/new comment anchors for replacements, added/deleted/empty files, missing final newline, and distant hunks.
- Exact readable review messages for multiple old/new-side comments, paths with spaces, and multiline bodies; unchanged structured attachments and unavailable-recipient rejection.
- Real worker-engine integration through Pierre's manager: highlighting, repeated-result reuse, changed-content keys, LRU eviction, and render-option invalidation. A small Node/browser messaging adapter is used for this test.

Service tests use disposable unborn repositories and state stores, without creating commits. They do not by themselves establish tracked-HEAD host UI behavior.

A clean copy installed successfully from the frozen lockfile and passed the same checks. The generated asset is also parsed to reject executable imports and the unused alternate engine.

## Daemon loading and host environment

Directory-source installation and scoped plugin reloads reported `workspace-review` **running** on the real Paseo 0.12.0 daemon. The install/reload commands are:

```sh
paseo plugin install /absolute/path/to/paseo-review --json
paseo plugin reload workspace-review
```

UI verification used the official [Paseo web client](https://app.paseo.sh) connected to that daemon. It exercised the actual workspace panel, rather than an isolated mock. Browser tools did not expose the main desktop window, so this does not prove direct interaction with the main Electron window or a physical mobile device.

A temporary localhost copy of the web app was rejected by the daemon's origin checks. Allowed origins and daemon security settings were left unchanged, and the temporary server was stopped.

## Host UI coverage

The following behaviors were exercised in the real workspace panel:

- New tab → Workspace Review, nested searchable file tree, full-content diffs, Shadow DOM styles, syntax tokens, unified/split layouts, and addition/deletion counts.
- Sticky headers aligned with the diff viewport, handing off to the next file while scrolling, with Viewed/Edit/collapse controls still usable.
- File-tree navigation, individual header/arrow/button collapse, Collapse all/Expand all, filters, and wrapped/unwrapped long lines.
- Viewed persistence after Refresh and reload; marking Viewed collapses and returns to that same file header. Returning to a retained inactive tab and opening a fresh tab both collapse Viewed files while preserving in-memory drafts.
- Explicit editing, Save with disk readback, refreshed diff, and reset Viewed marker. Drafts survived collapse, actual CodeView virtualization, layout changes, and panel remounts during the plugin lifetime.
- An external edit between display and Save caused a conflict. External disk contents remained intact and the typed draft stayed available. Cancel discarded the draft and Refresh loaded the external version.
- Inline comment creation, editing/deletion, filtering/collapse/layout retention, old/new anchors, and explicit feedback controls.
- File navigation, Viewed, collapse, line navigation, comment focus, filter focus, and shortcut help. Active editors, typing fields, composition, modifier chords, and hidden retained panels were guarded.

Save verification used a disposable fixture, removed afterward. Other edit checks ended with Cancel and disk readback. Verification comments were removed and original Viewed states restored. No test feedback was sent to a live agent.

The plain `j` key was delivered through browser keypress automation. The broader shortcut matrix, Escape, and Ctrl/Cmd+Enter used constructed KeyboardEvents in the live host DOM because the automation chord tool did not reliably populate modifier fields. This is handler evidence, not physical-keyboard or macOS verification. The host reserves `?` for its own dialog; the plugin uses `h` for help.

## Collapse and highlighting measurements

Before background highlighting, four local collapse samples took **345, 269, 206, and 206 ms** from button activation through two animation frames. The click handler itself took about 0–1 ms; synchronous highlighting of a newly exposed file accounted for the delay.

With one background worker and a bounded shared token cache, five corresponding samples took **25, 31, 30, 18, and 27 ms**. Later checks ranged from 21–46 ms. The actual host reported an initialized worker, populated caches, no worker failures, and syntax-colored spans after the response.

These are local UI samples rather than a controlled benchmark or a guarantee for every file/device. Browser scheduling, cache state, and instrumentation affect the numbers. Closing the review tab unmounted the panel and left its former pool with zero workers, tasks, subscribers, and cached results; reopening created a fresh worker.

Collapsing a header already in the viewport preserved both scrollTop and its screen position through header, arrow, button, and `z` actions in unified/split layouts. Collapsing a pinned header after scrolling into its file still returned to that file's original header. Viewed retained its explicit return-to-header behavior.

## Bundle and native boundary

The installed daemon compiler produced these uncompressed neutral client bundles at the recorded checkpoints:

| Checkpoint                       |      Bytes | Decimal MB |
| -------------------------------- | ---------: | ---------: |
| Before default-theme/engine trim | 12,329,232 |      12.33 |
| After default-theme/engine trim  | 10,029,359 |      10.03 |
| With background highlighting     | 10,533,533 |      10.53 |

The trim removed 2,299,873 bytes (18.65%). Compiler metadata showed the language-grammar contribution unchanged at 8,118,056 emitted bytes. Only default Pierre dark/light theme modules remained, with no Shiki alternate theme modules or Oniguruma WASM engine inputs. These are emitted code sizes, not RAM, startup timings, or compressed transfer sizes.

The renderer probe made no separate Pierre/Shiki/WASM resource requests. The worker asset is local, has no executable imports or language/theme catalogues, and receives required grammars and the default theme through Pierre's protocol. A fully disconnected client/daemon session was not tested.

The daemon-produced bundle was evaluated without DOM/Worker globals and rendered with an iOS platform in React's test renderer. The native fallback appeared without initializing CodeView or issuing snapshot RPCs. This is a simulation, not Hermes or physical-device evidence.

## Remaining limits

- Direct main Electron-window, physical mobile, and physical macOS keyboard interaction have not been exercised by this verification.
- No newly delivered chat bubble was tested against a live agent. Readable feedback text and the structured attachment are covered at the SDK boundary; loading and feedback controls were checked in the actual host.
- Host UI checks primarily used untracked additions. Old-side replacements are covered by real-parser/comment-anchor tests, rather than the full host UI matrix.
- Save conflict detection is optimistic; arbitrary external writers do not share a lock.
- Newer Paseo/Pierre versions and completely disconnected operation require separate verification.

## Folder line counts — 2026-10-22

Folder rows now sum addition/deletion counts from their visible descendant files, including nested folders. They reuse file-row colors, number formatting, and zero-side omission. Search and Unviewed only use the same filtered file set; unsupported files do not contribute counts. Folder names retain ellipsis and a native disclosure marker, and accessible labels include the full folder path and totals.

`vp check` passed and the plugin reload reported running. In the real Paseo panel through the official web client, a disposable nested fixture with two- and three-line files produced +5 on its parent and +3 on its nested folder. A binary-only child folder displayed no invented count. Collapsing/reopening retained the parent total, and filtering to the three-line file changed all three ancestor totals to +3. Existing tracked changes displayed matching positive/negative totals on their parent folders. A screenshot confirmed row alignment and visible disclosure markers. The fixture was removed and the filter cleared; no Viewed markers, comments, or source files were changed through the UI.

## Header count order — 2026-10-22

The panel's renderer CSS places the existing additions counter before deletions in file headers, matching the file tree. This overrides Pierre's default visual order without replacing its counters or modifying the dependency. `vp check` passed, the scoped plugin reload reported running, and rendered counter positions were checked in the actual Paseo web panel for unified, split, and collapsed headers. Layout was restored to unified with files expanded; no edits, comments, or Viewed markers were saved through the UI.
