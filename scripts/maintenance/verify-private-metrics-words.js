#!/usr/bin/env node
/**
 * verify-private-metrics-words.js — PR で足した行に、収益・費用・GA4 の生データ・
 * PV の目標の書き方が入っていないことを検査する（2026-11-06 オーナー決定:
 * 公開のリポジトリに置かず、hq（非公開）に置く）。
 *
 * 見るのは `git diff <base>...HEAD` の足された行（+ の行）だけ。既にある行は見ない。
 * 対象のファイル: docs/**・data/**・.claude/**・*.md・*.json（package.json・
 * package-lock.json は除く）。src などのコードの識別子は対象外。
 *
 * 外す口: 行の末尾に `public-ok: <理由>` の注があれば通す（md なら
 * `<!-- public-ok: 理由 -->` でもよい）。
 *
 * 使い方:
 *   node scripts/maintenance/verify-private-metrics-words.js --base=origin/master
 *   node scripts/maintenance/verify-private-metrics-words.js --scan-all  # 今の全ファイルに当てた数（誤検知の実測用）
 *   base を解決できない場合、CI（環境変数 CI が立っている）では失敗、手元ではスキップする。
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const DIGIT = /[0-9０-９]/;

/** 止める形。both があるものは、同じ行に both も当たるときだけ止める。 */
export const RULES = [
  {
    id: "revenue",
    label: "収益・売上・利益と数字",
    re: /収益|売上|利益|粗利|広告収入|アフィリエイト収入/i,
    both: DIGIT,
  },
  {
    id: "money-per-period",
    label: "期間あたりの金額（¥/$/円/ドル）",
    re: /[¥￥$＄]\s?[0-9][0-9,.]*\s?(\/|／)?\s?(月|日|年|mo|month|day)|(円|ドル)\s?(\/|／)\s?(月|日|年)/i,
  },
  {
    id: "ad-rate",
    label: "RPM・CPM・eCPM・CTR と数字",
    re: /RPM|CPM|eCPM|CTR/i,
    both: DIGIT,
  },
  {
    id: "traffic-count",
    label: "PV・ページビュー・UU・セッションの数",
    re: /[0-9０-９][0-9,.万千]*\s?(PV|ページビュー|UU|セッション)\s?(\/|／)?\s?(月|週|日)?/i,
  },
  {
    id: "goal",
    label: "PV の目標・KPI",
    re: /月100万PV|PV(の)?目標|KPI/i,
  },
  {
    id: "ga4-raw",
    label: "GA4 の生データのキー",
    re: /"eventName"|"sessionDefaultChannelGroup"|"activeUsers"|"screenPageViews"/i,
  },
];

const PUBLIC_OK = /public-ok:\s*\S.*$/;
const BINARY_EXT =
  /\.(png|jpe?g|gif|webp|avif|svg|ico|mp4|mov|webm|mp3|wav|m4a|pdf|woff2?|ttf|otf|zip|gz)$/i;

/** 検査の対象のファイルか */
export function isTargetFile(file) {
  if (BINARY_EXT.test(file)) return false;
  const base = path.posix.basename(file);
  if (base === "package.json" || base === "package-lock.json") return false;
  return /^(docs|data|\.claude)\//.test(file) || /\.(md|json)$/i.test(file);
}

/** 1行に当たる規則の id の一覧（外す口があれば空） */
export function matchLine(line) {
  if (PUBLIC_OK.test(line)) return [];
  return RULES.filter(
    (r) => r.re.test(line) && (!r.both || r.both.test(line)),
  ).map((r) => r.id);
}

/**
 * unified diff（--unified=0）から、対象のファイルの足された行を取り出す。
 * @returns {{file: string, line: number, text: string}[]}
 */
export function addedLines(diffText) {
  const out = [];
  let file = null;
  let lineNo = 0;
  for (const raw of diffText.split("\n")) {
    if (raw.startsWith("+++ ")) {
      const p = raw.slice(4);
      file = p === "/dev/null" ? null : p.replace(/^b\//, "");
      continue;
    }
    if (raw.startsWith("--- ")) continue;
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      lineNo = Number(hunk[1]);
      continue;
    }
    if (raw.startsWith("+") && file) {
      if (isTargetFile(file))
        out.push({ file, line: lineNo, text: raw.slice(1) });
      lineNo += 1;
    }
  }
  return out;
}

/** 足された行のうち当たるもの */
export function findViolations(lines) {
  return lines
    .map((l) => ({ ...l, rules: matchLine(l.text) }))
    .filter((l) => l.rules.length > 0);
}

// --- 判定ロジックの固定入力での検証 ---
const failures = [];
function check(label, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(
      `${label}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`,
    );
  }
}
check("収益と数字", matchLine("推定収益は約550"), ["revenue"]);
check("収益だけ（数字なし）は通す", matchLine("収益化の方針"), []);
check("全角の数字も数字", matchLine("売上は５"), ["revenue"]);
check("期間あたりのドル", matchLine("上限 $150/月"), ["money-per-period"]);
check("円/月", matchLine("約550円/月"), ["money-per-period"]);
check("RPM と数字", matchLine("ページ RPM 52"), ["ad-rate"]);
check("CTR だけ（数字なし）は通す", matchLine("CTR を見る"), []);
check("PV の数", matchLine("13,313PV"), ["traffic-count"]);
check("万PV", matchLine("3.3万PV/月"), ["traffic-count"]);
check("目標の語", matchLine("月100万PV を目指す"), ["traffic-count", "goal"]);
check("KPI", matchLine("KPI の表"), ["goal"]);
check("GA4 のキー", matchLine('  "screenPageViews": 10,'), ["ga4-raw"]);
check("外す口", matchLine("13,313PV public-ok: サイトに出ている数"), []);
check(
  "md の注の外す口",
  matchLine("13,313PV <!-- public-ok: 記事の例 -->"),
  [],
);
check("理由の無い外す口は効かない", matchLine("13,313PV public-ok:"), [
  "traffic-count",
]);
check("対象: docs", isTargetFile("docs/a.txt"), true);
check("対象: 任意の md", isTargetFile("public/blog/a.md"), true);
check("対象外: package.json", isTargetFile("package.json"), false);
check("対象外: src のコード", isTargetFile("src/utils/analytics.js"), false);
check("対象外: 画像", isTargetFile("docs/a.png"), false);
check(
  "diff から足した行だけを取る",
  addedLines(
    [
      "diff --git a/docs/x.md b/docs/x.md",
      "--- a/docs/x.md",
      "+++ b/docs/x.md",
      "@@ -3,0 +4,2 @@",
      "+13,313PV",
      "+ok",
      "diff --git a/src/a.js b/src/a.js",
      "--- a/src/a.js",
      "+++ b/src/a.js",
      "@@ -1 +1 @@",
      "-old",
      "+const pv = 13313; // 13,313PV",
    ].join("\n"),
  ),
  [
    { file: "docs/x.md", line: 4, text: "13,313PV" },
    { file: "docs/x.md", line: 5, text: "ok" },
  ],
);
check(
  "消したファイルは見ない",
  addedLines(
    ["--- a/docs/x.md", "+++ /dev/null", "@@ -1 +0,0 @@", "-13,313PV"].join(
      "\n",
    ),
  ),
  [],
);
if (failures.length > 0) {
  console.error("NG: お金・PV の語の検査ロジックが期待どおりに動いていません");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

function git(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
}

// --- 今の全ファイルに当てた数（誤検知の実測） ---
if (process.argv.includes("--scan-all")) {
  const files = git(["ls-files"])
    .split("\n")
    .filter(Boolean)
    .filter(isTargetFile);
  const byFile = new Map();
  for (const file of files) {
    let text;
    try {
      text = readFileSync(path.join(repoRoot, file), "utf8");
    } catch (err) {
      console.error(`読めないので飛ばした: ${file}（${err.message}）`);
      continue;
    }
    const lines = text
      .split("\n")
      .map((t, i) => ({ file, line: i + 1, text: t }));
    const v = findViolations(lines);
    if (v.length > 0) byFile.set(file, v);
  }
  console.log(JSON.stringify(Object.fromEntries(byFile)));
  process.exit(0);
}

// --- PR の差分を見る ---
const base =
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--base="))
    .map((a) => a.slice("--base=".length))
    .pop() || "origin/master";

let diff;
try {
  git(["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
  diff = git([
    "diff",
    "--unified=0",
    "--no-renames",
    "--no-color",
    "--diff-filter=AM",
    `${base}...HEAD`,
  ]);
} catch (err) {
  const message = `base（${base}）との差分を取れませんでした: ${err.message.split("\n")[0]}`;
  if (process.env.CI) {
    console.error(`NG: ${message}`);
    process.exit(1);
  }
  console.log(`スキップ: ${message}（手元のため。CIでは失敗扱い）`);
  process.exit(0);
}

const added = addedLines(diff);
const violations = findViolations(added);
if (violations.length > 0) {
  const labels = new Map(RULES.map((r) => [r.id, r.label]));
  console.error(
    `NG: 公開のリポジトリに置かない数（収益・費用・GA4 の生データ・PV の目標）の書き方が、足した行に ${violations.length} 行あります。`,
  );
  for (const v of violations) {
    const why = v.rules.map((id) => labels.get(id)).join("・");
    console.error(
      `  - ${v.file}:${v.line} [${why}] ${v.text.trim().slice(0, 120)}`,
    );
  }
  console.error(
    [
      "",
      "この数は hq（非公開）に置いてください（2026-11-06 オーナー決定）。公開のリポジトリには、数に依らない結論と「実数は hq」の一言だけを書きます。",
      "サイトに出ている数・記事の例など、公開してよいものだけは、行の末尾に `public-ok: <理由>` を付けると通ります。",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(
  `OK: PR（${base}...HEAD）の足した行 ${added.length} 行に、公開のリポジトリに置かない数の書き方は無い`,
);
