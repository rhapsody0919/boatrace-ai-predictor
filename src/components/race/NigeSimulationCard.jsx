/**
 * NigeSimulationCard - 逃げシミュレーション（phase a FR-6）
 *
 * 設計: docs/design/analysis-visualization-upgrade/screens.md §3.1.4
 *       spec.md FR-6 / ADR-0068
 *
 * この会場で1コースが逃げて1着になったレースだけを集め、2着に来た実進入コースの
 * 割合（逃し時2着率）と、実際にその2連単が出る確率（2連単確率）を出す。
 * **予想ではなく事実の集計**なので、その旨を画面に明記する。
 *
 * 選手単位ではなく会場のコース単位の指標なので、選手チップの選択とは独立。
 * 会場別のみで、全国へのフォールバックはしない（母数はカードに明記する）。
 *
 * 横棒は個別の棒にする（積み上げ1本にしない）。2着率の合計は100%だが、
 * 積み上げると「どのコースがどれだけか」が読みにくくなるため。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../utils/colors";
import TermHintButton from "./TermHintButton";
import "./NigeSimulationCard.css";

function NigeSimulationCard({ rows }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  // 094未適用（権限なし）ならセクションごと出さない
  if (rows && !Array.isArray(rows) && rows.state === "forbidden") return null;
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const first = rows[0];
  const maxRate = Math.max(...rows.map((r) => Number(r.second_rate)));

  return (
    <div className="nsc-card">
      <h3 className="nsc-title">
        {t("nigeSimulation.title")}
        <TermHintButton termKey="nigeSimulation" />
      </h3>
      <p className="nsc-sub">
        {t("nigeSimulation.sample", {
          nige: Number(first.nige_races).toLocaleString(),
          total: Number(first.total_races).toLocaleString(),
        })}
      </p>

      <p className="nsc-section-label">{t("nigeSimulation.secondCourse")}</p>
      <div className="nsc-rows">
        {rows.map((row) => {
          const course = row.second_course;
          const color = BOAT_COLORS[course] || {};
          const rate = Number(row.second_rate);
          return (
            <div key={course} className="nsc-row">
              <span
                className="nsc-course"
                style={{ background: color.bg, color: color.text }}
              >
                {course}
              </span>
              <span className="nsc-track">
                <span
                  className="nsc-fill"
                  style={{
                    width: `${Math.max(2, (rate / maxRate) * 100)}%`,
                  }}
                />
              </span>
              <span className="nsc-rate">{rate.toFixed(1)}%</span>
              <span className="nsc-exacta">
                {t("nigeSimulation.exacta", {
                  value: Number(row.exacta_rate).toFixed(1),
                })}
              </span>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className="nsc-detail-toggle"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {expanded
          ? t("nigeSimulation.hideDetail")
          : t("nigeSimulation.showDetail")}
      </button>
      {expanded && (
        <div className="nsc-detail">
          <p>{t("nigeSimulation.detailMethod")}</p>
          <p>
            {t("nigeSimulation.detailWindow", {
              start: first.window_start,
              end: first.window_end,
              days: first.window_days,
            })}
          </p>
          <p>{t("nigeSimulation.detailNotPrediction")}</p>
        </div>
      )}
    </div>
  );
}

export default NigeSimulationCard;
