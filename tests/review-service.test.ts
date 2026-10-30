import { afterEach, expect, it } from "vite-plus/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  link,
  chmod,
  stat,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ReviewService } from "../server/review-service";
import { validatePath, MAX_FILE_BYTES } from "../server/repository";

const execute = promisify(execFile);
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "diff-review-test-"));
  directories.push(directory);
  const root = path.join(directory, "repository");
  await mkdir(root);
  await execute("git", ["init", "--quiet", root]);
  const state = path.join(directory, "state");
  const service = new ReviewService(state);
  return { root, state, service };
}

async function baseline(root: string) {
  await execute("git", ["-C", root, "add", "--all"]);
  const { stdout } = await execute("git", ["-C", root, "write-tree"]);
  // A tree-valued test ref supplies HEAD contents without creating commits.
  await execute("git", ["-C", root, "update-ref", "refs/review-test/base", stdout.trim()]);
  await execute("git", ["-C", root, "symbolic-ref", "HEAD", "refs/review-test/base"]);
}

async function branchFixture() {
  const fixtureState = await fixture();
  const { root } = fixtureState;
  await rm(root, { recursive: true });
  // Reuse real history in an isolated clone without creating any commits.
  await execute("git", [
    "clone",
    "--quiet",
    "--local",
    "--no-hardlinks",
    fileURLToPath(new URL("..", import.meta.url)),
    root,
  ]);
  await execute("git", ["-C", root, "branch", "review-feature"]);
  await execute("git", ["-C", root, "symbolic-ref", "HEAD", "refs/heads/review-feature"]);
  await execute("git", ["-C", root, "update-ref", "refs/heads/main", "HEAD~1"]);
  await execute("git", ["-C", root, "update-ref", "refs/remotes/origin/main", "HEAD~1"]);
  await execute("git", [
    "-C",
    root,
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
    "refs/remotes/origin/main",
  ]);
  return fixtureState;
}

it("switches between uncommitted and whole-branch changes using the default base", async () => {
  const { root, service } = await branchFixture();
  await writeFile(path.join(root, "local.txt"), "local addition\n");
  await writeFile(path.join(root, "README.md"), "staged readme\n");
  await execute("git", ["-C", root, "add", "README.md"]);
  await writeFile(path.join(root, "README.md"), "unstaged readme\n");
  const index = await readFile(path.join(root, ".git/index"));
  const objects = (await execute("git", ["-C", root, "count-objects", "-v"])).stdout;
  const local = await service.snapshot("workspace", root);
  const branch = await service.snapshot("workspace", root, "branch-worktree");
  expect(local.files.map((file) => file.path)).toEqual(["README.md", "local.txt"]);
  expect(branch.comparison).toBe("branch-worktree");
  expect(branch.baseRef).toBe("origin/main");
  const changed = (await execute("git", ["-C", root, "diff", "--name-only", "HEAD~1", "--"])).stdout
    .trim()
    .split("\n");
  expect(branch.files.map((file) => file.path).sort()).toEqual([...changed, "local.txt"].sort());
  expect(branch.files.find((file) => file.path === "README.md")?.newContents).toBe(
    "unstaged readme\n",
  );
  for (const committedPath of changed) {
    const original = await execute("git", ["-C", root, "show", `HEAD~1:${committedPath}`]).then(
      ({ stdout }) => stdout,
      () => null,
    );
    expect(branch.files.find((file) => file.path === committedPath)?.oldContents).toBe(original);
  }
  expect(await readFile(path.join(root, ".git/index"))).toEqual(index);
  expect((await execute("git", ["-C", root, "count-objects", "-v"])).stdout).toBe(objects);
});

it("uses the common ancestor rather than showing changes made only on the base branch", async () => {
  const { root, service } = await branchFixture();
  await execute("git", ["-C", root, "update-ref", "refs/heads/main", "HEAD"]);
  await execute("git", ["-C", root, "reset", "--hard", "HEAD~1"]);
  const snapshot = await service.snapshot("workspace", root, "branch-worktree", "main");
  expect(snapshot.files).toEqual([]);
  expect(snapshot.baseRef).toBe("main");
});

it("keeps Viewed acknowledgements independent between scopes and base branches", async () => {
  const { root, state, service } = await branchFixture();
  await writeFile(path.join(root, "local.txt"), "local addition\n");
  const local = await service.snapshot("workspace", root);
  await service.viewed("workspace", local.id, "local.txt", true);
  const branch = await service.snapshot("workspace", root, "branch-worktree", "main");
  expect(branch.files.find((file) => file.path === "local.txt")?.viewed).toBe(false);
  await service.viewed("workspace", branch.id, "local.txt", true);
  const restarted = new ReviewService(state);
  expect(
    (await restarted.snapshot("workspace", root, "branch-worktree", "main")).files.find(
      (file) => file.path === "local.txt",
    )?.viewed,
  ).toBe(true);
  expect(
    (await restarted.snapshot("workspace", root, "branch-worktree", "origin/main")).files.find(
      (file) => file.path === "local.txt",
    )?.viewed,
  ).toBe(false);
  await service.viewed("workspace", branch.id, "local.txt", false);
  expect(
    (await restarted.snapshot("workspace", root)).files.find((file) => file.path === "local.txt")
      ?.viewed,
  ).toBe(true);
  await service.save("workspace", branch.id, "local.txt", "saved from branch review\n");
  expect(await readFile(path.join(root, "local.txt"), "utf8")).toBe("saved from branch review\n");
});

it("reports missing or invalid branch bases without silently using HEAD", async () => {
  const { root, service } = await fixture();
  await expect(service.snapshot("workspace", root, "branch-worktree")).rejects.toThrow(
    "committed HEAD",
  );
  const branch = await branchFixture();
  for (const base of ["missing-branch", "--all"])
    await expect(
      branch.service.snapshot("workspace", branch.root, "branch-worktree", base),
    ).rejects.toThrow("does not resolve to a commit");
  await execute("git", ["-C", branch.root, "update-ref", "-d", "refs/remotes/origin/main"]);
  await execute("git", ["-C", branch.root, "update-ref", "-d", "refs/heads/main"]);
  await expect(
    branch.service.snapshot("workspace", branch.root, "branch-worktree"),
  ).rejects.toThrow("Cannot find a base branch");
});

it("resolves external editor targets only from the matching workspace snapshot", async () => {
  const { root, service } = await fixture();
  const relative = 'space and "quote".ts';
  await writeFile(path.join(root, relative), "const changed = true;\n");
  const snapshot = await service.snapshot("workspace", root);
  const before = await readFile(path.join(root, relative));
  expect(await service.editorTarget("workspace", snapshot.id, relative, root)).toEqual({
    root,
    file: path.join(root, relative),
  });
  expect(await readFile(path.join(root, relative))).toEqual(before);
  await expect(
    service.editorTarget("other-workspace", snapshot.id, relative, root),
  ).rejects.toThrow("snapshot expired");
  await expect(
    service.editorTarget("workspace", snapshot.id, "../outside.ts", root),
  ).rejects.toThrow("displayed snapshot");
  const other = await fixture();
  await expect(
    service.editorTarget("workspace", snapshot.id, relative, other.root),
  ).rejects.toThrow("repository changed");
  await rm(path.join(root, relative));
  await expect(service.editorTarget("workspace", snapshot.id, relative, root)).rejects.toThrow(
    "no longer exists",
  );
  await symlink(path.join(other.root, "outside.ts"), path.join(root, relative));
  await expect(service.editorTarget("workspace", snapshot.id, relative, root)).rejects.toThrow(
    "Only regular files",
  );
});

it("opens renamed destinations and oversized files but rejects deleted files and symlink parents", async () => {
  const { root, service } = await fixture();
  await writeFile(path.join(root, "before.ts"), "export const value = 1;\n");
  await writeFile(path.join(root, "deleted.ts"), "export const removed = true;\n");
  await baseline(root);
  await rename(path.join(root, "before.ts"), path.join(root, "after.ts"));
  await rm(path.join(root, "deleted.ts"));
  await writeFile(path.join(root, "large.txt"), "x".repeat(MAX_FILE_BYTES + 1));
  await mkdir(path.join(root, "folder"));
  await writeFile(path.join(root, "folder/file.ts"), "changed\n");
  const snapshot = await service.snapshot("workspace", root);
  expect(await service.editorTarget("workspace", snapshot.id, "after.ts", root)).toEqual({
    root,
    file: path.join(root, "after.ts"),
  });
  expect(await service.editorTarget("workspace", snapshot.id, "large.txt", root)).toEqual({
    root,
    file: path.join(root, "large.txt"),
  });
  await expect(service.editorTarget("workspace", snapshot.id, "deleted.ts", root)).rejects.toThrow(
    "Deleted files",
  );
  await rename(path.join(root, "folder"), path.join(root, "moved-folder"));
  await symlink(path.join(root, "moved-folder"), path.join(root, "folder"));
  await expect(
    service.editorTarget("workspace", snapshot.id, "folder/file.ts", root),
  ).rejects.toThrow("parent directories");
});

it("pairs unstaged renames with edits without changing the index or object database", async () => {
  const { root, service } = await fixture();
  const source = 'old folder/é-[literal]\t".ts';
  const destination = "new folder/renamed.ts";
  await mkdir(path.join(root, "old folder"));
  await mkdir(path.join(root, "new folder"));
  const before = Array.from({ length: 20 }, (_, i) => `export const value${i} = ${i};\n`).join("");
  const after = before.replace("value10 = 10", "value10 = 100");
  await writeFile(path.join(root, source), before);
  await baseline(root);
  await rename(path.join(root, source), path.join(root, destination));
  await writeFile(path.join(root, destination), after);
  const index = await readFile(path.join(root, ".git/index"));
  const objects = await execute("git", ["-C", root, "count-objects", "-v"]);
  const snapshot = await service.snapshot("workspace", root);
  expect(snapshot.files).toHaveLength(1);
  expect(snapshot.files[0]).toMatchObject({
    path: destination,
    oldPath: source,
    oldContents: before,
    newContents: after,
    kind: "renamed",
    editable: true,
  });
  expect(await readFile(path.join(root, ".git/index"))).toEqual(index);
  expect((await execute("git", ["-C", root, "count-objects", "-v"])).stdout).toBe(objects.stdout);
  await service.viewed("workspace", snapshot.id, destination, true);
  expect((await service.snapshot("workspace", root)).files[0]!.viewed).toBe(true);
  await writeFile(path.join(root, destination), after + "// external edit\n");
  await expect(
    service.save("workspace", snapshot.id, destination, after + "draft\n"),
  ).rejects.toThrow("File changed");
  const changed = await service.snapshot("workspace", root);
  expect(changed.files[0]!.viewed).toBe(false);
  await service.save("workspace", changed.id, destination, after + "// saved\n");
  expect(await readFile(path.join(root, destination), "utf8")).toBe(after + "// saved\n");
  await expect(readFile(path.join(root, source))).rejects.toThrow();
  await expect(service.save("workspace", changed.id, source, "wrong path\n")).rejects.toThrow(
    "displayed snapshot",
  );
});

it("detects staged pure and empty renames, preserving mode changes", async () => {
  const { root, service } = await fixture();
  await writeFile(path.join(root, "script.sh"), "echo hello\n");
  await chmod(path.join(root, "script.sh"), 0o644);
  await writeFile(path.join(root, "empty"), "");
  await baseline(root);
  await rename(path.join(root, "script.sh"), path.join(root, "moved.sh"));
  await chmod(path.join(root, "moved.sh"), 0o755);
  await rename(path.join(root, "empty"), path.join(root, "moved-empty"));
  await execute("git", ["-C", root, "add", "--all"]);
  const snapshot = await service.snapshot("workspace", root);
  expect(snapshot.files).toHaveLength(2);
  expect(snapshot.files.find((file) => file.path === "moved.sh")).toMatchObject({
    oldPath: "script.sh",
    kind: "renamed",
    modeChange: "100644 → 100755",
    oldContents: "echo hello\n",
    newContents: "echo hello\n",
  });
  expect(snapshot.files.find((file) => file.path === "moved-empty")).toMatchObject({
    oldPath: "empty",
    kind: "renamed",
    oldContents: "",
    newContents: "",
  });
  await service.save("workspace", snapshot.id, "moved.sh", "echo edited\n");
  expect((await stat(path.join(root, "moved.sh"))).mode & 0o777).toBe(0o755);
});

it("keeps unrelated additions/deletions, copies and unsupported files separate", async () => {
  const { root, service } = await fixture();
  await writeFile(path.join(root, "removed.txt"), "original unique contents\n");
  await writeFile(path.join(root, "kept.txt"), "retained contents\n");
  await writeFile(path.join(root, "binary-old"), Buffer.from([0, 1, 2]));
  await baseline(root);
  await rm(path.join(root, "removed.txt"));
  await writeFile(path.join(root, "unrelated.txt"), "totally different text\n");
  await writeFile(path.join(root, "copy.txt"), "retained contents\n");
  await rename(path.join(root, "binary-old"), path.join(root, "binary-new"));
  const snapshot = await service.snapshot("workspace", root);
  expect(snapshot.files.every((file) => file.oldPath === null)).toBe(true);
  expect(snapshot.files.find((file) => file.path === "removed.txt")?.kind).toBe("deleted");
  expect(snapshot.files.find((file) => file.path === "copy.txt")?.kind).toBe("added");
  expect(
    snapshot.files
      .filter((file) => file.path.startsWith("binary"))
      .every((file) => !file.fingerprint),
  ).toBe(true);
});
it("persists exact displayed file versions, independent of another file and workspace", async () => {
  const { root, state, service } = await fixture();
  await writeFile(path.join(root, "one.ts"), "one\n");
  await writeFile(path.join(root, "two.ts"), "two\n");
  const first = await service.snapshot("workspace", root);
  await service.viewed("workspace", first.id, "one.ts", true);
  await writeFile(path.join(root, "two.ts"), "two changed\n");
  const restarted = new ReviewService(state);
  expect(
    (await restarted.snapshot("workspace", root)).files.find((f) => f.path === "one.ts")?.viewed,
  ).toBe(true);
  expect((await restarted.snapshot("other", root)).files.every((f) => !f.viewed)).toBe(true);
  await writeFile(path.join(root, "one.ts"), "agent edit\n");
  await service.viewed("workspace", first.id, "one.ts", true);
  expect(
    (await service.snapshot("workspace", root)).files.find((f) => f.path === "one.ts")?.viewed,
  ).toBe(false);
});
it("saves only the captured current file and detects external edits", async () => {
  const { root, service } = await fixture();
  const target = path.join(root, "é-[literal].ts");
  await writeFile(target, "before\n");
  const first = await service.snapshot("workspace", root);
  await writeFile(target, "external\n");
  await expect(service.save("workspace", first.id, "é-[literal].ts", "draft\n")).rejects.toThrow(
    "File changed",
  );
  expect(await readFile(target, "utf8")).toBe("external\n");
  const second = await service.snapshot("workspace", root);
  expect(await service.save("workspace", second.id, "é-[literal].ts", "saved\n")).toEqual({
    changed: true,
  });
  expect(await readFile(target, "utf8")).toBe("saved\n");
  await expect(service.save("workspace", second.id, "é-[literal].ts", "again\n")).rejects.toThrow();
  await expect(service.save("other", first.id, "é-[literal].ts", "bad\n")).rejects.toThrow();
  await expect(service.save("workspace", first.id, "../outside", "bad\n")).rejects.toThrow();
});
it("refuses symlinks, hard links, traversal, and Git metadata paths", async () => {
  const { root, service } = await fixture();
  const outside = path.join(path.dirname(root), "outside.txt");
  await writeFile(outside, "private\n");
  await symlink(outside, path.join(root, "symlink"));
  await link(outside, path.join(root, "hardlink"));
  await symlink(path.dirname(root), path.join(root, "linked-parent"));
  for (const relative of [
    "../outside.txt",
    "/tmp/outside",
    ".git/config",
    ".GIT/config",
    "a/../b",
    "linked-parent/outside.txt",
    "a\\b",
  ]) {
    await expect(validatePath(root, relative)).rejects.toThrow();
  }
  const snapshot = await service.snapshot("workspace", root);
  expect(snapshot.files.every((f) => !f.editable)).toBe(true);
  for (const file of snapshot.files)
    await expect(service.save("workspace", snapshot.id, file.path, "bad")).rejects.toThrow();
  expect(await readFile(outside, "utf8")).toBe("private\n");
});
it("handles unsupported encodings and oversized content without editable partial files", async () => {
  const { root, service } = await fixture();
  const contents = {
    binary: Buffer.from([0, 1]),
    invalid: Buffer.from([0xff, 0xfe]),
    crlf: Buffer.from("a\r\n"),
    bom: Buffer.from("\ufeffhello\n"),
    large: Buffer.alloc(MAX_FILE_BYTES + 1, 65),
  };
  for (const [name, value] of Object.entries(contents))
    await writeFile(path.join(root, name), value);
  const snapshot = await service.snapshot("workspace", root);
  expect(snapshot.files).toHaveLength(5);
  expect(snapshot.files.every((f) => !f.editable && f.reason)).toBe(true);
  expect(snapshot.files.find((f) => f.path === "large")?.newContents).toBeNull();
});

it("persists Viewed for unavailable files and invalidates same-size changes without capturing content", async () => {
  const { root, service } = await fixture();
  const target = path.join(root, "large.txt");
  await writeFile(target, Buffer.alloc(MAX_FILE_BYTES + 1, 65));
  await writeFile(path.join(root, "binary"), Buffer.from([0, 1]));
  const first = await service.snapshot("workspace", root);
  for (const file of first.files) {
    expect(file).toMatchObject({
      fingerprint: null,
      oldContents: null,
      newContents: null,
      editable: false,
    });
    expect(file.viewedFingerprint).toBeTypeOf("string");
    await service.viewed("workspace", first.id, file.path, true);
    await expect(service.save("workspace", first.id, file.path, "replacement")).rejects.toThrow();
  }
  expect((await service.snapshot("workspace", root)).files.every((file) => file.viewed)).toBe(true);
  await writeFile(target, Buffer.alloc(MAX_FILE_BYTES + 1, 66));
  // Acknowledge the old display, even though the file has already changed.
  await service.viewed("workspace", first.id, "large.txt", true);
  const changed = await service.snapshot("workspace", root);
  expect(changed.files.find((file) => file.path === "large.txt")).toMatchObject({
    viewed: false,
    newContents: null,
  });
  expect(changed.files.find((file) => file.path === "large.txt")!.viewedFingerprint).not.toBe(
    first.files.find((file) => file.path === "large.txt")!.viewedFingerprint,
  );
  expect(changed.files.find((file) => file.path === "binary")!.viewed).toBe(true);
  await service.viewed("workspace", changed.id, "large.txt", true);
  await service.viewed("workspace", changed.id, "large.txt", false);
  expect(
    (await service.snapshot("workspace", root)).files.find((file) => file.path === "large.txt")!
      .viewed,
  ).toBe(false);
});

it("invalidates unavailable Viewed state when the base blob changes", async () => {
  const { root, service } = await fixture();
  const target = path.join(root, "large.txt");
  await writeFile(target, Buffer.alloc(MAX_FILE_BYTES + 1, 65));
  await writeFile(path.join(root, "alternate.txt"), Buffer.alloc(MAX_FILE_BYTES + 1, 66));
  await baseline(root);
  await writeFile(target, "small current file\n");
  const first = await service.snapshot("workspace", root);
  expect(first.files[0]!.reason).toContain("Original file exceeds");
  await service.viewed("workspace", first.id, "large.txt", true);
  expect((await service.snapshot("workspace", root)).files[0]!.viewed).toBe(true);
  // Change only the base tree; leave the current file and its metadata untouched.
  const { stdout: blob } = await execute("git", ["-C", root, "rev-parse", "HEAD:alternate.txt"]);
  await execute("git", [
    "-C",
    root,
    "update-index",
    "--cacheinfo",
    `100644,${blob.trim()},large.txt`,
  ]);
  const { stdout: tree } = await execute("git", ["-C", root, "write-tree"]);
  await execute("git", ["-C", root, "update-ref", "refs/review-test/base", tree.trim()]);
  expect(
    (await service.snapshot("workspace", root)).files.find((file) => file.path === "large.txt")!
      .viewed,
  ).toBe(false);
});

it("allows Viewed for files omitted by the snapshot content budget", async () => {
  const { root, service } = await fixture();
  for (let i = 0; i < 17; i++)
    await writeFile(
      path.join(root, `file-${String(i).padStart(2, "0")}.txt`),
      Buffer.alloc(MAX_FILE_BYTES, 65),
    );
  const first = await service.snapshot("workspace", root);
  const omitted = first.files.at(-1)!;
  expect(omitted).toMatchObject({ fingerprint: null, oldContents: null, newContents: null });
  expect(omitted.reason).toContain("8 MiB");
  await service.viewed("workspace", first.id, omitted.path, true);
  expect((await service.snapshot("workspace", root)).files.at(-1)!.viewed).toBe(true);
});
it("serializes saves and rejects tokens after workspace relocation", async () => {
  const { root, service } = await fixture();
  const other = await fixture();
  await writeFile(path.join(root, "one.txt"), "original\n");
  const snapshot = await service.snapshot("workspace", root);
  await expect(
    service.save("workspace", snapshot.id, "one.txt", "wrong repository\n", other.root),
  ).rejects.toThrow("repository changed");
  const results = await Promise.allSettled([
    service.save("workspace", snapshot.id, "one.txt", "first\n", root),
    service.save("workspace", snapshot.id, "one.txt", "second\n", root),
  ]);
  expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
  expect(await readFile(path.join(root, "one.txt"), "utf8")).toBe("first\n");
});
it("detects permission changes and preserves the saved file mode", async () => {
  const { root, service } = await fixture();
  const target = path.join(root, "script.sh");
  await writeFile(target, "echo original\n");
  await chmod(target, 0o664);
  const first = await service.snapshot("workspace", root);
  await chmod(target, 0o775);
  await expect(service.save("workspace", first.id, "script.sh", "echo draft\n")).rejects.toThrow(
    "File changed",
  );
  const second = await service.snapshot("workspace", root);
  expect(second.files[0]!.fingerprint).not.toBe(first.files[0]!.fingerprint);
  await service.save("workspace", second.id, "script.sh", "echo saved\n");
  expect((await stat(target)).mode & 0o777).toBe(0o775);
});
it("rejects a parent replaced by a symlink after the displayed snapshot", async () => {
  const { root, service } = await fixture();
  const folder = path.join(root, "folder");
  const outside = path.join(path.dirname(root), "outside");
  await mkdir(folder);
  await mkdir(outside);
  await writeFile(path.join(folder, "one.txt"), "inside\n");
  await writeFile(path.join(outside, "one.txt"), "outside\n");
  const snapshot = await service.snapshot("workspace", root);
  await rename(folder, path.join(root, "moved"));
  await symlink(outside, folder);
  await expect(service.save("workspace", snapshot.id, "folder/one.txt", "draft\n")).rejects.toThrow(
    "Symlinked",
  );
  expect(await readFile(path.join(outside, "one.txt"), "utf8")).toBe("outside\n");
  expect(await readFile(path.join(root, "moved/one.txt"), "utf8")).toBe("inside\n");
});
