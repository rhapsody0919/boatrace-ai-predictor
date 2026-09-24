/**
 * check-prediction-odds-shadow.js - 買い目オッズ（BOA-404、tasks.md T4b-10-3）の導出のshadow検証（読み取りのみ。
 * DBへは書き込まない。select しか呼ばない）。
 *
 * race_odds の最新スナップショット（trifecta_all・trio_all）から導出した prediction_odds の値と、
 * GitHub Actions側のA4（scripts/daily/scrape-prediction-odds.js、5分ごと）が実際に書いた最終値を比べる。
 * Vercel側の導出（scrape_job_state の job='prediction_odds' が shadow の間は prediction_odds へ一切書かないため、
 * DBに残っている値は常にA4が書いた最終値のまま。このスクリプトは、その値と「今A3のスナップショットから
 * 導出したら何が書かれるか」を比べることで、本番切替（liveへの変更・A4のGHA停止）前の妥当性を確認する。
 *
 *   node --env-file=.env.local scripts/maintenance/check-prediction-odds-shadow.js
 *   node --env-file=.env.local scripts/maintenance/check-prediction-odds-shadow.js --date=2026-09-24
 *   node --env-file=.env.local scripts/maintenance/check-prediction-odds-shadow.js --strict
 *     # 買い目の一致率99%未満、または3連単オッズのp90差が32%（T4b-10-1の実測の目安）を超えると終了コード1
 *
 * 出力:
 *   - 対象レース数（当日のスケジュール。発走前・発走後を問わない。両方に取得済みの値があるレースだけが比較対象）
 *   - 買い目の一致率（モデル×券種ごとに、導出した買い目とA4の買い目が一致した割合）
 *   - 一致した組の、3連単・3連複オッズの%差（p50・p90。T4b-10-1の実測: 中央値8.8%・12.1%、p90 32%・42%が目安）
 *   - 導出できなかった件数（予測が無い・race_odds のスナップショットが無い）
 *
 * 値は数分で変わるため、絶対値の一致は期待しない（trioKeyOf・buildPredictionOddsRow は決定的だが、race_odds の
 * スナップショットの新しさに応じて値が変わる。詳細は scripts/lib/predictionOddsDerive.js 冒頭のコメント）。
 */
import { createClient } from "@supabase/supabase-js";
import { getRaceSchedule } from "../lib/raceSchedule.js";
import {
  deriveRowsForRaces,
  buildShadowDigest,
} from "../lib/scrapeJobs/predictionOddsHandlers.js";

/** --strict の目安（T4b-10-1の実測: 3連単の差はp90 32%） */
export const STRICT_MAX_TRIFECTA_P90_PCT = 32;
export const STRICT_MIN_COMBO_MATCH_RATE = 0.99;

const jstToday = () =>
  new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

async function main() {
  const args = process.argv.slice(2);
  const arg = (name) =>
    args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const strict = args.includes("--strict");
  const date = arg("date") ?? jstToday();

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("❌ SUPABASE_URL・SUPABASE_SERVICE_KEY が必要です");
    process.exit(1);
  }
  const client = createClient(url, key);

  const schedule = await getRaceSchedule(date, { client, throwOnError: true });
  const raceIds = schedule.map((r) => r.race_id);
  console.log(`対象日 ${date}: ${raceIds.length}レース\n`);
  if (raceIds.length === 0) {
    console.log("対象レースがありません（スケジュール未登録）");
    return;
  }

  const derived = await deriveRowsForRaces({ raceIds, client });
  console.log(
    `導出できたレース: ${derived.length}/${raceIds.length}件（予測・race_oddsの両方が揃っているレースのみ）`,
  );

  const digest = await buildShadowDigest({ client, derived });
  const matchRate =
    digest.sampleSize === 0
      ? null
      : (digest.sampleSize - digest.comboMismatch) / digest.sampleSize;
  console.log(
    `\n比較できた組（モデル×券種）: ${digest.sampleSize}件 / 買い目の不一致: ${digest.comboMismatch}件`,
  );
  console.log(
    `買い目の一致率: ${matchRate === null ? "算出不能（比較できる組が0件）" : `${(matchRate * 100).toFixed(2)}%`}`,
  );
  const fmt = (v) => (v === null ? "-" : `${v.toFixed(1)}%`);
  console.log(
    `\n3連単オッズの差（買い目が一致した組のみ）: p50 ${fmt(digest.trifectaOddsDiffPct.p50)} / p90 ${fmt(digest.trifectaOddsDiffPct.p90)}（n=${digest.trifectaOddsDiffPct.n}）`,
  );
  console.log(
    `3連複オッズの差（買い目が一致した組のみ）: p50 ${fmt(digest.trioOddsDiffPct.p50)} / p90 ${fmt(digest.trioOddsDiffPct.p90)}（n=${digest.trioOddsDiffPct.n}）`,
  );
  console.log(
    "\n参考（T4b-10-1の実測、2026-09-17〜19の516レース）: 3連単 中央値8.8%・p90 32% / 3連複 中央値12.1%・p90 42%",
  );

  if (strict) {
    const failMatch =
      matchRate !== null && matchRate < STRICT_MIN_COMBO_MATCH_RATE;
    const failP90 =
      digest.trifectaOddsDiffPct.p90 !== null &&
      digest.trifectaOddsDiffPct.p90 > STRICT_MAX_TRIFECTA_P90_PCT;
    if (failMatch || failP90) {
      console.error(
        `\n❌ --strict: 買い目の一致率が${STRICT_MIN_COMBO_MATCH_RATE * 100}%未満、または3連単オッズのp90差が${STRICT_MAX_TRIFECTA_P90_PCT}%を超えています`,
      );
      process.exit(1);
    }
  }
}

// スタンドアローン実行時のみ実行する（import 時に実行させない）
if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    console.error("❌", error.message);
    process.exit(1);
  });
}
