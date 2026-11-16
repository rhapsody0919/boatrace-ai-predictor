// オッズ一覧の派生値（出走艇・公式の導線・締切後の注記）。RaceOddsListTabBody の式を字のまま移しただけ
import { latestSnapshotWith } from "../../../utils/oddsMath";
import { parseRaceId } from "../../../utils/raceId";
import {
  BET_TYPES,
  FINAL_ODDS_SINCE,
  FINAL_ODDS_WINDOW_MS,
  activeBoatsOf,
  formatJstTime,
  todayJst,
} from "./oddsListHelpers";

// 出走艇（全券種の最新値＋ライブ値のキーから、欠場の記録が無い過去レースの欠場艇を除く）
export function boatsOf({ players, absentBoats, snapshots, livePages, finalOdds }) {
  return activeBoatsOf({
    players,
    absentBoats,
    maps: [
      ...BET_TYPES.filter((bt) => bt.id !== "winPlace").map(
        (bt) =>
          (snapshots &&
            latestSnapshotWith(snapshots, bt.dataKey)?.[bt.dataKey]) ??
          null,
      ),
      ...Object.values(livePages).flatMap((entry) =>
        Object.entries(entry.result?.data ?? {})
          .filter(([key]) => key !== "win" && key !== "place")
          .map(([, map]) => map),
      ),
      ...BET_TYPES.filter((bt) => bt.id !== "winPlace").map(
        (bt) => finalOdds?.[bt.dataKey] ?? null,
      ),
    ],
  });
}

// 公式のオッズへの導線・締切後の注記（締切時オッズの取り直しの予告）。RaceOddsListTabBody の式をそのまま移した
export function officialOddsNotesOf({
  raceId,
  liveEnabled,
  deadline,
  openedAtMs,
  finalOdds,
  snapshots,
}) {
  // 当日・締切前で、まだライブ取得の対象（締切90分前以内）に入っていないレースだけ、公式のオッズへの導線を出す
  const parsedRace = parseRaceId(raceId);
  const beforeLiveWindow =
    !liveEnabled &&
    !!parsedRace &&
    !!deadline &&
    parsedRace.date === todayJst(openedAtMs) &&
    deadline.getTime() > openedAtMs;
  const officialOddsUrl = beforeLiveWindow
    ? `https://www.boatrace.jp/owpc/pc/race/oddstf?rno=${parsedRace.raceNo}&jcd=${String(parsedRace.venueCode).padStart(2, "0")}&hd=${parsedRace.date.replace(/-/g, "")}`
    : null;

  // 締切後で締切時オッズ（公式）が無いとき: 取り直しの期間（締切5分後〜60分後）なら「pending」（あとで
  // 切り替わる）、期間を過ぎたら「unavailable」（取得できなかった。保存を始める前のレースは除く）
  const openedAfterDeadline = !!deadline && openedAtMs > deadline.getTime();
  const finalNote =
    finalOdds || !snapshots || !openedAfterDeadline
      ? null
      : openedAtMs - deadline.getTime() <= FINAL_ODDS_WINDOW_MS
        ? "pending"
        : parsedRace && parsedRace.date >= FINAL_ODDS_SINCE
          ? "unavailable"
          : null;
  // 締切時オッズを取り直す期間の終わり（「16:24頃までに表示されます」）
  const finalPendingUntil = deadline
    ? formatJstTime(
        new Date(deadline.getTime() + FINAL_ODDS_WINDOW_MS).toISOString(),
      )
    : null;
  return { openedAfterDeadline, officialOddsUrl, finalNote, finalPendingUntil };
}
