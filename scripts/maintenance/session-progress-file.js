#!/usr/bin/env node
/**
 * SessionStart・Stop: claude/ の枝で働くセッションごとに進捗の一枚（リポジトリの外
 * ~/.config/ryujin/progress/session-<セッションの id>.md）を持たせる（設計 docs/design/harness-migration/dev-friction-2026-11-25.md §2）。
 *
 * 目的: セッションが文脈を失った後に続きから始められること。状態・待ちは窓口のボードが PR・CI・セッションの状態から
 * 出すので書かせない（2026-11-26 オーナー）。一枚はゴール・枝と PR・判断・次にやることだけ。
 * 単位は枝でなくセッション（1つのレーンが PR ごとに枝を切ると、枝の数だけ同じ中身が複製されていた）。
 * 前のセッションの id の一枚が無く、今の枝の名の一枚（11/26 までの置き方）があればそれを渡す（続きを失わない）。
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
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { safeStateKey } from "./session-progress.js";

export const MAX_CONTEXT_BYTES = 8000;
// 一枚を書いた直後の PostToolUse が編集の時刻を少し後に進めるので、その分は「一枚の後に変えた」と数えない（目安・根拠なし）
export const WRITE_MARGIN_MS = 30 * 1000;
export const HEADINGS = [
  "ゴール",
  "枝と PR（#番号）",
  "判断の記録（日付つき）",
  "次にやること",
];

/** 一枚の置き場（枝の名の / は __ に） */
export function progressPath(branch, dir) {
  return path.join(dir, `${branch.replace(/\//g, "__")}.md`);
}

/** セッションごとの一枚の置き場。id が読めなければ null */
export function sessionProgressPath(sessionId, dir) {
  const key = safeStateKey(sessionId);
  return key ? path.join(dir, `session-${key}.md`) : null;
}

/**
 * 使う一枚を選ぶ。書く先はいつもセッションの一枚（id が読めなければ枝の一枚）。
 * 読む物は、セッションの一枚が無く枝の一枚（旧い置き方）があればそれ
 * @param {{sessionFile: string|null, branchFile: string, exists: (f: string) => boolean}} o
 */
export function chooseProgressFile({
  sessionFile,
  branchFile,
  exists,
  sameBranchFile = null,
}) {
  const write = sessionFile ?? branchFile;
  const read = exists(write)
    ? write
    : sameBranchFile && exists(sameBranchFile)
      ? sameBranchFile
      : exists(branchFile)
        ? branchFile
        : null;
  return { write, read };
}

/** 一枚の1行目に書かせる枝の名（窓口は grep -l "branch: <枝>" で引く。片付けもこれで枝と結ぶ） */
export function branchLine(branch) {
  return `branch: ${branch}`;
}

/**
 * 同じ枝の別のセッションの一枚（新しく始めたセッションで続きを渡す）。1行目が branch: <枝> の物のうち最も新しい物
 * @param {{name: string, firstLine: string, mtimeMs: number}[]} files session-*.md の一覧
 */
export function latestSameBranch(files, branch, self) {
  const hits = files
    .filter((f) => f.name !== self && f.firstLine.trim() === branchLine(branch))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return hits[0]?.name ?? null;
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
export function startContext({ file, content, from = file }) {
  if (content === null) {
    return [
      `[進捗の一枚] このセッションの進捗を ${file} に書く（リポジトリの外。1セッション1枚。PR ごとに枝を切っても同じ一枚に書く）。1行目は「${branchLine("<今の枝>")}」（窓口が枝で引く）。`,
      `見出し: ${HEADINGS.join("・")}（状態・待ちは窓口のボードが PR と CI から出すので書かない）`,
    ].join("\n");
  }
  const body = Buffer.from(content).subarray(0, MAX_CONTEXT_BYTES).toString();
  const moved =
    from === file
      ? ""
      : `。旧い置き方 ${from} から読んだ。以後は ${file} に書く`;
  return `[進捗の一枚] ${from}（前のセッションの続き${moved}）\n\n${body}`;
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
    reason: `進捗の一枚（${file}）がこのセッションの作業に追いついていない。枝と PR・判断・次にやることを更新してから終える（見出し: ${HEADINGS.join("・")}）`,
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

/** 置き場の session-*.md から同じ枝の最新の一枚を探す（読めなければ null） */
function sameBranchIn(dir, branch, self) {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((n) => /^session-.*\.md$/.test(n))
    .map((n) => {
      const full = path.join(dir, n);
      const firstLine = readFileSync(full, "utf8").split("\n", 1)[0] ?? "";
      return { name: full, firstLine, mtimeMs: statSync(full).mtimeMs };
    });
  return latestSameBranch(files, branch, self);
}

/** このセッションの一枚（書く先・中身・読んだ元） */
function progressFor(sessionId, branch) {
  const dir =
    process.env.RYUJIN_PROGRESS_DIR ||
    path.join(os.homedir(), ".config/ryujin/progress");
  const sessionFile = sessionProgressPath(sessionId, dir);
  const chosen = chooseProgressFile({
    sessionFile,
    branchFile: progressPath(branch, dir),
    exists: existsSync,
    sameBranchFile: sameBranchIn(dir, branch, sessionFile),
  });
  const content = chosen.read === null ? null : readOrNull(chosen.read);
  return { file: chosen.write, content, from: chosen.read ?? chosen.write };
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
  const { file, content, from } = progressFor(payload?.session_id, branch);
  if (event === "start") {
    const additionalContext = startContext({
      file,
      content,
      from,
    });
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
    progressMtime: existsSync(file) ? statSync(file).mtimeMs : null,
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
