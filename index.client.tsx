import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ReviewPanel } from "./client/review-panel";

export default function contribute(client: PluginClientContext) {
  const removePanel = client.addWorkspacePanel({
    id: "review",
    title: "Workspace Review",
    icon: "GitCompareArrows",
    context: "workspace",
    locations: ["workspace"],
    Component: ReviewPanel,
  });
  const removeCommand = client.addCommandCenterItem({
    id: "open-review",
    title: "Open Workspace Review",
    icon: "GitCompareArrows",
    context: "workspace",
    onSelect: (context) => context.openPanel("review"),
  });
  return async () => {
    await removeCommand();
    await removePanel();
  };
}
