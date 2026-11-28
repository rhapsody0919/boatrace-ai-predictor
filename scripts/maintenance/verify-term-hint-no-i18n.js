#!/usr/bin/env node
/**
 * 「?」の部品（src/components/race/TermHintButton.jsx）が、i18n の初期化の外（react-i18next の既定。検査の静的な描画）でも
 * 例外を出さず、何も描かないことの検査。i18n がある時は、訳のある用語だけ「?」を出す（今までと同じ）
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const i18nOf = { bare: "export const useTranslation = () => ({ t: (k) => k, i18n: {} });",
  ready: "export const useTranslation = () => ({ t: (k) => k, i18n: { exists: (k) => k === 'termHints.motor' } });" };
async function hintWith(kind) {
  const out = await build({
    entryPoints: [path.join(here, "../../src/components/race/TermHintButton.jsx")], bundle: true, write: false, format: "cjs",
    platform: "node", packages: "external", jsx: "automatic",
    plugins: [{ name: "i18n", setup(b) {
      b.onResolve({ filter: /^react-i18next$|\.css$/ }, (a) => ({ path: a.path, namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({ loader: "js", contents: a.path === "react-i18next" ? i18nOf[kind] : "" }));
    } }],
  });
  const mod = { exports: {} };
  new Function("require", "module", "exports", out.outputFiles[0].text)(createRequire(import.meta.url), mod, mod.exports);
  return mod.exports.default;
}

const errors = [];
const draw = (C, termKey) => { try { return renderToStaticMarkup(createElement(C, { termKey })); } catch (e) { return `例外: ${e.message}`; } };
const bare = await hintWith("bare");
if (draw(bare, "motor") !== "") errors.push(`i18n の外では何も描かない（実際: ${draw(bare, "motor")}）`);
const ready = await hintWith("ready");
if (!draw(ready, "motor").includes("term-hint__button")) errors.push("訳のある用語は「?」を出す");
if (draw(ready, "nothing") !== "") errors.push("訳の無い用語は「?」を出さない");
if (errors.length > 0) {
  console.error(`verify-term-hint-no-i18n: NG\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
console.log("verify-term-hint-no-i18n: OK");
