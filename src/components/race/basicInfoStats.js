/**
 * basicInfoStats - 「基本情報」タブ（BOA-306）のクライアント側集計ユーティリティ
 *
 * supabaseDataService.getRacerScopedRaceStats(racerId) で取得した1選手分の
 * 生データ（race_id単位のフラット配列、過去2年分）を、会場（当地/全国）×
 * グレード（全レース/一般戦/SG・G1）×期間で絞り込み、勝率・2連対率・3連対率を
 * 計算する。対象は常に1選手のみのライブ集計（BOA-303が問題視する全選手×
 * 全会場の横断集計とは規模が異なる）。
 *
 * グレードのバケット分け: races.race_gradeは'SG'/'G1'/'G2'/'G3'/'ippan'。
 * モックの3択（全レース/一般戦/SG・G1）に合わせ、G2/G3は「全レース」選択時のみ
 * 含め、「一般戦」「SG・G1」のどちらの個別フィルタにも含めない
 * （日和のグレード区分に対応する自社データが無いため、判断が割れやすいG2/G3を
 * あいまいに寄せるより、明確な2区分＋全体の3択に留める判断）。
 *
 * 期間「初日」「最終日」は当初モックで想定していたが実装せず削除した
 * （2026-09-15判明: race_conditions.series_day/is_final_dayは
 * scripts/daily/generate-predictions.jsで常にnullを書き込む未実装カラムで、
 * 実データも33,411行全件がnull。「取れないものは正直にモックから削って良い」
 * というBOA-306本文の指示に従い削除した）
 *
 * 期間「今期」は自社データに公式の期区分（前期/後期）の境界を持たないため
 * （racer_profiles.period_labelは2026-09-15時点で未取得、BOA-321参照）、
 * グレード=全レース時は呼び出し側がrace_entriesの公式集計済み値
 * （win_rate/local_win_rate等）をそのまま使う（このモジュールを経由しない）。
 * グレード条件を組み合わせた「今期」は公式の期区分を再現できないため、
 * 便宜上「取得できる全期間（過去2年）」を対象とする
 */
import { isPlaceHit, isShowHit } from "../../../scripts/lib/hitCalculator.js";

export const METRICS = ["winRate", "top2Rate", "top3Rate", "avgSt"];
export const SCOPES = ["local", "national"];
export const GRADES = ["all", "ippan", "sgg1"];
export const PERIODS = ["current", "last3m", "last1m"];

// 小標本フラグの閾値（BOA-306本文の「n<6等の小標本」表記に合わせる）
export const SMALL_SAMPLE_THRESHOLD = 6;

function gradeBucket(raceGrade) {
  if (raceGrade === "ippan") return "ippan";
  if (raceGrade === "SG" || raceGrade === "G1") return "sgg1";
  return "other";
}

function matchesGrade(record, grade) {
  if (grade === "all") return true;
  return gradeBucket(record.raceGrade) === grade;
}

function matchesPeriod(record, period) {
  if (period === "current") return true;
  if (period === "last3m" || period === "last1m") {
    const days = period === "last3m" ? 90 : 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split("T")[0];
    return record.date >= cutoffStr;
  }
  return true;
}

/**
 * 会場・グレード・期間でrecordsを絞り込む
 * @param {Array} records - getRacerScopedRaceStatsの戻り値
 * @param {Object} filters
 * @param {number|null} filters.venueCode - 現在レースの会場コード（当地判定用）
 * @param {'local'|'national'} filters.scope
 * @param {'all'|'ippan'|'sgg1'} filters.grade
 * @param {'current'|'last3m'|'last1m'} filters.period
 */
export function filterRecords(records, { venueCode, scope, grade, period }) {
  return (records ?? []).filter((r) => {
    if (scope === "local" && r.venueCode !== venueCode) return false;
    if (!matchesGrade(r, grade)) return false;
    if (!matchesPeriod(r, period)) return false;
    return true;
  });
}

/**
 * 絞り込み済みrecordsから勝率・2連対率・3連対率とサンプル数を計算する。
 * 各レースでの艇番（枠番）はレースごとに変わりうるため、外部から固定の艇番を
 * 渡すのではなく、各レコード自身のboatNumber（そのレースでの実際の枠番）を
 * 使って判定する（getRacerVenueStatsと同じ考え方）
 * @param {Array} records - filterRecordsの戻り値（当該選手のレコードのみ）
 */
export function computeRates(records) {
  const n = records.length;
  if (n === 0) {
    return { n: 0, winRate: null, top2Rate: null, top3Rate: null };
  }
  let wins = 0;
  let top2 = 0;
  let top3 = 0;
  records.forEach((r) => {
    if (r.rank1 === r.boatNumber) wins += 1;
    if (isPlaceHit(r.boatNumber, r.rank1, r.rank2)) top2 += 1;
    if (isShowHit(r.boatNumber, r.rank1, r.rank2, r.rank3)) top3 += 1;
  });
  return {
    n,
    winRate: (wins / n) * 100,
    top2Rate: (top2 / n) * 100,
    top3Rate: (top3 / n) * 100,
  };
}

/**
 * 直近n走の個別結果を返す（新しい方が配列の末尾）。
 * 当初は「節」単位でグルーピングした勝率推移を計画していたが、節境界の
 * データ（series_day/is_final_day）が実データで常にnullのため断念し、
 * 個別レースの着順をそのまま並べる方式にした（上記モジュールコメント参照）。
 * recordsは日付昇順であることを前提とする（getRacerScopedRaceStatsの戻り値順）
 */
export function getRecentRaces(records, count = 5) {
  return (records ?? []).slice(-count).map((r) => {
    let finish; // 1 | 2 | 3 | "out"
    if (r.rank1 === r.boatNumber) finish = 1;
    else if (r.rank2 === r.boatNumber) finish = 2;
    else if (r.rank3 === r.boatNumber) finish = 3;
    else finish = "out";
    return {
      raceId: r.raceId,
      date: r.date,
      venueCode: r.venueCode,
      finish,
    };
  });
}
