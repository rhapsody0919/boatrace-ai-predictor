/**
 * ADRへの参照が実在するADRを指しているかを検知する（BOA-572）。
 *
 * 背景: ADR番号の重複解消（verify-adr-numbers.js）でADRをリネームした際、
 * コード・設計書側の参照が更新されず、存在しないファイル
 * （docs/adr/0043-racer-grade-win-rate-cache-strategy.md）や
 * 別件のADR番号（ADR-0024 → 本来は0050）を指したまま残っていた。
 *
 * 確かめること:
 *   1. ファイル参照: `adr/NNNN-xxx.md` の形（docs/adr/… や ../adr/… を含む）が、
 *      docs/adr/ に実在するファイル名と完全一致すること。
 *      docs/adr/ 内の相対リンク `(./)NNNN-xxx.md` も同じく照合する
 *   2. 番号参照: `ADR-NNNN` / `ADR NNNN` / `ADRNNNN` の番号が docs/adr/ に存在すること
 *
 * 確かめないこと（機械では判定できない）:
 *   - 番号が実在する別件のADRを指している誤り（例: 0050のつもりで0024と書いた）。
 *     番号だけの参照は「存在する」ことしか分からない
 *
 * 対象: git 管理下のテキストファイル（node_modules・未追跡の生成物は自然に外れる）。
 * 対象外は EXCLUDED_PREFIXES とその理由を参照。
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const ADR_DIR = "docs/adr";

/** [前方一致するパス, 対象外にする理由] */
const EXCLUDED_PREFIXES = [
  [
    "docs/archive/",
    "廃案・古い資料の保管場所。書かれた時点の番号のまま凍結しておく",
  ],
  [
    "data/",
    "分析結果・スナップショット等の出力データ。ADRを参照する文書ではない",
  ],
  [
    "scripts/maintenance/verify-adr-references.js",
    "本スクリプト自身。誤参照の例を説明文に含むため",
  ],
];

const ADR_FILE_RE = /^\d{4}-.+\.md$/;
// 直前が英数字・_ でない `adr/NNNN-xxx.md`（docs/adr/… や ../adr/… を含む）
const FILE_REF_RE = /(?<![\w])adr\/(\d{4}-[\w.-]*?\.md)/g;
// docs/adr/ 内のMarkdownリンクで、ディレクトリを付けずに書かれたもの
const RELATIVE_LINK_RE = /\]\((?:\.\/)?(\d{4}-[\w.-]*?\.md)(?:#[^)]*)?\)/g;
const NUMBER_REF_RE = /(?<![\w])ADR[- ]?(\d{4})(?!\d)/g;

const isExcluded = (file) =>
  EXCLUDED_PREFIXES.some(([prefix]) => file.startsWith(prefix));

const trackedFiles = () =>
  execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);

/** バイナリらしいもの（NULバイトを含む）は読まない */
const readText = (file) => {
  const buf = readFileSync(path.join(ROOT, file));
  return buf.includes(0) ? null : buf.toString("utf8");
};

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

/** 1ファイル分の問題を返す（純関数） */
export function findProblems(file, text, adrFiles, adrNumbers) {
  const problems = [];
  const report = (index, message) =>
    problems.push(`${file}:${lineOf(text, index)}: ${message}`);

  for (const m of text.matchAll(FILE_REF_RE)) {
    if (!adrFiles.has(m[1])) {
      report(m.index, `存在しないADRファイル adr/${m[1]}`);
    }
  }
  if (file.startsWith(`${ADR_DIR}/`)) {
    for (const m of text.matchAll(RELATIVE_LINK_RE)) {
      if (!adrFiles.has(m[1])) {
        report(m.index, `存在しないADRファイルへの相対リンク ${m[1]}`);
      }
    }
  }
  for (const m of text.matchAll(NUMBER_REF_RE)) {
    if (!adrNumbers.has(m[1])) {
      report(m.index, `存在しないADR番号 ${m[0]}`);
    }
  }
  return problems;
}

/**
 * 検出ロジックが空振りしていないかを合成データで確かめる。
 * 正規表現が壊れて何も拾わなくなると、本体の実行は常に「OK」になるため
 */
function selfCheck() {
  const files = new Set(["0052-racer-grade.md"]);
  const numbers = new Set(["0052"]);
  const cases = [
    ["src/a.js", "// docs/adr/0043-racer-grade.md", 1],
    ["docs/x.md", "[x](../adr/0043-racer-grade.md)", 1],
    ["docs/adr/0001-a.md", "[x](./0043-racer-grade.md)", 1],
    ["docs/x.md", "（ADR-0099）と ADR 0098 と ADR0097", 3],
    ["docs/x.md", "docs/adr/0052-racer-grade.md と ADR-0052", 0],
    ["docs/x.md", "[x](0043-racer-grade.md) はADR外なので見ない", 0],
  ];
  for (const [file, text, expected] of cases) {
    const actual = findProblems(file, text, files, numbers).length;
    if (actual !== expected) {
      throw new Error(
        `自己検査に失敗: ${file} "${text}" の検出件数が ${actual}（期待 ${expected}）`,
      );
    }
  }
}

function main() {
  selfCheck();
  const adrFiles = new Set(
    readdirSync(path.join(ROOT, ADR_DIR)).filter((f) => ADR_FILE_RE.test(f)),
  );
  const adrNumbers = new Set([...adrFiles].map((f) => f.slice(0, 4)));

  const files = trackedFiles().filter((f) => !isExcluded(f));
  const problems = files.flatMap((file) => {
    let text;
    try {
      text = readText(file);
    } catch (error) {
      // git ls-files には出るが作業ツリーで削除済みのファイル（未コミットの削除）
      if (error.code === "ENOENT") return [];
      throw new Error(`${file} を読めません: ${error.message}`);
    }
    return text === null ? [] : findProblems(file, text, adrFiles, adrNumbers);
  });

  if (problems.length === 0) {
    console.log(
      `OK: ADRへの参照はすべて実在するADRを指している（${files.length}ファイル、ADR ${adrFiles.size}件）。番号が別件を指していないかまでは確かめていない`,
    );
    return;
  }

  console.error(
    `NG: 実在しないADRへの参照が${problems.length}件見つかりました。\n`,
  );
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    "\nADRをリネーム・振り直ししたときは、旧番号・旧ファイル名で git grep し、参照側も合わせて更新すること。",
  );
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
