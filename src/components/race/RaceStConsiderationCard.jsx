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
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../utils/colors";
import { SMALL_SAMPLE_THRESHOLD } from "./basicInfoStats";
import { computeStConsideration } from "../../utils/stConsideration";
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
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <p className="rsc-caveat">{t("stConsideration.caveat")}</p>
    </div>
  );
}

export default RaceStConsiderationCard;
