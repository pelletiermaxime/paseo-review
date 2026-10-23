import { spawnProcess } from "@getpaseo/plugin/server";

export async function launchEditor(executable: string, root: string, file: string) {
  await new Promise<void>((resolve, reject) => {
    // Paths remain separate arguments; the SDK handles platform launchers.
    // Do not wait for a GUI editor to close.
    const child = spawnProcess(executable, [root, file], {
      cwd: root,
      detached: true,
      stdio: "ignore",
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      reject(
        new Error(
          error.code === "ENOENT"
            ? `Editor executable "${executable}" was not found. Configure it in Workspace Review settings.`
            : `Could not launch editor "${executable}": ${error.message}`,
        ),
      );
    });
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
