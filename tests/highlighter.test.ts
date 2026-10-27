import { expect, it } from "vite-plus/test";
import { getSharedHighlighter } from "@pierre/diffs";

it("colors supported languages with both default theme variants and preserves their text", async () => {
  const highlighter = await getSharedHighlighter({
    themes: ["pierre-dark", "pierre-light"],
    langs: [],
    preferredHighlighter: "highlights",
  });
  expect(highlighter.name).toBe("highlights");
  const samples = {
    typescript: "export const answer = 42;",
    php: "<?php $answer = 42;",
    rust: "fn main() { let answer = 42; }",
    "emacs-lisp": "(defun answer () 42)",
    vue: "<template><div>{{ answer }}</div></template>",
  } as const;
  for (const [lang, code] of Object.entries(samples)) {
    const dark = highlighter.codeToTokens(code, { lang, theme: "pierre-dark" });
    const light = highlighter.codeToTokens(code, { lang, theme: "pierre-light" });
    for (const result of [dark, light]) {
      expect(
        result.tokens
          .flat()
          .map((token) => token.content)
          .join(""),
      ).toBe(code);
      expect(new Set(result.tokens.flat().map((token) => token.color)).size).toBeGreaterThan(1);
    }
    expect(dark.bg).not.toBe(light.bg);
  }
});

it("preserves unsupported languages as plain text", async () => {
  const highlighter = await getSharedHighlighter({
    themes: ["pierre-dark"],
    langs: [],
    preferredHighlighter: "highlights",
  });
  const code = "@if($answer) <div>answer</div> @endif";
  const result = highlighter.codeToTokens(code, { lang: "blade", theme: "pierre-dark" });
  expect(
    result.tokens
      .flat()
      .map((token) => token.content)
      .join(""),
  ).toBe(code);
  expect(new Set(result.tokens.flat().map((token) => token.color)).size).toBe(1);
});
