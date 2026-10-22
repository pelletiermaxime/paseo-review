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
