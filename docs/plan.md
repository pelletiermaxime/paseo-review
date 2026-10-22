# Workspace Review: scope and architecture

Workspace Review is a standalone Paseo workspace panel for reviewing local changes, marking files Viewed, making small inline edits, and sending line comments to a workspace agent. Its plugin ID is `workspace-review`, and its command is **Open Workspace Review**.

## Supported scope

- Target Paseo **0.12.0**, with the manifest and SDK pinned to that version. Register a separate panel through the public `addWorkspacePanel`/`openPanel` APIs.
- Compare **HEAD → worktree**, including staged, unstaged, and untracked files. Load complete original/current contents. Pair supported text renames at Git’s 50% similarity threshold without touching the real index or object database. Support staged/unstaged moves and unborn repositories. Display one entry at the new location, both paths in its header, and a useful content diff.
- Show a searchable changed-file tree with addition/deletion counts on files and cumulative counts on folders beside one scrolling diff surface. Folder totals include visible descendants and follow the active filters. Provide unified/split layouts, sticky file headers, per-file collapse, Collapse all/Expand all, and line wrapping enabled by default.
- Keep the current scroll position when collapsing a file whose original header is visible. Return to its header when collapsing through a pinned header whose original position is outside the viewport.
- Persist Viewed markers daemon-side for the exact displayed per-file diff. Marking Viewed collapses that file and returns to its own header. Opening, returning to, or refreshing the panel collapses Viewed files while retaining drafts.
- Offer explicit Edit, Save, and Cancel for the current side. Preserve drafts through collapse, filtering, virtualization, and panel remounts during the client plugin lifetime. Reloading the plugin/client or restarting the app loses in-memory drafts.
- Add old/new line comments locally, then explicitly send a batch to a selected workspace agent. Include readable comment text in the chat message and captured code context in Paseo's structured review attachment. Preserve comments on failure and block stale comments after Refresh.
- Provide focused-panel navigation, Viewed, collapse, comment, filter, and help shortcuts. Ctrl/Cmd+Enter adds or updates a local comment; sending remains a separate action. Pause review shortcuts during edits and ignore typing/composition.

See [README.md](../README.md) for detailed behavior, shortcuts, content limits, and read-only cases.

## Architecture

- `client/`: React 19.1 and React Native 0.81.5 UI primitives, host theme/icons, browser diff rendering, drafts, and feedback UI.
- `server/`: Git snapshots, path and save validation, atomic file replacement, and the persistent Viewed store.
- `shared/`: typed RPC contracts and validation schemas. Root files register the client and daemon entry points.
- Renderer: **@pierre/diffs 1.5.2** vanilla CodeView and its beta editor API. Browser imports initialize after a platform guard; native clients receive an explicit fallback.
- Highlighting: all language grammars, only the default Pierre dark/light themes, and the JavaScript engine. A version-pinned dependency patch removes alternate themes and the unused WASM backend.
- Background work: one supported Pierre worker pool per panel, with a 20-result token cache and per-content cache keys. Teardown terminates workers and revokes the Blob URL. The editor retains its local highlighter.
- Bundling: Paseo 0.12.0 produces one neutral client bundle. `scripts/build-diff-worker.mjs` generates a checked-in JSON worker asset from the pinned portable worker; `vp run test` checks regeneration consistency. Preserve [third-party notices](../THIRD_PARTY_NOTICES.md) when updating it.

## Data and save boundaries

Viewed state is separate from any remote review service. Each marker is scoped to a workspace, repository, comparison, path, and exact content/mode fingerprint. An unrelated file changing does not invalidate it; acknowledging an older displayed snapshot does not acknowledge newer disk contents.

Save validates the server-issued snapshot, workspace repository, path components, regular-file status, link count, bytes, inode, and mode before atomic replacement. Saves are serialized, and failures retain the draft. Arbitrary external writers do not share a filesystem lock, so this is optimistic conflict detection rather than a filesystem-level compare-and-swap. Unix permission bits are preserved; other filesystem metadata is not copied.

Collapse, virtualization, teardown, comment creation, and Refresh never save edits automatically. The plugin does not stage, commit, push, start containers, or write remote review state.

## Current limits

- Staged-only and branch-base comparisons are not implemented.
- Native diff rendering and disk-persisted drafts are not implemented. Copy detection and rename pairing for unsupported content are not implemented.
- Deleted, linked, special-permission, binary, non-UTF-8, oversized, and nonstandard-EOL/BOM files have deliberate read-only restrictions; see the README for exact cases and bounds.
- SDK 0.12.0 exposes workspace agent membership rather than the built-in view's open-agent-tab list.
- The upstream editor is beta. Compatibility with later Paseo or Pierre releases requires verification.

## Verification and development

Use `vp install`, `vp fmt`, `vp check`, and `vp run test`. Keep static checks, daemon loading, real host interaction, and native simulation as separate evidence. Recheck the actual host after renderer, worker, or editing changes.

[verification.md](verification.md) records what has been exercised and the remaining verification limits.

## Upstream references

- [Pierre Diffs documentation](https://diffs.com/docs)
- [Pierre Diffs source](https://github.com/pierrecomputer/pierre/tree/main/packages/diffs)
