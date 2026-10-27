# Workspace Review for Paseo

A standalone Paseo 0.13.0 workspace panel with a changed-file tree beside a scrolling CodeView, persistent Viewed markers, explicit inline Save/Cancel, and line comments sent to an agent as review feedback. It is independent of task-workspaces.

Open **New tab → Workspace Review**, or choose **Open Workspace Review** in the workspace command center. Its plugin ID is `workspace-review`, distinct from other plugins named Diff Review.

Click **↗** in a file's diff header to open it in an external editor. The default executable is `code` (VS Code). Change **Editor executable** in Paseo's **Workspace Review** plugin settings and click **Save** to use another executable name or full path, such as `cursor`. The editor receives the repository folder and selected file as separate arguments, with the repository as its working directory. Enter only the executable, without command-line arguments. Settings apply to the selected host, and the editor runs on that host's machine. Deleted files have no launch button. Existing regular files can open externally even when their content exceeds the diff viewer's limits. Opening does not save an inline draft; external edits are subject to the usual conflict checks when saving that draft.

The comparison is **HEAD → worktree**: staged and unstaged changes plus untracked files, with complete original/current text loaded before editing. Renames of supported text files are detected using Git's 50% content-similarity threshold, including unstaged moves to untracked paths. Each rename appears once under its new location with an R marker and an old → new header. Moves with edits show only the changed lines; pure moves show “Renamed — no content changes”. Search matches either path. Unrelated files, copies, unsupported files, and moves below the threshold remain separate additions/deletions. The panel loads a fresh snapshot on opening and automatically refreshes when you return from another Paseo tab or move back into its content from another split by clicking or keyboard focus. Refresh pauses while a file edit is open; Save or Cancel explicitly, then use Refresh or return to the tab again. The Refresh button remains available. There is no periodic polling or additional filesystem watcher. Use the file search, Unviewed only filter, file collapse controls, and Unified/Split toggle to navigate. **Collapse all** and **Expand all** apply to every file in the current snapshot, including files hidden by a filter, while preserving edit and comment drafts. Long lines wrap by default; uncheck **Wrap lines** to use horizontal scrolling. Wrapping works in unified and split modes. Folder totals count a rename once at its new location. The file tree shows green added-line and red removed-line counts beside each reviewable file, matching the diff header. Folders show the combined counts of their visible descendant files, including nested folders; the totals follow the file and Unviewed only filters. Unsupported files do not contribute counts. Each file header stays at the top of the diff area while scrolling through that file, keeping its name, Viewed checkbox and edit controls accessible.

Viewed markers live in `$PASEO_HOME/plugin-data/workspace-review/viewed.json` (default `~/.paseo`). Each marker belongs to a workspace, repository, comparison, path, and exact content/mode fingerprint. A different file changing does not reset it. Checking Viewed acknowledges the displayed snapshot, even if an agent has since changed the disk file. Once the marker is saved, the file diff collapses and the view scrolls back to that same file's header. Other files keep their current collapse state. If Unviewed only or a filename filter hides the file, there is no explicit navigation to another file. Unchecking Viewed expands that file without scrolling. An active edit draft is retained through this collapse.

Click a file's name or header background to collapse or expand its diff, including when the header is pinned while scrolling. Collapsing keeps the current scroll position when the file header is already in the viewport. If you have scrolled past its original position and are using the pinned header, collapse returns to that file's header so it stays accessible. This also applies to the arrow, Collapse button and z shortcut. The arrow beside the filename is also a keyboard-focusable toggle with an announced expanded state. Viewed, Edit, Save, Cancel and other header controls keep their own actions. Header collapse preserves drafts and never saves them.

Viewed files start collapsed when the panel opens. Returning to an already open review tab refreshes its snapshot and collapses Viewed files again; an active edit keeps its existing snapshot and draft. Refresh applies the same collapse default. You can expand them while reviewing; unviewed files retain their current open/collapsed state when returning to the tab. Edit and comment drafts remain intact.

Edit opens the new side only. One file can be edited at a time in each panel. Save validates a server-issued snapshot, repository, path, bytes, inode and file mode before replacing the file. A conflict keeps the draft. Cancel discards it. Each tab saves its view preferences, selected file, file-edit draft and local comments across reloads and app restarts. Unsaved edits and unsent comments mark the tab modified and trigger Paseo’s close confirmation. Closing a tab discards its state after confirmation. Save captures a fresh server snapshot and checks that the edited file still matches the original bytes; restored drafts cannot overwrite external changes. Only the edited file’s captured contents are stored with a draft.

Hover beside a line and click **+** to write an inline comment on the old or new side. **Add comment** keeps it as a local draft; Edit/Delete remain available before sending. Choose an agent from this workspace and click **Send feedback** to send the batch using Paseo's structured code-review attachment, including file paths, line numbers and surrounding code. The chat message includes a numbered list of the submitted comments, with each file path, old/new line number and full comment text. The structured attachment still carries the captured code context. On renamed files, old-side comments carry the former path and new-side comments carry the current path; both remain attached to the same review entry. Running agents receive steering feedback. Agent choices come from the public SDK's workspace membership, since 0.12.0 does not expose the built-in view's open-agent-tab list.

In a comment box, **Ctrl+Enter** (or **Cmd+Enter** on macOS) adds the comment using the same action as Add comment. It also applies changes to an existing comment. Plain Enter inserts a newline. The shortcut keeps the comment local until you explicitly send feedback; empty comments, repeated keydown events and IME composition do not submit.

Click the diff or focus the review panel to use its keyboard shortcuts:

| Key       | Action                                                                  |
| --------- | ----------------------------------------------------------------------- |
| `n` / `p` | Next / previous file in the filtered list                               |
| `r`       | Toggle Viewed; marking Viewed collapses and returns to that file header |
| `z`       | Collapse / expand the current file                                      |
| `j` / `k` | Move the highlighted line down / up within the current diff             |
| `c`       | Open a comment on the highlighted line                                  |
| `/`       | Focus the file filter                                                   |
| `h`       | Show / hide the shortcut help                                           |
| `Escape`  | Return from the filter to the diff, or close the shortcut help          |

Line navigation follows unified diff order in either layout, including removed lines before added lines, and skips unchanged gaps between hunks. Click an expanded context line number to comment there. File navigation stops at the first/last filtered file. Scrolling with the mouse or touch clears the line cursor so navigation starts near the visible position. Review shortcuts ignore text fields, comment boxes, selectors, composition and modifier chords, and pause while a file edit is active. The **Shortcuts** button also opens the help. Paseo reserves `?` for its own app-wide shortcut dialog, so this panel uses `h`.

Comments survive collapse, filtering, virtualization and panel remounts, including unfinished text. Each tab persists its own unfinished text across app reloads and restarts, independently of other review tabs. Failed sends keep the comments; only an acknowledged batch is cleared. Refreshing a changed file marks its comments stale and blocks sending until they are reviewed and recreated. The local comments list retains their text even if the file disappears from the diff. Save or Cancel active file edits before adding comments to that file or sending feedback. Comment creation and refresh never send messages automatically.

Deleted files, symlinks, hard links, special-permission files, submodules, binary/non-UTF-8 files and oversized files are read-only. Unsupported content cannot be marked Viewed. CRLF, CR-only and UTF-8 BOM files can be reviewed but cannot be edited, preserving their original encoding. Unsupported files show a reason. Content loading is limited to 512 KiB per side, 8 MiB per snapshot, and 500 changed files. No staging, committing, pushing, Docker, or GitLab writes occur.

Saves use a temporary file and atomic replacement, preserving Unix permission bits. Conflict checks run immediately before replacement; arbitrary external writers do not share a lock, so this is not a filesystem-level compare-and-swap. Filesystem metadata beyond permission bits is not copied to the replacement file.

The browser renderer uses unmodified `@pierre/diffs` 1.6.1 and its beta editor through the vanilla API, avoiding a React DOM dependency. Browser imports initialize after a platform guard. Native clients show an explicit fallback.

Syntax highlighting uses Pierre Highlights 0.2.0 (embedded WebAssembly) on the main thread, with the default Pierre dark/light themes. No background worker or custom worker bundle is created. Highlights includes its own language lexers; unsupported languages such as Blade fall back to plain text. The editor uses the same backend with incremental tokenization. Shiki remains an upstream dependency of Pierre Diffs, but the review selects Highlights.

Development uses pnpm through VitePlus:

```sh
vp install
vp check
vp run test
paseo plugin install /absolute/path/to/paseo-review
paseo plugin reload workspace-review
```

See [docs/plan.md](docs/plan.md) for unfinished work and [docs/verification.md](docs/verification.md) for the feature map and repeatable test procedures. Installation trusts local plugin code to run in the Paseo host.

Workspace Review's plugin code is licensed under [MIT](LICENSE). The renderer and generated worker use [Pierre Diffs](https://github.com/pierrecomputer/pierre/tree/main/packages/diffs) and other third-party components under their respective licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [LICENSES/](LICENSES/).

Rename matching compares bounded captured contents in a private temporary directory and deletes those copies afterward. It never stages files or writes to the repository’s index or object database. If matching fails, the snapshot keeps separate additions/deletions and shows a warning.
