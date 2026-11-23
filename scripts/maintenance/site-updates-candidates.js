#!/usr/bin/env node
/**
 * 更新のお知らせ（src/data/siteUpdates.js）に載せる候補を、origin/master のマージから出す（読むだけ）。
 * 設計: docs/design/site-updates/plan.md「候補の機械」。窓口が選び、ファンの言葉に書き直してデータに足す。
 *
 * 使い方（回す前に git fetch origin master）:
 *   node scripts/maintenance/site-updates-candidates.js [--since YYYY-MM-DD]
 * 起点の既定はデータの最新の日付（その日の JST 0時から）。出力は Markdown の箇条書き（標準出力）。
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { SITE_UPDATES } from "../../src/data/siteUpdates.js";

// 画面に触れたとみなす場所
const UI_PATHS = ["src/pages/", "src/components/", "src/hooks/", "src/locales/ja/"];
// 題にあれば外す（大文字と小文字を区別しない）。「揺れ」「見た目は変えない」は画面の直しもあるので外さない
const SKIP_WORDS =
  /refactor|リファクタ|test|e2e|^ci[:(]|^chore|^docs|^content[:(]|sns|admin|機能フラグの裏|振る舞いは変えない|付け替え|noindex|\bRA\d+/i;

// git log --first-parent --name-only の出力を [{ date, subject, pr, files }] にする
export function parseLog(text) {
  return text
    .split("\u0001")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [head, ...files] = chunk.split("\n").filter(Boolean);
      const [date, subject] = head.split("\u0002");
      const pr = subject.match(/\(#(\d+)\)$/)?.[1];
      return { date, subject, pr: pr ? Number(pr) : null, files };
    });
}

// 残す: 画面に触れ、題が内部の変更でなく、まだデータに無い PR
export function pickCandidates(commits, knownPrs) {
  return commits.filter(
    (c) =>
      c.pr !== null &&
      !knownPrs.has(c.pr) &&
      !SKIP_WORDS.test(c.subject) &&
      c.files.some((f) => UI_PATHS.some((p) => f.startsWith(p))),
  );
}

export const toMarkdown = (list) =>
  list.length === 0
    ? "候補なし"
    : list.map((c) => `- ${c.date} #${c.pr} ${c.subject}`).join("\n");

function main() {
  const i = process.argv.indexOf("--since");
  const since = i > 0 ? process.argv[i + 1] : SITE_UPDATES[0]?.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since ?? "")) {
    throw new Error(`--since は YYYY-MM-DD（受け取った値: ${since}）`);
  }
  const log = execFileSync(
    "git",
    [
      "log",
      "origin/master",
      "--first-parent",
      `--since=${since}T00:00:00+09:00`,
      "--date=format-local:%Y-%m-%d",
      "--format=%x01%ad%x02%s",
      "--name-only",
    ],
    { encoding: "utf8", env: { ...process.env, TZ: "Asia/Tokyo" }, maxBuffer: 64 * 1024 * 1024 },
  );
  const known = new Set(SITE_UPDATES.flatMap((u) => u.prs));
  console.log(`# 更新のお知らせの候補（${since} から、新しい順）\n`);
  console.log(toMarkdown(pickCandidates(parseLog(log), known)));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
