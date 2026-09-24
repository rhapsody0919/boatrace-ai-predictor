/**
 * RaceStConsiderationCard - ST考察（phase a FR-1）
 *
 * 設計: docs/design/analysis-visualization-upgrade/screens.md §3.1.2
 *       モック: https://claude.ai/artifact/N3e6TSHmoPXzLNX1SSSLZK （Version 8）
 *
 * 6艇 × 指標のグリッド。安定率・出遅率には**同じコース・同じ級別の平均との差**を
 * 併記する。生の値だけでは評価が逆転するため（実データの例: 守屋美穂 A1・5コース
 * 出遅率25.9% は平均より+12.1pt「悪い」、吉原快誓 B2・6コース 26.0% は
 * 平均より−10.6pt「良い」。生の値はほぼ同じなのに評価は正反対）。
 *
 * ## 抜出は率ではなく実回数
 *
 * 5・6コースは30走あたりの期待回数が0.2〜0.4回しかなく、率にすると
 * 「0.0%が並ぶ」か「1回の出来事が3.3%に見える」のどちらかになる。
 * 実回数を主表示にし、同コース・同級別の期待回数を添える（率は画面に出さない）。
 * 期待回数が1回未満のセルで0回のときは差の色を付けない（赤くすると誤読される）。
 *
 * ## Fの扱い
 *
 * Fの走は母数に入れない（ST順1位の基準からも外す。符号反転はしない）。
 * 代わりに級別セルの中にFバッジを出す。艇番ヘッダは枠色で塗られており、
 * 金・赤のバッジを重ねるとコントラストが確保できないため。
 * F1は金、F2は赤で色を分ける（F2は合計90日のあっせん停止で意味が違う）。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../utils/colors";
import { SMALL_SAMPLE_THRESHOLD, finishPositionOf } from "./basicInfoStats";
import {
  computeStConsideration,
  computeStHistogram,
  getStHistory,
  ST_HISTOGRAM_BINS,
} from "../../utils/stConsideration";
import {
  METRIC_DIRECTION,
  indexBaseline,
  getBaselineCell,
  diffFromBaseline,
  expectedBreakoutCount,
} from "../../utils/courseBaseline";
import TermHintButton from "./TermHintButton";
import "./RaceStConsiderationCard.css";

/** 差の表示（+12.1 / −10.6）。符号は全角マイナスにせずCSSで色を分ける */
function formatDiff(diff) {
  if (diff === null || diff === undefined) return null;
  const sign = diff > 0 ? "+" : "−";
  return `${sign}${Math.abs(diff).toFixed(1)}`;
}

function diffClass(isBetter) {
  if (isBetter === null || isBetter === undefined) return "";
  return isBetter ? " is-better" : " is-worse";
}

function RaceStConsiderationCard({
  players,
  scopedByRacer,
  baseline,
  entryCourseOf,
}) {
  const { t } = useTranslation();
  // 折りたたみ（ST分布・ST履歴）。どちらも1艇ずつしか描けないため、
  // カード上部のグリッド（6艇横並び）とは別に「どの艇を見るか」を持つ
  const [openSection, setOpenSection] = useState(null);
  const [detailBoat, setDetailBoat] = useState(null);

  const sorted = [...(players ?? [])].sort((a, b) => a.number - b.number);
  if (sorted.length === 0) return null;

  // 094未適用（権限なし）ならセクションごと出さない（ピットレポートと同じ扱い）
  if (baseline && !Array.isArray(baseline) && baseline.state === "forbidden") {
    return null;
  }
  const baselineRows = Array.isArray(baseline) ? baseline : null;
  if (!baselineRows || baselineRows.length === 0) return null;

  const baselineIndex = indexBaseline(baselineRows);
  const windowStart = baselineRows[0]?.window_start ?? null;
  const windowEnd = baselineRows[0]?.window_end ?? null;

  // 艇ごとに「想定コース × 級別」で指標とベースラインとの差を組み立てる
  const columns = sorted.map((p) => {
    const records = p.racerId ? scopedByRacer[p.racerId] : null;
    const course = entryCourseOf(p);
    const grade = Array.isArray(records)
      ? (records[records.length - 1]?.grade ?? null)
      : null;
    const stats = Array.isArray(records)
      ? computeStConsideration(records, { course })
      : null;
    const cell = getBaselineCell(baselineIndex, course, grade);
    return { player: p, course, grade, stats, cell };
  });

  const loading = columns.every((c) => c.stats === null);

  // --- 折りたたみ（ST分布 / ST履歴）用の派生値 ---
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

  return (
    <div className="rsc-card">
      <h3 className="rsc-title">{t("stConsideration.title")}</h3>
      <p className="rsc-sub">{t("stConsideration.subtitle")}</p>
      {windowStart && windowEnd && (
        <p className="rsc-window">
          {t("stConsideration.window", {
            start: windowStart,
            end: windowEnd,
          })}
        </p>
      )}

      {loading ? (
        <p className="rsc-loading">{t("wakuInfo.loading")}</p>
      ) : (
        <div className="rsc-grid-wrapper">
          <table className="rsc-grid">
            <thead>
              <tr>
                <th className="rsc-label-th" scope="col"></th>
                {columns.map(({ player }) => {
                  const color = BOAT_COLORS[player.number] || {};
                  return (
                    <th
                      key={player.number}
                      className="rsc-boat-th"
                      scope="col"
                      style={{ background: color.bg, color: color.text }}
                    >
                      {player.number}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {/* 級別（＋Fバッジ）。どのベースラインと比べているかを読めるようにする */}
              <tr>
                <th className="rsc-label-th rsc-label-sub" scope="row">
                  {t("stConsideration.gradeRow")}
                </th>
                {columns.map(({ player, grade, stats }) => (
                  <td key={player.number} className="rsc-cell rsc-cell-meta">
                    <span className="rsc-grade">{grade ?? "—"}</span>
                    {stats?.flyingCount > 0 && (
                      <span
                        className={`rsc-flying${stats.flyingCount >= 2 ? " is-f2" : ""}`}
                        title={t("stConsideration.flyingTitle", {
                          n: stats.flyingCount,
                        })}
                      >
                        F{stats.flyingCount}
                      </span>
                    )}
                  </td>
                ))}
              </tr>

              {/* 走数（母数。Fの走は入っていない） */}
              <tr>
                <th className="rsc-label-th rsc-label-sub" scope="row">
                  {t("stConsideration.runsRow")}
                </th>
                {columns.map(({ player, stats }) => (
                  <td key={player.number} className="rsc-cell rsc-cell-meta">
                    <span className="rsc-runs">{stats?.n ?? "—"}</span>
                  </td>
                ))}
              </tr>

              {/* 安定率（高いほど良い） */}
              <tr>
                <th className="rsc-label-th" scope="row">
                  <span>{t("stConsideration.stable")}</span>
                  <TermHintButton termKey="stStable" />
                </th>
                {columns.map(({ player, stats, cell }) => {
                  const value = stats?.stableRate ?? null;
                  const { diff, isBetter } = diffFromBaseline(
                    value,
                    cell?.stable_rate ?? null,
                    METRIC_DIRECTION.stableRate,
                  );
                  const small =
                    (stats?.n ?? 0) > 0 &&
                    (stats?.n ?? 0) < SMALL_SAMPLE_THRESHOLD;
                  return (
                    <td key={player.number} className="rsc-cell">
                      <span
                        className={`rsc-value${small ? " is-small-sample" : ""}`}
                      >
                        {value === null ? "—" : value.toFixed(1)}
                      </span>
                      {diff !== null && (
                        <span className={`rsc-diff${diffClass(isBetter)}`}>
                          {formatDiff(diff)}
                        </span>
                      )}
                      {cell?.stable_rate !== null &&
                        cell?.stable_rate !== undefined && (
                          <span className="rsc-baseline">
                            {t("stConsideration.average", {
                              value: Number(cell.stable_rate).toFixed(1),
                            })}
                          </span>
                        )}
                    </td>
                  );
                })}
              </tr>

              {/* 抜出（実回数。率は出さない） */}
              <tr>
                <th className="rsc-label-th" scope="row">
                  <span>{t("stConsideration.breakout")}</span>
                  <TermHintButton termKey="stBreakout" />
                </th>
                {columns.map(({ player, course, stats, cell }) => {
                  if (course === 1) {
                    return (
                      <td key={player.number} className="rsc-cell">
                        <span className="rsc-value rsc-muted">—</span>
                        <span className="rsc-note-small">
                          {t("stConsideration.noInnerBoat")}
                        </span>
                      </td>
                    );
                  }
                  const count = stats?.breakoutCount ?? null;
                  const expected = expectedBreakoutCount(
                    cell?.breakout_rate ?? null,
                    stats?.n ?? 0,
                  );
                  return (
                    <td key={player.number} className="rsc-cell">
                      <span className="rsc-value">
                        {count === null
                          ? "—"
                          : t("stConsideration.times", { n: count })}
                      </span>
                      {expected !== null && (
                        <span className="rsc-note-small">
                          {t("stConsideration.expectedTimes", {
                            n: expected.toFixed(1),
                          })}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>

              {/* 出遅率（低いほど良い） */}
              <tr>
                <th className="rsc-label-th" scope="row">
                  <span>{t("stConsideration.late")}</span>
                  <TermHintButton termKey="stLate" />
                </th>
                {columns.map(({ player, stats, cell }) => {
                  const value = stats?.lateRate ?? null;
                  const { diff, isBetter } = diffFromBaseline(
                    value,
                    cell?.late_rate ?? null,
                    METRIC_DIRECTION.lateRate,
                  );
                  const small =
                    (stats?.n ?? 0) > 0 &&
                    (stats?.n ?? 0) < SMALL_SAMPLE_THRESHOLD;
                  return (
                    <td key={player.number} className="rsc-cell">
                      <span
                        className={`rsc-value${small ? " is-small-sample" : ""}`}
                      >
                        {value === null ? "—" : value.toFixed(1)}
                      </span>
                      {diff !== null && (
                        <span className={`rsc-diff${diffClass(isBetter)}`}>
                          {formatDiff(diff)}
                        </span>
                      )}
                      {cell?.late_rate !== null &&
                        cell?.late_rate !== undefined && (
                          <span className="rsc-baseline">
                            {t("stConsideration.average", {
                              value: Number(cell.late_rate).toFixed(1),
                            })}
                          </span>
                        )}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* 折りたたみ: ST分布 / ST履歴（T3-3、2026-09-24ユーザー判断で案1を採用）。
          どちらも1艇ずつしか描けないため、上のグリッド（6艇横並び）とは別に
          「どの艇を見るか」のチップを持つ。既定は1号艇 */}
      {!loading && (
        <div className="rsc-folds">
          <div className="rsc-fold-buttons">
            <button
              type="button"
              className={`rsc-fold-toggle${openSection === "histogram" ? " is-open" : ""}`}
              onClick={() =>
                setOpenSection((v) => (v === "histogram" ? null : "histogram"))
              }
              aria-expanded={openSection === "histogram"}
            >
              {openSection === "histogram" ? "\u25be " : "\u25b8 "}
              {t("stConsideration.histogramTitle")}
            </button>
            <button
              type="button"
              className={`rsc-fold-toggle${openSection === "history" ? " is-open" : ""}`}
              onClick={() =>
                setOpenSection((v) => (v === "history" ? null : "history"))
              }
              aria-expanded={openSection === "history"}
            >
              {openSection === "history" ? "\u25be " : "\u25b8 "}
              {t("stConsideration.historyTitle")}
            </button>
          </div>

          {openSection && (
            <div className="rsc-fold-body">
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
                        active
                          ? { background: color.bg, color: color.text }
                          : undefined
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

              {openSection === "histogram" &&
                (histogram === null || histogram.total === 0 ? (
                  <p className="rsc-fold-empty">{t("wakuInfo.noData")}</p>
                ) : (
                  <>
                    <p className="rsc-fold-note">
                      {t("stConsideration.histogramNote", {
                        course: detailColumn.course,
                        grade: detailColumn.grade ?? "\u2014",
                        n: histogram.total,
                        baselineN: Number(
                          detailColumn.cell?.runs ?? 0,
                        ).toLocaleString(),
                      })}
                    </p>
                    <div className="rsc-histogram">
                      {ST_HISTOGRAM_BINS.map((bin) => (
                        <div key={bin} className="rsc-hist-col">
                          <span className="rsc-hist-bars">
                            <span
                              className="rsc-hist-own"
                              style={{
                                height: `${(ownPctOf(bin) / maxBinPct) * 100}%`,
                              }}
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
                    <p className="rsc-fold-legend">
                      {t("stConsideration.histogramLegend")}
                    </p>
                  </>
                ))}

              {openSection === "history" &&
                (history.length === 0 ? (
                  <p className="rsc-fold-empty">{t("wakuInfo.noData")}</p>
                ) : (
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
                            <th scope="col">
                              {t("stConsideration.histVenue")}
                            </th>
                            <th scope="col">{t("stConsideration.histSt")}</th>
                            <th scope="col">
                              {t("stConsideration.histStRank")}
                            </th>
                            <th scope="col">{t("stConsideration.histRank")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {history.map((r) => (
                            <tr key={r.raceId}>
                              <td>{r.date}</td>
                              <td>{t(`venues.${r.venueCode}`)}</td>
                              <td>
                                {r.isFlying
                                  ? t("recentRuns.flying")
                                  : r.stForRank === null ||
                                      r.stForRank === undefined
                                    ? "\u2014"
                                    : Number(r.stForRank)
                                        .toFixed(2)
                                        .replace(/^0/, "")}
                              </td>
                              <td>
                                {r.isFlying ||
                                r.stRank === null ||
                                r.stRank === undefined
                                  ? "\u2014"
                                  : t("recentRuns.stRank", { n: r.stRank })}
                              </td>
                              <td>
                                {finishPositionOf(r) ??
                                  t("wakuInfo.outOfPlace")}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ))}
            </div>
          )}
        </div>
      )}

      <p className="rsc-caveat">{t("stConsideration.caveat")}</p>
    </div>
  );
}

export default RaceStConsiderationCard;
