/**
 * トップの区画「お気に入り選手の出走」（GS04-6〜8、BOA-1272〜1274）。
 * 設計: docs/design/gs04-favorites/spec.md の 3・4・6、見た目は同じフォルダの mock/。
 *
 * 出走の行は予測の応答（getPredictions、選手は players で racerId・号艇を持つ）から作る。
 * トップの venuesData（get_today_races の形）は racerId・raceId を持たないので出走の行には使わない
 * （#2225 はこれを読んで `race.entries is not iterable` でトップ全体を落とした）。
 * ☆の選手が0人のときは予測を読まない。読み込み中・失敗のときは区画を出さず、トップは落とさない。
 *
 * 行の成績の一言と今節（GS04-7）は useFavoriteRunStats。出走が無いときの代わりの表示と
 * ☆の会場の行（GS04-8）は FavoritesFallback で、トップの venuesData から作る（☆0人でも出す）。
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useFavorites } from "../../hooks/useFavorites";
import { useLocalizedPath } from "../../hooks/useLocalizedPath";
import { useFavoriteRunStats } from "../../hooks/useFavoriteRunStats";
import { useVisibleOnce } from "../../hooks/useVisibleOnce";
import {
  buildFavoriteRuns,
  buildFavoritesFallback,
  venuesFromPredictions,
  venuesFromTodayRaces,
} from "../../pure/favoriteRuns";
import { dataService } from "../../services/dataService";
import { getTodayJST } from "../../utils/dateUtils";
import { racerPagePath } from "../../utils/racerPagePath";
import { finishMarkKeyOf } from "../../utils/prevResult";
import { trackEvent } from "../../utils/analytics";
import { isAnalogyFinderEnabled } from "../../config/featureFlags";
import { GRADE_CONFIG } from "../../constants/gradeConfig";
import BoatBadge from "../race/BoatBadge";
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
    setResult((prev) =>
      prev.status === "ready" ? prev : { status: "loading", venues: null },
    );
    const date = getTodayJST();
    dataService
      .getPredictions(date, { light: true })
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

/** 今節の1走の札の文字（レース詳細の今節タブと同じ: 着順、欠場、公式の記号、着外） */
function useFinishLabel() {
  const { t } = useTranslation();
  return (run) => {
    if (run.finishRank != null) return String(run.finishRank);
    if (run.absent) return t("meetTab.finishAbsent");
    if (run.finishMark) {
      const key = finishMarkKeyOf(run.finishMark);
      return key ? t(`dataTable.prevMark.${key}`) : run.finishMark;
    }
    return t("raceHistoryTable.finishUnknownShort");
  };
}

function RunInfo({ row, info, seriesDay }) {
  const { t } = useTranslation();
  const finishLabel = useFinishLabel();
  // 読み込み中も2つの欄の高さを取っておく（CLS を出さない）
  if (info.loading)
    return (
      <>
        <div className="favorite-runs__meet" aria-busy="true" />
        <div className="favorite-runs__stat" aria-busy="true" />
      </>
    );
  if (info.error)
    return (
      <>
        <div className="favorite-runs__meet" />
        <div className="favorite-runs__stat favorite-runs__stat--failed">
          {t("favorites.section.statFailed")}
        </div>
      </>
    );
  const { stat, meet } = info;
  return (
    <>
      <div className="favorite-runs__meet">
        <span>{t("favorites.section.meet")}</span>
        {meet.length === 0 ? (
          // 「初日」と言い切るのは、節の日目が1（または不明）のときだけ。2日目以降で走が無いのは
          // 途中からの出場・記録の遅れで、初日ではない
          seriesDay == null || seriesDay === 1 ? (
            <span>{t("favorites.section.meetFirstDay")}</span>
          ) : null
        ) : (
          <span className="favorite-runs__seq">
            {meet.map((run) => (
              <b
                key={run.raceId}
                className={
                  run.finishRank === 1 || run.finishRank === 2
                    ? "favorite-runs__finish favorite-runs__finish--top"
                    : "favorite-runs__finish"
                }
              >
                {finishLabel(run)}
              </b>
            ))}
          </span>
        )}
      </div>
      <div className="favorite-runs__stat">
        {stat.kind === "rate" &&
          t("favorites.section.statLine", {
            boat: row.boat,
            n: stat.n,
            rate: stat.ratePct,
          })}
        {stat.kind === "count" &&
          t("favorites.section.statLineSmall", { boat: row.boat, n: stat.n })}
      </div>
    </>
  );
}

function RunRow({ row, state, extra, info, seriesDay }) {
  const { t, i18n } = useTranslation();
  const localize = useLocalizedPath();
  const isJa = i18n.resolvedLanguage === "ja";
  const grade = ["SG", "G1"].includes(row.raceGrade)
    ? GRADE_CONFIG[row.raceGrade]
    : null;
  const links = [
    { kind: "racer_page", to: racerPagePath(row.racerId), label: "linkRacer" },
    ...(isAnalogyFinderEnabled()
      ? [
          {
            kind: "sonar",
            to: localize(`/race/${row.raceId}?tab=sonar`),
            label: "linkSonar",
          },
        ]
      : []),
    // 思考アシストは ja 専用のページ（spec 4）
    ...(isJa
      ? [
          {
            kind: "assist",
            to: `/race/${row.raceId}/assist`,
            label: "linkAssist",
          },
        ]
      : []),
  ];
  const className = [
    "favorite-runs__row",
    state === "past" && "favorite-runs__row--past",
    extra && "favorite-runs__row--extra",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <li className={className}>
      <div className="favorite-runs__time">
        {row.startTime}
        {t("home.jstNote")}
        <small>{t("favorites.section.deadline")}</small>
      </div>
      <div className="favorite-runs__race">
        {grade && (
          <span
            className="favorite-runs__grade"
            style={{ backgroundColor: grade.color }}
          >
            {grade.label}
          </span>
        )}
        {t(`venues.${row.venueCode}`)} {row.raceNumber}R
      </div>
      <div className="favorite-runs__who">
        <BoatBadge n={row.boat} />
        <span className="favorite-runs__name" translate="no">
          {row.name}
        </span>
        {row.grade && <span className="favorite-runs__class">{row.grade}</span>}
      </div>
      <RunInfo row={row} info={info} seriesDay={seriesDay} />
      <div className="favorite-runs__links">
        {links.map((link) => (
          <Link
            key={link.kind}
            to={link.to}
            className="favorite-runs__link"
            onClick={() =>
              trackEvent("today_row_click", {
                row_kind: "run",
                row_link: link.kind,
                row_state: state,
                fav_state: "runs",
              })
            }
          >
            {t(`favorites.section.${link.label}`)}
          </Link>
        ))}
      </div>
    </li>
  );
}

export default function FavoriteRunsSection({ venuesData, nowHHMM }) {
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

  const runs = useMemo(
    () =>
      status === "ready"
        ? buildFavoriteRuns(venues, racers, nowHHMM)
        : EMPTY_RUNS,
    [status, venues, racers, nowHHMM],
  );
  const rows = useMemo(() => [...runs.upcoming, ...runs.past], [runs]);
  const seriesDayOf = useMemo(() => {
    const map = new Map();
    for (const venue of venues ?? [])
      for (const race of venue.races) map.set(race.raceId, race.seriesDay ?? null);
    return map;
  }, [venues]);
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
  const { upcoming, past, runningRacerCount, raceCount } = runs;
  const hidden = upcoming.length - NARROW_VISIBLE;

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
          fallback={fallback}
          favState={favState}
          racerCount={racers.length}
        />
      ) : (
        <>
          <p className="favorite-runs__lead">
            {t("favorites.section.lead", {
              racers: racers.length,
              running: runningRacerCount,
              races: raceCount,
            })}
          </p>
          {upcoming.length > 0 && (
            <ul className="favorite-runs__list">
              {upcoming.map((row, index) => (
                <RunRow
                  key={`${row.raceId}-${row.racerId}`}
                  row={row}
                  state="upcoming"
                  extra={!showMore && index >= NARROW_VISIBLE}
                  info={infoOf(row)}
                  seriesDay={seriesDayOf.get(row.raceId)}
                />
              ))}
            </ul>
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
                  {past.map((row) => (
                    <RunRow
                      key={`${row.raceId}-${row.racerId}`}
                      row={row}
                      state="past"
                      info={infoOf(row)}
                      seriesDay={seriesDayOf.get(row.raceId)}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
          <FavoriteVenueChips favVenues={fallback.favVenues} />
          <p className="favorite-runs__note">{t("favorites.section.note")}</p>
        </>
      )}
    </section>
  );
}
