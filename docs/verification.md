# Verification guide

Choose a feature below, drive the actual Paseo panel, and check the observable result. These pages are procedures, not a record of previous runs. Report results in the change or PR that runs them.

## Feature map

| Feature            | What to test                                                                             | Recipe                                               |
| ------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Navigation         | Both entry points, tree/counts/search, layouts, wrapping, sticky headers and collapse    | [Navigation](verification/navigation.md)             |
| External editor    | Default/configured executable, tree launch, paths, host scope and draft preservation     | [External editor](verification/external-editor.md)   |
| Renames            | Pure/edited moves, staged/unstaged paths, search and destination-only saves              | [Renames](verification/renames.md)                   |
| Viewed and refresh | Versioned markers, persistence, filters, opening/returning and draft guards              | [Viewed and refresh](verification/viewed-refresh.md) |
| Editing            | Save/Cancel, conflicts, draft retention, modes and read-only targets                     | [Editing](verification/editing.md)                   |
| Comments           | Old/new anchors, local drafts, stale/send failures and readable agent feedback           | [Comments](verification/comments.md)                 |
| Shortcuts          | Every shortcut, navigation order, focus and typing/composition guards                    | [Shortcuts](verification/shortcuts.md)               |
| Rendering          | Themes, languages, main-thread highlighting, collapse responsiveness and native fallback | [Rendering](verification/rendering.md)               |

## Launch and isolation

Use Paseo **0.13.0** and the pinned dependencies. From this checkout:

```sh
vp install --frozen-lockfile
vp check
vp run test
paseo plugin ls --json
paseo plugin reload workspace-review --json
```

For a first installation, run `paseo plugin install "$(pwd)" --json` before reload. Require the registration to point to this checkout.

Use the existing host; do not start a second daemon on its port. Run file mutations in a disposable clone. These commands share one shell; carry the resulting paths into subsequent command-runner calls:

```sh
REVIEW_SOURCE=$(git rev-parse --show-toplevel)
REVIEW_RUN=$(mktemp -d)
REVIEW_REPO="$REVIEW_RUN/repository"
mkdir "$REVIEW_RUN/artifacts"
git clone --local --no-hardlinks "$REVIEW_SOURCE" "$REVIEW_REPO"
paseo workspace create --isolation local --path "$REVIEW_REPO" --title "Workspace Review verification" --json
```

Record the returned workspace ID as `REVIEW_WORKSPACE_ID`. This copies existing history without creating a commit. The plugin comes from `REVIEW_SOURCE`; the reviewed files come from `REVIEW_REPO`.

Create the common fixture in that clone:

```sh
python - "$REVIEW_REPO" <<'PYFIXTURE'
from pathlib import Path
import sys
repo = Path(sys.argv[1])
scratch = repo / "scratch"
(scratch / "nested").mkdir(parents=True)
(scratch / "a.ts").write_text("export const a = 1;\nexport const b = 2;\n")
(scratch / "nested/b.ts").write_text("export const c = 3;\n")
(scratch / "long.txt").write_text("long " * 100 + "\n")
(scratch / "many.ts").write_text("".join(f"export const line{i} = {i};\n" for i in range(400)))
(scratch / "binary.bin").write_bytes(b"\0binary")
(scratch / "crlf.txt").write_bytes(b"keep\r\nthis\r\n")
overview = repo / "OVERVIEW.md"
overview.write_text(overview.read_text().replace("# Workspace Review", "# Review fixture", 1))
tracked = repo / "server/repository.ts"
lines = tracked.read_text().splitlines(keepends=True)
lines.insert(len(lines) // 2, "// verification context fixture\n")
tracked.write_text("".join(lines))
PYFIXTURE
```

## Doctor

Before driving, or whenever the UI looks wrong:

1. Run `paseo daemon status --json`: require a reachable 0.13.0 daemon. Match its server ID to the selected client host.
2. Run `paseo plugin ls --json`: require `workspace-review` enabled/running from this checkout. This proves daemon loading only.
3. Select the disposable workspace. Open **New tab → Workspace Review**. Require the **Workspace review** region, **Refresh** button and **Changed files** navigation.
4. Require `scratch/a.ts` and the modified `OVERVIEW.md` in the tree. If the panel is unavailable, stop UI verification and report the prerequisite; do not change global security settings to make it pass.

## Driving conventions

Use Paseo browser tools against the real host. Open `https://app.paseo.sh` with `browser_new_tab` when that client can load the plugin, then select the matching host and disposable workspace.

Take `browser_snapshot` and use its current refs with `browser_click`, `browser_fill` and `browser_type`. Take a fresh snapshot after state changes. Prefer visible names and these stable handles:

| Surface        | Handle                                                                 |
| -------------- | ---------------------------------------------------------------------- |
| Panel          | region `Workspace review`; `[data-diff-review="ready"]`                |
| File tree      | navigation `Changed files`                                             |
| Search         | searchbox `Filter changed files`                                       |
| Viewed         | checkbox `Viewed <current path>`                                       |
| Feedback       | region `Review feedback`; combobox `Send feedback to agent`            |
| Comment editor | textarea `Comment on <side-specific path> <old/new> line <number>`     |
| File editor    | `[contenteditable="true"][role="textbox"]` inside Pierre's shadow root |

Read shadow roots when inspecting diff lines or editor contents. Use real clicks/typing for user journeys. Constructed KeyboardEvents check handlers; report them separately from physical key delivery. Run shell commands through the command runner, not by typing into a Paseo terminal tab.

## Evidence and cleanup

For every executed feature ID, keep action/result snapshots, screenshots where useful, commands and exit codes under `$REVIEW_RUN/artifacts`. Save needs disk readback; delivery needs the received message and attachment result. A success label alone is insufficient. Separate automated tests, daemon loading, real host interaction, simulations and unexecuted checks.

Cancel edits and remove verification comments. Close only browser tabs created by the run. Archive only `REVIEW_WORKSPACE_ID` with `paseo workspace archive "$REVIEW_WORKSPACE_ID" --json`. Confirm the path is this run's clone before removing `REVIEW_REPO`; retain `$REVIEW_RUN/artifacts`. Do not stop the shared daemon or clear the user's Viewed store.

Keep these recipes current when behavior changes. Do not append dated results; use [plan.md](plan.md) for outstanding work.
