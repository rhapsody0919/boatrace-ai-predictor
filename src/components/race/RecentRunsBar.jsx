/**
 * RecentRunsBar - 直近10走の帯（phase a FR-1 / T3-4）
 *
 * 設計: docs/design/analysis-visualization-upgrade/screens.md §3.1.3
 *
 * 日和は表（枠・ST・モーター2連・着順の4列×10行）。龍神レーダーは
 * 1走＝1本の帯にして10走の流れを一目で見せる。
 *
 * ## モーター2連対率は出さない / ST順位を括弧で併記する
 *
 * 2026-09-23ユーザー決定。モーター2連対率は「その走のモーターの成績」であって
 * 選手の走りの情報ではなく、帯が読みにくくなるだけ。代わりに
 * **そのレース内でのST順位を「(1位)」の形で併記**する。STの絶対値だけだと
 * 「速いのか遅いのか」がレースの水面・風で変わるため、順位のほうが読める。
 *
 * Fの走はST順位を付けず「F」と出す（順位づけの対象外にしているため）。
 */
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../utils/colors";
import { finishPositionOf } from "./basicInfoStats";
import { parseRaceId } from "../../utils/raceId";
import "./RecentRunsBar.css";

function rankClass(rank) {
  if (rank === null) return "rrb-rank-bad";
  if (rank === 1) return "rrb-rank-first";
  if (rank <= 3) return "rrb-rank-good";
  if (rank <= 4) return "rrb-rank-mid";
  return "rrb-rank-bad";
}

/**
 * @param {Object} props
 * @param {Array<Object>} props.runs 走（`getRacerScopedRaceStats` の生record）
 * @param {boolean} [props.showDateLabel] 各走の上に「9/23 5R」を出す。
 *   今節タブ（FR-3）は「その節の**各日**」を見せるのが目的で日付が要る。
 *   直近10走（FR-1）は流れだけを見るので既定は出さない
 */
function RecentRunsBar({ runs, showDateLabel = false }) {
  const { t } = useTranslation();
  const list = Array.isArray(runs) ? runs : [];
  if (list.length === 0) return null;

  return (
    <div className="rrb">
      <div className="rrb-axis">
        <span>{t("recentRuns.older")}</span>
        <span>{t("recentRuns.newer")}</span>
      </div>
      <div className="rrb-strip">
        {list.map((r) => {
          const rank = finishPositionOf(r);
          const course = r.actualCourse ?? null;
          const color = course ? BOAT_COLORS[course] || {} : {};
          return (
            <div key={r.raceId} className="rrb-item" title={r.raceId}>
              {showDateLabel && (
                <span className="rrb-date">
                  {t("recentRuns.dateLabel", {
                    month: Number(r.date.slice(5, 7)),
                    day: Number(r.date.slice(8, 10)),
                    race: parseRaceId(r.raceId)?.raceNo ?? "-",
                  })}
                </span>
              )}
              <span
                className="rrb-course"
                style={
                  course
                    ? { background: color.bg, color: color.text }
                    : undefined
                }
              >
                {course ?? "—"}
              </span>
              <span className={`rrb-rank ${rankClass(rank)}`}>
                {rank ?? t("wakuInfo.outOfPlace")}
              </span>
              <span className="rrb-st">
                {r.isFlying
                  ? t("recentRuns.flying")
                  : r.stForRank === null || r.stForRank === undefined
                    ? "—"
                    : Number(r.stForRank).toFixed(2).replace(/^0/, "")}
              </span>
              <span className="rrb-st-rank">
                {r.isFlying || r.stRank === null || r.stRank === undefined
                  ? ""
                  : t("recentRuns.stRank", { n: r.stRank })}
              </span>
            </div>
          );
        })}
      </div>
      <p className="rrb-legend">{t("recentRuns.legend")}</p>
    </div>
  );
}

export default RecentRunsBar;
