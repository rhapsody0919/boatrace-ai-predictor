#!/usr/bin/env node
/**
 * PostToolUse(Edit|Write): セッションが長くなったことを検知して、切り出しの判断を促す。
 *
 * ## なぜ要るか
 *
 * Claude Code CLI 1,650セッション・16,050の関数レベル観測を使った factorial study
 * （[arXiv 2605.10039](https://arxiv.org/abs/2605.10039)）が、指示の遵守について次を報告している。
 *
 * - CLAUDE.md の**サイズ・指示の位置・ファイル構成・隣接ファイル間の矛盾**の4変数は、
 *   2要因交互作用も含めて多重比較補正後に**検出可能な差が無い**（サイズと矛盾は
 *   BF10 0.05〜0.10 で帰無仮説を積極的に支持）
 * - 唯一はっきり出た効果は**セッション内の劣化**で、
 *   **関数を1つ生成するごとに指示遵守のオッズが約5.6%低下する（OR = 0.944）**。
 *   2つ目のコードベースでも Opus 4.6 でも再現している
 *
 * つまり「ルールの書き方を工夫する」では遵守率は上がらず、効くのは
 * **1セッションで生成する量を減らすこと**。このプロジェクトは10前後のセッションを
 * 長時間走らせる運用なので、この劣化を最大化している。
 *
 * 「作業単位ごとにコミットする」というGit安全策は既にあるが、あれは他セッションの
 * 変更を巻き込まないための規律で、指示遵守率の話ではなかった。ここでは
 * **遵守率の対策として**、長くなった時点で切り出しを判断させる。
 *
 * ## 何をするか
 *
 * Edit / Write のたびに、そのセッションの編集回数を数える。閾値を超えたら
 * `additionalContext` で、現在の推定遵守率と、切り出しの選択肢を返す。
 * 人間に聞くのではなく、Claude 自身がその場で判断するための材料を渡す。
 *
 * サブエージェント内の編集（`agent_id` が付く）は数えない。親セッションの
 * コンテキスト長とは別で、サブエージェントは短命に終わるため。
 *
 * 状態は `.claude/session-state/<session_id>.json`（バージョン管理の対象外）。
 *
 * 検証: scripts/maintenance/verify-session-progress.js
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 関数1つあたりの遵守オッズ比（arXiv 2605.10039）。 */
const ODDS_RATIO_PER_UNIT = 0.944;
/** 最初に知らせる編集回数。0.944^20 ≒ 0.32 で、オッズが約1/3になるあたり。 */
const FIRST_NOTICE_AT = 20;
/** 以降、この間隔で再通知する。毎回出すとうるさく、無視されるようになる。 */
const NOTICE_INTERVAL = 10;

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const STATE_DIR = path.join(repoRoot, ".claude/session-state");

/** 初期を1としたときの、現時点の推定遵守オッズ。 */
export function estimateAdherence(edits) {
  return ODDS_RATIO_PER_UNIT ** edits;
}

/** この編集回数で知らせるべきか。 */
export function shouldNotify(edits) {
  if (edits < FIRST_NOTICE_AT) return false;
  return (edits - FIRST_NOTICE_AT) % NOTICE_INTERVAL === 0;
}

/** セッションIDをファイル名に使える形にする（パス区切りなどを落とす）。 */
export function safeStateKey(sessionId) {
  if (typeof sessionId !== "string" || sessionId.trim() === "") return null;
  const cleaned = sessionId.replace(/[^A-Za-z0-9_-]/g, "");
  return cleaned === "" ? null : cleaned.slice(0, 128);
}

/** 通知本文。判断の選択肢を、その場で読める形で並べる。 */
export function buildNotice(edits) {
  const pct = Math.round(estimateAdherence(edits) * 100);
  return [
    `[セッションの長さ] このセッションで ${edits} 回目のファイル編集。`,
    `指示遵守のオッズは初期比で約 ${pct}%（関数1つごとに5.6%低下、arXiv 2605.10039）。`,
    "",
    "次の作業に入る前に、切り出せないか判断すること。ユーザーに聞かず、自分で決めて一言報告する。",
    "  - 今のタスクの続きで、切り離せない → 作業単位でコミットしてから続ける",
    "  - 今すぐ結果が要る調査・検証 → Agent で起動する（親のコンテキストを汚さない）",
    "  - 今は手が回らない別スコープの改善点 → spawn_task で切り出す",
    "  - 元の依頼と目的が別物、または別ディレクトリ・別リポジトリ → 新しい worktree と新セッション",
    "",
    "この判定は長さだけを見ている。タスクの性質による切り分けは",
    ".claude/CLAUDE.md「セッション内のスコープ管理」が正本。",
  ].join("\n");
}

function readState(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return Number.isInteger(parsed?.edits) ? parsed : { edits: 0 };
  } catch {
    return { edits: 0 };
  }
}

/** 書き込みは一時ファイル経由。途中で落ちてもカウントが壊れないように。 */
function writeState(file, state) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(state), "utf8");
  renameSync(tmp, file);
}

function main() {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0);
  }

  // サブエージェント内の編集は親セッションの長さではない
  if (payload?.agent_id) process.exit(0);

  const key = safeStateKey(payload?.session_id);
  if (!key) process.exit(0);

  let state;
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    const file = path.join(STATE_DIR, `${key}.json`);
    state = readState(file);
    state.edits += 1;
    state.updatedAt = new Date().toISOString();
    writeState(file, state);
  } catch {
    process.exit(0); // 記録できなくても作業は止めない
  }

  if (!shouldNotify(state.edits)) process.exit(0);

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: buildNotice(state.edits),
      },
    }),
  );
}

const invokedDirectly =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) main();
