/**
 * 前検タイム（`motor_pretest_stats`）の行の選び方（BOA-451 / phase a FR-4a）
 *
 * このテーブルは「1節に1行」ではない。**時期によって行の意味が変わる**。
 * 古い期間は節に1日（前検日）だけだが、直近は節の中の複数日に行がある
 * （例: 桐生の9月は 09-05 / 09-20 / 09-23 / 09-24 / 09-25。09-20〜25 が1つの節で、
 * その中でも 09-21・09-22 には行が無い）。どの行を採るかを決める必要がある。
 *
 * ## 結論: どの行を採っても前検タイム・前検順位は同じ（2026-09-28 実測）
 *
 * 会場×選手×節の連続区間 **31,268 区間すべて**で `pretest_time` も `pretest_rank` も
 * 単一値だった（変動する区間は0件）。前検は節の初日に1回だけ計測する値なので、
 * 節の中で更新されないのは仕様どおり。行が複数あるのは、取得ジョブが節の期間中
 * 毎日スナップショットを取り直しているため。
 *
 * したがって画面ごとに違う採り方をしても**数字は食い違わない**。
 * 今節タブ（`getMeetScoreboard`）は節の最初の行、モータ情報タブ
 * （`getRaceMotorBreakdown`）は最新の行を採るが、両者は必ず一致する。
 * この不変条件は `npm run verify:pretest-row-pick` が本番データで検査する。
 *
 * ## ルックバックを6日にした理由
 *
 * - 日付の完全一致だけで引くと当たるのは **30.9%**（2026年9月の出走25,344件）
 * - 6日ルックバック（`race_date <= 当日` かつ `>= 当日 - 6`、最新を採用）で **94.6%**
 * - 6日にしても**前の節の行を拾う例は0件**（2026-01-01〜09-27 の 241,427 件で、
 *   採った行の `series_title` がその日の節の `series_title` と食い違うケースは無し）。
 *   節は最長でも7日で、同じ選手が同じ会場の連続する節に出続けることが無いため
 */

/** 前検タイムを探すときのルックバック日数（当日を含めて7日ぶん） */
export const PRETEST_LOOKBACK_DAYS = 6;

/** `YYYY-MM-DD` を n 日戻した `YYYY-MM-DD` にする */
export function shiftDate(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 節の**最初**の行（＝前検日のもの）を選手ごとに採る。今節タブが使う。
 * @param {Array<{racer_id: number, race_date: string}>} rows
 * @returns {Map<number, object>}
 */
export function pickFirstPretestByRacer(rows) {
  return pickByRacer(rows, "asc");
}

/**
 * `race_date` が**最新**の行を選手ごとに採る。モータ情報タブが使う。
 * @param {Array<{racer_id: number, race_date: string}>} rows
 * @returns {Map<number, object>}
 */
export function pickLatestPretestByRacer(rows) {
  return pickByRacer(rows, "desc");
}

function pickByRacer(rows, order) {
  const sorted = [...(rows ?? [])].sort((a, b) =>
    order === "asc"
      ? String(a.race_date).localeCompare(String(b.race_date))
      : String(b.race_date).localeCompare(String(a.race_date)),
  );
  const map = new Map();
  sorted.forEach((row) => {
    if (!map.has(row.racer_id)) map.set(row.racer_id, row);
  });
  return map;
}
