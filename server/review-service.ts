import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import type { ReviewSnapshot } from "../shared/review";
import { capture, hash, repositoryRoot, saveFile, validatePath } from "./repository";
import type { CapturedFile } from "./repository";

const stateSchema = z.record(z.string(), z.string());
interface Session {
  workspaceId: string;
  root: string;
  expires: number;
  files: Map<string, CapturedFile>;
}
export class ReviewService {
  private sessions = new Map<string, Session>();
  private writes: Promise<unknown> = Promise.resolve();
  private saves: Promise<unknown> = Promise.resolve();
  constructor(private stateDirectory: string) {}
  private async state(): Promise<Record<string, string>> {
    try {
      return stateSchema.parse(
        JSON.parse(await readFile(path.join(this.stateDirectory, "viewed.json"), "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw new Error(
        "Viewed state cannot be read. Repair or restore viewed.json before continuing.",
      );
    }
  }
  private key(workspaceId: string, root: string, relative: string) {
    return hash(JSON.stringify([workspaceId, root, "head-worktree", relative]));
  }
  async snapshot(workspaceId: string, directory: string): Promise<ReviewSnapshot> {
    const root = await repositoryRoot(directory);
    const { files, warning } = await capture(root);
    await this.writes.catch(() => {});
    const state = await this.state();
    for (const { file } of files)
      file.viewed =
        file.fingerprint !== null &&
        state[this.key(workspaceId, root, file.path)] === file.fingerprint;
    // Bound retained snapshots, including the original bytes used for conflicts.
    for (const [id, session] of this.sessions)
      if (session.expires < Date.now()) this.sessions.delete(id);
    while (this.sessions.size >= 8) this.sessions.delete(this.sessions.keys().next().value!);
    const id = randomUUID();
    this.sessions.set(id, {
      workspaceId,
      root,
      expires: Date.now() + 60 * 60_000,
      files: new Map(files.map((file) => [file.file.path, file])),
    });
    return {
      id,
      root,
      comparison: "head-worktree",
      files: files.map((file) => file.file),
      warning,
    };
  }
  private displayed(workspaceId: string, snapshotId: string, relative: string) {
    const session = this.sessions.get(snapshotId);
    if (!session || session.workspaceId !== workspaceId || session.expires < Date.now())
      throw new Error(
        "Displayed snapshot expired. Your draft is kept; cancel and refresh to load a new snapshot.",
      );
    const file = session.files.get(relative);
    if (!file) throw new Error("File does not belong to the displayed snapshot.");
    return { session, file };
  }
  async viewed(workspaceId: string, snapshotId: string, relative: string, viewed: boolean) {
    const { session, file } = this.displayed(workspaceId, snapshotId, relative);
    if (!file.file.fingerprint) throw new Error("Unsupported files cannot be marked Viewed.");
    const key = this.key(workspaceId, session.root, relative);
    const fingerprint = file.file.fingerprint;
    const operation = this.writes
      .catch(() => {})
      .then(async () => {
        const state = await this.state();
        if (viewed) state[key] = fingerprint;
        else delete state[key];
        await mkdir(this.stateDirectory, { recursive: true, mode: 0o700 });
        const temporary = path.join(this.stateDirectory, `viewed-${randomUUID()}.tmp`);
        await writeFile(temporary, JSON.stringify(state) + "\n", { mode: 0o600, flag: "wx" });
        await rename(temporary, path.join(this.stateDirectory, "viewed.json"));
      });
    this.writes = operation;
    await operation;
    return { viewed };
  }
  async save(
    workspaceId: string,
    snapshotId: string,
    relative: string,
    contents: string,
    directory?: string,
  ) {
    const operation = this.saves
      .catch(() => {})
      .then(() => this.saveCaptured(workspaceId, snapshotId, relative, contents, directory));
    this.saves = operation;
    return operation;
  }

  async editorTarget(workspaceId: string, snapshotId: string, relative: string, directory: string) {
    const { session, file } = this.displayed(workspaceId, snapshotId, relative);
    if ((await repositoryRoot(directory)) !== session.root)
      throw new Error("Workspace repository changed. Refresh before opening the editor.");
    if (file.file.kind === "deleted") throw new Error("Deleted files cannot be opened.");
    const target = await validatePath(session.root, relative);
    const stat = await lstat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") throw new Error("File no longer exists. Refresh the review.");
      throw error;
    });
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
      throw new Error("Only regular files with no symlinks or hard links can be opened.");
    return { root: session.root, file: target };
  }

  private async saveCaptured(
    workspaceId: string,
    snapshotId: string,
    relative: string,
    contents: string,
    directory?: string,
  ) {
    const { session, file } = this.displayed(workspaceId, snapshotId, relative);
    if (directory && (await repositoryRoot(directory)) !== session.root)
      throw new Error("Workspace repository changed. Your draft is kept.");
    if (!file.file.editable || !file.disk)
      throw new Error(file.file.reason ?? "This file is read-only.");
    const changed = await saveFile(session.root, relative, file.disk, contents);
    if (changed) {
      // A content fingerprint naturally invalidates the old marker on refresh.
      // Make this save token single-use so repeated clicks cannot overwrite edits.
      file.file.editable = false;
      file.disk = null;
    }
    return { changed };
  }
}
