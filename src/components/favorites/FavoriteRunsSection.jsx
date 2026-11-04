/**
 * トップの区画「お気に入り選手の出走」（GS04-6、BOA-1272）。
 * 設計: docs/design/gs04-favorites/spec.md の 3・4・6、見た目は同じフォルダの mock/。
 *
 * 出走の行は予測の応答（getPredictions、選手は players で racerId・号艇を持つ）から作る。
 * トップの venuesData（get_today_races の形）は racerId・raceId を持たないので使わない
 * （#2225 はこれを読んで `race.entries is not iterable` でトップ全体を落とした）。
 * ☆の選手が0人のときは読まない。読み込み中・失敗のときは区画を出さず、トップは落とさない。
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useFavorites } from "../../hooks/useFavorites";
import { useLocalizedPath } from "../../hooks/useLocalizedPath";
import {
  buildFavoriteRuns,
  venuesFromPredictions,
} from "../../pure/favoriteRuns";
import { dataService } from "../../services/dataService";
import { getTodayJST } from "../../utils/dateUtils";
import { racerPagePath } from "../../utils/racerPagePath";
import { trackEvent } from "../../utils/analytics";
import { isAnalogyFinderEnabled } from "../../config/featureFlags";
import { GRADE_CONFIG } from "../../constants/gradeConfig";
import BoatBadge from "../race/BoatBadge";
import "./FavoriteRunsSection.css";

/** 375px（〜767px）で最初に出す締切前の行の数 */
const NARROW_VISIBLE = 4;

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

function RunRow({ row, state, extra }) {
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

export default function FavoriteRunsSection({ nowHHMM }) {
  const { t } = useTranslation();
  const { racers } = useFavorites();
  const { status, venues } = useTodayEntries(racers.length > 0);
  const [showMore, setShowMore] = useState(false);
  const [showPast, setShowPast] = useState(false);

  if (status !== "ready") return null;
  const { upcoming, past, runningRacerCount, raceCount } = buildFavoriteRuns(
    venues,
    racers,
    nowHHMM,
  );
  // 行が0件の代わりの表示は GS04-8（BOA-1274）
  if (upcoming.length + past.length === 0) return null;

  const hidden = upcoming.length - NARROW_VISIBLE;
  return (
    <section
      className="favorite-runs"
      data-testid="favorite-runs"
      aria-labelledby="favorite-runs-title"
    >
      <h3 id="favorite-runs-title" className="favorite-runs__title">
        {t("favorites.section.title")}
      </h3>
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
                />
              ))}
            </ul>
          )}
        </>
      )}
      <p className="favorite-runs__note">{t("favorites.section.note")}</p>
    </section>
  );
}
