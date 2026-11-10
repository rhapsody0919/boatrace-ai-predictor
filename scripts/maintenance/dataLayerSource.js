/**
 * dataLayerSource.js — verify が「データ層（画面のサービス層）の本文」を読むときの読み先。
 *
 * データ層は src/services/supabaseDataService.js と、そこから分けた core*.js・*Queries*.js の和。
 * 分けた後も verify が同じ字を照らせるよう、名前の順に `\n` で連結して返す。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const servicesDir = path.join(repoRoot, "src/services");
const MAIN = "supabaseDataService.js";

/** データ層のファイルの相対パス（repo 根から）を名前の順に返す。 */
export function dataLayerPaths() {
  const names = readdirSync(servicesDir)
    .filter((n) => n === MAIN || (/\.js$/.test(n) && (/^core/.test(n) || /Queries/.test(n))))
    .filter((n) => existsSync(path.join(servicesDir, n)))
    .sort();
  return names.map((n) => `src/services/${n}`);
}

/** データ層の全ファイルの本文を `\n` で連結した字。 */
export function readDataLayerSource() {
  return dataLayerPaths()
    .map((rel) => readFileSync(path.join(repoRoot, rel), "utf8"))
    .join("\n");
}
