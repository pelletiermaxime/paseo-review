import { constants } from "node:fs";
import { lstat, open, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execCommand } from "@getpaseo/plugin/server";
import type { ReviewFile } from "../shared/review";
import { detectRenames } from "./renames";

export const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
export const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export async function git(root: string, args: string[], maxBuffer = MAX_FILE_BYTES + 1024) {
  return (
    await execCommand("git", ["--no-optional-locks", "-C", root, ...args], {
      timeout: 10_000,
      maxBuffer,
      encoding: "latin1",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    })
  ).stdout;
}
export async function repositoryRoot(directory: string) {
  return realpath(
    text(Buffer.from(await git(directory, ["rev-parse", "--show-toplevel"]), "latin1")).trim(),
  );
}
export async function validatePath(root: string, relative: string) {
  if (
    !relative ||
    relative.includes("\\") ||
    relative.includes("\0") ||
    path.isAbsolute(relative) ||
    relative.split("/").some((p) => !p || p === "." || p === ".." || p.toLowerCase() === ".git")
  ) {
    throw new Error("Invalid worktree path.");
  }
  let parent = root;
  const parts = relative.split("/");
  for (const part of parts.slice(0, -1)) {
    parent = path.join(parent, part);
    const stat = await lstat(parent);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error("Symlinked or missing parent directories are read-only.");
  }
  if ((await realpath(parent)) !== parent)
    throw new Error("The parent directory changed. Refresh before editing.");
  return path.join(parent, parts.at(-1)!);
}
export interface DiskFile {
  bytes: Buffer;
  revision: string;
  mode: number;
  dev: number;
  ino: number;
}
export async function readCurrent(root: string, relative: string): Promise<DiskFile | null> {
  let target: string;
  try {
    target = await validatePath(root, relative);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let stat;
  try {
    stat = await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
    throw new Error("Only regular files with no symlinks or hard links can be edited.");
  if (stat.mode & 0o7000) throw new Error("Files with special permission bits are read-only.");
  if (stat.size > MAX_FILE_BYTES) throw new Error("File exceeds the 512 KiB content limit.");
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (
      opened.ino !== stat.ino ||
      opened.dev !== stat.dev ||
      !opened.isFile() ||
      opened.nlink !== 1
    )
      throw new Error("File changed while opening. Refresh and retry.");
    const bytes = Buffer.alloc(MAX_FILE_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < bytes.length) {
      const read = await handle.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead);
      if (!read.bytesRead) break;
      bytesRead += read.bytesRead;
    }
    if (bytesRead > MAX_FILE_BYTES) throw new Error("File exceeds the 512 KiB content limit.");
    const data = bytes.subarray(0, bytesRead);
    return {
      bytes: data,
      revision: hash(data),
      mode: opened.mode,
      dev: opened.dev,
      ino: opened.ino,
    };
  } finally {
    await handle.close();
  }
}
function text(bytes: Buffer) {
  if (bytes.includes(0)) throw new Error("Binary content is read-only.");
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error("Non-UTF-8 content is read-only.");
  }
}
export interface CapturedFile {
  file: ReviewFile;
  disk: DiskFile | null;
}
export async function capture(
  root: string,
): Promise<{ files: CapturedFile[]; warning: string | null }> {
  let head: string | null;
  try {
    head = (await git(root, ["rev-parse", "--verify", "HEAD"])).trim();
  } catch {
    head = null;
  }
  const tracked = await git(
    root,
    head
      ? ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "-z", head, "--"]
      : ["ls-files", "-z"],
    2 * 1024 * 1024,
  );
  const untracked = await git(
    root,
    ["ls-files", "--others", "--exclude-standard", "-z"],
    2 * 1024 * 1024,
  );
  const paths = [
    ...new Set([...tracked.split("\0"), ...untracked.split("\0")].filter(Boolean)),
  ].sort();
  if (paths.length > 500)
    throw new Error("More than 500 changed files. Narrow the worktree before reviewing.");
  let bytes = 0;
  const files: CapturedFile[] = [];
  const baseModes = new Map<string, string>();
  const currentModes = new Map<string, string>();
  for (const encoded of paths) {
    const relative = text(Buffer.from(encoded, "latin1"));
    const file: ReviewFile = {
      path: relative,
      oldPath: null,
      oldContents: null,
      newContents: null,
      fingerprint: null,
      viewed: false,
      editable: false,
      reason: null,
      modeChange: null,
      kind: "unsupported",
    };
    let disk: DiskFile | null = null;
    try {
      if (bytes >= MAX_TOTAL_BYTES)
        throw new Error(
          "Snapshot exceeds the 8 MiB content budget; remaining files are read-only.",
        );
      let base: Buffer | null = null;
      let baseMode: string | null = null;
      if (head) {
        const tree = await git(root, [
          "--literal-pathspecs",
          "ls-tree",
          "-z",
          head,
          "--",
          relative,
        ]);
        if (tree) {
          const match = /^(\d+) blob ([a-f0-9]+)\t/.exec(tree);
          if (!match || !["100644", "100755"].includes(match[1]!))
            throw new Error("Git symlinks and submodules are read-only.");
          baseMode = match[1]!;
          baseModes.set(relative, baseMode);
          if (Number(await git(root, ["cat-file", "-s", match[2]!])) > MAX_FILE_BYTES)
            throw new Error("Original file exceeds the 512 KiB content limit.");
          base = Buffer.from(await git(root, ["cat-file", "blob", match[2]!]), "latin1");
        }
      }
      disk = await readCurrent(root, relative);
      bytes += (base?.length ?? 0) + (disk?.bytes.length ?? 0);
      if (bytes > MAX_TOTAL_BYTES)
        throw new Error(
          "Snapshot exceeds the 8 MiB content budget; remaining files are read-only.",
        );
      file.oldContents = base ? text(base) : null;
      file.newContents = disk ? text(disk.bytes) : null;
      file.kind = base === null ? "added" : disk === null ? "deleted" : "modified";
      const currentMode = disk ? (disk.mode & 0o111 ? "100755" : "100644") : null;
      if (currentMode) currentModes.set(relative, currentMode);
      file.modeChange =
        baseMode && currentMode && baseMode !== currentMode ? `${baseMode} → ${currentMode}` : null;
      file.fingerprint = hash(
        JSON.stringify([
          relative,
          base && hash(base),
          disk?.revision ?? null,
          baseMode,
          currentMode,
        ]),
      );
      file.editable = disk !== null;
      if (!disk) file.reason = "Deleted files are read-only.";
      else if (file.newContents!.includes("\r") || file.newContents!.charCodeAt(0) === 0xfeff) {
        file.editable = false;
        file.reason = "CRLF, CR-only and UTF-8 BOM files are read-only to preserve their encoding.";
      }
    } catch (error) {
      file.reason = error instanceof Error ? error.message : String(error);
      file.oldContents = null;
      file.newContents = null;
      file.fingerprint = null;
      file.editable = false;
    }
    files.push({ file, disk: file.editable ? disk : null });
  }
  let warning =
    "HEAD → worktree includes staged, unstaged and untracked files. Renames use Git's 50% similarity threshold. Refresh is manual.";
  const renamedSources = new Set<string>();
  try {
    const matches = await detectRenames(files.map(({ file }) => file));
    const byPath = new Map(files.map(({ file }) => [file.path, file]));
    for (const [destination, source] of matches) {
      const previous = byPath.get(source)!;
      const current = byPath.get(destination)!;
      current.oldPath = source;
      current.oldContents = previous.oldContents;
      current.kind = "renamed";
      current.fingerprint = hash(
        JSON.stringify(["rename", source, previous.fingerprint, current.fingerprint]),
      );
      const oldMode = baseModes.get(source);
      const newMode = currentModes.get(destination);
      current.modeChange = oldMode !== newMode ? `${oldMode} → ${newMode}` : null;
      renamedSources.add(source);
    }
  } catch {
    warning += " Rename detection failed; unmatched files are shown separately.";
  }
  return { files: files.filter(({ file }) => !renamedSources.has(file.path)), warning };
}
export async function saveFile(
  root: string,
  relative: string,
  expected: DiskFile,
  contents: string,
) {
  const bytes = Buffer.from(contents, "utf8");
  if (
    bytes.length > MAX_FILE_BYTES ||
    contents.includes("\0") ||
    contents.includes("\r") ||
    contents.charCodeAt(0) === 0xfeff
  )
    throw new Error("Save requires UTF-8 text with LF line endings, no BOM, and at most 512 KiB.");
  const check = async () => {
    const disk = await readCurrent(root, relative);
    if (
      !disk ||
      disk.revision !== expected.revision ||
      disk.ino !== expected.ino ||
      disk.dev !== expected.dev ||
      disk.mode !== expected.mode
    )
      throw new Error(
        "File changed since this diff was displayed. Your draft is kept. Cancel and refresh to load the new version.",
      );
  };
  await check();
  if (hash(bytes) === expected.revision) return false;
  const target = await validatePath(root, relative);
  const temporary = path.join(path.dirname(target), `.diff-review-${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, "wx", expected.mode & 0o777);
    try {
      await handle.writeFile(bytes);
      await handle.chmod(expected.mode & 0o777);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await check();
    await validatePath(root, relative);
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch(() => {});
  }
  return true;
}
