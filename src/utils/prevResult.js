/**
 * 前走（今節）の1マスの読み方（BOA-569 → BOA-610）。データ出走表（raceIndicators.jsx）と
 * AIコピー（useAiCopyText.js）が使う。JSX を含まない純関数なので、ここに置いて単体テストする
 *
 * 以前は exhibition_data.prev_*（公式の直前情報の「同じ日の、このレースより前の走」）を
 * 出していた。前日までの走が入らないため、節の途中でもその日の1走目は空になり、
 * 「今節初戦」と誤って出た（2026-09-30 児島7R の西村拓也: 9/29 10R を走っているのに
 * 「今節初戦」。BOA-610）。いまは、同じ会場・同じ節でこのレースより前の最後の走を出す
 */

import { FINISH_MARKS, normalizeFinishMark } from "./raceOutcome.js";

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
 * 今節の前走の1マスに何を出すか（純関数、BOA-610）。
 *
 * - 節の初戦（今節の走がまだ無い）→ { kind: "firstOfMeet" }
 * - 着順が付かない走（F・L・転・欠など、本番STの着欄の記号）→ { kind: "mark", mark, markKey, course, raceId }
 *   **着順より先に見る**。返還艇（F）が race_results の着順に入っていることがある
 *   （BOA-576: 2026-09-19 戸田9R の3号艇は F なのに rank3）
 * - 着順が付いた走 → { kind: "rank", rank, course, raceId }
 * - 結果がまだ無い・読めない → { kind: "unknown" }
 *
 * @param {{firstOfMeet?: boolean, raceId?: string, boatNumber?: number,
 *   result?: Object|null, finishMark?: string|null}|null} entry
 *   サービス層（getRaceMeetPrevRuns）の1艇分。result は race_results の1行
 *   （rank1..6・course_1..6 に艇番が入る）
 */
export function meetPrevRunState(entry) {
  if (!entry) return { kind: "unknown" };
  if (entry.firstOfMeet) return { kind: "firstOfMeet" };
  const { raceId, boatNumber, result } = entry;
  if (!raceId || !boatNumber || !result) return { kind: "unknown" };
  const indexOf = (prefix) => {
    for (let n = 1; n <= 6; n += 1) {
      if (Number(result[`${prefix}${n}`]) === Number(boatNumber)) return n;
    }
    return null;
  };
  const course = indexOf("course_");
  const mark = normalizeFinishMark(entry.finishMark);
  if (mark !== null && !/^[0-9]$/.test(mark)) {
    return {
      kind: "mark",
      mark,
      markKey: finishMarkKeyOf(mark),
      course,
      raceId,
    };
  }
  const rank = indexOf("rank");
  if (rank !== null) return { kind: "rank", rank, course, raceId };
  return { kind: "unknown" };
}

/**
 * 前走がいつのどのレースかを、i18n（dataTable.prevResultWhen）に渡す値にする（BOA-610）。
 * 前日までの走も出るようになったので、「どの走の結果か」を併記しないと読み違える
 *
 * @param {string|null} raceId `YYYY-MM-DD-VV-RR`
 * @returns {{month: number, day: number, race: number}|null}
 */
export function meetPrevRunWhenParams(raceId) {
  const m = /^\d{4}-(\d{2})-(\d{2})-\d{2}-(\d{2})$/.exec(raceId ?? "");
  if (!m) return null;
  return { month: Number(m[1]), day: Number(m[2]), race: Number(m[3]) };
}
