#!/usr/bin/env node
/**
 * session-progress.js の判定を検証する。
 *
 * このフックが壊れると「セッションが長くなっても何も言わなくなる」だけで、
 * 静かに無効化される。検知そのものが消えても誰も気づかないので、
 * 通知する側・しない側の両方を固定の入力で確かめる。
 */

import {
  buildNotice,
  estimateAdherence,
  safeStateKey,
  shouldNotify,
} from "./session-progress.js";
import {
  MAX_CONTEXT_BYTES,
  WRITE_MARGIN_MS,
  applies,
  isDone,
  progressPath,
  startContext,
  stopDecision,
} from "./session-progress-file.js";

const failures = [];
let checked = 0;

function check(label, actual, expected) {
  checked += 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(
      `${label}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`,
    );
  }
}

// --- 遵守オッズの推定（arXiv 2605.10039 の OR=0.944/関数） ---
check("編集0回なら初期値", estimateAdherence(0), 1);
check("20回で約1/3", Math.round(estimateAdherence(20) * 100), 32);
check("40回で約1/10", Math.round(estimateAdherence(40) * 100), 10);
check("単調に下がる", estimateAdherence(10) > estimateAdherence(11), true);

// --- 通知のタイミング ---
check("閾値未満では黙る(19)", shouldNotify(19), false);
check("閾値未満では黙る(1)", shouldNotify(1), false);
check("閾値ちょうどで知らせる(20)", shouldNotify(20), true);
check("次の1回では知らせない(21)", shouldNotify(21), false);
check("間隔ごとに再通知(30)", shouldNotify(30), true);
check("間隔ごとに再通知(40)", shouldNotify(40), true);
check("間隔の途中では黙る(35)", shouldNotify(35), false);
// 毎回出すと無視されるようになるので、20〜60の間で出るのは5回だけ
check(
  "20〜60で通知するのは5回",
  Array.from({ length: 41 }, (_, i) => shouldNotify(i + 20)).filter(Boolean)
    .length,
  5,
);

// --- セッションIDの正規化（状態ファイル名に使う） ---
check("通常のUUID", safeStateKey("a1b2-c3d4-e5f6"), "a1b2-c3d4-e5f6");
check("パス区切りを落とす", safeStateKey("../../etc/passwd"), "etcpasswd");
check("ドットを落とす", safeStateKey("a.b.c"), "abc");
check("空文字", safeStateKey(""), null);
check("空白のみ", safeStateKey("   "), null);
check("文字列でない", safeStateKey(null), null);
check("記号だけなら使わない", safeStateKey("///"), null);
check("長すぎる場合は切る", safeStateKey("x".repeat(200)).length, 128);

// --- 通知の中身 ---
const notice = buildNotice(20);
check("編集回数が入る", notice.includes("20 回目"), true);
check("推定値が入る", notice.includes("32%"), true);
check("Agentの選択肢がある", notice.includes("Agent で起動"), true);
check("spawn_taskの選択肢がある", notice.includes("spawn_task"), true);
check("新セッションの選択肢がある", notice.includes("新しい worktree"), true);
check("続行の選択肢もある", notice.includes("コミットしてから続ける"), true);
check(
  "ユーザーに聞かせない",
  notice.includes("ユーザーに聞かず、自分で決めて"),
  true,
);
check("根拠を示す", notice.includes("arXiv 2605.10039"), true);

// --- 進捗の一枚（session-progress-file.js、設計 docs/design/harness-migration/dev-friction-2026-11-25.md §2） ---
check(
  "置き場: 枝の / は __",
  progressPath("claude/a-b", "/p"),
  "/p/claude__a-b.md",
);
check(
  "claude/ の worktree だけ動く",
  [
    applies({ branch: "claude/x", isLinkedWorktree: true }),
    applies({ branch: "claude/x", isLinkedWorktree: false }),
    applies({ branch: "master", isLinkedWorktree: true }),
    applies({ branch: "", isLinkedWorktree: true }),
  ],
  [true, false, false, false],
);
check(
  "一枚が無ければ置き場と見出しを知らせる",
  startContext({ file: "/p/f.md", content: null }).includes("/p/f.md に書く"),
  true,
);
check(
  "一枚があれば上限まで中身を渡す",
  startContext({ file: "/p/f.md", content: "あ".repeat(MAX_CONTEXT_BYTES) })
    .length < MAX_CONTEXT_BYTES,
  true,
);
check(
  "完了の一枚",
  [
    isDone("## 状態\n完了\n"),
    isDone("状態: 完了"),
    isDone("## 状態（調査中・実行中・待ち・完了）\n実行中\n"),
  ],
  [true, true, false],
);
const T = Date.parse("2026-11-25T12:00:00Z");
const stop = (o) =>
  stopDecision({
    stopHookActive: false,
    lastEditAt: T,
    progressMtime: null,
    content: null,
    file: "/p/f.md",
    ...o,
  });
check("変えたのに一枚が無ければ1回止める", stop({})?.decision, "block");
check(
  "止めた後の Stop（stop_hook_active）は通す＝1回だけ",
  stop({ stopHookActive: true }),
  null,
);
check(
  "このセッションで変えていなければ止めない（読んだだけ）",
  stop({ lastEditAt: NaN }),
  null,
);
check(
  "一枚が最後の変更より新しければ止めない",
  stop({ progressMtime: T + 1, content: "実行中" }),
  null,
);
check(
  "一枚を書いた直後の編集の時刻のずれは数えない",
  stop({ progressMtime: T - WRITE_MARGIN_MS, content: "実行中" }),
  null,
);
check(
  "一枚より後に変えたら止める",
  stop({ progressMtime: T - WRITE_MARGIN_MS - 1, content: "実行中" })?.decision,
  "block",
);
check(
  "完了の一枚は見ない",
  stop({ progressMtime: 0, content: "状態: 完了" }),
  null,
);

if (failures.length > 0) {
  console.error("NG: セッション長の判定が期待どおりに動いていません");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`OK: セッション長の判定${checked}件を検証`);
