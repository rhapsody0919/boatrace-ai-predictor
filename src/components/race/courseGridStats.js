/**
 * 枠別情報タブの「コース別成績グリッド」の集計（phase a FR-1 / T3-1）
 *
 * 設計: docs/design/analysis-visualization-upgrade/screens.md §3.1.1
 *
 * ## 共通コンポーネントにしない理由
 *
 * 当初は `CrossTabGrid` として汎用化する予定だったが、使う箇所が1つしか
 * 無いことが分かったため取り下げた（spec.md FR-0、2026-09-23ユーザー判断）。
 * FR-2（基本情報タブ）は「グリッド化はしない」と決定済みで、「条件別」タブは
 * 行＝条件・列＝値とnの1次元テーブル。2例目が現れた時点で切り出す。
 *
 * ## 艇番ではなく実進入コースで数える
 *
 * 従来このタブが使っていた `racer_aggregated_stats.courseRaceCounts` は
 * 艇番＝コースの前提で、実際の進入コース変化を区別できなかった（BOA-257の制約）。
 * BOA-257はDoneで `race_results.actual_course_N` の充足率は99.7〜99.9%なので、
 * `getRacerScopedRaceStats` の `actualCourse` で数える。
 * `actualCourse` が取れないレースは母数から自然に落ちる。
 *
 * 同じサイト内で艇番基準と実進入コース基準が混在する点は横断課題として
 * BOA-302 が起票済み（重複起票しない）。グリッドには「実進入コース基準」と注記する。
 */
import { filterRecords, computeRates } from "./basicInfoStats";

export const GRID_COURSES = [1, 2, 3, 4, 5, 6];

/**
 * グリッドの行（期間・条件）。`filterRecords` に渡す絞り込み条件の組。
 * screens.md §3.1.1 の「今期/3ヶ月/1ヶ月/当地/一般戦/SG・G1」に対応する。
 */
export const GRID_ROWS = [
  { key: "current", scope: "national", grade: "all", period: "current" },
  { key: "last3m", scope: "national", grade: "all", period: "last3m" },
  { key: "last1m", scope: "national", grade: "all", period: "last1m" },
  { key: "local", scope: "local", grade: "all", period: "current" },
  { key: "ippan", scope: "national", grade: "ippan", period: "current" },
  { key: "sgg1", scope: "national", grade: "sgg1", period: "current" },
];

/**
 * 選手の出走履歴から、行（期間・条件）× 列（実進入コース1〜6）のセルを組み立てる。
 *
 * @param {Array<Object>} records `getRacerScopedRaceStats` の戻り値
 * @param {{venueCode: number|null, metric: "winRate"|"top2Rate"|"top3Rate"}} options
 * @returns {Array<{key: string, cells: Array<{course: number, value: number|null, n: number}>}>}
 *   n=0 のセルは value=null（画面は「—」を出す）
 */
export function buildCourseGrid(records, { venueCode, metric }) {
  const all = Array.isArray(records) ? records : [];
  return GRID_ROWS.map((row) => {
    const filtered = filterRecords(all, {
      venueCode,
      scope: row.scope,
      grade: row.grade,
      period: row.period,
    });
    const cells = GRID_COURSES.map((course) => {
      const inCourse = filtered.filter((r) => r.actualCourse === course);
      const rates = computeRates(inCourse);
      return {
        course,
        value: rates.n > 0 ? rates[metric] : null,
        n: rates.n,
      };
    });
    return { key: row.key, cells };
  });
}

/**
 * セルをタップしたときに出す「そのコースの直近N走」を、取得済みのrecordsから取り出す。
 *
 * 追加のSupabaseクエリは要らない（`getRacerScopedRaceStats` が既に全走を持っている）。
 * 従来は `getRacerCourseRecentFinishes` を別に叩いていたが、あちらは艇番基準で
 * 母集団が違うため、グリッドを実進入コース基準にした時点で使えなくなった。
 *
 * @param {Array<Object>} records `getRacerScopedRaceStats` の戻り値
 * @param {{venueCode: number|null, rowKey: string, course: number, count?: number}} options
 * @returns {Array<Object>} 新しい順（左が新しい）
 */
export function getCourseRecentRuns(
  records,
  { venueCode, rowKey, course, count = 10 },
) {
  const row = GRID_ROWS.find((r) => r.key === rowKey) ?? GRID_ROWS[0];
  const filtered = filterRecords(Array.isArray(records) ? records : [], {
    venueCode,
    scope: row.scope,
    grade: row.grade,
    period: row.period,
  });
  return filtered
    .filter((r) => r.actualCourse === course)
    .slice(-count)
    .reverse();
}

/** 既定ビュー（今日の想定コース）で同時に出す3指標 */
export const TODAY_METRICS = ["winRate", "top2Rate", "top3Rate"];

/**
 * 今日の想定コース1本に絞って、行（期間・条件）× 3指標 + n を組み立てる（純関数）。
 *
 * 2026-09-24のユーザー判断で既定ビューをこれに変えた。6コース×1指標の表は
 * モバイル390pxで横スクロールが要り、ライト層に読まれていなかった（ファン4名の
 * 検討結果）。列を1本に絞ると横幅が余るので、**1着率・2連対率・3連対率を
 * 同時に出せる**（従来は3つから1つを選ばせていた）。最も見られる部分では
 * 情報が減るどころか増える。
 *
 * @param {Array<Object>} records `getRacerScopedRaceStats` の戻り値
 * @param {{venueCode: number|null, course: number}} options
 * @returns {Array<{key: string, metrics: Record<string, number|null>, n: number}>}
 */
export function buildTodayCourseRows(records, { venueCode, course }) {
  // course が数値でないときに素通りさせると、`actualCourse === null` の走
  // （実進入コースが取れていないレース）を「今日のコース」として数えてしまう
  const all = Number.isInteger(course) && Array.isArray(records) ? records : [];
  return GRID_ROWS.map((row) => {
    const filtered = filterRecords(all, {
      venueCode,
      scope: row.scope,
      grade: row.grade,
      period: row.period,
    }).filter((r) => r.actualCourse === course);
    const rates = computeRates(filtered);
    return {
      key: row.key,
      n: rates.n,
      metrics: Object.fromEntries(
        TODAY_METRICS.map((m) => [m, rates.n > 0 ? rates[m] : null]),
      ),
    };
  });
}

/**
 * 枠なり進入率（枠番どおりのコースに入った割合）を求める（純関数）。
 *
 * 「本日の想定進入」が枠なり進入の仮定であることを断るために出す。
 * 実測（全261,528走）では枠番どおりが90.90%、1つずれが7.06%、
 * 2つ以上ずれが2.04%。選手1,610人（50走以上）の平均は90.5%で、
 * **枠なり率100%の選手は1人もいない**（最小31.5%、80%未満が107人）。
 *
 * @param {Array<Object>} records `getRacerScopedRaceStats` の戻り値
 * @returns {{rate: number|null, n: number}}
 */
export function computeWakuNariRate(records) {
  const withCourse = (Array.isArray(records) ? records : []).filter(
    (r) => r.actualCourse !== null && r.actualCourse !== undefined,
  );
  if (withCourse.length === 0) return { rate: null, n: 0 };
  const same = withCourse.filter((r) => r.actualCourse === r.boatNumber).length;
  return { rate: (same / withCourse.length) * 100, n: withCourse.length };
}
