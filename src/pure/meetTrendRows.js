/**
 * RaceMeetTab の推移（6艇）の行と、選んだ1艇の走りの値を作る純関数（副作用なし）。
 * RaceMeetTabTrendModel.jsx から使う（`buildSelectedModel`・`mdOf` はそこから再 export して名前を保つ）。
 */
import {
  buildMeetResults,
  buildMeetTrend,
  getRecentRaces,
  lastStartTiming,
} from "./basicInfoStats.js";

// 表の日付（9/22）と同じ形。`slice` だけだと「09/22」でゼロ埋めが残る
export const mdOf = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

// 6艇の今節の推移（追加クエリ0本。節の全レースぶんをサービス層で2本
// 引いて畳んである）。**同じ節・同じ水面を走った6艇**なので、
// 縦の物差しを共通にして初めて比較になる
export function buildTrendRowsRaw(board, sortedPlayers) {
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

export function buildTrendStats(trendRows, trendKey) {
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
