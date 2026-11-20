import { Link } from "react-router-dom";
import {
  formatMotorRate,
  MOTOR_SORT_KEYS,
} from "../../utils/venueMotorRanking";
import RateBar from "../common/RateBar";

// 棒は艇の一覧ではないので中立色（UI統一ルール R4）
const NEUTRAL_FILL =
  "color-mix(in srgb, var(--text-secondary) 45%, transparent)";

const dash = "-";

function MotorSortHeader({ sortKey, columnKey, label, setSortKey }) {
  return (
    <th
      aria-sort={
        sortKey === columnKey
          ? MOTOR_SORT_KEYS[columnKey].ascending
            ? "ascending"
            : "descending"
          : undefined
      }
    >
      <button
        type="button"
        className={`vmr-sort-btn${sortKey === columnKey ? " is-active" : ""}`}
        onClick={() => setSortKey(columnKey)}
      >
        {label}
        <span className="vmr-sort-mark" aria-hidden="true">
          {
            (MOTOR_SORT_KEYS[columnKey].ascending ? "▲△" : "▼▽")[
              sortKey === columnKey ? 0 : 1
            ]
          }
        </span>
      </button>
    </th>
  );
}

function MotorTableHead({ t, sortKey, setSortKey, fromPretest, userHeader }) {
  const sortHeader = (key, label) => (
    <MotorSortHeader
      sortKey={sortKey}
      columnKey={key}
      label={label}
      setSortKey={setSortKey}
    />
  );
  return (
    <thead>
      <tr>
        <th>{t("analysis.motorRanking.rankHeader")}</th>
        {sortHeader("motorNumber", t("analysis.motor.motorNumberShortHeader"))}
        {sortHeader(
          "top2Rate",
          fromPretest
            ? t("analysis.motorRanking.officialRateHeader")
            : t("analysis.motorRanking.rateHeader"),
        )}
        <th>{t("analysis.motorRanking.finalHeader")}</th>
        {/* 会場サイトの値を出さない会場は優勝が全部「-」なので、並べ替えを出さない
            （押すと全行の順位が「-」になり、壊れて見える。ファン評価 2周目） */}
        {fromPretest ? (
          <th>{t("analysis.motorRanking.championshipHeader")}</th>
        ) : (
          sortHeader(
            "championshipCount",
            t("analysis.motorRanking.championshipHeader"),
          )
        )}
        {sortHeader("pretestTime", t("analysis.motor.pretestTimeHeader"))}
        <th className="vmr-user-head">{userHeader}</th>
      </tr>
    </thead>
  );
}

function MotorRateCell({ r, t, maxRate, best }) {
  return (
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
      {r.top2Rate !== null && r.raceCount !== null && (
        <span className="vmr-race-count">
          {t("analysis.motorRanking.raceCount", {
            n: r.raceCount,
          })}
        </span>
      )}
    </td>
  );
}

function MotorRow({ r, t, localize, venue, maxRate, best }) {
  return (
    <tr>
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
      <MotorRateCell r={r} t={t} maxRate={maxRate} best={best} />
      <td>{r.finalCount ?? dash}</td>
      <td>{r.championshipCount ?? dash}</td>
      <td>{r.pretestTime === null ? dash : r.pretestTime.toFixed(2)}</td>
      <td className="vmr-user">
        {r.racerId !== null ? (
          <Link to={localize(`/racer/${r.racerId}`)} translate="no">
            {r.racerName ?? r.racerId}
          </Link>
        ) : (
          dash
        )}
      </td>
    </tr>
  );
}

function MotorTableWrapper({
  t,
  localize,
  venue,
  rows,
  maxRate,
  best,
  scroll,
  sortKey,
  setSortKey,
  fromPretest,
  userHeader,
}) {
  const { scrollRef, hasMore, updateScroll, scrollRight } = scroll;
  return (
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
      <div className="vmr-table-scroll" ref={scrollRef} onScroll={updateScroll}>
        <table className="vmr-table">
          <MotorTableHead
            t={t}
            sortKey={sortKey}
            setSortKey={setSortKey}
            fromPretest={fromPretest}
            userHeader={userHeader}
          />
          <tbody>
            {rows.map((r) => (
              <MotorRow
                key={r.motorNumber}
                r={r}
                t={t}
                localize={localize}
                venue={venue}
                maxRate={maxRate}
                best={best}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export { MotorTableWrapper };
