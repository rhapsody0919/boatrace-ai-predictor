/**
 * 前走成績の1マスの読み方（BOA-569）。データ出走表（raceIndicators.jsx）が使う。
 * JSX を含まない純関数なので、ここに置いて単体テストする
 */

import { FINISH_MARKS, normalizeFinishMark } from "./raceOutcome.js";

const toNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * 前走成績（exhibition_data.prev_*）が、取得漏れなく入り始めた日（BOA-569）。
 *
 * prev_* は「**同じ日に、このレースより前に走ったレース**」の記録（今節の前走ではない）。
 * 2026-09-28 の全864行で、前走が入っている317行は全て同じ日の直前の走と一致し、
 * 空の547行は全てその日まだ走っていなかった。この日以降は「空＝本日初走」と読める。
 * 09-15 以前は、同じ日に走っているのに空の行が大量にある（09-14 は372行、09-15 は108行）
 */
export const PREV_RESULT_AVAILABLE_FROM = "2026-09-16";

/**
 * 公式の記号（着順が付かない走の F・転・エ など）を、訳すための key に引く
 * （i18n の dataTable.prevMark.<key> / result.mark.<key>）。全角の Ｆ・Ｌ は半角にそろえる。
 * 知らない記号・空は null（呼び出し側は記号をそのまま出す）。データ出走表と
 * 直近の出走履歴で同じ表記にするための共通の入口（BOA-569 ファン評価3周目）
 *
 * @param {string|null} mark
 * @returns {string|null}
 */
export function finishMarkKeyOf(mark) {
  const m = normalizeFinishMark(mark);
  return m === null ? null : (FINISH_MARKS[m]?.key ?? null);
}

/**
 * 前走成績の1マスに何を出すか（純関数、BOA-569）。
 *
 * - 前走があり着順も有る → { kind: "rank", rank, course }
 * - 前走があり着順が無い（失・F・転など）→ { kind: "mark", mark, markKey, course }（記号が無ければ unknown）。
 *   markKey は FINISH_MARKS の key（i18n の dataTable.prevMark.<key>）。日本語以外の画面で
 *   「エ」「転」を生のまま出さないため（BOA-569 ファン評価2周目）。知らない記号は null
 * - 前走が空で、取得漏れが無い日（または 1R）→ { kind: "firstToday" }（その日の最初の走）
 * - それ以外（取得が始まる前の空）→ { kind: "unknown" }
 *
 * @param {Object|null} row exhibition_data の1行
 * @param {string|null} raceId 表示中のレース
 */
export function prevResultState(row, raceId) {
  const prevNo = toNumber(row?.prev_race_no);
  const course = toNumber(row?.prev_entry_course);
  if (prevNo !== null) {
    const rank = toNumber(row?.prev_finish_rank);
    if (rank !== null) return { kind: "rank", rank, course };
    const mark = normalizeFinishMark(row?.prev_finish_mark);
    return mark !== null && !/^[0-9]$/.test(mark)
      ? { kind: "mark", mark, markKey: finishMarkKeyOf(mark), course }
      : { kind: "unknown" };
  }
  const raceDate = (raceId ?? "").slice(0, 10);
  const raceNo = Number((raceId ?? "").slice(14, 16));
  if (raceNo === 1) return { kind: "firstToday" };
  if (raceDate && raceDate >= PREV_RESULT_AVAILABLE_FROM)
    return { kind: "firstToday" };
  return { kind: "unknown" };
}
