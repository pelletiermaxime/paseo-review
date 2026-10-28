import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import { homedir } from "node:os";
import path from "node:path";
import { openEditorRpc, saveRpc, snapshotRpc, viewedRpc } from "./shared/review";
import { reviewSettings } from "./shared/settings";
import { launchEditor } from "./server/editor";
import { ReviewService } from "./server/review-service";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(reviewSettings);
  const service = new ReviewService(
    path.join(
      process.env.PASEO_HOME ?? path.join(homedir(), ".paseo"),
      "plugin-data",
      "workspace-review",
    ),
  );
  async function directory(context: PluginHandlerContext, workspaceId: string) {
    const workspace = context.paseo.workspaces.ref(workspaceId);
    await workspace.refresh();
    if (!workspace.directory) throw new Error("Workspace is unavailable.");
    return workspace.directory;
  }
  server.handle(snapshotRpc, async (input, context) =>
    service.snapshot(
      input.workspaceId,
      await directory(context, input.workspaceId),
      input.comparison,
      input.baseRef,
    ),
  );
  server.handle(viewedRpc, (input) =>
    service.viewed(input.workspaceId, input.snapshotId, input.path, input.viewed),
  );
  server.handle(saveRpc, async (input, context) => {
    const currentDirectory = await directory(context, input.workspaceId);
    return service.save(
      input.workspaceId,
      input.snapshotId,
      input.path,
      input.contents,
      currentDirectory,
    );
  });
  server.handle(openEditorRpc, async (input, context) => {
    const target = await service.editorTarget(
      input.workspaceId,
      input.snapshotId,
      input.path,
      await directory(context, input.workspaceId),
    );
    const current = await settings.read();
    if (current.status !== "ready") throw new Error(current.error);
    await launchEditor(current.values.editorExecutable, target.root, target.file);
    return { launched: true };
  });
  return () => {};
}
