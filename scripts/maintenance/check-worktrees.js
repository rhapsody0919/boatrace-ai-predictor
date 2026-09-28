#!/usr/bin/env node
/**
 * worktree の棚卸し。何が片付けられて、何に触ってはいけないかを分類して見せる。
 *
 * 背景: 2026-09-25時点で worktree が37本あり、12本が未コミット変更を抱え、12本が
 * マージ済みブランチの残骸だった。このプロジェクトは「新規タスクは必ずworktreeで隔離」を
 * ルールにしているため放っておくと増え続ける。一方で、他セッションが作業中の worktree や、
 * gitに入らない取り直しの効かないデータを抱えた worktree を消すと実害が出る
 * （2026-09-25に実際に数夜分の取得データを失っている）。
 *
 * このスクリプトは**何も削除しない**。分類と、安全に消せるものの削除コマンドを出すだけ。
 * 判断と実行は人間が行う。
 *
 * 使い方: npm run check:worktrees
 *
 * 検証: scripts/maintenance/verify-git-hygiene.js / verify-worktree-in-use.js
 */

import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRECIOUS_PATHS } from "../lib/preciousPaths.js";
import { parseWorktrees, selectManagedWorktrees } from "./check-git-hygiene.js";

const GIT_TIMEOUT_MS = 10000;
const GH_TIMEOUT_MS = 30000;
const LSOF_TIMEOUT_MS = 30000;
/** マージ済みでも、この時間内に HEAD が動いた worktree は片付け対象にしない */
const RECENT_HOURS = 24;

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/**
 * gitが追跡しないが、残っていると `git worktree remove` が
 * "Directory not empty" で失敗するもの。消して困らない（作り直せる）。
 * 取り直しの効かないデータは preciousPaths.js 側で別に扱う。
 */
const UNTRACKED_LEFTOVERS = [
  "node_modules",
  "dist",
  ".vite",
  "playwright-report",
];

function git(args, cwd = repoRoot) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * マージ済みとみなすのは、MERGED の PR が見つかり、その PR の head が
 * ローカルのブランチ先頭と一致するときだけ。
 *
 * 以前は「ブランチ先頭が origin/master の祖先（ahead=0）」をマージ済みとしていた。
 * これは作業を始めたばかりでまだコミットしていない worktree（先頭 = origin/master）も
 * 満たすため、2026-09-28 に稼働中セッションの worktree 4本を「片付けてよい」と表示した。
 * PR の head との一致で見るので squash マージも拾える。マージ後にローカルで
 * 積んだコミットがあれば先頭が一致せず、マージ済みにならない。
 */
export function isMergedByPr({ branch, tip, mergedPrs }) {
  if (!branch || !tip || !mergedPrs) return false;
  return mergedPrs.some(
    (pr) => pr.headRefName === branch && pr.headRefOid === tip,
  );
}

/** `lsof -d cwd -Fn` の出力から、各プロセスのカレントディレクトリを取り出す。 */
export function parseCwdPaths(lsofOutput) {
  if (!lsofOutput) return [];
  return lsofOutput
    .split("\n")
    .filter((line) => line.startsWith("n/"))
    .map((line) => line.slice(1));
}

/** worktree の中（サブディレクトリ含む）をカレントディレクトリにしているプロセスがあるか。 */
export function hasProcessInside(worktreePath, cwdPaths) {
  return cwdPaths.some(
    (p) => p === worktreePath || p.startsWith(`${worktreePath}/`),
  );
}

/** HEAD が直近 RECENT_HOURS 時間以内に動いたか。 */
export function isRecentlyActive(lastActivityMs, nowMs) {
  if (lastActivityMs == null) return false;
  return nowMs - lastActivityMs < RECENT_HOURS * 60 * 60 * 1000;
}

/**
 * worktree 1本を分類する。
 * - locked   : 他のセッションが使っている（git のロック、または中にプロセスがいる）
 * - blocked  : 触ってはいけない（未コミット変更、または取り直しの効かないデータがある）
 * - active   : マージを確認できない。作業中
 * - recent   : マージ済みだが直近に HEAD が動いた。セッションが続いている可能性がある
 * - removable: PR がマージ済みで中身も空。消してよい
 */
export function classify({
  merged,
  dirtyCount,
  precious,
  locked,
  inUse = false,
  recent = false,
}) {
  // ロックは他のセッションが今そこで作業している印。マージ済みでも触らない。
  // 2026-09-25、この判定が無かったため「片付けてよい」に他セッションの
  // 作業ツリーが2本並び、git 側のロックだけが削除を止めた。
  // デスクトップアプリ（Codeタブ）のセッションはロックを掛けないため、
  // 中にプロセスがいること（inUse）も同じ扱いにする（2026-09-28）。
  if (locked || inUse) return "locked";
  if (precious.length > 0 || dirtyCount > 0) return "blocked";
  if (!merged) return "active";
  return recent ? "recent" : "removable";
}

/**
 * 全プロセスのカレントディレクトリ。`lsof +D` は配下を全走査して重いので
 * cwd だけを見る。取得できなければ null（＝使用中かどうか分からない）。
 */
function listProcessCwds() {
  try {
    return parseCwdPaths(
      execFileSync("lsof", ["-a", "-d", "cwd", "-Fn"], {
        encoding: "utf8",
        timeout: LSOF_TIMEOUT_MS,
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 16 * 1024 * 1024,
      }),
    );
  } catch (err) {
    // 権限の無いプロセスがあると lsof は非0で終わるが、読めた分の出力は有効
    if (typeof err.stdout === "string" && err.stdout.length > 0) {
      return parseCwdPaths(err.stdout);
    }
    return null;
  }
}

/** マージ済み PR の {headRefName, headRefOid}。取得できなければ null。 */
function listMergedPrs() {
  try {
    return JSON.parse(
      execFileSync(
        "gh",
        [
          "pr",
          "list",
          "--state",
          "merged",
          "--limit",
          "1000",
          "--json",
          "headRefName,headRefOid",
        ],
        {
          encoding: "utf8",
          timeout: GH_TIMEOUT_MS,
          cwd: repoRoot,
          stdio: ["ignore", "pipe", "ignore"],
        },
      ),
    );
  } catch {
    return null;
  }
}

/**
 * HEAD と reflog の最終更新時刻（worktree 作成・checkout・commit・reset で動く）。
 * index は自分の `git status` が書き換えうるので見ない。
 */
function lastHeadActivityMs(worktreePath) {
  const gitDir = git(["rev-parse", "--absolute-git-dir"], worktreePath);
  if (!gitDir) return null;
  const times = ["HEAD", "logs/HEAD"]
    .map((f) => path.join(gitDir, f))
    .filter((f) => existsSync(f))
    .map((f) => statSync(f).mtimeMs);
  return times.length > 0 ? Math.max(...times) : null;
}

function main() {
  const porcelain = git(["worktree", "list", "--porcelain"]);
  if (!porcelain) {
    console.error("worktree の一覧を取得できませんでした");
    process.exit(1);
  }

  const entries = selectManagedWorktrees(parseWorktrees(porcelain), repoRoot);
  const mergedPrs = listMergedPrs();
  const cwds = listProcessCwds();
  const now = Date.now();

  const rows = entries.map((e) => {
    // git status より先に読む
    const recent = isRecentlyActive(lastHeadActivityMs(e.path), now);
    const dirty = git(["status", "--short"], e.path);
    const dirtyCount = dirty ? dirty.split("\n").filter(Boolean).length : 0;
    const precious = PRECIOUS_PATHS.filter((p) =>
      existsSync(path.join(e.path, p)),
    );
    const tip = e.branch ? git(["rev-parse", e.branch]) : null;
    const merged = isMergedByPr({ branch: e.branch, tip, mergedPrs });
    // cwd を取れなかったときは使用中の可能性を否定できないので使用中扱い
    const inUse = cwds === null || hasProcessInside(e.path, cwds);
    // gitが追跡しないもの（node_modules 等）が残っていると
    // `git worktree remove` は "Directory not empty" で失敗する。
    // 消してよいものではあるので削除対象からは外さず、--force が要ると示す。
    const needsForce = UNTRACKED_LEFTOVERS.some((d) =>
      existsSync(path.join(e.path, d)),
    );
    return {
      ...e,
      dirtyCount,
      precious,
      merged,
      inUse,
      needsForce,
      kind: classify({
        merged,
        dirtyCount,
        precious,
        locked: e.locked,
        inUse,
        recent,
      }),
    };
  });

  const removable = rows.filter((r) => r.kind === "removable");
  const blocked = rows.filter((r) => r.kind === "blocked");
  const active = rows.filter((r) => r.kind === "active");
  const locked = rows.filter((r) => r.kind === "locked");
  const recent = rows.filter((r) => r.kind === "recent");

  console.log(`worktree ${rows.length}本（メインの作業ツリーを除く）`);
  console.log(
    `  片付けてよい: ${removable.length} / 使用中: ${locked.length} / 触らない: ${blocked.length} / 作業中: ${active.length} / 直近に操作あり: ${recent.length}`,
  );
  if (mergedPrs === null) {
    console.log("");
    console.log(
      "  gh でマージ済みPRを取得できなかったため、マージ済みを判定していません（片付け対象は0件になります）。",
    );
  }
  if (cwds === null) {
    console.log("");
    console.log(
      "  lsof でプロセスの作業ディレクトリを取得できなかったため、全件を使用中として扱っています。",
    );
  }

  if (locked.length > 0) {
    console.log("");
    console.log("## 使用中（他のセッションが使っている。触らない）");
    for (const r of locked) {
      console.log(`  ${path.basename(r.path)}  [${r.branch ?? "detached"}]`);
      console.log(
        `    ${r.locked ?? "中で動いているプロセスがある（デスクトップアプリのセッション等）"}`,
      );
    }
    console.log("");
    console.log(
      "  そのセッションが終わるまで待つ。ロックは git 側の安全装置なので -f で外さない。",
    );
  }

  if (blocked.length > 0) {
    console.log("");
    console.log(
      "## 触らない（未コミットの変更、または取り直しの効かないデータがある）",
    );
    for (const r of blocked) {
      const why = [];
      if (r.precious.length > 0) why.push(`データ: ${r.precious.join(", ")}`);
      if (r.dirtyCount > 0) why.push(`未コミット${r.dirtyCount}件`);
      console.log(
        `  ${path.basename(r.path)}  [${r.branch ?? "detached"}]  ${why.join(" / ")}`,
      );
    }
    const withData = blocked.filter((r) => r.precious.length > 0);
    if (withData.length > 0) {
      console.log("");
      console.log(
        "  このうちデータを抱えているものは、worktreeごと消えると復元できません。",
      );
      console.log(
        "  リポジトリ外（例: ~/boatrace-archive-backup/）へ退避してください。",
      );
    }
  }

  if (active.length > 0) {
    console.log("");
    console.log(
      "## 作業中（マージ済みPRを確認できない。コミット前の作業開始直後も含む）",
    );
    for (const r of active) {
      console.log(`  ${path.basename(r.path)}  [${r.branch ?? "detached"}]`);
    }
  }

  if (recent.length > 0) {
    console.log("");
    console.log(
      `## 直近${RECENT_HOURS}時間以内に操作あり（PRはマージ済み。セッションが続いている可能性があるので待つ）`,
    );
    for (const r of recent) {
      console.log(`  ${path.basename(r.path)}  [${r.branch ?? "detached"}]`);
    }
  }

  if (removable.length > 0) {
    console.log("");
    console.log(
      "## 片付けてよい（PRマージ済み・未コミットなし・データなし・使用中のプロセスなし）",
    );
    for (const r of removable) {
      // node_modules 等が残っているものは --force が無いと
      // "Directory not empty" で失敗する
      console.log(
        `  git worktree remove ${r.needsForce ? "--force " : ""}${r.path}`,
      );
    }
    console.log("");
    console.log(
      "  上のコマンドは自動実行しません。内容を確認してから実行してください。",
    );
  }
}

const invokedDirectly =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) main();
