import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import vesper from "shiki/themes/vesper.mjs";
import json from "shiki/langs/json.mjs";
import bash from "shiki/langs/bash.mjs";

// Fine-grained imports + the JS regex engine keep the bundle tiny:
// only these grammars ship, and no oniguruma wasm is loaded.
const LANGS = ["json", "bash"] as const;

let instance: HighlighterCore | null = null;
let pending: Promise<HighlighterCore> | null = null;

export async function getHighlighter(): Promise<HighlighterCore> {
  if (instance) return instance;
  if (!pending) {
    pending = createHighlighterCore({
      themes: [vesper],
      langs: [json, bash],
      engine: createJavaScriptRegexEngine(),
    }).then((h) => {
      instance = h;
      return h;
    });
  }
  return pending;
}

export async function highlight(code: string, lang: string): Promise<string> {
  const h = await getHighlighter();
  const safeLang = (LANGS as readonly string[]).includes(lang) ? lang : "json";
  return h.codeToHtml(code.trimEnd(), { lang: safeLang, theme: "vesper" });
}
