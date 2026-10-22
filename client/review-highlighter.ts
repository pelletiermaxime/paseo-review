import { WorkerPoolManager } from "@pierre/diffs/worker";
import workerSource from "./diff-worker.generated.json";

/** One worker per panel; token results outlive virtualized file elements. */
export function createReviewHighlighter() {
  const url = URL.createObjectURL(new Blob([workerSource.source], { type: "text/javascript" }));
  const pool = new WorkerPoolManager(
    {
      poolSize: 1,
      totalASTLRUCacheSize: 20,
      workerFactory: () => new Worker(url),
    },
    { preferredHighlighter: "shiki-js" },
  );
  return {
    pool,
    dispose() {
      pool.terminate();
      URL.revokeObjectURL(url);
    },
  };
}
