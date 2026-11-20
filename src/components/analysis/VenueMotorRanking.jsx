import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { MotorTableWrapper } from "./VenueMotorTable";
import { useLocation, useNavigate } from "react-router-dom";
import { getVenueMotorList } from "../../services/motorQueries4.js";
import { getVenuesWithTodaysRaces } from "../../services/scheduleQueries.js";
import { STADIUM_NAMES as VENUE_NAMES, ALL_VENUE_CODES } from "../../constants";
import { useHorizontalScrollHint } from "../../hooks/useHorizontalScrollHint";
import { useLocalizedPath } from "../../hooks/useLocalizedPath";
import { getTodayJST } from "../../utils/dateUtils";
import {
  sortMotorRows,
  formatSlashDate,
  formatMonthDay,
} from "../../utils/venueMotorRanking";
import { bestOf } from "../../utils/bestOf";
import "./VenueMotorRanking.css";
import "../common/HorizontalScrollHint.css";

function deriveMotorHeaders(result, venue, t) {
  const venueName =
    venue === null
      ? ""
      : t(`venues.${venue}`, VENUE_NAMES[venue] || String(venue));
  const fromPretest = result?.state === "ok" && result.source === "pretest";
  const pretestDate = result?.state === "ok" ? result.pretestDate : null;
  const seriesRange = result?.state === "ok" ? result.seriesRange : null;
  const recentDate = seriesRange
    ? t("meetPage.period", {
        start: formatMonthDay(seriesRange.start),
        end: formatMonthDay(seriesRange.end),
      })
    : pretestDate === null
      ? null
      : formatSlashDate(pretestDate);
  const userHeader =
    pretestDate === null || pretestDate === getTodayJST()
      ? t("analysis.motorRanking.userHeader")
      : t("analysis.motorRanking.userHeaderRecent", {
          date: recentDate,
        });
  return { venueName, fromPretest, userHeader };
}

function MotorRankingResult({
  t,
  localize,
  venue,
  result,
  venueName,
  fromPretest,
  userHeader,
  rows,
  tableProps,
}) {
  return (
    <>
      <p className="vmr-source">
        {fromPretest
          ? t("analysis.motorRanking.sourcePretest")
          : t("analysis.motorRanking.sourceVenueSite", {
              venue: venueName,
              date: formatSlashDate(result.scrapedDate),
            })}
      </p>

      {rows.length === 0 ? (
        <div className="vmr-state">{t("analysis.motorRanking.empty")}</div>
      ) : (
        <MotorTableWrapper
          t={t}
          localize={localize}
          venue={venue}
          rows={rows}
          fromPretest={fromPretest}
          userHeader={userHeader}
          {...tableProps}
        />
      )}

      <p className="vmr-note">
        {t(
          fromPretest
            ? "analysis.motorRanking.sortNotePretest"
            : "analysis.motorRanking.sortNote",
        )}
        <br />
        {t("analysis.motorRanking.linkNote")}
        <br />
        {t("analysis.motor.motorRiderMixNote")}
      </p>
    </>
  );
}

function MotorRankingStates({ t, venue, result, ...resultProps }) {
  return (
    <>
      {(venue === null || result === null) && (
        <div className="vmr-state">{t("analysis.loading")}</div>
      )}

      {result?.state === "error" && (
        <div className="vmr-state vmr-error" role="alert">
          {t("analysis.motorRanking.fetchError")}
        </div>
      )}

      {result?.state === "ok" && (
        <MotorRankingResult
          t={t}
          venue={venue}
          result={result}
          {...resultProps}
        />
      )}
    </>
  );
}

function MotorVenueSelect({ t, venue, selectVenue }) {
  return (
    <div className="vmr-controls">
      <label htmlFor="vmr-venue-select">{t("analysis.venueSelectLabel")}</label>
      <select
        id="vmr-venue-select"
        className="vmr-venue-select"
        value={venue ?? ""}
        onChange={(e) => selectVenue(parseInt(e.target.value, 10))}
      >
        {ALL_VENUE_CODES.map((v) => (
          <option key={v} value={v}>
            {t(`venues.${v}`, VENUE_NAMES[v] || String(v))}
          </option>
        ))}
      </select>
    </div>
  );
}

function VenueMotorRanking({ initialVenueCode = null }) {
  const { t } = useTranslation();
  const localize = useLocalizedPath();
  const [venue, setVenue] = useState(initialVenueCode);
  const location = useLocation();
  const navigate = useNavigate();
  // 会場を選び直したら URL の venue_code も替える（共有・再読み込みで同じ会場が開くように）
  const selectVenue = (code) => {
    setVenue(code);
    const next = new URLSearchParams(location.search);
    next.set("venue_code", String(code));
    navigate({ search: `?${next.toString()}` }, { replace: true });
  };
  // 取得結果は会場とセットで持つ（会場を替えた直後に前の会場の表が残らない。
  // 読み込み中は「今の会場の結果がまだ無い」から導く）
  const [loaded, setLoaded] = useState(null);
  const [sortKey, setSortKey] = useState("top2Rate");

  // 会場の指定が無ければ、今日開催している最初の会場（無ければ会場コード順の最初）
  useEffect(() => {
    if (initialVenueCode !== null) return;
    let cancelled = false;
    getVenuesWithTodaysRaces()
      .then((list) => {
        if (!cancelled) setVenue(list[0] ?? ALL_VENUE_CODES[0]);
      })
      .catch((err) => {
        console.error("本日開催の会場の取得エラー:", err);
        if (!cancelled) setVenue(ALL_VENUE_CODES[0]);
      });
    return () => {
      cancelled = true;
    };
  }, [initialVenueCode]);

  useEffect(() => {
    if (venue === null) return;
    let cancelled = false;
    getVenueMotorList(venue).then((data) => {
      if (!cancelled) setLoaded({ venue, data });
    });
    return () => {
      cancelled = true;
    };
  }, [venue]);

  const result = loaded?.venue === venue ? loaded.data : null;
  const rows = useMemo(
    () => (result?.state === "ok" ? sortMotorRows(result.rows, sortKey) : []),
    [result, sortKey],
  );
  // 2連率1位の機番（同率1位は全部、全部同じ値なら無し。UI統一ルール R1）
  const best = useMemo(
    () =>
      bestOf(
        rows.map((r) => ({ boat: r.motorNumber, value: r.top2Rate })),
        "max",
      ),
    [rows],
  );
  const maxRate = useMemo(
    () => Math.max(0, ...rows.map((r) => r.top2Rate).filter((v) => v !== null)),
    [rows],
  );
  const {
    ref: scrollRef,
    hasMore,
    update: updateScroll,
    scrollRight,
  } = useHorizontalScrollHint([rows.length]);

  const headers = deriveMotorHeaders(result, venue, t);

  return (
    <div className="vmr-container">
      <h2>{t("analysis.motorRanking.title")}</h2>
      <p className="vmr-description">
        {t("analysis.motorRanking.description")}
      </p>

      <MotorVenueSelect t={t} venue={venue} selectVenue={selectVenue} />

      <MotorRankingStates
        t={t}
        localize={localize}
        venue={venue}
        result={result}
        {...headers}
        rows={rows}
        tableProps={{
          maxRate,
          best,
          scroll: { scrollRef, hasMore, updateScroll, scrollRight },
          sortKey,
          setSortKey,
        }}
      />
    </div>
  );
}

export default VenueMotorRanking;
