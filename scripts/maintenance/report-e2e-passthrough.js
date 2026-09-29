#!/usr/bin/env node
/**
 * E2E の再生で、録画に無く本番へ素通しした通信の一覧を出す（BOA-466、ADR-0077 の A改）。
 *
 * PRゲートの E2E は録画を再生するが、録画に無い /rest/v1/*・/api/* は abort せずに
 * 本番へ素通しする（データ取得部分を変える PR が1日に何本も入り、PR ごとに撮り直す
 * 前提が成り立たないため）。素通しが黙って増えると、PRゲートがいつの間にか本番依存に
 * 戻る。そこで素通しした通信（メソッド・URL・どのテストか）を必ず表に出す。
 *
 * 入力: e2e/fixtures.js が書く test-results/.e2e-passthrough/*.jsonl
 *
 * 使い方:
 *   node scripts/maintenance/report-e2e-passthrough.js             標準出力に Markdown
 *   node scripts/maintenance/report-e2e-passthrough.js --summary   $GITHUB_STEP_SUMMARY にも追記
 *   node scripts/maintenance/report-e2e-passthrough.js --pr=123     PR コメントを作成・更新（1件）
 *
 * 素通しがあっても失敗にはしない（終了コード0）。PR で見えることが目的のため。
 */

import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const DIR = path.join(repoRoot, "test-results", ".e2e-passthrough");
/** PR コメントを見つけるための目印。1PR につき1件だけ更新し続ける */
export const MARKER = "<!-- e2e-passthrough-report -->";
const MAX_ROWS = 200;

export function readEntries(dir = DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .flatMap((f) =>
      readFileSync(path.join(dir, f), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    );
}

/** 同じ通信をまとめ、どのテストが叩いたかを並べる（純関数） */
export function summarize(entries) {
  const byRequest = new Map();
  for (const e of entries) {
    const key = `${e.method} ${e.url}`;
    const row = byRequest.get(key) ?? {
      method: e.method,
      url: e.url,
      tests: new Set(),
      count: 0,
    };
    row.count += 1;
    row.tests.add(`[${e.project}] ${e.test}`);
    byRequest.set(key, row);
  }
  return [...byRequest.values()]
    .map((r) => ({ ...r, tests: [...r.tests].sort() }))
    .sort(
      (a, b) => b.tests.length - a.tests.length || a.url.localeCompare(b.url),
    );
}

const cell = (s) => String(s).replaceAll("|", "\\|").replaceAll("\n", " ");

export function toMarkdown(rows, { runUrl } = {}) {
  const lines = [MARKER, "## E2E: 録画に無く本番へ素通しした通信"];
  if (rows.length === 0) {
    lines.push(
      "",
      "**0件**。全ての `/rest/v1/*`・`/api/*` を録画から返した（本番に依存していない）。",
    );
  } else {
    const tests = new Set(rows.flatMap((r) => r.tests));
    lines.push(
      "",
      `**${rows.length}種類の通信**が録画に無く、本番へ素通しした（${tests.size}テスト）。` +
        "このPRで新しいクエリを足したなら想定どおり。毎日の自動撮り直し（e2e-rerecord.yml）で録画に入るまで、これらのテストは本番のデータに依存する（ADR-0077）。",
      "",
      "| # | メソッド | URL | テスト |",
      "|---|---|---|---|",
    );
    rows.slice(0, MAX_ROWS).forEach((r, i) => {
      const shown = r.tests.slice(0, 3).map(cell).join("<br>");
      const more = r.tests.length > 3 ? `<br>ほか${r.tests.length - 3}件` : "";
      lines.push(
        `| ${i + 1} | ${r.method} | \`${cell(decodeSafe(r.url)).slice(0, 300)}\` | ${shown}${more} |`,
      );
    });
    if (rows.length > MAX_ROWS)
      lines.push("", `（ほか${rows.length - MAX_ROWS}種類は省略）`);
  }
  if (runUrl) lines.push("", `実行: ${runUrl}`);
  return lines.join("\n") + "\n";
}

function decodeSafe(url) {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

function upsertPrComment(pr, body) {
  const file = path.join(
    repoRoot,
    "test-results",
    "e2e-passthrough-comment.md",
  );
  writeFileSync(file, body);
  // {owner}/{repo} は gh がカレントのリポジトリ（または GH_REPO）から埋める
  const existingId = execFileSync(
    "gh",
    [
      "api",
      "--paginate",
      `repos/{owner}/{repo}/issues/${pr}/comments`,
      "--jq",
      `.[] | select(.body | contains("${MARKER}")) | .id`,
    ],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean)[0];
  if (existingId) {
    execFileSync(
      "gh",
      [
        "api",
        "-X",
        "PATCH",
        `repos/{owner}/{repo}/issues/comments/${existingId}`,
        "-F",
        `body=@${file}`,
      ],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    console.log(`PR #${pr} のコメント（${existingId}）を更新しました`);
  } else {
    execFileSync("gh", ["pr", "comment", String(pr), "--body-file", file], {
      stdio: "inherit",
    });
    console.log(`PR #${pr} にコメントを作成しました`);
  }
}

function main() {
  const rows = summarize(readEntries());
  const runUrl = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : undefined;
  const markdown = toMarkdown(rows, { runUrl });
  process.stdout.write(markdown);

  if (process.argv.includes("--summary") && process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  }
  const pr = process.argv.find((a) => a.startsWith("--pr="))?.slice(5);
  if (pr) upsertPrComment(pr, markdown);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
