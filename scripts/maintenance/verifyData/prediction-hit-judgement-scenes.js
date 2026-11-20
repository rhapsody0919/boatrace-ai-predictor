/**
 * verify-prediction-hit-judgement.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-prediction-hit-judgement.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

let MIGRATION, check, evaluateTrigger, hit;

const SQL_MUTANTS = [
  [
    "トリガー: 単勝の返還艇の確認を外す",
    "judgeable AND NOT (q.top_pick = ANY (refunded)) AS win",
    "judgeable AS win",
  ],
  [
    "トリガー: 不成立を見ない",
    "AND NEW.race_status IS DISTINCT FROM 'no_race';",
    ";",
  ],
  [
    "トリガー: rank1 が無いと展開予測を消す",
    "CASE WHEN NEW.race_status = 'no_race' THEN NULL ELSE p.is_hit_turn END",
    "CASE WHEN judgeable THEN p.is_hit_turn END",
  ],
  [
    "トリガー: 発火条件に race_status を入れない",
    "payout_trio,\n  race_status, refund_boats",
    "payout_trio",
  ],
  [
    "トリガー: 外れの配当を NULL に戻す",
    "THEN COALESCE(NEW.payout_trio, 0)\n            ELSE 0",
    "THEN COALESCE(NEW.payout_trio, 0)\n            ELSE NULL",
  ],
];

async function scene1() {
  for (const [label, from, to] of SQL_MUTANTS) {
    const failed = MIGRATION.includes(from)
      ? await evaluateTrigger(
          MIGRATION.replace(from, to),
          hit.buildPredictionHitUpdate,
        )
      : [];
    check(
      `(e) 変異検証: ${label} → 検証が失敗する（${failed.length}項目）`,
      failed.length > 0,
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（MIGRATION・check・evaluateTrigger・hit） */
export async function runPredictionHitJudgementScenes1(env) {
  ({ MIGRATION, check, evaluateTrigger, hit } = env);
  await scene1();
}
