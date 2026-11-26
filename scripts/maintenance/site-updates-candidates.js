#!/usr/bin/env node
/**
 * 更新のお知らせ（src/data/siteUpdates.js）に載せる候補を、origin/master のマージから出す（読むだけ）。
 * 設計: docs/design/site-updates/plan.md「候補の機械」。窓口が選び、ファンの言葉に書き直してデータに足す。
 *
 * 使い方（回す前に git fetch origin master）:
 *   node scripts/maintenance/site-updates-candidates.js [--since YYYY-MM-DD]
 * 起点の既定はデータの最新の日付。比べるのはマージの日でなく、その PR を初めて含んだ本番（Production）の
 * success の配備の日（JST）。マージの翌朝の定時で出た PR を落とさないため。まだ本番に出ていない PR は「未配備」で残す。
 * 配備は gh api（GitHub の deployments）で読む。出力は Markdown の箇条書き（標準出力）。
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { SITE_UPDATES } from "../../src/data/siteUpdates.js";
import { getDaysAgoJST } from "../../src/pure/jstDate.js";

// 画面に触れたとみなす場所
const UI_PATHS = ["src/pages/", "src/components/", "src/hooks/", "src/locales/ja/"];
// 題にあれば外す（大文字と小文字を区別しない）。「揺れ」「見た目は変えない」は画面の直しもあるので外さない
const SKIP_WORDS =
  /refactor|リファクタ|test|e2e|^ci[:(]|^chore|^docs|^content[:(]|sns|admin|機能フラグの裏|振る舞いは変えない|付け替え|noindex|\bRA\d+/i;

// マージの日でこれだけ遡って git log を読む（目安・根拠なし。定時は1日3回で、7日あれば配備の遅れを含む見込み）
const LOOKBACK_DAYS = 7;

// git log --first-parent --name-only の出力を [{ date, subject, sha, pr, files }] にする
export function parseLog(text) {
  return text
    .split("\u0001")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [head, ...files] = chunk.split("\n").filter(Boolean);
      const [date, subject, sha] = head.split("\u0002");
      const pr = subject.match(/\(#(\d+)\)$/)?.[1];
      return { date, subject, sha, pr: pr ? Number(pr) : null, files };
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

// 各 commit に、それを初めて含んだ success の配備を付ける。deployments は古い順の [{ id, sha, createdAt }]、
// isAncestor(commitSha, deploySha) は真偽。含む配備が無ければ deploy は null（まだ本番に出ていない）
export const attachDeploys = (commits, deployments, isAncestor) =>
  commits.map((c) => {
    const d = deployments.find((x) => isAncestor(c.sha, x.sha));
    return {
      ...c,
      deploy: d ? { id: d.id, date: getDaysAgoJST(0, new Date(d.createdAt)) } : null,
    };
  });

// 起点の日以降に本番に出た物と、まだ出ていない物を残す
export const deployedSince = (commits, since) =>
  commits.filter((c) => c.deploy === null || c.deploy.date >= since);

export const toMarkdown = (list) =>
  list.length === 0
    ? "候補なし"
    : list
        .map((c) => {
          const at = c.deploy ? `本番 ${c.deploy.date}（配備 ${c.deploy.id}）` : "未配備";
          return `- ${at} マージ ${c.date} #${c.pr} ${c.subject}`;
        })
        .join("\n");

const run = (cmd, args) =>
  execFileSync(cmd, args, {
    encoding: "utf8",
    env: { ...process.env, TZ: "Asia/Tokyo" },
    maxBuffer: 64 * 1024 * 1024,
  });

// 本番の success の配備を古い順に。起点の LOOKBACK_DAYS 日前より前に作られた配備は読まない（状態の問い合わせを減らす）
function readProductionDeploys(fromDate) {
  const repo = "repos/{owner}/{repo}";
  const list = JSON.parse(
    run("gh", ["api", `${repo}/deployments?environment=Production&per_page=100`]),
  );
  const recent = list.filter((d) => getDaysAgoJST(0, new Date(d.created_at)) >= fromDate);
  if (recent.length === list.length && list.length > 0) {
    throw new Error(
      `本番の配備の100件が全部 ${fromDate} 以降で、それより古い配備を読めていない。--since を近くにして回し直す`,
    );
  }
  return recent
    .filter((d) => run("gh", ["api", `${repo}/deployments/${d.id}/statuses`, "--jq", ".[0].state"]).trim() === "success")
    .map((d) => ({ id: d.id, sha: d.sha, createdAt: d.created_at }))
    .reverse();
}

const isAncestor = (commit, target) => {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", commit, target], { stdio: "ignore" });
    return true;
  } catch (e) {
    // 終了コード1は「祖先でない」。それ以外（sha が手元に無い等）は落とす
    if (e.status === 1) return false;
    throw new Error(`git merge-base が失敗した（${commit} と ${target}。git fetch origin master の後に回す）: ${e.message}`);
  }
};

function main() {
  const i = process.argv.indexOf("--since");
  const since = i > 0 ? process.argv[i + 1] : SITE_UPDATES[0]?.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since ?? "")) {
    throw new Error(`--since は YYYY-MM-DD（受け取った値: ${since}）`);
  }
  const from = getDaysAgoJST(LOOKBACK_DAYS, new Date(`${since}T12:00:00+09:00`));
  const log = run("git", [
    "log",
    "origin/master",
    "--first-parent",
    `--since=${from}T00:00:00+09:00`,
    "--date=format-local:%Y-%m-%d",
    "--format=%x01%ad%x02%s%x02%H",
    "--name-only",
  ]);
  const known = new Set(SITE_UPDATES.flatMap((u) => u.prs));
  const picked = pickCandidates(parseLog(log), known);
  const withDeploys = attachDeploys(picked, readProductionDeploys(from), isAncestor);
  console.log(`# 更新のお知らせの候補（本番に ${since} 以降に出た物と未配備、マージの新しい順）\n`);
  console.log(toMarkdown(deployedSince(withDeploys, since)));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
