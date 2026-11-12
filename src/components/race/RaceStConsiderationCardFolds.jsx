/**
 * RaceStConsiderationCard の折りたたみ（ST分布 / ST履歴）。
 * どちらも1艇ずつしか描けないため、上のグリッド（6艇横並び）とは別に
 * 「どの艇を見るか」のチップを持つ（detailBoat は親が持つ）。
 */
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../utils/colors";
import { finishPositionOf } from "./basicInfoStats";
import {
  computeStHistogram,
  getStHistory,
  ST_HISTOGRAM_BINS,
} from "../../utils/stConsideration";

/** 選んだ艇の ST分布・ST履歴・ベースライン分布(%)をまとめて組み立てる */
function buildDetail(columns, scopedByRacer, detailBoat) {
  const detailColumn =
    columns.find((c) => c.player.number === detailBoat) ?? columns[0];
  const detailRecords = detailColumn.player.racerId
    ? scopedByRacer[detailColumn.player.racerId]
    : null;
  const histogram = Array.isArray(detailRecords)
    ? computeStHistogram(detailRecords, { course: detailColumn.course })
    : null;
  const history = Array.isArray(detailRecords)
    ? getStHistory(detailRecords, { course: detailColumn.course })
    : [];

  // ベースラインの分布を割合(%)に直す。母数が桁違い（例: 44走 vs 16,640走）なので
  // 件数では比べられず、割合に正規化してから重ねる
  const baselineBins = detailColumn.cell?.st_histogram ?? null;
  const baselineTotal = baselineBins
    ? Object.values(baselineBins).reduce((a, b) => a + Number(b), 0)
    : 0;
  const baselinePctByBin = Object.fromEntries(
    ST_HISTOGRAM_BINS.map((bin) => [
      bin,
      baselineTotal > 0
        ? (Number(baselineBins[bin] ?? 0) / baselineTotal) * 100
        : 0,
    ]),
  );
  const ownPctOf = (bin) =>
    histogram && histogram.total > 0
      ? ((histogram.bins[bin] ?? 0) / histogram.total) * 100
      : 0;
  const maxBinPct = Math.max(
    ...ST_HISTOGRAM_BINS.map((bin) =>
      Math.max(ownPctOf(bin), baselinePctByBin[bin] ?? 0),
    ),
    1,
  );
  return {
    detailColumn,
    histogram,
    history,
    baselinePctByBin,
    ownPctOf,
    maxBinPct,
  };
}

function FoldToggle({ id, label, openSection, setOpenSection }) {
  return (
    <button
      type="button"
      className={`rsc-fold-toggle${openSection === id ? " is-open" : ""}`}
      onClick={() => setOpenSection((v) => (v === id ? null : id))}
      aria-expanded={openSection === id}
    >
      {openSection === id ? "▾ " : "▸ "}
      {label}
    </button>
  );
}

function DetailChips({ columns, detailColumn, setDetailBoat }) {
  return (
    <div className="rsc-detail-chips" role="group">
      {columns.map(({ player }) => {
        const active = detailColumn.player.number === player.number;
        const color = BOAT_COLORS[player.number] || {};
        return (
          <button
            key={player.number}
            type="button"
            className={`rsc-detail-chip${active ? " is-active" : ""}`}
            style={
              active ? { background: color.bg, color: color.text } : undefined
            }
            onClick={() => setDetailBoat(player.number)}
            aria-pressed={active}
          >
            {player.number}
          </button>
        );
      })}
      <span className="rsc-detail-name" translate="no">
        {detailColumn.player.name?.replace(/\s+/g, "")}
      </span>
    </div>
  );
}

function HistogramBars({ detail }) {
  const { t } = useTranslation();
  const { histogram, baselinePctByBin, ownPctOf, maxBinPct } = detail;
  return (
    <div className="rsc-histogram">
      {ST_HISTOGRAM_BINS.map((bin) => (
        <div key={bin} className="rsc-hist-col">
          <span className="rsc-hist-bars">
            <span
              className="rsc-hist-own"
              style={{ height: `${(ownPctOf(bin) / maxBinPct) * 100}%` }}
              title={t("stConsideration.histogramOwnTitle", {
                pct: ownPctOf(bin).toFixed(1),
                n: histogram.bins[bin] ?? 0,
              })}
            />
            <span
              className="rsc-hist-base"
              style={{
                height: `${((baselinePctByBin[bin] ?? 0) / maxBinPct) * 100}%`,
              }}
              title={t("stConsideration.histogramBaseTitle", {
                pct: (baselinePctByBin[bin] ?? 0).toFixed(1),
              })}
            />
          </span>
          <span className="rsc-hist-label">{bin}</span>
        </div>
      ))}
    </div>
  );
}

function HistogramView({ detail }) {
  const { t } = useTranslation();
  const { detailColumn, histogram } = detail;
  if (histogram === null || histogram.total === 0) {
    return <p className="rsc-fold-empty">{t("wakuInfo.noData")}</p>;
  }
  return (
    <>
      <p className="rsc-fold-note">
        {t("stConsideration.histogramNote", {
          course: detailColumn.course,
          grade: detailColumn.grade ?? "—",
          n: histogram.total,
          baselineN: Number(detailColumn.cell?.runs ?? 0).toLocaleString(),
        })}
      </p>
      <HistogramBars detail={detail} />
      <p className="rsc-fold-legend">{t("stConsideration.histogramLegend")}</p>
    </>
  );
}

function HistoryRow({ r }) {
  const { t } = useTranslation();
  return (
    <tr>
      <td>{r.date}</td>
      <td>{t(`venues.${r.venueCode}`)}</td>
      <td>
        {r.isFlying
          ? t("recentRuns.flying")
          : r.stForRank === null || r.stForRank === undefined
            ? "—"
            : Number(r.stForRank).toFixed(2).replace(/^0/, "")}
      </td>
      <td>
        {r.isFlying || r.stRank === null || r.stRank === undefined
          ? "—"
          : t("recentRuns.stRank", { n: r.stRank })}
      </td>
      <td>{finishPositionOf(r) ?? t("wakuInfo.outOfPlace")}</td>
    </tr>
  );
}

function HistoryView({ detail }) {
  const { t } = useTranslation();
  const { detailColumn, history } = detail;
  if (history.length === 0) {
    return <p className="rsc-fold-empty">{t("wakuInfo.noData")}</p>;
  }
  return (
    <>
      <p className="rsc-fold-note">
        {t("stConsideration.historyNote", {
          course: detailColumn.course,
          n: history.length,
        })}
      </p>
      <div className="rsc-history-wrapper">
        <table className="rsc-history">
          <thead>
            <tr>
              <th scope="col">{t("stConsideration.histDate")}</th>
              <th scope="col">{t("stConsideration.histVenue")}</th>
              <th scope="col">{t("stConsideration.histSt")}</th>
              <th scope="col">{t("stConsideration.histStRank")}</th>
              <th scope="col">{t("stConsideration.histRank")}</th>
            </tr>
          </thead>
          <tbody>
            {history.map((r) => (
              <HistoryRow key={r.raceId} r={r} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function RaceStConsiderationCardFolds({
  columns,
  scopedByRacer,
  openSection,
  setOpenSection,
  detailBoat,
  setDetailBoat,
}) {
  const { t } = useTranslation();
  const detail = buildDetail(columns, scopedByRacer, detailBoat);
  return (
    <div className="rsc-folds">
      <div className="rsc-fold-buttons">
        <FoldToggle
          id="histogram"
          label={t("stConsideration.histogramTitle")}
          openSection={openSection}
          setOpenSection={setOpenSection}
        />
        <FoldToggle
          id="history"
          label={t("stConsideration.historyTitle")}
          openSection={openSection}
          setOpenSection={setOpenSection}
        />
      </div>
      {openSection && (
        <div className="rsc-fold-body">
          <DetailChips
            columns={columns}
            detailColumn={detail.detailColumn}
            setDetailBoat={setDetailBoat}
          />
          {openSection === "histogram" && <HistogramView detail={detail} />}
          {openSection === "history" && <HistoryView detail={detail} />}
        </div>
      )}
    </div>
  );
}

export default RaceStConsiderationCardFolds;
