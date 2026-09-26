/**
 * seriesPoints - 今節の得点率（phase a FR-3 Phase B）
 *
 * ## なぜ自前で計算するのか
 *
 * 公式サイトの「得点率一覧」（`race/pointrank`）は **SG/G1 の4日目以降にしか出ない**。
 * 2026-09-26に実機で確認: 若松G1（ヤングダービー）は表が出るが、同日の桐生・戸田の
 * 一般戦はどちらも「※ データはありません。」。自社の `racer_series_points` が
 * 101行（2節・いずれもG1）しか無いのは取得漏れではなくこれが理由。
 * ボートレース日和は一般戦でも得点率を出しており（桐生の一般戦で確認）、
 * 同じことをするには自前計算しかない。
 *
 * ## 計算規則（公式データで検証済み）
 *
 * 2026-09-22〜 若松G1 の公式「得点率一覧」と、自社の `race_results` から計算した値を
 * 全選手で照合し、**得点・得点率とも49名中49名が完全一致**した。規則は次の4つ。
 *
 * 1. 着順点（予選・一般）: 1着10 / 2着8 / 3着6 / 4着4 / 5着2 / 6着1
 * 2. **特別戦（ドリーム戦・選抜戦）は別配点**: 1着12 / 2着10 / 3着9 / 4着7 / 5着6 / 6着5
 *    （若松G1の初日ドリーム戦の6名で、着順ごとの差が +2/+2/+3/+3/+4/+4 と揃うことから確定）
 * 3. **失格・落水・転覆は0点だが、分母（走数）には含める**。実データでは着順に載らず
 *    `rank5`/`rank6` が null になる（例: 2026-09-23 若松9R）
 * 4. **準優勝戦・優勝戦は算入しない**（公式の表も「予選終了時点」と明記している）
 *
 * 賞典除外・途中帰郷の選手は公式が得点率を出さない（「-」）。ここでは判定材料を
 * 持っていないので、走った分から計算した値をそのまま返す。
 */
import { finishPositionOf } from "./basicInfoStats.js";

/** 予選・一般戦の着順点 */
export const SCORE_POINTS = { 1: 10, 2: 8, 3: 6, 4: 4, 5: 2, 6: 1 };
/** 特別戦（ドリーム戦・選抜戦）の着順点 */
export const SPECIAL_SCORE_POINTS = { 1: 12, 2: 10, 3: 9, 4: 7, 5: 6, 6: 5 };

/**
 * 得点率に算入しないレース（勝ち上がり後のレース）。
 * 公式の得点率一覧が「◯日目12R終了時点」＝予選までで確定することに合わせる
 */
export function isExcludedStage(stage) {
  if (!stage) return false;
  return stage.includes("準優") || stage.includes("優勝戦");
}

/**
 * 特別戦（別配点）かどうか。
 *
 * **名前に「ドリーム」「選抜」を含むものだけ**を特別戦として扱う。実データの
 * `race_stage` は「５ールドレース」「ツッキーレース」のような会場固有の自由記述が
 * 多く、それらの配点は未検証のため、確認できているものだけを別配点にする
 * （未知のものは通常配点で計算し、最悪でも数点の誤差に留める）
 */
export function isSpecialStage(stage) {
  if (!stage) return false;
  return stage.includes("ドリーム") || stage.includes("選抜");
}

/**
 * 今節の得点・走数・得点率を計算する（純関数）。
 *
 * @param {Array<Object>} meetRecords `buildMeetResults` の戻り値（節内の走）
 * @returns {{points: number, runs: number, rate: number|null}}
 */
export function computeSeriesScore(meetRecords) {
  const rows = Array.isArray(meetRecords) ? meetRecords : [];
  let points = 0;
  let runs = 0;
  rows.forEach((r) => {
    if (isExcludedStage(r.raceStage)) return;
    // **結果がまだ無いレースは分母に入れない**。節の全選手を引く経路では
    // その日のこれから走るレースも `race_entries` に入っており、数えると
    // 「得点率4.00（4走）なのに日別の表は3行」という食い違いが出る
    // （2026-09-26 尼崎10Rで実際に発生）。
    // 失格・落水は結果行そのものはあり `rank1` に他艇が入るので、
    // `rank1` の有無で「実施されたか」を判定できる
    if (r.rank1 === null || r.rank1 === undefined) return;
    runs += 1;
    const rank = finishPositionOf(r);
    if (rank === null) return; // 失格・落水・転覆は0点（分母には入れる）
    const table = isSpecialStage(r.raceStage)
      ? SPECIAL_SCORE_POINTS
      : SCORE_POINTS;
    points += table[rank] ?? 0;
  });
  return { points, runs, rate: runs > 0 ? points / runs : null };
}

/**
 * 「今日この着順を取ると得点率がこうなる」の早見（純関数）。
 *
 * 表示中のレースが特別戦かどうかは画面側が持っていないため、**予選の配点で計算する**
 * （呼び出し側はその旨を注記すること）。準優・優勝戦の日は得点率が動かないが、
 * 同じ理由で判別できないので早見は出したまま注記に委ねる。
 *
 * @param {{points: number, runs: number}} current `computeSeriesScore` の戻り値
 * @returns {Array<{rank: number, rate: number}>} 1着〜6着
 */
export function forecastSeriesScore(current) {
  const points = current?.points ?? 0;
  const runs = current?.runs ?? 0;
  return [1, 2, 3, 4, 5, 6].map((rank) => ({
    rank,
    rate: (points + SCORE_POINTS[rank]) / (runs + 1),
  }));
}

/**
 * 準優勝戦の既定の枠数。直近2ヶ月の実測では129節中118節が3個レース＝18名
 * （4個=24名が3節、2個=12名が7節、1個=6名が1節）。節の準優が既に組まれていれば
 * 実数を使い、予選中で未定のときだけこの既定値を目安として使う
 */
export const SEMIFINAL_DEFAULT_SLOTS = 18;

/**
 * 節の全選手の得点率を計算して順位を付ける（純関数）。
 *
 * 得点率は**単独では読めない**（「3.67」だけでは準優に乗るか分からない）。
 * 節の中での位置と、準優の枠に対する距離を出して初めて判断材料になる。
 *
 * @param {{entries: Array<Object>}|null} scoreboard `getMeetScoreboard` の戻り値
 * @returns {Array<{racerId: number, playerName: string, points: number,
 *   runs: number, rate: number, rank: number}>} 得点率の降順。同率は同順位
 */
export function buildMeetRanking(scoreboard) {
  const entries = scoreboard?.entries;
  if (!Array.isArray(entries) || entries.length === 0) return [];

  const byRacer = new Map();
  entries.forEach((e) => {
    if (!byRacer.has(e.racerId))
      byRacer.set(e.racerId, { playerName: e.playerName, rows: [] });
    byRacer.get(e.racerId).rows.push(e);
  });

  const rows = [...byRacer.entries()]
    .map(([racerId, { playerName, rows: runs }]) => {
      const score = computeSeriesScore(runs);
      return { racerId, playerName, ...score };
    })
    .filter((r) => r.rate !== null)
    .sort((a, b) => b.rate - a.rate);

  // 同率は同順位（1,2,2,4…）。公式の得点率一覧と同じ付け方
  let rank = 0;
  let prev = null;
  return rows.map((r, i) => {
    if (prev === null || Math.abs(r.rate - prev) > 0.0001) rank = i + 1;
    prev = r.rate;
    return { ...r, rank };
  });
}

/**
 * 得点率に小標本の印を付ける走数の下限。
 *
 * 節の予選は6走前後で、2走以下だと1走の着順で得点率が2点近く動く
 * （2走2勝なら10.00、そこから6着を1つ挟むと7.00）。条件別タブの
 * `SMALL_SAMPLE_THRESHOLD`（n<6）は全期間の集計向けで、節には大きすぎるため別に持つ
 */
export const MEET_SMALL_SAMPLE_RUNS = 3;
