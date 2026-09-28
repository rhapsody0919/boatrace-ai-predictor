#!/usr/bin/env node
/**
 * SessionStart: このセッションが「古い前提」で作業を始めていないかを見せる。
 *
 * 背景: 2026-09-25に、作業ディレクトリの master が origin/master より23コミット遅れたまま
 * 複数のセッションが動いていた。そこで起動したセッションは
 *   - 古い .claude/CLAUDE.md と .claude/rules/*.md を読む（その時点の版では、既にCIで
 *     自動実行されるようになった検証を「毎回手元で実行しろ」と指示していた）
 *   - 古い master からブランチを切る（当日作ったブランチが作成時点で23コミット遅れていた）
 * という状態になる。SessionStartフックはブランチ名と git status は見せていたが、
 * origin との乖離は見せていなかったため、誰も気づけなかった。
 *
 * 併せて、gitに入らない取り直しの効かないデータが worktree の中に置かれていないかも見る
 * （worktree は使い捨てを前提にした場所で、実際に `gh pr merge --delete-branch` で
 * ディレクトリごと消えて数夜分の取得データを失っている。scripts/lib/preciousPaths.js 参照）。
 *
 * 遅れていても、メインの作業ツリーが master・追跡ファイル無変更・独自コミット無しなら
 * 警告ではなく fast-forward で自動取り込みする（shouldAutoFastForward）。
 *
 * 問題が無ければ何も出力しない（セッション冒頭のノイズを増やさないため）。
 * 依存はNode標準のみ。node_modules が壊れていても動く必要がある
 * （2026-09-25に node_modules が空で session-start-check.js が起動できなかった実例がある）。
 *
 * 検証: scripts/maintenance/verify-git-hygiene.js
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRECIOUS_PATHS } from "../lib/preciousPaths.js";

const DEFAULT_BRANCH = "master";
const FETCH_TIMEOUT_MS = 10000;
const GIT_TIMEOUT_MS = 5000;
/** これを超えたら棚卸しを促す。並行セッション分（数本）は通常運転。 */
const WORKTREE_WARN_THRESHOLD = 12;

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function git(args, { timeout = GIT_TIMEOUT_MS } = {}) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      timeout,
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/** `git worktree list --porcelain` を {path, branch} の配列に直す。 */
export function parseWorktrees(porcelain) {
  const result = [];
  let current = null;
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = {
        path: line.slice("worktree ".length),
        branch: null,
        locked: null,
      };
      result.push(current);
    } else if (line.startsWith("branch ") && current) {
      current.branch = line.slice("branch refs/heads/".length);
    } else if (line.startsWith("locked") && current) {
      // Claude Code は作業中の worktree をロックする。
      // 理由の文字列（"claude session <名前> (pid ...)"）まで拾って、
      // どのセッションが使っているかを人に見せる。理由なしでロックされることもある。
      current.locked = line.slice("locked".length).trim() || "(理由の記載なし)";
    }
  }
  return result;
}

/**
 * 棚卸しの対象になる worktree を返す。
 *
 * `git worktree list` の先頭は常にメインの作業ツリーで、これは消す対象ではない。
 * worktree の中からこのスクリプトを走らせるとメインが「別のworktree」に見えてしまうため、
 * 先頭と自分自身の両方を除く。
 */
export function selectManagedWorktrees(worktrees, selfPath) {
  const mainPath = worktrees[0]?.path;
  return worktrees.filter((w) => w.path !== mainPath && w.path !== selfPath);
}

/** `git rev-list --left-right --count A...B` の出力から behind 側を取る。 */
export function parseBehindCount(revListOutput) {
  const m = revListOutput?.match(/^(\d+)\s+(\d+)$/);
  return m ? Number(m[2]) : null;
}

/** 同じ出力から ahead 側（ローカルにしか無いコミット数）を取る。 */
export function parseAheadCount(revListOutput) {
  const m = revListOutput?.match(/^(\d+)\s+(\d+)$/);
  return m ? Number(m[1]) : null;
}

/**
 * メインの作業ツリーの master を自動で fast-forward してよいか。
 *
 * 並行セッションは worktree で作業し、PR は GitHub 上でマージされるため、
 * メインの作業ツリーのローカル master は誰かが取り込まない限り遅れ続ける
 * （警告を出すだけでは、2026-09-28 時点でも7コミット遅れていた）。
 * 他セッションの作業を壊さない条件に限って自動で取り込む:
 *   - メインが master にいる（別ブランチで作業中なら触らない）
 *   - 追跡ファイルに未コミットの変更が無い（untracked は merge --ff-only 自身が
 *     上書きになる場合だけ拒否するので、条件に含めない）
 *   - ローカルにしか無いコミットが無い（ff-only で失敗するが、事前に弾いて警告に回す）
 */
export function shouldAutoFastForward({ branch, trackedDirty, ahead, behind }) {
  return (
    branch === DEFAULT_BRANCH &&
    trackedDirty === false &&
    ahead === 0 &&
    typeof behind === "number" &&
    behind > 0
  );
}

function main() {
  const lines = [];

  // origin の最新を取りに行く。ネットワークが遅い・繋がらない場合は諦めて続ける。
  git(["fetch", "origin", DEFAULT_BRANCH, "--quiet"], {
    timeout: FETCH_TIMEOUT_MS,
  });

  const counts = git([
    "rev-list",
    "--left-right",
    "--count",
    `${DEFAULT_BRANCH}...origin/${DEFAULT_BRANCH}`,
  ]);
  let behind = parseBehindCount(counts);
  const ahead = parseAheadCount(counts);

  // worktree から起動しても、取り込む対象はメインの作業ツリー（一覧の先頭）。
  const porcelain = git(["worktree", "list", "--porcelain"]);
  const mainPath = porcelain ? parseWorktrees(porcelain)[0]?.path : null;
  if (mainPath) {
    const mainGit = (args, opts) => git(["-C", mainPath, ...args], opts);
    const tracked = mainGit(["status", "--porcelain", "--untracked-files=no"]);
    const decision = shouldAutoFastForward({
      branch: mainGit(["branch", "--show-current"]),
      trackedDirty: tracked === null ? null : tracked !== "",
      ahead,
      behind,
    });
    if (
      decision &&
      mainGit(["merge", "--ff-only", "--quiet", `origin/${DEFAULT_BRANCH}`], {
        timeout: FETCH_TIMEOUT_MS,
      }) !== null
    ) {
      lines.push(
        `メインの作業ツリー（${mainPath}）の ${DEFAULT_BRANCH} を origin/${DEFAULT_BRANCH} へ自動で取り込みました（${behind} コミット、fast-forward）。`,
      );
      behind = 0;
    }
  }

  if (behind && behind > 0) {
    lines.push(
      `${DEFAULT_BRANCH} が origin/${DEFAULT_BRANCH} より ${behind} コミット遅れています。`,
    );
    lines.push(
      `  この作業ディレクトリで起動したセッションは、古い .claude/CLAUDE.md・.claude/rules/*.md を読み、` +
        `古い ${DEFAULT_BRANCH} からブランチを切ります。新規タスクの前に取り込んでください:`,
    );
    lines.push(
      `  git fetch origin ${DEFAULT_BRANCH} && git merge --ff-only origin/${DEFAULT_BRANCH}`,
    );
  }

  if (porcelain) {
    const extra = selectManagedWorktrees(parseWorktrees(porcelain), repoRoot);
    if (extra.length > WORKTREE_WARN_THRESHOLD) {
      lines.push(
        `worktree が ${extra.length} 本あります（閾値 ${WORKTREE_WARN_THRESHOLD}）。` +
          `マージ済みの残骸が溜まっている可能性があります: npm run check:worktrees`,
      );
    }
    const atRisk = [];
    for (const w of extra) {
      const found = PRECIOUS_PATHS.filter((p) =>
        existsSync(path.join(w.path, p)),
      );
      if (found.length > 0) atRisk.push(`${w.path} (${found.join(", ")})`);
    }
    if (atRisk.length > 0) {
      lines.push(
        `worktree の中に、gitに入らない取り直しの効かないデータがあります。` +
          `worktree ごと消えると復元できません（リポジトリ外へ退避してください）:`,
      );
      for (const a of atRisk) lines.push(`  - ${a}`);
    }
  }

  if (lines.length === 0) return;
  console.log("");
  console.log("### 作業前提の確認");
  for (const l of lines) console.log(l);
}

const invokedDirectly =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) main();
