/**
 * RaceMeetTab の推移（6艇）と選んだ1艇の走りの値を作る純関数（副作用なし）。
 * RaceMeetTabModel の `buildMeetModel` から呼ぶ。
 */
import { rankMeetAvgSt } from "./meetStRank";
import { layoutTrendByDate } from "../../utils/trendDateLayout";
import {
  buildMeetResults,
  buildMeetTrend,
  getRecentRaces,
  lastStartTiming,
} from "./basicInfoStats";

// 表の日付（9/22）と同じ形。`slice` だけだと「09/22」でゼロ埋めが残る
export const mdOf = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

// 6艇の今節の推移（追加クエリ0本。節の全レースぶんをサービス層で2本
// 引いて畳んである）。**同じ節・同じ水面を走った6艇**なので、
// 縦の物差しを共通にして初めて比較になる
function buildTrendRowsRaw(board, sortedPlayers) {
  const meetRunsByRacer = board?.meetRunsByRacer ?? {};
  // 中身の無い走（ST・展示・着順のどれも無い）は外す。中止になった日のレースは
  // 出走表にだけ残り、点の無い空きの位置を取って線を片側に寄せていた
  // （津 2026-09-21・22 は中止。2026-09-28 の最終日で、飯山泰の線が右7割に詰まった。
  // BOA-537 ファン評価2周目）
  return sortedPlayers.map((p) => ({
    player: p,
    runs: (meetRunsByRacer[p.racerId] ?? []).filter(
      (x) =>
        x.st !== null ||
        x.exhibition !== null ||
        (x.finish !== null && x.finish !== undefined),
    ),
  }));
}

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

function buildTrendStats(trendRows, trendKey) {
  const trendValues = trendRows
    .flatMap((r) => r.runs.map((x) => x[trendKey]))
    .filter((v) => typeof v === "number");
  return {
    trendDomain:
      trendValues.length >= 2
        ? [Math.min(...trendValues), Math.max(...trendValues)]
        : null,
    // 6艇の平均。各行の同じ高さに破線で引くと、行をまたいだ比較の手がかりになる
    // （行が分かれていると「同じ物差し」と書いても伝わりにくい）
    trendMean:
      trendValues.length >= 2
        ? trendValues.reduce((a, b) => a + b, 0) / trendValues.length
        : null,
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

// スパークラインの右端に出す「前走」の値（欠測は飛ばして最後の実測を採る）
const lastOf = (meet, key) => {
  const vals = meet.map((r) => r[key]).filter((v) => typeof v === "number");
  return vals.length > 0 ? vals[vals.length - 1] : null;
};

export function buildSelectedModel(f) {
  const { board, records, raceId, venueCode, selectedPlayer, pretestOf } = f;
  const meet = buildMeetResults(records ?? [], { raceId, venueCode });
  // 表の日付（9/22）と揃える。`slice` だけだと「09/22」でゼロ埋めが残る
  const firstMeetDate = meet[0]?.date ? mdOf(meet[0].date) : "";
  // 今節の各走の「そのレース内でのST順位」（節の全レースぶんのSTから算出済み）
  const stRankByRace = Object.fromEntries(
    (board?.meetRunsByRacer?.[selectedPlayer?.racerId] ?? []).map((r) => [
      r.raceId,
      r.stRank,
    ]),
  );
  return {
    meet,
    st: buildMeetTrend(meet, records ?? []).st,
    pre: pretestOf(selectedPlayer?.racerId),
    firstMeetDate,
    stRankByRace,
    venueDailyExhibitionAvg: board?.venueDailyExhibitionAvg ?? {},
    // 下の「日別の走り」表と同じ行（getRecentRaces の正規化後）。吹き出しの文字列もここから作る
    meetRows: getRecentRaces(meet, meet.length),
    // STの前走は、直前がFならFと出す（数値のある最後の走を採るとFを飛ばす。BOA-597）
    lastSt: lastStartTiming(meet, {
      valueOf: (r) => r.startTiming,
      markOf: (r) =>
        r.isFlying === true ? "F" : r.finishMark === "L" ? "L" : null,
    }),
    lastExhibition: lastOf(meet, "exhibitionTime"),
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

