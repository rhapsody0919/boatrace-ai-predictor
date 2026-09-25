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
 * 検証: scripts/maintenance/verify-git-hygiene.js
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRECIOUS_PATHS } from "../lib/preciousPaths.js";
import { parseWorktrees, selectManagedWorktrees } from "./check-git-hygiene.js";

const DEFAULT_BRANCH = "origin/master";
const GIT_TIMEOUT_MS = 10000;

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

function isMerged(branch) {
  try {
    execFileSync(
      "git",
      ["merge-base", "--is-ancestor", branch, DEFAULT_BRANCH],
      {
        timeout: GIT_TIMEOUT_MS,
        cwd: repoRoot,
        stdio: "ignore",
      },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * worktree 1本を分類する。
 * - blocked : 触ってはいけない（未コミット変更、または取り直しの効かないデータがある）
 * - removable: マージ済みで中身も空。消してよい
 * - active  : 未マージ。作業中
 */
export function classify({ merged, dirtyCount, precious, locked }) {
  // ロックは他のセッションが今そこで作業している印。マージ済みでも触らない。
  // 2026-09-25、この判定が無かったため「片付けてよい」に他セッションの
  // 作業ツリーが2本並び、git 側のロックだけが削除を止めた。
  if (locked) return "locked";
  if (precious.length > 0 || dirtyCount > 0) return "blocked";
  return merged ? "removable" : "active";
}

function main() {
  const porcelain = git(["worktree", "list", "--porcelain"]);
  if (!porcelain) {
    console.error("worktree の一覧を取得できませんでした");
    process.exit(1);
  }

  const entries = selectManagedWorktrees(parseWorktrees(porcelain), repoRoot);

  git(["fetch", "origin", "master", "--quiet"]);

  const rows = entries.map((e) => {
    const dirty = git(["status", "--short"], e.path);
    const dirtyCount = dirty ? dirty.split("\n").filter(Boolean).length : 0;
    const precious = PRECIOUS_PATHS.filter((p) =>
      existsSync(path.join(e.path, p)),
    );
    const merged = e.branch ? isMerged(e.branch) : false;
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
      needsForce,
      kind: classify({ merged, dirtyCount, precious, locked: e.locked }),
    };
  });

  const removable = rows.filter((r) => r.kind === "removable");
  const blocked = rows.filter((r) => r.kind === "blocked");
  const active = rows.filter((r) => r.kind === "active");
  const locked = rows.filter((r) => r.kind === "locked");

  console.log(`worktree ${rows.length}本（メインの作業ツリーを除く）`);
  console.log(
    `  片付けてよい: ${removable.length} / 使用中: ${locked.length} / 触らない: ${blocked.length} / 作業中: ${active.length}`,
  );

  if (locked.length > 0) {
    console.log("");
    console.log("## 使用中（他のセッションがロックしている。触らない）");
    for (const r of locked) {
      console.log(`  ${path.basename(r.path)}  [${r.branch ?? "detached"}]`);
      console.log(`    ${r.locked}`);
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
    console.log("## 作業中（origin/master に未マージ）");
    for (const r of active) {
      console.log(`  ${path.basename(r.path)}  [${r.branch ?? "detached"}]`);
    }
  }

  if (removable.length > 0) {
    console.log("");
    console.log("## 片付けてよい（マージ済み・未コミットなし・データなし）");
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
