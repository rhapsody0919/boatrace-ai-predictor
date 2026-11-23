/**
 * auto-merge-content-prs.js - 開いている記事の PR のうち、段階0 F の条件を満たす物をマージする
 * （オーナー 2026-11-23 yes。判定は scripts/lib/contentAutoMerge.js）。
 *
 * 判定の道具（pr-lane.js・この本）は master の版を回す。PR のコードは実行しない（ファイルの一覧と manifest の JSON を読むだけ。
 * pr-lane は git の差分を読む）。マージは --match-head-commit で、確かめた head の後に push があれば入れない。
 *
 * 使い方: node scripts/content/auto-merge-content-prs.js [--dry-run]
 * 環境変数: GH_TOKEN（マージできる App のトークン）・GITHUB_REPOSITORY
 * 終了コード: 0 済み、1 読み書きの失敗
 */
import { execFileSync } from "node:child_process";
import { judge } from "../lib/contentAutoMerge.js";

const DRY = process.argv.includes("--dry-run");
const repo = process.env.GITHUB_REPOSITORY;

const gh = (args) =>
  execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const api = (path) => JSON.parse(gh(["api", path]));
const git = (args) => execFileSync("git", args, { encoding: "utf8" }).trim();

function lane(baseSha, headSha) {
  try {
    const out = execFileSync(
      "node",
      ["scripts/maintenance/pr-lane.js", "--base", baseSha, "--head", headSha],
      { encoding: "utf8" },
    );
    return JSON.parse(out).lane;
  } catch {
    return "unknown";
  }
}

function manifestOf(files, headSha) {
  const f = files.find((x) => x.path.startsWith("docs/content-manifests/"));
  if (!f) return null;
  try {
    return JSON.parse(git(["show", `${headSha}:${f.path}`]));
  } catch {
    return null;
  }
}

function main() {
  if (!repo) throw new Error("環境変数 GITHUB_REPOSITORY が無い");
  const prs = api(`/repos/${repo}/pulls?state=open&base=master&per_page=100`).filter(
    (p) => p.head.ref.startsWith("claude/content-") && p.head.repo?.full_name === repo && !p.draft,
  );
  if (prs.length === 0) console.log("記事の開いた PR は無い");
  for (const p of prs) {
    const headSha = p.head.sha;
    const files = api(`/repos/${repo}/pulls/${p.number}/files?per_page=100`).map((f) => ({
      path: f.filename,
      status: f.status,
    }));
    const checks = api(`/repos/${repo}/commits/${headSha}/check-runs?per_page=100`).check_runs.map(
      (c) => ({ name: c.name, conclusion: c.conclusion }),
    );
    git(["fetch", "-q", "origin", `pull/${p.number}/head`]);
    const baseSha = git(["merge-base", "origin/master", headSha]);
    const { merge, reasons } = judge({
      headRef: p.head.ref,
      files,
      manifest: manifestOf(files, headSha),
      checks,
      lane: lane(baseSha, headSha),
    });
    if (!merge) {
      console.log(`#${p.number}: 待つ（${reasons.join("・")}）`);
      continue;
    }
    if (DRY) {
      console.log(`#${p.number}: マージしてよい（試しなので入れない）`);
      continue;
    }
    gh(["pr", "merge", String(p.number), "--squash", "--match-head-commit", headSha, "--repo", repo]);
    console.log(`#${p.number}: マージした（${headSha.slice(0, 9)}）`);
  }
}

try {
  main();
} catch (err) {
  console.error(`auto-merge-content-prs: ${String(err.message).split("\n")[0]}`);
  process.exit(1);
}
