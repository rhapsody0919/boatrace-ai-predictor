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

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * データ層のメソッド name の本文を、殻のメソッドか移した関数かの形によらず切り出す。
 * - 殻のメソッド: 行頭の `  name(`・`  async name(` から、次の `\n  },\n` の前まで（旧の verify の切り出しと同じ字）
 * - 移した関数: 行頭の `export function name(`・`export async function name(` から、次の `\n  }\n` の前まで
 *   （split-data-layer.mjs は本体の字下げを変えないので、閉じ括弧は字下げ2のまま。殻から移したメソッドだけが対象で、
 *   元から上にある関数（閉じ括弧が字下げ0）は対象外）
 * until（任意、字か正規表現）: 殻のメソッドの形のとき、終わりを `\n  },\n` でなく頭より後の最初の until の前にする。
 *   旧の verify が「次のメソッドの頭まで」を切っていた所で、master の字を変えないため。移した関数の形では使わない
 *   （ファイルと並びが変わり、次のメソッドが隣にいないため）
 * 見つからない・終わりが無いときは ""。両方の形にあるときは Error（どちらを照らすか決められない。殻は移した
 * メソッドを `  name,` で持つだけなので、正しく移した木では起きない）。
 */
export function dataLayerMethod(name, source = readDataLayerSource(), { until } = {}) {
  const n = escapeRe(name);
  const method = new RegExp(`^  (?:async )?${n}\\(`, "m").exec(source);
  const fn = new RegExp(`^export (?:async )?function ${n}\\(`, "m").exec(source);
  if (method && fn) {
    throw new Error(`dataLayerMethod: ${name} が殻のメソッドと移した関数の両方にある`);
  }
  if (!method && !fn) return "";
  const start = (method ?? fn).index;
  let end;
  if (fn) end = source.indexOf("\n  }\n", start);
  else if (until instanceof RegExp) {
    const at = source.slice(start).search(until);
    end = at < 0 ? -1 : start + at;
  } else end = source.indexOf(until ?? "\n  },\n", start);
  return end > start ? source.slice(start, end) : "";
}

/**
 * データ層の `import { a, b } from "<from>";` の文が持つ名前を、文の分かれ方によらず名前の順で返す（重なりは1つ）。
 * 移すと1つの import の文がファイルごとに要る名前だけに分かれるため、文の並びでなく名前の集まりで照らす。
 * `a as b` は字のまま返す（照らす側の名前と合わないので、別名にしたら落ちる）。
 */
export function dataLayerImportNames(from, source = readDataLayerSource()) {
  const re = new RegExp(`import \\{([^}]*)\\} from "${escapeRe(from)}";`, "g");
  const names = [...source.matchAll(re)].flatMap((m) =>
    m[1].split(",").map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean),
  );
  return [...new Set(names)].sort();
}
