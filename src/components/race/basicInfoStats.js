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
 * 「初日」「最終日」は2026-09-15時点で「race_conditions.series_day /
 * is_final_day は実データ全件null」として一度削除したが、**この前提は現在
 * 成り立たない**。BOA-226（update-race-info.jsのscrapeSeriesDay()、racelist
 * ページの日程タブ由来）のバックフィルが効いて、2026-09-24の実測で
 * **35,992 / 36,353行＝99.01%が埋まっている**（2026-02-03以降）。
 * さらにrace_series（月間スケジュール）との全件照合で、3,014 venue-day の
 * 初日・最終日がどちらも100%一致（不一致0件）。
 * したがってphase a FR-2の「条件別」タブ（buildConditionRows）では、
 * race_seriesを引かずにこの2列で初日・最終日を判定する（追加クエリ0本）。
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
 * 「着順判定に使う艇番」が食い違う内部矛盾が生じるため）。
 *
 * 2026-09-16追記（レビュー指摘#3）: raceTitle/raceStage/winningTechnique/
 * payoutWinが常に「-」表示になっていた問題を修正。getRacerScopedRaceStats側で
 * race_conditions（race_title/race_stage）とrace_results（winning_technique/
 * payout_win）も取得するよう拡張し（BOA-159のgetRacerRaceHistory()と同じ
 * テーブル）、ここではそれをそのまま透過するだけにした。getRacerScopedRaceStats
 * 側で既に`?? null`によりnull正規化済み（undefinedにはならない）のため、
 * ここでの`?? null`は付けていない
 */
export function getRecentRaces(records, count = 5) {
  return (records ?? []).slice(-count).map((r) => ({
    raceId: r.raceId,
    date: r.date,
    venueCode: r.venueCode,
    raceNo: parseRaceId(r.raceId)?.raceNo ?? null,
    raceTitle: r.raceTitle,
    raceGrade: r.raceGrade ?? null,
    raceStage: r.raceStage,
    boatNumber: r.boatNumber,
    startTiming: r.startTiming ?? null,
    // 4〜6着はBOA-238以降のみ保存されているため、rank4〜6が未バックフィルの
    // 過去レースではnullになる（"unknown"として表示側が「着外」等に読み替える）
    finishRank: finishPositionOf(r),
    winningTechnique: r.winningTechnique,
    payoutWin: r.payoutWin,
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

/**
 * 「条件別」タブ（phase a FR-2）の行。行＝条件、列＝値とn。選んだ1選手のみ。
 *
 * screens.md §3.2 の決定どおり、基本情報タブはグリッド化せず、既存のバー展開の
 * 3つ目のタブとしてこの1次元テーブルを足す。
 *
 * ## F持ち時 / F無し時（2026-09-25にユーザー判断で追加）
 *
 * 当初は「過去の `f_count` 充足率が低く母数が残らない」として出さない方針だったが、
 * **充足率が低くても出す**ことにした（過去分のバックフィルは BOA-365 / BOA-353配下で
 * 別途進む見込み）。実測（本日の出走選手12人、`f_count` が取れている走は16〜35走）では
 * 4人が n=8〜22 で成立し、8人は n=0 で「—」になる。
 *
 * **2行を対にする**。screens.md §3.7 が「F持ち時の平均ST vs 通常時」と対比で
 * 設計しているとおり、単独では「全国」と比べることになるが、全国は母集団
 * （`f_count` が取れていない走も含む全走）が違うため比較が成立しない。
 * 同じ「F数が取れている走」の中で F>0 と F=0 を並べて初めて読める。
 *
 * ## 出さない条件
 *
 * - **ナイター**: 開催時間帯を取得していない（`race_series.kind` はシリーズ種別で
 *   時間帯を含まない。screens.md §3.2 で実測済み）。「—」の行を並べず行ごと出さない
 */
export const CONDITION_ROWS = [
  { key: "national", kind: "filter", scope: "national", grade: "all" },
  { key: "local", kind: "filter", scope: "local", grade: "all" },
  { key: "ippan", kind: "filter", scope: "national", grade: "ippan" },
  { key: "sgg1", kind: "filter", scope: "national", grade: "sgg1" },
  { key: "firstDay", kind: "seriesDay" },
  { key: "finalDay", kind: "isFinalDay" },
  { key: "wave5", kind: "wave" },
  { key: "fHolding", kind: "fCount", holding: true },
  { key: "fClean", kind: "fCount", holding: false },
];

/**
 * 「荒れ」とみなす波高の下限（cm）。
 *
 * screens.md は「波5cm超」と書いていたが、実測で `> 5` は全レースの4.0%しかなく、
 * 選手あたりの母数が3〜9走（SMALL_SAMPLE_THRESHOLD=6を下回る選手が出る）になる。
 * `>= 5` なら11.4%で母数8〜33走。**既存の予想モデル `scripts/lib/turnPrediction.js`
 * が `waveHeight >= 5` を「荒れ」の閾値に使っている**ため、プロジェクト内の
 * 既存慣習に合わせる（screens.mdのモックの n=52 は `>= 3cm`＝41.0%相当で、
 * ラベルと数値が食い違っていた）。
 */
export const ROUGH_WAVE_CM = 5;

// 条件別タブが使う派生フィールドが「未取得」か（取得失敗でundefinedのまま）。
// 欠測（null）とは区別する。区別しないと、取得に失敗しただけなのに
// 「初日 n=0」のような誤った値を出してしまう（.claude/rules/frontend-data-fetch.md）
function isUnavailable(records, field) {
  const rows = records ?? [];
  if (rows.length === 0) return false;
  return rows.every((r) => r[field] === undefined);
}

/**
 * 条件別タブの各行を組み立てる（純関数）。
 *
 * **値は全行とも自社集計**にする。既定状態（勝率・全レース・今期）では
 * バー側が公式値（`race_entries.win_rate`、点）を出すため、同じ「全国」という
 * ラベルで別の数字が同一画面に並ぶ。呼び出し側は既存の
 * `basicInfo.winRateSwitchCaveat` と同趣旨の注記を出すこと。
 *
 * 期間は全行「今期」（＝取得できる全期間）で固定する。期間の切り替えは
 * 既存のチップが担っており、この表は「条件の比較」に役割を絞る。
 *
 * @param {Array<Object>} records `getRacerScopedRaceStats` の戻り値
 * @param {{venueCode: number|null, metric: string}} options
 * @returns {Array<{key: string, value: number|null, n: number, unavailable: boolean, baseN: number|null}>}
 *   `unavailable` が true の行は呼び出し側で描画しない。
 *   `baseN` は波・F持ち時・F無し時の行だけ非null（その条件を判定できた走数。
 *   他行と母数が違うことを示すので、画面はこれを添えて「他行と比べない」と読ませる）
 */
export function buildConditionRows(records, { venueCode, metric }) {
  const all = Array.isArray(records) ? records : [];

  return CONDITION_ROWS.map((row) => {
    if (row.kind === "filter") {
      const rates = computeRates(
        filterRecords(all, {
          venueCode,
          scope: row.scope,
          grade: row.grade,
          period: "current",
        }),
      );
      return {
        key: row.key,
        value: rates.n > 0 ? rates[metric] : null,
        n: rates.n,
        unavailable: false,
        baseN: null,
      };
    }

    if (row.kind === "seriesDay" || row.kind === "isFinalDay") {
      const field = row.kind === "seriesDay" ? "seriesDay" : "isFinalDay";
      if (isUnavailable(all, field)) {
        return {
          key: row.key,
          value: null,
          n: 0,
          unavailable: true,
          baseN: null,
        };
      }
      const hit = all.filter((r) =>
        field === "seriesDay" ? r.seriesDay === 1 : r.isFinalDay === true,
      );
      const rates = computeRates(hit);
      return {
        key: row.key,
        value: rates.n > 0 ? rates[metric] : null,
        n: rates.n,
        unavailable: false,
        baseN: null,
      };
    }

    if (row.kind === "fCount") {
      // F数が取れている走だけを母集団にする。取れていない走（null）は
      // 「F0だった」とは限らないので、F無し時に混ぜてはいけない
      const known = all.filter((r) => typeof r.fCount === "number");
      const hit = known.filter((r) =>
        row.holding ? r.fCount > 0 : r.fCount === 0,
      );
      const rates = computeRates(hit);
      return {
        key: row.key,
        value: rates.n > 0 ? rates[metric] : null,
        n: rates.n,
        unavailable: false,
        baseN: known.length,
      };
    }

    // 波高。母数が他行と違う（波高が取れていない走がある）ので baseN を返す
    if (isUnavailable(all, "waveHeight")) {
      return {
        key: row.key,
        value: null,
        n: 0,
        unavailable: true,
        baseN: null,
      };
    }
    const known = all.filter(
      (r) => typeof r.waveHeight === "number" && Number.isFinite(r.waveHeight),
    );
    const rough = known.filter((r) => r.waveHeight >= ROUGH_WAVE_CM);
    const rates = computeRates(rough);
    return {
      key: row.key,
      value: rates.n > 0 ? rates[metric] : null,
      n: rates.n,
      unavailable: false,
      baseN: known.length,
    };
  });
}

/**
 * 「前期」（`racer_period_stats`）の1選手分を表示用に整える（純関数）。
 *
 * **指標の列に混ぜない**。`win_rate` は公式勝率（点、実測1.07〜8.24）で、
 * `computeRates` の `winRate`（1着率、%）とは単位が違う。`top3_rate` に
 * 相当する列も無い。呼び出し側は固定3値＋算出期間の別枠として描画する。
 *
 * @param {Array<Object>|{state: string}} rows `getRacerPeriodStats` の戻り値
 * @param {number|null} racerId
 * @returns {{winRate: number|null, top2Rate: number|null, avgSt: number|null,
 *            starts: number|null, calcFrom: string|null, calcTo: string|null}|null}
 *   該当が無ければ null（呼び出し側は枠ごと出さない）
 */
export function pickPeriodStats(rows, racerId) {
  if (!Array.isArray(rows) || !racerId) return null;
  const row = rows.find((r) => r.racer_id === racerId);
  if (!row) return null;
  return {
    // 出走0の新人は win_rate が NULL（実測2.6%）。呼び出し側は「—」を出す
    winRate: row.win_rate ?? null,
    top2Rate: row.top2_rate ?? null,
    avgSt: row.avg_st ?? null,
    starts: row.starts ?? null,
    calcFrom: row.calc_from ?? null,
    calcTo: row.calc_to ?? null,
  };
}
