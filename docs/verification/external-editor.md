# External editor

Open a changed file and its repository folder in a configurable editor on the workspace host.

## Sub-features

- `editor-settings`: Host-scoped executable, default `code`, explicit Save and validation.
- `editor-launch`: Independent diff-header button, current rename destination and literal path arguments.
- `editor-errors`: Missing executable, stale workspace/snapshot, deleted or unsafe targets.
- `editor-drafts`: Launch preserves inline edits, comments, Viewed and collapse state.

## How to get to it (user POV)

- Open Paseo settings and choose the **Workspace Review** plugin settings for the workspace's host.
- Set **Editor executable** and click **Save**. It defaults to `code` for VS Code.
- Open **Workspace Review** and click **↗** in a changed file's diff header.

## Driving it with Paseo browser tools

Preconditions: complete the [launch/doctor steps](../verification.md). Use a disposable workspace on a desktop host with VS Code's `code` executable installed. Record the previous editor setting and restore it afterward.

- **Settings.** Require `code` on an installation with no saved editor setting. Enter an empty/whitespace value: require validation and disabled Save. Enter a valid alternative executable, leave without saving, then reopen: require the previous saved value. Save the alternative and reopen: require persistence on this host.
- **Launch.** With `code` saved, activate button **Open scratch/a.ts in external editor**. Require no editor buttons in the tree. Test the header button with the file expanded, collapsed and with its header pinned while scrolling; it must not toggle collapse or Viewed. Inspect the actual VS Code window: require the disposable repository folder and the selected file. A launch status proves process creation only, not a visible editor window.
- **Literal paths.** In the disposable clone, create a file with spaces, quotes and shell characters in its name. Refresh and open it. Require that exact file in the editor and no shell side effects. Also try a configured executable whose full path contains spaces. Automated tests use a harmless executable to record the exact arguments and working directory.
- **Renames/unsupported.** Use the rename recipe: open the renamed entry and require the new path. Existing large/binary regular files may be opened externally. Deleted entries have no button; symlinks, hard links and directory targets must fail without launching.
- **Errors.** Temporarily save a nonexistent executable and try launching: require a useful error with drafts intact. Restore the setting. Remove a file after loading the snapshot, then try its old header button: require rejection rather than opening a new empty file. Server tests cover workspace/snapshot ownership and replaced symlink parents.
- **Drafts.** Start an inline edit and a comment draft; record Viewed and collapse state. Launch the external editor with the header button. Require all local state unchanged. Change the same file in the editor, then explicitly Save the inline draft: require a conflict with its text retained. Cancel the inline draft and Refresh to load the external edit.

## Gotchas

- The executable runs on the daemon host, including when the client is remote. It must be available in that host's environment.
- The setting accepts one executable name or full path. Editors receive the repository folder followed by the absolute file path; editors needing a different interface can use a wrapper executable.
- Opening launches a process without waiting for the editor to close. A later editor startup failure may not appear in the panel.
- Restore the previous saved executable, cancel verification drafts and close only editor windows opened for this run.
