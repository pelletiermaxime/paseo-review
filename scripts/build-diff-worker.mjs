import { readFileSync, writeFileSync } from "node:fs";
const workerPath = new URL(import.meta.resolve("@pierre/diffs/worker/worker-portable.js"));
if (JSON.parse(readFileSync(new URL("../../package.json", workerPath), "utf8")).version !== "1.5.2")
  throw new Error("Review the worker build when upgrading @pierre/diffs.");
let source = readFileSync(workerPath, "utf8");
const start = source.indexOf("//#region ../../node_modules/.pnpm/@shikijs+engine-oniguruma@");
const endMarker = "__reExport(/* @__PURE__ */ __exportAll({}), dist_exports);\n";
const end = source.indexOf(endMarker, start);
const engine =
  'preferredHighlighter === "shiki-wasm" ? createOnigurumaEngine(import("./wasm-B9ZqxnKj.js")) : createJavaScriptRegexEngine()';
if (start < 0 || end < 0 || !source.includes(engine))
  throw new Error(
    "The pinned Pierre worker changed. Review the JavaScript-only build before updating it.",
  );
source = source.slice(0, start) + source.slice(end + endMarker.length);
source = source.replace(engine, "createJavaScriptRegexEngine()");
source = source.replace(/\n\/\/# sourceMappingURL=.*$/, "");
const output =
  JSON.stringify(
    {
      notice:
        "Generated from @pierre/diffs 1.5.2 (Apache-2.0). Modified to remove the unused Oniguruma engine. Regenerate with vp run build:worker. Includes third-party MIT/BSD components; see THIRD_PARTY_NOTICES.md and LICENSES/ for licenses and attribution.",
      source,
    },
    null,
    2,
  ) + "\n";
const target = new URL("../client/diff-worker.generated.json", import.meta.url);
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== output)
    throw new Error("Run vp run build:worker to update the bundled worker.");
} else writeFileSync(target, output);
