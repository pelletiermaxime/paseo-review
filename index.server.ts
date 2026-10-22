import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import { homedir } from "node:os";
import path from "node:path";
import { saveRpc, snapshotRpc, viewedRpc } from "./shared/review";
import { ReviewService } from "./server/review-service";

export default function contribute(server: PluginServerContext) {
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
    service.snapshot(input.workspaceId, await directory(context, input.workspaceId)),
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
  return () => {};
}
