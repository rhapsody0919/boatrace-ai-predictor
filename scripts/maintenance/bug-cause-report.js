#!/usr/bin/env node
/**
 * バグ原因の定点観測用に、分類対象のコミットを集める。
 *
 * 手順と分類基準は docs/operation/bug-cause-measurement.md が正本。
 * このスクリプトは「対象を集めて正規化の分母を出す」ところまでで、
 * **原因の分類（R1〜R7）はしない**。diff を読んで判断する必要があるため。
 *
 * 使い方:
 *   node scripts/maintenance/bug-cause-report.js --since=2026-09-26 --until=2026-10-24
 *   node scripts/maintenance/bug-cause-report.js --since=2026-09-26            # 今日まで
 *
 * 検証: scripts/maintenance/verify-bug-cause-report.js
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/**
 * マージ前に捕捉されたfixを除く語。これらを含むものは「実装完了後に発覚した」に
 * 当たらないため、分類の対象外にする。
 *
 * **判定は件名だけで行う。** 本文まで見ると「指摘」「フィードバック」を含む
 * コミットを過剰に除外してしまい、第1期（169件→147件）と比較できなくなる。
 * 実際に本文込みで判定したところ、同じ期間で101件まで落ちた。
 *
 * 「指摘」を単独で入れないのも同じ理由。第1期は「セルフレビュー指摘」
 * 「レビュー指摘」のような複合語で絞っている。
 */
const PRE_MERGE_MARKERS = [
  "セルフレビュー",
  "自動レビュー",
  "レビュー指摘",
  "レビュー対応",
  "フィードバック",
  "ローカル確認",
  "実機",
];

export function isPreMergeFix(subject) {
  return PRE_MERGE_MARKERS.some((m) => subject.includes(m));
}

/**
 * `fix` で始まるコミットを対象にする。
 * 第1期は `grep -E "^fix"` で集めたので、コロンの有無を問わない形に合わせる
 * （`fixture:` のような語は `\b` で弾く）。基準を変えると比較できなくなる。
 */
export function isFixCommit(subject) {
  return /^fix\b/.test(subject);
}

/**
 * 第1期の実測。比較の基準として埋め込む（docs/operation/bug-cause-measurement.md と同じ値）。
 *
 * `classified` は2026-09-25に手作業で全件分類した件数。このスクリプトで同じ期間を
 * 集めると146件になり1件ずれるが、集計時点の履歴の違いによるもので比率には響かない。
 * `mergedPrs` は**このスクリプトの数え方**に合わせてある（当時の報告では130としていた）。
 * 第2期も同じ数え方をするので、分母の算出方法を揃える方を優先した。
 */
export const BASELINE = {
  label: "第1期 2026-08-15〜2026-09-25",
  classified: 147,
  mergedPrs: 125,
  byCause: {
    "R4 仕様・要件の取り違え": 39,
    "R7 単純な実装ミス": 36,
    "R3 既存実装を知らず再実装": 26,
    "R5 実行環境差異": 16,
    "R1 外部データの想定外パターン": 13,
    "R2 失敗の握りつぶし": 9,
    "R6 並行セッション起因": 8,
  },
};

/** 件数を「1PRあたり」に直す。生の件数は開発量に比例するので比較できない。 */
export function perPr(count, mergedPrs) {
  if (!mergedPrs) return null;
  return Number((count / mergedPrs).toFixed(3));
}

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function parseArgs(argv) {
  const get = (name) =>
    argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  return { since: get("since"), until: get("until") };
}

function main() {
  const { since, until } = parseArgs(process.argv.slice(2));
  if (!since) {
    console.error("NG: --since=YYYY-MM-DD が要ります。");
    console.error(
      "  例: node scripts/maintenance/bug-cause-report.js --since=2026-09-26",
    );
    process.exit(1);
  }

  const range = ["--since", since];
  if (until) range.push("--until", until);

  // 区切り文字は本文に現れない制御文字にする（件名に改行は無いが本文には入る）
  const SEP = "";
  const raw = git([
    "log",
    ...range,
    `--pretty=format:%H${SEP}%ad${SEP}%s${SEP}%b${SEP}`,
    "--date=short",
  ]);

  const commits = raw
    .split("")
    .map((chunk) => chunk.replace(/^\n/, ""))
    .filter((chunk) => chunk.trim() !== "")
    .map((chunk) => {
      const [hash, date, subject, body] = chunk.split(SEP);
      return { hash, date, subject: subject ?? "", body: body ?? "" };
    });

  const fixes = commits.filter((c) => isFixCommit(c.subject));
  const target = fixes.filter((c) => !isPreMergeFix(c.subject));
  const preMerge = fixes.length - target.length;

  const mergedPrs = commits.filter((c) =>
    /^Merge pull request #\d+/.test(c.subject),
  ).length;

  const period = until ? `${since} 〜 ${until}` : `${since} 〜 今日`;
  console.log(`## 対象期間: ${period}`);
  console.log("");
  console.log(`全コミット: ${commits.length}`);
  console.log(`fixコミット: ${fixes.length}`);
  console.log(`  うちマージ前に捕捉（対象外）: ${preMerge}`);
  console.log(`  **分類の対象: ${target.length}**`);
  console.log(`マージPR（正規化の分母）: ${mergedPrs}`);
  console.log("");

  if (mergedPrs > 0 && target.length > 0) {
    console.log(
      `全体のfix率: ${perPr(target.length, mergedPrs)} 件/PR（第1期: ${perPr(BASELINE.classified, BASELINE.mergedPrs)}）`,
    );
    console.log("");
  }

  console.log("## 分類する対象");
  console.log("");
  console.log("各コミットを `git show <hash>` で読み、R1〜R7に割り当てる。");
  console.log(
    "件名だけで判断しない。基準は docs/operation/bug-cause-measurement.md。",
  );
  console.log("");
  for (const c of target) {
    console.log(`${c.hash.slice(0, 8)}  ${c.date}  ${c.subject}`);
  }

  console.log("");
  console.log("## 第1期の比率（比較用）");
  console.log("");
  for (const [cause, count] of Object.entries(BASELINE.byCause)) {
    const pct = ((count / BASELINE.classified) * 100).toFixed(1);
    console.log(
      `  ${cause}: ${count}件 (${pct}%) / ${perPr(count, BASELINE.mergedPrs)} 件/PR`,
    );
  }
}

const invokedDirectly =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) main();
