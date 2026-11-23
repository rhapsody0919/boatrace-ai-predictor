/**
 * close-merged-ticket.js - master に入った commit の PR に紐づく Linear の票を Done にしてアーカイブする
 * （BOA-1711、hq 閉鎖 R7。前は非公開の hq の deploy-guard・maker-merge が閉じていた）。
 *
 * 判定は scripts/lib/linearCloseMerged.js（迷う物は閉じない）。閉じるときは根拠のコメントを付ける。
 * 誤って閉じたら Linear の UI で票をアーカイブから戻し、状態を戻す。
 *
 * 使い方: node scripts/linear/close-merged-ticket.js <commit の sha>
 * 環境変数: GITHUB_TOKEN（PR を読む）・GITHUB_REPOSITORY・LINEAR_API_KEY
 * 終了コード: 0 済み（閉じる票が無いときも）、1 読み書きの失敗（job-watch が拾う）
 */
import { decide, ticketsFor } from "../lib/linearCloseMerged.js";

const GH = "https://api.github.com";

async function gh(path) {
  const res = await fetch(`${GH}${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) throw new Error(`GitHub ${path} が HTTP ${res.status}`);
  return res.json();
}

async function linear(query, variables) {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: process.env.LINEAR_API_KEY,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors) {
    const msg = json.errors?.[0]?.message ?? `HTTP ${res.status}`;
    throw new Error(`Linear: ${String(msg).slice(0, 120)}`);
  }
  return json.data;
}

const ISSUE_Q = `query($id: String!) { issue(id: $id) {
  id identifier archivedAt state { type } team { id }
  children { nodes { identifier state { type } } } } }`;
const DONE_STATE_Q = `query($team: ID!) { workflowStates(filter: { team: { id: { eq: $team } }, type: { eq: "completed" } }) {
  nodes { id name position } } }`;

async function archiveIssue(issue) {
  await linear(
    `mutation($id: String!) { issueArchive(id: $id) { success } }`,
    { id: issue.id },
  );
}

async function closeIssue(issue, pr) {
  const { workflowStates } = await linear(DONE_STATE_Q, { team: issue.team.id });
  const done = [...workflowStates.nodes].sort((a, b) => a.position - b.position)[0];
  if (!done) throw new Error(`${issue.identifier}: チームに完了の状態が無い`);
  await linear(
    `mutation($id: String!, $s: String!) { issueUpdate(id: $id, input: { stateId: $s }) { success } }`,
    { id: issue.id, s: done.id },
  );
  await linear(
    `mutation($id: String!, $b: String!) { commentCreate(input: { issueId: $id, body: $b }) { success } }`,
    {
      id: issue.id,
      b: `PR #${pr.number} が master に入ったので、自動で完了にしてアーカイブした（.github/workflows/linear-close-merged.yml）。続きがあるならアーカイブから戻して状態を直す。`,
    },
  );
  await linear(
    `mutation($id: String!) { issueArchive(id: $id) { success } }`,
    { id: issue.id },
  );
}

async function main() {
  const sha = process.argv[2];
  for (const name of ["GITHUB_TOKEN", "GITHUB_REPOSITORY", "LINEAR_API_KEY"]) {
    if (!process.env[name]) throw new Error(`環境変数 ${name} が無い（secret 未設定）`);
  }
  if (!/^[0-9a-f]{7,40}$/.test(sha ?? "")) throw new Error("commit の sha を引数で渡す");
  const repo = process.env.GITHUB_REPOSITORY;
  const prs = (await gh(`/repos/${repo}/commits/${sha}/pulls`)).filter(
    (p) => p.merged_at && p.base?.ref === "master",
  );
  if (prs.length === 0) {
    console.log(`${sha.slice(0, 9)}: PR の無い commit（閉じる票なし）`);
    return;
  }
  const openPrs = await gh(`/repos/${repo}/pulls?state=open&per_page=100`);
  for (const pr of prs) {
    for (const ident of ticketsFor(pr.title, pr.head?.ref)) {
      const { issue } = await linear(ISSUE_Q, { id: ident });
      if (!issue) {
        console.log(`#${pr.number} ${ident}: 票が無い`);
        continue;
      }
      const { action, reason } = decide(ident, issue, openPrs, pr);
      if (action === "close") await closeIssue(issue, pr);
      if (action === "archive") await archiveIssue(issue);
      console.log(`#${pr.number} ${ident}: ${action}（${reason}）`);
    }
  }
}

main().catch((err) => {
  console.error(`close-merged-ticket: ${err.message}`);
  process.exit(1);
});
