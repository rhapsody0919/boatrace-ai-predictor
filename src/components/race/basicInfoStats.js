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
 * というBOA-306本文の指示に従い削除した。2026-09-16追記: BOA-226
 * （scripts/daily/update-race-info.jsのscrapeSeriesDay()）でracelistページの
 * 日程タブから実際に値を取得・書き込むようになったため、今後発生するレースは
 * 順次値が入る見込み。ただし本モジュールが対象とする過去2年分のうち大部分は
 * BOA-226以前のバックフィル済みnullデータのままのため、この期間フィルタ自体を
 * 復活させる判断は改めて行う）
 *
 * 期間「今期」は自社データに公式の期区分（前期/後期）の境界を持たないため
 * （racer_profiles.period_labelは2026-09-15時点で未取得、BOA-321参照）、
 * グレード=全レース時は呼び出し側がrace_entriesの公式集計済み値
 * （win_rate/local_win_rate等）をそのまま使う（このモジュールを経由しない）。
 * グレード条件を組み合わせた「今期」は公式の期区分を再現できないため、
 * 便宜上「取得できる全期間（過去2年）」を対象とする
 */
import { isPlaceHit, isShowHit } from "../../../scripts/lib/hitCalculator.js";
import { parseRaceId } from "../../utils/raceId.js";

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
 * 絞り込み済みrecordsから勝率・2連対率・3連対率・平均STとサンプル数を計算する。
 * 各レースでの艇番（枠番）はレースごとに変わりうるため、外部から固定の艇番を
 * 渡すのではなく、各レコード自身のboatNumber（そのレースでの実際の枠番）を
 * 使って判定する（getRacerVenueStatsと同じ考え方）。
 * 平均STはstartTimingが取得できているレコードのみを対象に計算する
 * （フライング・未計測は既にgetRacerScopedRaceStats側でnull化済み）ため、
 * サンプル数nと平均ST算出対象のn（avgStN）は一致しない場合がある
 * @param {Array} records - filterRecordsの戻り値（当該選手のレコードのみ）
 */
export function computeRates(records) {
  const n = records.length;
  if (n === 0) {
    return {
      n: 0,
      winRate: null,
      top2Rate: null,
      top3Rate: null,
      avgSt: null,
      avgStN: 0,
    };
  }
  let wins = 0;
  let top2 = 0;
  let top3 = 0;
  let stSum = 0;
  let stCount = 0;
  records.forEach((r) => {
    if (r.rank1 === r.boatNumber) wins += 1;
    if (isPlaceHit(r.boatNumber, r.rank1, r.rank2)) top2 += 1;
    if (isShowHit(r.boatNumber, r.rank1, r.rank2, r.rank3)) top3 += 1;
    if (r.startTiming !== null && r.startTiming !== undefined) {
      stSum += r.startTiming;
      stCount += 1;
    }
  });
  return {
    n,
    winRate: (wins / n) * 100,
    top2Rate: (top2 / n) * 100,
    top3Rate: (top3 / n) * 100,
    avgSt: stCount > 0 ? stSum / stCount : null,
    avgStN: stCount,
  };
}

// レース内順位（1〜6）を返す。rank1〜3は必ず取得済み、rank4〜6はBOA-238以降のみ
// バックフィル済みのため、一致しなければ「着外だが正確な順位は不明」として
// nullを返す（"out"というラベル文字列ではなく、呼び出し側で明示的に判定させる）。
// BOA-159（選手ページのレース一覧）でも同じ判定が必要になったためexportした
export function finishPositionOf(r) {
  if (r.rank1 === r.boatNumber) return 1;
  if (r.rank2 === r.boatNumber) return 2;
  if (r.rank3 === r.boatNumber) return 3;
  if (r.rank4 === r.boatNumber) return 4;
  if (r.rank5 === r.boatNumber) return 5;
  if (r.rank6 === r.boatNumber) return 6;
  return null;
}

/**
 * 直近n走の個別結果を返す（新しい方が配列の末尾）。
 * 当初は「節」単位でグルーピングした勝率推移を計画していたが、節境界の
 * データ（series_day/is_final_day）が実データで常にnullのため断念し、
 * 個別レースの着順をそのまま並べる方式にした（上記モジュールコメント参照）。
 * recordsは日付昇順であることを前提とする（getRacerScopedRaceStatsの戻り値順）
 *
 * 2026-09-16（BOA-333/159共通化）: 戻り値の形をRaceHistoryTable.jsx
 * （共有テーブルコンポーネント、getRacerRaceHistory()由来のmatchedRacesと
 * 同じフィールド名）に合わせた。raceNoはraceId（YYYY-MM-DD-VV-RR）から導出する
 * （racesテーブルへの追加問い合わせ不要）。boatNumberは、レビュー指摘により
 * RaceHistoryTable側の列見出し「枠番」・もう一方の利用元（RacerPerformanceStats.jsx、
 * BOA-159）と一貫させるため、当該レースでの生の艇番（r.boatNumber）をそのまま渡す
 * （実進入コースのcourseWithFallbackは使わない。使うと同じ行内で「表示コース」と
 * 「着順判定に使う艇番」が食い違う内部矛盾が生じるため）。raceTitle/raceStage/
 * winningTechnique/payoutWinはgetRacerScopedRaceStatsが取得していないためnull固定
 * （直近5走のためだけに追加クエリを増やすのは範囲外と判断、RaceHistoryTable側で
 * 「-」表示にフォールバックする）
 */
export function getRecentRaces(records, count = 5) {
  return (records ?? []).slice(-count).map((r) => ({
    raceId: r.raceId,
    date: r.date,
    venueCode: r.venueCode,
    raceNo: parseRaceId(r.raceId)?.raceNo ?? null,
    raceTitle: null,
    raceGrade: r.raceGrade ?? null,
    raceStage: null,
    boatNumber: r.boatNumber,
    startTiming: r.startTiming ?? null,
    // 4〜6着はBOA-238以降のみ保存されているため、rank4〜6が未バックフィルの
    // 過去レースではnullになる（"unknown"として表示側が「着外」等に読み替える）
    finishRank: finishPositionOf(r),
    winningTechnique: null,
    payoutWin: null,
  }));
}

/**
 * 会場別に、指定した指標（勝率/2連対率/3連対率/平均ST）でランキングする
 * （BOA-306フィードバック#3: 「得意会場」は選択中の指標に連動させる）。
 * n>=5の会場のみ対象（getRacerVenueStatsと同じ閾値）。グレード・期間による
 * 絞り込みは行わず、全期間（過去2年）×全グレードでの会場別集計に固定する
 * （会場ランキングまでフィルタを連動させると母数が細分化されすぎて
 * ほとんどの会場がn<5で対象外になるため）。avgSt採用時は値が小さいほど
 * 良好なため昇順、それ以外は降順でソートする
 * @param {Array} records - getRacerScopedRaceStatsの戻り値（フィルタ前の生データ）
 * @param {'winRate'|'top2Rate'|'top3Rate'|'avgSt'} metric
 */
export function computeVenueRanking(records, metric) {
  const byVenue = new Map();
  (records ?? []).forEach((r) => {
    if (!byVenue.has(r.venueCode)) byVenue.set(r.venueCode, []);
    byVenue.get(r.venueCode).push(r);
  });

  const rows = [...byVenue.entries()]
    .map(([venueCode, venueRecords]) => ({
      venueCode,
      ...computeRates(venueRecords),
    }))
    .filter((row) => (metric === "avgSt" ? row.avgStN >= 5 : row.n >= 5));

  const valueOf = (row) => (metric === "avgSt" ? row.avgSt : row[metric]);
  rows.sort((a, b) => {
    const av = valueOf(a);
    const bv = valueOf(b);
    if (av === null) return 1;
    if (bv === null) return -1;
    return metric === "avgSt" ? av - bv : bv - av;
  });
  return rows;
}

/**
 * 平均進入コースを計算する（BOA-304、直前情報タブ「平均進入順」）。
 * getRacerScopedRaceStatsのactualCourse（BOA-257の実進入コース、race_results.
 * actual_course_N）を使う。2025-12-04より前のレース・欠場艇はactualCourseが
 * nullのため対象外になる（そのレースを1着扱い等にすり替えない）
 * @param {Array} records - getRacerScopedRaceStatsの戻り値
 */
export function computeAvgEntryCourse(records) {
  const courses = (records ?? [])
    .map((r) => r.actualCourse)
    .filter((c) => c !== null && c !== undefined);
  if (courses.length === 0) return { n: 0, avgCourse: null };
  const sum = courses.reduce((a, b) => a + b, 0);
  return { n: courses.length, avgCourse: sum / courses.length };
}

/**
 * 展示タイムが単独最速だった時に限定した1着率/2連対率/3連対率を計算する
 * （BOA-304、直前情報タブ「展示タイム1位勝率」）。
 * isFastestExhibition===trueのレコードのみに絞り込んだ上で、既存の
 * computeRates（勝率/2連対率/3連対率の定義そのもの）をそのまま再利用する
 * （日和の「展示タイム1位勝率」と同じ定義=「展示1位だった時の」1着率等の
 * 母集団だけを変え、率の計算式自体は基本情報タブと重複させない）
 * @param {Array} records - getRacerScopedRaceStatsの戻り値
 */
export function computeExhibitionTopRates(records) {
  const fastestRecords = (records ?? []).filter(
    (r) => r.isFastestExhibition === true,
  );
  return computeRates(fastestRecords);
}
