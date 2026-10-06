/**
 * VenueMotorRanking - 会場モーターランキング（BOA-428 子3）
 * 会場を選ぶと、その会場の全モーターを 順位・機番・2連率（横棒）・優出・優勝・前検・
 * 今節使用者 で並べる。機番・2連率・優勝・前検の見出しで並べ替え（向きは列ごとに固定）、
 * 同じ値は同じ順位（1, 2, 2, 4）。
 *
 * 2連率・優出・優勝は会場公式サイトのモーター成績（表の上に出典と取得日を出す。ADR-0067）。
 * 会場サイトの値を出さない会場（戸田・平和島・浜名湖・宮島）は、BOATRACE 公式の前検データに
 * 載るモーターだけを公式2連率で並べる。
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabaseDataService } from "../../services/supabaseDataService";
import { STADIUM_NAMES as VENUE_NAMES, ALL_VENUE_CODES } from "../../constants";
import { useHorizontalScrollHint } from "../../hooks/useHorizontalScrollHint";
import { useLocalizedPath } from "../../hooks/useLocalizedPath";
import { getTodayJST } from "../../utils/dateUtils";
import {
  sortMotorRows,
  formatMotorRate,
  formatSlashDate,
} from "../../utils/venueMotorRanking";
import RateBar from "../common/RateBar";
import { bestOf } from "../../utils/bestOf";
import "./VenueMotorRanking.css";
import "../common/HorizontalScrollHint.css";

// 棒は艇の一覧ではないので中立色（UI統一ルール R4）
const NEUTRAL_FILL =
  "color-mix(in srgb, var(--text-secondary) 45%, transparent)";

const dash = "-";

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
    supabaseDataService
      .getVenuesWithTodaysRaces()
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
    supabaseDataService.getVenueMotorList(venue).then((data) => {
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

  const venueName =
    venue === null
      ? ""
      : t(`venues.${venue}`, VENUE_NAMES[venue] || String(venue));
  const fromPretest = result?.state === "ok" && result.source === "pretest";
  const pretestDate = result?.state === "ok" ? result.pretestDate : null;
  const userHeader =
    pretestDate === null || pretestDate === getTodayJST()
      ? t("analysis.motorRanking.userHeader")
      : t("analysis.motorRanking.userHeaderRecent", {
          date: formatSlashDate(pretestDate),
        });

  const sortHeader = (key, label) => (
    <th
      aria-sort={
        sortKey === key
          ? key === "motorNumber" || key === "pretestTime"
            ? "ascending"
            : "descending"
          : undefined
      }
    >
      <button
        type="button"
        className={`vmr-sort-btn${sortKey === key ? " is-active" : ""}`}
        onClick={() => setSortKey(key)}
      >
        {label}
        <span className="vmr-sort-mark" aria-hidden="true">
          {sortKey === key ? "▼" : "▽"}
        </span>
      </button>
    </th>
  );

  return (
    <div className="vmr-container">
      <h2>{t("analysis.motorRanking.title")}</h2>
      <p className="vmr-description">
        {t("analysis.motorRanking.description")}
      </p>

      <div className="vmr-controls">
        <label htmlFor="vmr-venue-select">
          {t("analysis.venueSelectLabel")}
        </label>
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

      {(venue === null || result === null) && (
        <div className="vmr-state">{t("analysis.loading")}</div>
      )}

      {result?.state === "error" && (
        <div className="vmr-state vmr-error" role="alert">
          {t("analysis.motorRanking.fetchError")}
        </div>
      )}

      {result?.state === "ok" && (
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
            <div
              className={`vmr-table-wrapper hscroll-hint${hasMore ? " has-more" : ""}`}
            >
              {hasMore && (
                <button
                  type="button"
                  className="hscroll-more"
                  onClick={scrollRight}
                  aria-hidden="true"
                  tabIndex={-1}
                >
                  ›
                </button>
              )}
              <div
                className="vmr-table-scroll"
                ref={scrollRef}
                onScroll={updateScroll}
              >
                <table className="vmr-table">
                  <thead>
                    <tr>
                      <th>{t("analysis.motorRanking.rankHeader")}</th>
                      {sortHeader(
                        "motorNumber",
                        t("analysis.motor.motorNumberShortHeader"),
                      )}
                      {sortHeader(
                        "top2Rate",
                        fromPretest
                          ? t("analysis.motorRanking.officialRateHeader")
                          : t("analysis.motorRanking.rateHeader"),
                      )}
                      <th>{t("analysis.motorRanking.finalHeader")}</th>
                      {sortHeader(
                        "championshipCount",
                        t("analysis.motorRanking.championshipHeader"),
                      )}
                      {sortHeader(
                        "pretestTime",
                        t("analysis.motor.pretestTimeHeader"),
                      )}
                      <th className="vmr-user-head">{userHeader}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.motorNumber}>
                        <td className="vmr-rank">{r.rank ?? dash}</td>
                        <td className="vmr-no">
                          {r.raceId ? (
                            <Link
                              to={localize(
                                `/winning-technique?tab=motor&venue_code=${venue}&race_id=${r.raceId}&motor=${r.motorNumber}`,
                              )}
                            >
                              {r.motorNumber}
                            </Link>
                          ) : (
                            r.motorNumber
                          )}
                        </td>
                        <td className="vmr-rate">
                          {r.top2Rate === null ? (
                            dash
                          ) : (
                            <RateBar
                              value={r.top2Rate}
                              max={maxRate}
                              fill={NEUTRAL_FILL}
                              best={best.has(r.motorNumber)}
                              label={formatMotorRate(r.top2Rate)}
                            />
                          )}
                        </td>
                        <td>{r.finalCount ?? dash}</td>
                        <td>{r.championshipCount ?? dash}</td>
                        <td>
                          {r.pretestTime === null
                            ? dash
                            : r.pretestTime.toFixed(2)}
                        </td>
                        <td className="vmr-user">
                          {r.racerId !== null ? (
                            <Link
                              to={localize(`/racer/${r.racerId}`)}
                              translate="no"
                            >
                              {r.racerName ?? r.racerId}
                            </Link>
                          ) : (
                            dash
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="vmr-note">
            {t("analysis.motorRanking.sortNote")}
            <br />
            {t("analysis.motor.motorRiderMixNote")}
          </p>
        </>
      )}
    </div>
  );
}

export default VenueMotorRanking;
