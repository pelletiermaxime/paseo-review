import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc, useTabState } from "@getpaseo/plugin/client";
import { useEffect, useRef, useState } from "react";
import { Platform, Text, View } from "react-native";
import { openEditorRpc, saveRpc, snapshotRpc, viewedRpc } from "../shared/review";
import { defaultReviewTabState, reviewHasDrafts, reviewTabSchema } from "./review-state";
import { listFeedbackAgents, sendFeedback } from "./review-comments";

export function ReviewPanel({ theme, layout, workspaceId, host, tab }: PluginWorkspacePanelProps) {
  const container = useRef<View>(null);
  const [error, setError] = useState<string>();
  const snapshot = useRpc(snapshotRpc);
  const viewed = useRpc(viewedRpc);
  const save = useRpc(saveRpc);
  const openEditor = useRpc(openEditorRpc);
  const paseo = usePaseo();
  const [state, setState] = useTabState(tab, reviewTabSchema, defaultReviewTabState);
  const initialState = useRef(state);
  initialState.current = state;
  const callbacks = useRef({ snapshot, viewed, save, openEditor, theme, paseo, setState, tab });
  callbacks.current = { snapshot, viewed, save, openEditor, theme, paseo, setState, tab };
  const modified = reviewHasDrafts(state);
  useEffect(() => tab.setModified(modified), [tab, modified]);

  const web = layout.platform === "web" && Platform.OS === "web";
  useEffect(() => {
    if (!web) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void import("./review-browser")
      .then(async ({ mountReview }) => {
        if (disposed) return;
        const element = container.current as unknown as HTMLElement | null;
        if (!element || typeof element.appendChild !== "function")
          throw new Error("Paseo did not supply a browser DOM container.");
        cleanup = await mountReview(element, {
          state: initialState.current,
          onStateChange: (next) => {
            callbacks.current.setState(next);
            callbacks.current.tab.setModified(reviewHasDrafts(next));
          },
          colors: callbacks.current.theme.colors,
          snapshot: () => callbacks.current.snapshot({ workspaceId }),
          viewed: (snapshotId, path, value) =>
            callbacks.current.viewed({ workspaceId, snapshotId, path, viewed: value }),
          save: (snapshotId, path, contents) =>
            callbacks.current.save({ workspaceId, snapshotId, path, contents }),
          openEditor: (snapshotId, path) =>
            callbacks.current.openEditor({ workspaceId, snapshotId, path }),
          agents: () => listFeedbackAgents(callbacks.current.paseo, workspaceId),
          send: (agentId, attachment) =>
            sendFeedback(callbacks.current.paseo, workspaceId, agentId, attachment),
        });
        if (disposed) cleanup();
      })
      .catch((cause: unknown) => {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [web, host.id, workspaceId]);
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      {!web || error ? (
        <Text style={{ padding: 20, color: theme.colors.foreground }}>
          {error
            ? `Workspace Review could not load: ${error}`
            : "Workspace Review rendering currently requires Paseo desktop or web."}
        </Text>
      ) : (
        <View ref={container} testID="diff-review" style={{ flex: 1, minHeight: 240 }} />
      )}
    </View>
  );
}
