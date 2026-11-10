/**
 * dataLayerSource.js — verify が「データ層（画面のサービス層）の本文」を読むときの読み先。
 *
 * データ層は src/services/supabaseDataService.js と、そこから分けた core*.js・*Queries*.js の和。
 * 分けた後も verify が同じ字を照らせるよう、名前の順に `\n` で連結して返す。
 * メソッドの切り出し（dataLayerMethod）と呼び出しの字（dataLayerCall）は構文木で形（殻のメソッドか
 * scripts/maintenance/split-data-layer.mjs が移した関数か）を見分ける。
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseModule } from "./splitDataLayer/ast.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const servicesDir = path.join(repoRoot, "src/services");
const MAIN = "supabaseDataService.js";

/** データ層のファイルの相対パス（repo 根から）を名前の順に返す。 */
export function dataLayerPaths() {
  const names = readdirSync(servicesDir)
    .filter((n) => n === MAIN || /^core\d*\.js$/.test(n) || /^[A-Za-z]+Queries\d*\.js$/.test(n))
    .sort();
  return names.map((n) => `src/services/${n}`);
}

const readFiles = () =>
  dataLayerPaths().map((rel) => readFileSync(path.join(repoRoot, rel), "utf8"));

/** データ層の全ファイルの本文を `\n` で連結した字。 */
export function readDataLayerSource() {
  return readFiles().join("\n");
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// 構文木は1回の実行の中で使い回す（verify がメソッドごとに呼ぶため）。字が変わったら読み直す
let parsedCache = null;
function parsedDataLayer() {
  const texts = readFiles();
  const source = texts.join("\n");
  if (parsedCache?.source === source) return parsedCache;
  let offset = 0;
  const files = texts.map((text) => {
    const file = { offset, program: parseModule(text).program };
    offset += text.length + 1;
    return file;
  });
  parsedCache = { source, files };
  return parsedCache;
}

const keyName = (key) => key?.name ?? key?.value;

/**
 * name の宣言を2つの形で探す。範囲は連結した字（readDataLayerSource）の中の位置。
 * - method: 上の変数の宣言の object（殻の supabaseDataService）のメソッド name
 * - fn: `export function name(`・`export async function name(` の関数の宣言
 */
function findDeclarations(name) {
  const { source, files } = parsedDataLayer();
  const method = [];
  const fn = [];
  for (const { offset, program } of files) {
    for (const stmt of program.body) {
      const exported = stmt.type === "ExportNamedDeclaration";
      const decl = exported ? stmt.declaration : stmt;
      if (!decl) continue;
      if (exported && decl.type === "FunctionDeclaration" && decl.id?.name === name) {
        fn.push({ start: offset + decl.start, end: offset + decl.end });
      }
      if (decl.type !== "VariableDeclaration") continue;
      for (const d of decl.declarations) {
        if (d.init?.type !== "ObjectExpression") continue;
        for (const p of d.init.properties) {
          if (p.type === "ObjectMethod" && p.kind === "method" && keyName(p.key) === name) {
            method.push({ start: offset + p.start, end: offset + p.end });
          }
        }
      }
    }
  }
  return { source, method, fn };
}

/**
 * データ層のメソッド name の本文を、殻のメソッドか移した関数かの形によらず切り出す。
 * until は殻のメソッドの形だけで使う（移した関数の形では無視）。
 * 範囲は構文木の宣言（殻の object のメソッド、または export 付きの関数の宣言）で決める:
 * - 頭: 宣言の行の頭（`  async name(`・`export function name(` の行の先頭。前の注釈は含まない）
 * - 終わり: 閉じの `}` の行の前の `\n`（殻の形では旧の verify の indexOf("\n  },\n") と同じ位置）
 * until（任意、字か正規表現）: 殻のメソッドの形のとき、終わりを頭より後の最初の until の前にする。
 *   旧の verify が「次のメソッドの頭まで」を切っていた所で、master の字を変えないため。移した関数の形では
 *   ファイルと並びが変わり次のメソッドが隣にいないので使わない
 * 見つからない・until が無いときは ""。両方の形にある・同じ形に2つあるときは Error（どれを照らすか決められない。
 * 殻は移したメソッドを `  name,` で持つだけなので、正しく移した木では起きない）。
 */
export function dataLayerMethod(name, { until } = {}) {
  const { source, method, fn } = findDeclarations(name);
  if (method.length + fn.length > 1) {
    throw new Error(
      `dataLayerMethod: ${name} の宣言が ${method.length + fn.length} 個（殻のメソッド ${method.length}・移した関数 ${fn.length}）`,
    );
  }
  const found = method[0] ?? fn[0];
  if (!found) return "";
  const start = source.lastIndexOf("\n", found.start - 1) + 1;
  let end = source.lastIndexOf("\n", found.end - 1);
  if (method[0] && until !== undefined) {
    if (until instanceof RegExp) {
      const at = source.slice(start).search(until);
      end = at < 0 ? -1 : start + at;
    } else end = source.indexOf(until, start);
  }
  return end > start ? source.slice(start, end) : "";
}

/**
 * 呼び出し `name(` を照らす正規表現の字（後ろに引数の照合を続けて使う）。殻にメソッド name がある木では
 * 旧のまま `this\.name\(`、移した後（殻にメソッドが無い）は前が識別子・`.` でない `name\(`。
 */
export function dataLayerCall(name) {
  const n = escapeRe(name);
  return findDeclarations(name).method.length > 0 ? `this\\.${n}\\(` : `(?<![\\w$.])${n}\\(`;
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
