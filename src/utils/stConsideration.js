/**
 * ST考察（安定率・出遅率・抜出）の算出（phase a FR-1）
 *
 * 設計: docs/design/analysis-visualization-upgrade/spec.md「ST考察の算出可否」
 *       docs/design/analysis-visualization-upgrade/plan.md §3.1・§3.2
 *
 * ## フライング（F）の扱い — この規則をこのファイルに閉じ込める
 *
 * `race_start_timings` はフライングのSTを**正値**で保存し `is_flying=true` で
 * 区別する（data-catalog E5 の既知の不整合）。当初これを `-start_timing` に
 * 正規化する設計にしていたが、実測すると**正規化した方が壊れる**ことが分かった。
 *
 *   | 測った内容                     | 生値のまま | 符号を反転 |
 *   |--------------------------------|-----------|-----------|
 *   | F艇が「ST順1位」になった回数    | 582       | 744       |
 *   | 同じレースの他艇の安定率        | 62.9%     | 21.9%     |
 *
 * 符号を反転するとF艇（＝スタートが早すぎて失格した艇）が必ずST順1位になり、
 * 同じレースの他艇が全員「基準から0.05以上遅い」と判定される。
 * 「スタートを揃えられたか」という指標の意味が壊れるため、**Fの行は
 * (a) ST順1位の基準からも (b) 3指標の母数からも外す**（ADR-0068 却下5）。
 *
 * Fそのものは指標から消すのではなく `flyingCount` として別に返し、
 * 画面ではバッジで見せる。
 *
 * ## 閾値（ユーザーから提示された日和の定義を自前実装したもの）
 *
 *   安定率: ST順1位（Fを除く最速）との差が 0.05 以内
 *   抜出  : 自分より内側のコースの艇**すべて**より 0.07 以上早い
 *   出遅率: ST順1位より 0.10 以上遅い
 *
 * 他サイトの同名の指標とは一致しない（当サービスの独自集計）。
 */

/** 安定率の閾値（秒）。ST順1位との差がこれ以内 */
export const STABLE_THRESHOLD = 0.05;
/** 抜出の閾値（秒）。すべての内側艇よりこれ以上早い */
export const BREAKOUT_THRESHOLD = 0.07;
/** 出遅率の閾値（秒）。ST順1位よりこれ以上遅い */
export const LATE_THRESHOLD = 0.1;

/**
 * STの差を 1/1000秒 の整数にして比較する。
 *
 * **浮動小数点のまま `st - best <= 0.05` と書いてはいけない。** STは0.01刻みで、
 * 差がちょうど閾値になるケースが頻出するが、二進浮動小数点では
 * `0.20 - 0.15 = 0.05000000000000002` となって条件から漏れる
 * （`0.15 - 0.10 = 0.04999999999999999` は通るので、通る/通らないが値に依存する）。
 * 2026-09-24の実測では、これにより安定率が本来の 74.4% → 67.5%、42.4% → 34.8% と
 * 約7pt低く出た（PostgreSQLのNUMERICは厳密10進なのでSQL側の集計とずれる）。
 * 出遅率(0.1)は偶然ずれにくいだけで、同じ危険がある。
 */
function diffMilli(a, b) {
  return Math.round(a * 1000) - Math.round(b * 1000);
}

const STABLE_MILLI = Math.round(STABLE_THRESHOLD * 1000);
const BREAKOUT_MILLI = Math.round(BREAKOUT_THRESHOLD * 1000);
const LATE_MILLI = Math.round(LATE_THRESHOLD * 1000);

/**
 * 1レース分のST行から、艇番ごとの派生値を組み立てる（純関数）。
 *
 * @param {Array<{boat_number: number, start_timing: number|null, is_flying: boolean}>} stRows
 *   そのレースの全艇分のST行（自艇だけでなく6艇分が必要）
 * @param {Object|null} result そのレースの race_results 行（actual_course_1〜6 を読む）
 * @returns {{
 *   raceBestSt: number|null,
 *   byBoat: Map<number, {isFlying: boolean, stForRank: number|null, course: number|null,
 *                        stRank: number|null, innerMinSt: number|null}>
 * }}
 */
export function deriveRaceStContext(stRows, result) {
  const byBoat = new Map();
  if (!Array.isArray(stRows) || stRows.length === 0) {
    return { raceBestSt: null, byBoat };
  }

  // 1. 艇番ごとに「順位づけに使えるST」と実進入コースを求める。
  //    Fの行と、STが取れていない行は stForRank を null にする（母数にも基準にも入らない）
  for (const row of stRows) {
    const isFlying = row.is_flying === true;
    const hasSt = row.start_timing !== null && row.start_timing !== undefined;
    const course = result
      ? (result[`actual_course_${row.boat_number}`] ?? null)
      : null;
    byBoat.set(row.boat_number, {
      isFlying,
      stForRank: isFlying || !hasSt ? null : Number(row.start_timing),
      course,
      stRank: null,
      innerMinSt: null,
    });
  }

  // 2. ST順1位（Fを除く最速）
  const ranked = [...byBoat.entries()]
    .filter(([, v]) => v.stForRank !== null)
    .sort((a, b) => a[1].stForRank - b[1].stForRank);
  const raceBestSt = ranked.length > 0 ? ranked[0][1].stForRank : null;

  // 3. ST順位（Fを除く。同タイムは同順位にする）
  let rank = 0;
  let prevSt = null;
  ranked.forEach(([, v], index) => {
    if (prevSt === null || v.stForRank > prevSt) {
      rank = index + 1;
      prevSt = v.stForRank;
    }
    v.stRank = rank;
  });

  // 4. 内側艇の最速ST（Fを除く）。1コース・コース不明は null
  for (const value of byBoat.values()) {
    if (value.course === null || value.course <= 1) continue;
    const innerSts = [...byBoat.values()]
      .filter(
        (other) =>
          other.course !== null &&
          other.course < value.course &&
          other.stForRank !== null,
      )
      .map((other) => other.stForRank);
    value.innerMinSt = innerSts.length > 0 ? Math.min(...innerSts) : null;
  }

  return { raceBestSt, byBoat };
}

/**
 * 選手の出走履歴（getRacerScopedRaceStatsの戻り値）から、指定コースのST考察を算出する（純関数）。
 *
 * 小標本の判定はここでは行わない。呼び出し側が `SMALL_SAMPLE_THRESHOLD`（=6、
 * src/components/race/basicInfoStats.js）で判断する（ST考察だけ別の閾値を持たせない）。
 *
 * @param {Array<Object>} rows getRacerScopedRaceStats の戻り値
 * @param {{course: number}} options 対象の実進入コース（1〜6）
 * @returns {{n: number, stableRate: number|null, lateRate: number|null,
 *   breakoutCount: number|null, breakoutRate: number|null, avgSt: number|null,
 *   flyingCount: number}}
 *   1コースの breakoutCount / breakoutRate は null（内側艇が存在しないため。0や0%にしない）
 */
export function computeStConsideration(rows, { course }) {
  const all = Array.isArray(rows) ? rows : [];
  const inCourse = all.filter((r) => r.actualCourse === course);

  // Fは母数に入れない。別途 flyingCount として返す
  const flyingCount = inCourse.filter((r) => r.isFlying === true).length;
  const target = inCourse.filter(
    (r) => r.stForRank !== null && r.stForRank !== undefined,
  );
  const n = target.length;

  if (n === 0) {
    return {
      n: 0,
      stableRate: null,
      lateRate: null,
      breakoutCount: course === 1 ? null : 0,
      breakoutRate: null,
      avgSt: null,
      flyingCount,
    };
  }

  const withBest = target.filter(
    (r) => r.raceBestSt !== null && r.raceBestSt !== undefined,
  );
  const stable = withBest.filter(
    (r) => diffMilli(r.stForRank, r.raceBestSt) <= STABLE_MILLI,
  ).length;
  const late = withBest.filter(
    (r) => diffMilli(r.stForRank, r.raceBestSt) >= LATE_MILLI,
  ).length;

  // 抜出は「率」ではなく「実回数」を主表示にする（spec.md参照）。
  // 5・6コースは30走あたりの期待回数が0.2〜0.4回しかなく、率にすると
  // 0.0%が並ぶか、1回の出来事が3.3%に見えるかのどちらかになる
  let breakoutCount = null;
  let breakoutRate = null;
  if (course !== 1) {
    const withInner = target.filter(
      (r) => r.innerMinSt !== null && r.innerMinSt !== undefined,
    );
    breakoutCount = withInner.filter(
      (r) => diffMilli(r.innerMinSt, r.stForRank) >= BREAKOUT_MILLI,
    ).length;
    breakoutRate =
      withInner.length > 0 ? (breakoutCount / withInner.length) * 100 : null;
  }

  const avgSt = target.reduce((sum, r) => sum + r.stForRank, 0) / target.length;

  return {
    n,
    stableRate: withBest.length > 0 ? (stable / withBest.length) * 100 : null,
    lateRate: withBest.length > 0 ? (late / withBest.length) * 100 : null,
    breakoutCount,
    breakoutRate,
    avgSt,
    flyingCount,
  };
}

/**
 * `st_course_baseline.st_histogram` と同じビン（0.05刻み）のキー。
 * ベースラインと選手の分布を同じ軸で重ねるため、ビンの定義を1箇所に持つ。
 */
export const ST_HISTOGRAM_BINS = [
  "0.00",
  "0.05",
  "0.10",
  "0.15",
  "0.20",
  "0.25",
  "0.30+",
];

/** STがどのビンに入るかを返す（ベースラインのSQLと同じ境界） */
function binOf(st) {
  if (st < 0.05) return "0.00";
  if (st < 0.1) return "0.05";
  if (st < 0.15) return "0.10";
  if (st < 0.2) return "0.15";
  if (st < 0.25) return "0.20";
  if (st < 0.3) return "0.25";
  return "0.30+";
}

/**
 * 選手の指定コースでのST分布を、ベースラインと同じビンで数える（純関数）。
 *
 * Fの走は数えない（`stForRank` が null になっているため自然に落ちる）。
 * ビンの合計は `computeStConsideration` の `n` と一致する。
 *
 * @param {Array<Object>} rows `getRacerScopedRaceStats` の戻り値
 * @param {{course: number}} options
 * @returns {{total: number, bins: Record<string, number>}}
 */
export function computeStHistogram(rows, { course }) {
  const bins = Object.fromEntries(ST_HISTOGRAM_BINS.map((b) => [b, 0]));
  let total = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r.actualCourse !== course) continue;
    if (r.stForRank === null || r.stForRank === undefined) continue;
    bins[binOf(Number(r.stForRank))] += 1;
    total += 1;
  }
  return { total, bins };
}

/**
 * 選手の指定コースでの全走を、新しい順に返す（ST履歴の一覧用）。
 * Fの走も含める（`isFlying` で画面が「F」と出す）。
 */
export function getStHistory(rows, { course }) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r.actualCourse === course)
    .slice()
    .reverse();
}
