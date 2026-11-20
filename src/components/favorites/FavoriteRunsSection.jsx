import { useEffect, useMemo, useState } from "react";
import { RunRow } from "./FavoriteRunRow";
import { useTranslation } from "react-i18next";
import { useFavorites } from "../../hooks/useFavorites";
import { useFavoriteRunStats } from "../../hooks/useFavoriteRunStats";
import { useVisibleOnce } from "../../hooks/useVisibleOnce";
import {
  buildFavoriteRuns,
  buildFavoritesFallback,
  venuesFromPredictions,
  venuesFromTodayRaces,
} from "../../pure/favoriteRuns";
import { getPredictions } from "../../services/predictionQueries2.js";
import { getTodayJST } from "../../utils/dateUtils";
import FavoritesFallback, { FavoriteVenueChips } from "./FavoritesFallback";
import "./FavoriteRunsSection.css";

/** 375px（〜767px）で最初に出す締切前の行の数 */
const NARROW_VISIBLE = 4;

const EMPTY_RUNS = {
  upcoming: [],
  past: [],
  runningRacerCount: 0,
  raceCount: 0,
};

/**
 * useVisibleOnce は鍵ごとにページをまたいで1回だけ呼ぶので、区画が付くたびに別の鍵にする
 * （同じ鍵だと、トップに戻ったときに成績を取りに行かない）
 */
let mountSeq = 0;

/**
 * 今日の予測の応答を会場別にまとめて返す。enabled が偽の間は読まない。
 * 失敗は console.error に出し、status: "failed" で返す（区画を出さない側に倒す）
 * @returns {{status: "idle"|"loading"|"ready"|"failed", venues: object[]|null}}
 */
function useTodayEntries(enabled) {
  const [result, setResult] = useState({ status: "idle", venues: null });
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    // 読み込み中は status が "idle" のまま（ready でない間は区画を出さないので、見た目は同じ）
    const date = getTodayJST();
    getPredictions(date, { light: true })
      .then((data) => {
        if (cancelled) return;
        if (data?.fetchFailed) {
          console.error(`お気に入り選手の出走: ${date} の予測の取得に失敗した`);
          setResult({ status: "failed", venues: null });
          return;
        }
        setResult({
          status: "ready",
          venues: venuesFromPredictions(data?.races),
        });
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("お気に入り選手の出走: 予測の取得に失敗した", error);
        setResult({ status: "failed", venues: null });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return enabled ? result : { status: "idle", venues: null };
}

/** 出走の行の組み立て（runs・締切後の並び・行の一覧・節の日目と段） */
function useSectionRuns(status, venues, racers, nowHHMM) {
  const runs = useMemo(
    () =>
      status === "ready"
        ? buildFavoriteRuns(venues, racers, nowHHMM)
        : EMPTY_RUNS,
    [status, venues, racers, nowHHMM],
  );
  // 締切後の行は直近の結果が先頭（締切の新しい順。同時刻は元の順を保つ）
  const pastNewestFirst = useMemo(
    () =>
      runs.past
        .map((row, index) => ({ row, index }))
        .sort(
          (a, b) =>
            b.row.startTime.localeCompare(a.row.startTime) || a.index - b.index,
        )
        .map(({ row }) => row),
    [runs],
  );
  const rows = useMemo(() => [...runs.upcoming, ...runs.past], [runs]);
  const { seriesDayOf, raceStageOf } = useMemo(() => {
    const days = new Map();
    const stages = new Map();
    for (const venue of venues ?? [])
      for (const race of venue.races) {
        days.set(race.raceId, race.seriesDay ?? null);
        stages.set(race.raceId, race.raceStage ?? null);
      }
    return { seriesDayOf: days, raceStageOf: stages };
  }, [venues]);
  return { runs, pastNewestFirst, rows, seriesDayOf, raceStageOf };
}

/** 締切前の行の一覧 */
function UpcomingList({ upcoming, showMore, infoOf, seriesDayOf, raceStageOf }) {
  return (
    <ul className="favorite-runs__list">
      {upcoming.map((row, index) => (
        <RunRow
          key={`${row.raceId}-${row.racerId}`}
          row={row}
          state="upcoming"
          extra={!showMore && index >= NARROW_VISIBLE}
          info={infoOf(row)}
          seriesDay={seriesDayOf.get(row.raceId)}
          raceStage={raceStageOf.get(row.raceId)}
        />
      ))}
    </ul>
  );
}

/** 締切後の行（開閉のボタンと一覧） */
function PastRuns({
  past,
  pastNewestFirst,
  showPast,
  setShowPast,
  infoOf,
  seriesDayOf,
  raceStageOf,
}) {
  const { t } = useTranslation();
  return (
    <>
      <button
        type="button"
        className="favorite-runs__toggle"
        aria-expanded={showPast}
        onClick={() => setShowPast((open) => !open)}
      >
        {t("favorites.section.pastRuns", { count: past.length })}
      </button>
      {showPast && (
        <ul className="favorite-runs__list">
          {pastNewestFirst.map((row) => (
            <RunRow
              key={`${row.raceId}-${row.racerId}`}
              row={row}
              state="past"
              info={infoOf(row)}
              seriesDay={seriesDayOf.get(row.raceId)}
              raceStage={raceStageOf.get(row.raceId)}
            />
          ))}
        </ul>
      )}
    </>
  );
}

/** 出走がある（favState が runs）ときの本文 */
function RunsBody({
  runs,
  racerCount,
  pastNewestFirst,
  showMore,
  setShowMore,
  showPast,
  setShowPast,
  infoOf,
  seriesDayOf,
  raceStageOf,
  fallback,
  nextOpenDates,
}) {
  const { t } = useTranslation();
  const { upcoming, past, runningRacerCount, raceCount } = runs;
  const hidden = upcoming.length - NARROW_VISIBLE;
  return (
    <>
      <p className="favorite-runs__lead">
        {t("favorites.section.lead", {
          racers: racerCount,
          running: runningRacerCount,
          races: raceCount,
        })}
      </p>
      {upcoming.length > 0 && (
        <UpcomingList
          upcoming={upcoming}
          showMore={showMore}
          infoOf={infoOf}
          seriesDayOf={seriesDayOf}
          raceStageOf={raceStageOf}
        />
      )}
      {hidden > 0 && !showMore && (
        <button
          type="button"
          className="favorite-runs__toggle favorite-runs__toggle--more"
          aria-expanded={false}
          onClick={() => setShowMore(true)}
        >
          {t("favorites.section.showMore", { count: hidden })}
        </button>
      )}
      {past.length > 0 && (
        <PastRuns
          past={past}
          pastNewestFirst={pastNewestFirst}
          showPast={showPast}
          setShowPast={setShowPast}
          infoOf={infoOf}
          seriesDayOf={seriesDayOf}
          raceStageOf={raceStageOf}
        />
      )}
      <FavoriteVenueChips
        favVenues={fallback.favVenues}
        nextOpenDates={nextOpenDates}
      />
      <p className="favorite-runs__note">{t("favorites.section.note")}</p>
    </>
  );
}

export default function FavoriteRunsSection({ venuesData, nowHHMM, nextOpenDates }) {
  const { t } = useTranslation();
  const { racers, venues: favVenueCodes } = useFavorites();
  const { status, venues } = useTodayEntries(racers.length > 0);
  const [showMore, setShowMore] = useState(false);
  const [showPast, setShowPast] = useState(false);
  // IntersectionObserver が無い環境では useVisibleOnce が呼ばれないので、最初から見えている扱い
  const [visible, setVisible] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  const [visibleKey] = useState(() => `favorite_runs|${(mountSeq += 1)}`);
  const sectionRef = useVisibleOnce(visibleKey, () => setVisible(true));

  const { runs, pastNewestFirst, rows, seriesDayOf, raceStageOf } =
    useSectionRuns(status, venues, racers, nowHHMM);
  const infoOf = useFavoriteRunStats(rows, visible);
  const fallback = useMemo(
    () =>
      buildFavoritesFallback(
        venuesFromTodayRaces(venuesData),
        favVenueCodes,
        nowHHMM,
      ),
    [venuesData, favVenueCodes, nowHHMM],
  );

  // ☆の選手がいて予測を読み込み中・失敗のときは出さない（「今日は出走なし」と取り違えない）
  if (racers.length > 0 && status !== "ready") return null;
  const favState =
    racers.length === 0
      ? "no_favorites"
      : rows.length === 0
        ? "no_runs"
        : "runs";

  return (
    <section
      ref={sectionRef}
      className="favorite-runs"
      data-testid="favorite-runs"
      data-fav-state={favState}
      aria-labelledby="favorite-runs-title"
    >
      <h3 id="favorite-runs-title" className="favorite-runs__title">
        {t("favorites.section.title")}
      </h3>
      {favState !== "runs" ? (
        <FavoritesFallback
          nextOpenDates={nextOpenDates}
          fallback={fallback}
          favState={favState}
          racerCount={racers.length}
        />
      ) : (
        <RunsBody
          runs={runs}
          racerCount={racers.length}
          pastNewestFirst={pastNewestFirst}
          showMore={showMore}
          setShowMore={setShowMore}
          showPast={showPast}
          setShowPast={setShowPast}
          infoOf={infoOf}
          seriesDayOf={seriesDayOf}
          raceStageOf={raceStageOf}
          fallback={fallback}
          nextOpenDates={nextOpenDates}
        />
      )}
    </section>
  );
}
