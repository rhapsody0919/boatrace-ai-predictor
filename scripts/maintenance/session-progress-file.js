#!/usr/bin/env node
/**
 * SessionStart・Stop: claude/ の枝の作業ごとに進捗の一枚（リポジトリの外 ~/.config/ryujin/progress/<枝>.md）を持たせる
 * （設計 docs/design/harness-migration/dev-friction-2026-11-25.md §2）。
 *
 * 目的: 窓口が子のセッションの400字の通知から状況を組み直す手間を減らす。窓口は子の枝の名で一枚を読む。
 * - SessionStart: claude/ の枝の worktree（メインの作業ツリーでない）だけ。一枚があれば中身（8000 バイトまで）を渡し、
 *   無ければ置き場とひな形の見出しを知らせる
 * - Stop: このセッションで最後にファイルを変えた時刻（session-progress.js の .claude/session-state/<id>.json の updatedAt）が
 *   一枚より新しいときだけ、一度止めて更新を頼む。stop_hook_active が true なら通す（止めるのは1回だけ）。
 *   読んで答えただけのセッション（変えていない）は止めない。状態が「完了」の一枚は見ない。中身の良し悪しは見ない
 * - 見逃す物（止めない側なので許す）: Bash だけの書き換え、「完了」にした後の作業
 * - 読めない・書けない・node が無いときは黙って通す（作業を止めない）
 *
 * 検証: scripts/maintenance/verify-session-progress.js（進捗の一枚の節）
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { safeStateKey } from "./session-progress.js";

export const MAX_CONTEXT_BYTES = 8000;
// 一枚を書いた直後の PostToolUse が編集の時刻を少し後に進めるので、その分は「一枚の後に変えた」と数えない（目安・根拠なし）
export const WRITE_MARGIN_MS = 30 * 1000;
export const HEADINGS = [
  "状態（調査中・実行中・待ち・完了）",
  "待ち（誰の何を）",
  "枝と PR",
  "ゴール",
  "完了の条件（[x] と根拠）",
  "分かったこと",
  "次にやること",
  "判断の記録（日付つき）",
];

/** 一枚の置き場（枝の名の / は __ に） */
export function progressPath(branch, dir) {
  return path.join(dir, `${branch.replace(/\//g, "__")}.md`);
}

/** 動く枝か（claude/ の枝の worktree だけ） */
export function applies({ branch, isLinkedWorktree }) {
  return (
    isLinkedWorktree &&
    typeof branch === "string" &&
    branch.startsWith("claude/")
  );
}

/** SessionStart で渡す文 */
export function startContext({ file, content }) {
  if (content === null) {
    return [
      `[進捗の一枚] この作業の進捗を ${file} に書く（リポジトリの外。窓口が枝の名で読む）。`,
      `見出し: ${HEADINGS.join("・")}`,
      "-v2 で作り直したときは、頭に旧い枝の名を書く。",
    ].join("\n");
  }
  const body = Buffer.from(content).subarray(0, MAX_CONTEXT_BYTES).toString();
  return `[進捗の一枚] ${file}（前のセッションの続き）\n\n${body}`;
}

/** 一枚の状態が「完了」か */
export function isDone(content) {
  return (
    /^#*\s*状態[^\n]*\n+\s*[-*]?\s*完了/m.test(content ?? "") ||
    /^状態[:：]\s*完了/m.test(content ?? "")
  );
}

/**
 * Stop で止めるか（止めないなら null）
 * @param {{stopHookActive: boolean, lastEditAt: number|null, progressMtime: number|null, content: string|null, file: string}} s
 */
export function stopDecision({
  stopHookActive,
  lastEditAt,
  progressMtime,
  content,
  file,
}) {
  if (stopHookActive) return null;
  if (!Number.isFinite(lastEditAt)) return null; // このセッションでは変えていない
  if (content !== null && isDone(content)) return null;
  if (
    Number.isFinite(progressMtime) &&
    lastEditAt - progressMtime <= WRITE_MARGIN_MS
  )
    return null;
  return {
    decision: "block",
    reason: `進捗の一枚（${file}）がこのセッションの作業に追いついていない。状態・待ち・枝と PR・次にやることを更新してから終える（見出し: ${HEADINGS.join("・")}）`,
  };
}

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function readOrNull(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

function main(event) {
  const payload = JSON.parse(readFileSync(0, "utf8"));
  if (payload?.agent_id) return;
  const cwd = payload?.cwd || process.cwd();
  const branch = git(cwd, ["branch", "--show-current"]);
  const isLinkedWorktree =
    path.resolve(cwd, git(cwd, ["rev-parse", "--git-dir"])) !==
    path.resolve(cwd, git(cwd, ["rev-parse", "--git-common-dir"]));
  if (!applies({ branch, isLinkedWorktree })) return;
  const dir =
    process.env.RYUJIN_PROGRESS_DIR ||
    path.join(os.homedir(), ".config/ryujin/progress");
  const file = progressPath(branch, dir);
  const content = readOrNull(file);
  if (event === "start") {
    const additionalContext = startContext({ file, content });
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext,
        },
      }),
    );
    return;
  }
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const key = safeStateKey(payload?.session_id);
  const state = key
    ? JSON.parse(
        readOrNull(path.join(root, ".claude/session-state", `${key}.json`)) ??
          "{}",
      )
    : {};
  const decision = stopDecision({
    stopHookActive: payload?.stop_hook_active === true,
    lastEditAt: Date.parse(state.updatedAt ?? ""),
    progressMtime: content === null ? null : statSync(file).mtimeMs,
    content,
    file,
  });
  if (decision) process.stdout.write(JSON.stringify(decision));
}

const invokedDirectly =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  try {
    main(process.argv[2] === "--stop" ? "stop" : "start");
  } catch {
    // 読めない・git が無い等。作業は止めない
  }
}
