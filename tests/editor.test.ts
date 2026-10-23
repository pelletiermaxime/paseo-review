import { afterEach, expect, it } from "vite-plus/test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { launchEditor } from "../server/editor";
import { reviewSettings } from "../shared/settings";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

it("defaults to code and validates a single executable without preventing spaces in its path", () => {
  expect(reviewSettings.schema.parse({})).toEqual({ editorExecutable: "code" });
  expect(reviewSettings.schema.parse({ editorExecutable: " /opt/My Editor/bin/editor " })).toEqual({
    editorExecutable: "/opt/My Editor/bin/editor",
  });
  for (const editorExecutable of ["", "   ", "code\nother", "code\0other"])
    expect(reviewSettings.schema.safeParse({ editorExecutable }).success).toBe(false);
});

it.skipIf(process.platform === "win32")(
  "launches a configured executable with literal workspace/file arguments and the project cwd",
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review editor "));
    directories.push(root);
    const executable = path.join(root, "fake editor");
    const output = path.join(root, "args.json");
    const file = path.join(root, 'file $(touch SHOULD_NOT_EXIST); "é".ts');
    await writeFile(
      executable,
      `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(output)}, JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()}));\n`,
    );
    await chmod(executable, 0o755);
    await launchEditor(executable, root, file);
    await expect
      .poll(async () => JSON.parse(await readFile(output, "utf8")))
      .toEqual({
        args: [root, file],
        cwd: root,
      });
    await expect(readFile(path.join(root, "SHOULD_NOT_EXIST"))).rejects.toThrow();
  },
);

it("reports a missing executable without hanging or changing the configured command", async () => {
  await expect(
    launchEditor(path.join(tmpdir(), "missing-review-editor", "code"), tmpdir(), "file.ts"),
  ).rejects.toThrow("was not found. Configure it in Workspace Review settings.");
});
