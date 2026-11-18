/**
 * RaceMeetTab の推移（6艇）と選んだ1艇の走りの値を作る純関数（副作用なし）。
 * RaceMeetTabModel の `buildMeetModel` から呼ぶ。
 */
import { rankMeetAvgSt } from "./meetStRank";
import { layoutTrendByDate } from "../../utils/trendDateLayout";
import {
  buildSelectedModel,
  buildTrendRowsRaw,
  buildTrendStats,
  mdOf,
} from "../../pure/meetTrendRows.js";

export { buildSelectedModel, mdOf };

function buildTrendLayout(trendRowsRaw, trendKey, noRaceDays) {
  // **横軸は日付**（BOA-538）。以前は各行が自分の走数で左右いっぱいに伸びる
  // 「走った順」で、走数が違うと同じ横位置が別の日になり、行をまたいで同じ日と
  // 比べられなかった。節の日（6艇のうち誰かが走った日）を等間隔に並べて、
  // 6行の横位置をそろえる。`meetRunsByRacer` は表示中レースの直前までしか持たない
  // ので、日付の範囲は「この節の全日程」ではなく「ここに出ている走の範囲」。
  // 追加取得はせず、既に持っている日付から出す
  const trendDates = [
    ...new Set(
      trendRowsRaw.flatMap((r) => r.runs.map((x) => x.date).filter(Boolean)),
    ),
  ].sort();
  // 横軸は日付（BOA-538）。節の日（6艇のうち誰かが走った日）を等間隔に並べ、
  // 各走をその日の位置に置く。1日2走は左右にずらし、走らなかった日で線を切る
  const trendRows = trendRowsRaw.map((r) => ({
    ...r,
    layout: layoutTrendByDate(r.runs, trendDates),
  }));
  // **線が1本も引けないときは出さない**。初日で各艇1走だと点が1個ずつになり、
  // 折れ線が描かれないのに「◯〜◯の走」「走った順」と言うことになる
  // （戸田 2026-09-26 の11Rで、6行とも線が無い状態で出ていた）。
  // 2点以上ある行が1つも無ければ、説明することが無い
  const hasAnyLine = trendRows.some(
    (r) => r.runs.filter((x) => typeof x[trendKey] === "number").length >= 2,
  );
  const last = trendDates.length - 1;
  return {
    trendDates,
    trendRows,
    trendRange:
      trendDates.length > 0 && hasAnyLine
        ? { from: mdOf(trendDates[0]), to: mdOf(trendDates[last]) }
        : null,
    // 横軸の範囲の中で、レースが無かった日（目盛りから抜ける日、BOA-636）
    trendNoRaceDays:
      trendDates.length > 1
        ? noRaceDays.filter((d) => d > trendDates[0] && d < trendDates[last])
        : [],
  };
}

export function buildTrendModel(f) {
  const { board, sortedPlayers, raceId, trendMetric, noRaceDays } = f;
  const trendKey = trendMetric === "st" ? "st" : "exhibition";
  const trendRowsRaw = buildTrendRowsRaw(board, sortedPlayers);
  const layout = buildTrendLayout(trendRowsRaw, trendKey, noRaceDays);
  return {
    trendKey,
    ...layout,
    ...buildTrendStats(layout.trendRows, trendKey),
    meetStRanks: rankMeetAvgSt(
      trendRowsRaw.map(({ player, runs }) => ({ boat: player.number, runs })),
      { beforeRaceId: raceId },
    ),
  };
}

// 線の点に合わせたときに出す文字列（BOA-454の確認中に出たユーザー要望）。
// 文言の組み立て（i18n）は呼び出し側の責任にし、MeetSparkline は受け取った
// 文字列を出すだけにしてある。日付は月日だけ（同じ節しか並ばないので年は要らない）。
//
// **下の「日別の走り」表と同じ行（getRecentRaces の正規化後）から作る。**
// 生の `meet` の行はレース番号を持たず（race_id から導出する）、着順も
// `finishPositionOf` を通して初めて決まるため、生の行から組み立てると
// 表には「11R・4着」と出ているのに吹き出しだけ「—R・着外」になる
export const makeSparkLabel = (t) => (row, metricKey, value, rank) => {
  if (value === null || value === undefined) return null;
  const shown = Number(value).toFixed(2);
  return t("meetTab.sparkTip", {
    date:
      typeof row.date === "string" && row.date.length === 10
        ? mdOf(row.date)
        : (row.date ?? "—"),
    no: row.raceNo ?? "—",
    metric: t(metricKey),
    value: rank
      ? t("raceHistoryTable.startTimingCell", { time: shown, rank })
      : shown,
    finish:
      row.finishRank == null
        ? row.absent
          ? t("basicInfo.finishAbsent")
          : (row.finishMark ?? t("basicInfo.finishUnknown"))
        : t("meetTab.sparkTipFinish", { finish: row.finishRank }),
  });
};

