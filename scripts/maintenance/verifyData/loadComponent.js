/**
 * 画面の部品（JSX）を esbuild で束ねて Node で読み、既定の export を返す（verify の静的な描画の検査で使う）。
 * react-i18next は鍵をそのまま返す t に差し替える。DB にも画面にも触れない
 */
import { createRequire } from "node:module";
import { build as bundle } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const requireHere = createRequire(import.meta.url);

// react-i18next の代わり（t は鍵をそのまま返す）
const I18N_SOURCE = [
  "export const useTranslation = () => ({",
  "  t: (k) => k,",
  "  i18n: { resolvedLanguage: 'ja' },",
  "});",
].join("\n");
const I18N_NS = "verify-i18n";

/** @type {import("esbuild").Plugin} */
const stubI18n = {
  name: "verify-i18n-stub",
  setup: (b) => {
    b.onResolve({ filter: /^react-i18next$/ }, (args) => ({
      path: args.path,
      namespace: I18N_NS,
    }));
    b.onLoad({ filter: /.*/, namespace: I18N_NS }, () => ({
      contents: I18N_SOURCE,
      loader: "js",
    }));
  },
};

/** @param {string} entry リポジトリの根からの部品のパス */
export async function loadComponent(entry) {
  const result = await bundle({
    entryPoints: [path.join(ROOT, entry)],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    packages: "external",
    plugins: [stubI18n],
  });
  const mod = { exports: {} };
  const run = new Function(
    "require",
    "module",
    "exports",
    result.outputFiles[0].text,
  );
  run(requireHere, mod, mod.exports);
  return mod.exports.default;
}
