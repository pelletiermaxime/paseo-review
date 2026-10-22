import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execCommand } from "@getpaseo/plugin/server";
import type { ReviewFile } from "../shared/review";

/** Match only bounded, captured text. No index, repository objects or worktree writes. */
export async function detectRenames(files: ReviewFile[]): Promise<Map<string, string>> {
  const removed = files.filter((file) => file.kind === "deleted" && file.fingerprint);
  const added = files.filter((file) => file.kind === "added" && file.fingerprint);
  const matches = new Map<string, string>();
  if (!removed.length || !added.length) return matches;
  const temporary = await mkdtemp(path.join(tmpdir(), "workspace-review-renames-"));
  try {
    const before = path.join(temporary, "before");
    const after = path.join(temporary, "after");
    await mkdir(before);
    await mkdir(after);
    // Synthetic names keep arbitrary repository paths out of temporary filesystem writes.
    for (const [index, file] of removed.entries())
      await writeFile(path.join(before, `old-${index}`), file.oldContents!, { mode: 0o600 });
    for (const [index, file] of added.entries())
      await writeFile(path.join(after, `new-${index}`), file.newContents!, { mode: 0o600 });
    let output: string;
    try {
      output = (
        await execCommand(
          "git",
          [
            "diff",
            "--no-index",
            "--no-ext-diff",
            "--no-textconv",
            "--name-status",
            "-z",
            "--find-renames=50%",
            "--rename-empty",
            "-l500",
            "--",
            before,
            after,
          ],
          { timeout: 10_000, maxBuffer: 2 * 1024 * 1024, encoding: "utf8" },
        )
      ).stdout;
    } catch (error) {
      // --no-index returns 1 for a successful comparison containing differences.
      const result = error as { code?: number; stdout?: string };
      if (result.code !== 1 || typeof result.stdout !== "string") throw error;
      output = result.stdout;
    }
    const records = output.split("\0");
    for (let index = 0; index < records.length - 1;) {
      const status = records[index++]!;
      const oldName = records[index++]!;
      if (!status.startsWith("R")) continue;
      const newName = records[index++]!;
      const oldFile = removed[Number(path.basename(oldName).replace(/^old-/, ""))];
      const newFile = added[Number(path.basename(newName).replace(/^new-/, ""))];
      if (!oldFile || !newFile) throw new Error("Invalid rename comparison result.");
      matches.set(newFile.path, oldFile.path);
    }
    return matches;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
