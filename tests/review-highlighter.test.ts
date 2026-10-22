import { Worker as NodeWorker } from "node:worker_threads";
import {
  createSourceFile,
  forEachChild,
  isImportDeclaration,
  isCallExpression,
  ScriptTarget,
  SyntaxKind,
  type Node,
} from "typescript";
import { expect, it, vi } from "vite-plus/test";
import { parseDiffFromFile } from "@pierre/diffs";
import { WorkerPoolManager, type WorkerRequest } from "@pierre/diffs/worker";
import workerSource from "../client/diff-worker.generated.json";

it("bundles a worker without alternate engines or network imports", () => {
  expect(/function createOnigurumaEngine\b/.test(workerSource.source)).toBe(false);
  const imports: Node[] = [];
  const visit = (node: Node) => {
    if (
      isImportDeclaration(node) ||
      (isCallExpression(node) && node.expression.kind === SyntaxKind.ImportKeyword)
    )
      imports.push(node);
    forEachChild(node, visit);
  };
  visit(createSourceFile("worker.js", workerSource.source, ScriptTarget.Latest));
  expect(imports).toHaveLength(0);
  expect(workerSource.source.includes("WebAssembly.")).toBe(false);
});

it("highlights on a real background thread, reuses tokens across renderer cleanup and invalidates versions", async () => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
  const requests: WorkerRequest[] = [];
  const pool = new WorkerPoolManager(
    {
      poolSize: 1,
      totalASTLRUCacheSize: 2,
      workerFactory() {
        // Adapt the browser worker protocol to Node without mocking the highlighter.
        const worker = new NodeWorker(
          `
          const { parentPort } = require('node:worker_threads');
          globalThis.self = {
            addEventListener(type, callback) {
              if (type === 'message') parentPort.on('message', data => callback({ data }));
            },
          };
          globalThis.postMessage = data => parentPort.postMessage(data);
          ${workerSource.source}
        `,
          { eval: true },
        );
        return {
          addEventListener(type: string, callback: (event: unknown) => void) {
            if (type === "message") worker.on("message", (data) => callback({ data }));
            else if (type === "error")
              worker.on("error", (error) => callback({ error, message: error.message }));
          },
          postMessage(request: WorkerRequest) {
            requests.push(request);
            worker.postMessage(request);
          },
          terminate() {
            void worker.terminate();
          },
        } as unknown as Worker;
      },
    },
    { preferredHighlighter: "shiki-js", langs: ["typescript"] },
  );
  const diff = (version: string, contents: string) => {
    const result = parseDiffFromFile(null, { name: "file.ts", contents });
    result.cacheKey = `file.ts:${version}`;
    return result;
  };
  const first = diff("original", "const answer = 42;\n");
  const changed = diff("changed", "const changedAnswer = 43;\n");
  try {
    await pool.initialize();
    await pool.primeDiffHighlightCache(first);
    const cached = pool.getDiffResultCache(first);
    expect(cached?.result.code.additionLines).toHaveLength(1);
    expect(JSON.stringify(cached?.result)).toContain("answer");
    const renderer = { __id: "virtualized-file", onHighlightSuccess() {}, onHighlightError() {} };
    pool.cleanUpTasks(renderer);
    await pool.primeDiffHighlightCache(first);
    expect(pool.getDiffResultCache(first)).toBe(cached);
    expect(requests.filter((request) => request.type === "diff")).toHaveLength(1);
    await pool.primeDiffHighlightCache(changed);
    expect(JSON.stringify(pool.getDiffResultCache(changed)?.result)).toContain("changedAnswer");
    expect(requests.filter((request) => request.type === "diff")).toHaveLength(2);
    await pool.primeDiffHighlightCache(diff("third", "const third = 44;\n"));
    expect(pool.getDiffResultCache(first)).toBeUndefined();
    expect(pool.inspectCaches().diffCache.size).toBe(2);
    await pool.setRenderOptions({ lineDiffType: "none" });
    await pool.primeDiffHighlightCache(changed);
    expect(pool.getDiffResultCache(changed)?.options.lineDiffType).toBe("none");
  } finally {
    pool.terminate();
    await new Promise((resolve) => setTimeout(resolve, 5));
    vi.unstubAllGlobals();
  }
});
