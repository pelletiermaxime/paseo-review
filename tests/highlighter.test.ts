import { expect, it } from "vite-plus/test";
import { getSharedHighlighter } from "@pierre/diffs";

it("highlights with both default theme variants and preserves diverse language grammars", async () => {
  const highlighter = await getSharedHighlighter({
    themes: ["pierre-dark", "pierre-light"],
    langs: ["typescript", "php", "rust", "emacs-lisp"],
    preferredHighlighter: "shiki-js",
  });
  expect(highlighter.getLoadedThemes().sort()).toEqual(["pierre-dark", "pierre-light"]);
  for (const lang of ["typescript", "php", "rust", "emacs-lisp"] as const) {
    const dark = highlighter.codeToTokens("answer = 42", { lang, theme: "pierre-dark" });
    const light = highlighter.codeToTokens("answer = 42", { lang, theme: "pierre-light" });
    expect(dark.tokens.flat().length).toBeGreaterThan(0);
    expect(light.tokens.flat().length).toBeGreaterThan(0);
    expect(dark.bg).not.toBe(light.bg);
  }
});
