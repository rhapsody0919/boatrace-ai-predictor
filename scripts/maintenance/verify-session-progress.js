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

if (failures.length > 0) {
  console.error("NG: セッション長の判定が期待どおりに動いていません");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`OK: セッション長の判定${checked}件を検証`);
