/**
 * 買い目オッズ（prediction_odds）を、予想の買い目（predictions）と、オッズの最新スナップショット
 * （race_odds.trifecta_all・trio_all）から導出する（純粋関数のみ。DBアクセスは
 * scripts/lib/scrapeJobs/predictionOddsHandlers.js が行う）。
 *
 * 背景（BOA-404、tasks.md T4b-10、2026-09-20の決定）: 従来（A4、scripts/daily/scrape-prediction-odds.js）は、
 * 予測の買い目1点ずつ（3モデル×2券種）を、A3（scripts/daily/scrape-odds.js）と同じ odds3t・odds3f ページから
 * 重複して取得していた（D1、job-inventory.md）。A3が既に取得・保存している全通り
 * （race_odds.trifecta_all・trio_all、"1-2-3" -> オッズ のキー）から同じキーで引けるため、追加のHTTPリクエストを
 * 行わずに導出できる（T4b-10-1の調査: 2026-09-17〜19の516レースで、予測の買い目のキーは514/514が
 * trifecta_all・trio_allに存在。形式が一致）。
 *
 * トレードオフ（ユーザー承認済み）: race_odds は窓（60/30/15/10/5/0分前）でしか更新されないため、A4（5分ごと）より
 * 最新のスナップショットが古い場合がある（T4b-10-1の実測: 最新のスナップショットは中央値約3.3分・p90 5.8分古く、
 * 3連単オッズの差は中央値8.8%・p90 32%、3連複は中央値12.1%・p90 42%）。読み手
 * （generate-moriarty-recommendations.js・train-moriarty-calibration.js・data-health-report.js）は、5分ごとの
 * 鮮度を必要としない（表示する画面が無い）ため、この古さは許容範囲（tasks.md T4b-10-1）。
 */

/** predictions.model_id -> prediction_odds の列名サフィックス（scrape-prediction-odds.js の MODEL_TO_COLUMN と同じ規約） */
export const MODEL_COLUMN_SUFFIX = Object.freeze({
  standard: "standard",
  safeBet: "safe_bet",
  upsetFocus: "upset_focus",
});

/** prediction_odds の値列（race_id・updated_at を除く。オッズ・買い目キー） */
export const PREDICTION_ODDS_VALUE_COLUMNS = Object.freeze(
  Object.values(MODEL_COLUMN_SUFFIX).flatMap((suffix) => [
    `trifecta_pred_${suffix}`,
    `trifecta_odds_${suffix}`,
    `trio_pred_${suffix}`,
    `trio_odds_${suffix}`,
  ]),
);

/** 3連複の買い目キー（艇番を昇順ソート）。scrape-prediction-odds.js の trioKey と同じ規約・同じキー空間 */
export function trioKeyOf(b1, b2, b3) {
  return [b1, b2, b3].sort((a, b) => a - b).join("-");
}

/**
 * 1レース分の prediction_odds 行を組み立てる。
 *
 * 買い目（trifecta_pred_*・trio_pred_*）は予測（predictions）だけで決まり、オッズ（trifecta_odds_*・trio_odds_*）は
 * race_odds の最新スナップショットに、その買い目のキーが無ければ null にする（取得できなかった券種・未公開等。
 * legacy の scrape-prediction-odds.js と同じ挙動: `trifMap.get(tfKey) ?? null`）。
 * 予測が1つのモデルも無ければ null を返す（書く価値のある列が無い）。
 *
 * @param {Object} params
 * @param {string} params.raceId
 * @param {Record<string, {top1: number, top2: number, top3: number}>} [params.predictionsByModel]
 *   モデルID（standard/safeBet/upsetFocus）-> 買い目（1〜3着の艇番）
 * @param {Record<string, number>|null} [params.trifectaAll] race_odds.trifecta_all（"1-2-3" -> オッズ）
 * @param {Record<string, number>|null} [params.trioAll] race_odds.trio_all（昇順ソート済みキー -> オッズ）
 * @param {string} params.updatedAtIso
 * @returns {Object|null}
 */
export function buildPredictionOddsRow({
  raceId,
  predictionsByModel,
  trifectaAll,
  trioAll,
  updatedAtIso,
}) {
  const row = { race_id: raceId, updated_at: updatedAtIso };
  let hasAny = false;
  for (const [modelId, colSuffix] of Object.entries(MODEL_COLUMN_SUFFIX)) {
    const pred = predictionsByModel?.[modelId];
    if (!pred?.top1 || !pred?.top2 || !pred?.top3) continue;
    hasAny = true;
    const { top1, top2, top3 } = pred;

    // 3連単: 1着→2着→3着の順通り
    const tfKey = `${top1}-${top2}-${top3}`;
    row[`trifecta_pred_${colSuffix}`] = tfKey;
    row[`trifecta_odds_${colSuffix}`] = trifectaAll?.[tfKey] ?? null;

    // 3連複: 艇番を昇順ソート
    const tkKey = trioKeyOf(top1, top2, top3);
    row[`trio_pred_${colSuffix}`] = tkKey;
    row[`trio_odds_${colSuffix}`] = trioAll?.[tkKey] ?? null;
  }
  return hasAny ? row : null;
}

/** 数値2つの絶対%差（片方が数値でない・分母が0なら null。分母は a=基準側=既存値） */
export function percentDiff(a, b) {
  if (typeof a !== "number" || typeof b !== "number") return null;
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return null;
  return (Math.abs(a - b) / a) * 100;
}

/** 数値配列のパーセンタイル（最近傍。空配列は null） */
export function percentileOf(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length),
  );
  return sorted[idx];
}

/**
 * 導出値（derived）と、既存の prediction_odds の行（GHA側のA4が書いた最終値、または前回の導出値）を、
 * モデル×券種ごとに比べる（純粋関数）。shadowモードの検証・手動チェックスクリプト（check-prediction-odds-shadow.js）の
 * 両方で使う。買い目（combo）が一致する組だけをオッズの%差の対象にする（買い目が違えば、比べても意味が無い＝
 * 予測が両者の間で変わった、または比較時点がずれている）。
 *
 * @param {Array<{race_id: string, row: Object}>} derivedRows
 * @param {Map<string, Object>} existingByRaceId race_id -> prediction_odds の既存行
 * @returns {{sampleSize: number, comboMismatch: number,
 *   trifectaOddsDiffPct: {p50: number|null, p90: number|null, n: number},
 *   trioOddsDiffPct: {p50: number|null, p90: number|null, n: number}}}
 */
export function summarizePredictionOddsDiff(derivedRows, existingByRaceId) {
  const trifectaDiffs = [];
  const trioDiffs = [];
  let sampleSize = 0;
  let comboMismatch = 0;
  for (const { race_id: raceId, row } of derivedRows) {
    const existing = existingByRaceId.get(raceId);
    if (!existing) continue;
    for (const suffix of Object.values(MODEL_COLUMN_SUFFIX)) {
      const derivedTf = row[`trifecta_pred_${suffix}`];
      const existingTf = existing[`trifecta_pred_${suffix}`];
      if (derivedTf == null || existingTf == null) continue;
      sampleSize++;
      if (derivedTf !== existingTf) {
        comboMismatch++;
        continue;
      }
      const tfDiff = percentDiff(
        existing[`trifecta_odds_${suffix}`],
        row[`trifecta_odds_${suffix}`],
      );
      if (tfDiff !== null) trifectaDiffs.push(tfDiff);

      const tkDiff = percentDiff(
        existing[`trio_odds_${suffix}`],
        row[`trio_odds_${suffix}`],
      );
      if (tkDiff !== null) trioDiffs.push(tkDiff);
    }
  }
  return {
    sampleSize,
    comboMismatch,
    trifectaOddsDiffPct: {
      p50: percentileOf(trifectaDiffs, 50),
      p90: percentileOf(trifectaDiffs, 90),
      n: trifectaDiffs.length,
    },
    trioOddsDiffPct: {
      p50: percentileOf(trioDiffs, 50),
      p90: percentileOf(trioDiffs, 90),
      n: trioDiffs.length,
    },
  };
}
