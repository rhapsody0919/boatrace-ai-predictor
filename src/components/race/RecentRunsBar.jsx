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
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../utils/colors";
import { finishPositionOf } from "./basicInfoStats";
import "./RecentRunsBar.css";

function rankClass(rank) {
  if (rank === null) return "rrb-rank-bad";
  if (rank === 1) return "rrb-rank-first";
  if (rank <= 3) return "rrb-rank-good";
  if (rank <= 4) return "rrb-rank-mid";
  return "rrb-rank-bad";
}

function RecentRunsBar({ runs }) {
  const { t } = useTranslation();
  const list = Array.isArray(runs) ? runs : [];
  // 古い順（左が古い）に並ぶので、横に収まらない幅では開いたときに右端（最新）を
  // 見せる。左端から見せると、いちばん知りたい直近の走が画面の外になる（BOA-601）
  const stripRef = useRef(null);
  const lastId = list[list.length - 1]?.raceId ?? null;
  // 左に隠れている（見えていない古い）走の本数。375pxでは10走のうち5〜6本しか
  // 見えず、「古い」の下が一番古い走だと読まれた（ファン評価3周目）ので、
  // 軸に「左にあと◯走」と出す
  const [hiddenOlder, setHiddenOlder] = useState(0);
  const measureHidden = useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    const left = el.getBoundingClientRect().left;
    const hidden = [...el.children].filter(
      (c) => c.getBoundingClientRect().left < left - 1,
    ).length;
    setHiddenOlder(hidden);
  }, []);
  useLayoutEffect(() => {
    const el = stripRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
    measureHidden();
  }, [list.length, lastId, measureHidden]);
  if (list.length === 0) return null;

  return (
    <div className="rrb">
      <div className="rrb-axis">
        <span>
          {t("recentRuns.older")}
          {hiddenOlder > 0 && (
            <span className="rrb-hidden-older">
              {t("recentRuns.hiddenOlder", { n: hiddenOlder })}
            </span>
          )}
        </span>
        <span>{t("recentRuns.newer")}</span>
      </div>
      <div className="rrb-strip" ref={stripRef} onScroll={measureHidden}>
        {list.map((r) => {
          const rank = finishPositionOf(r);
          const course = r.actualCourse ?? null;
          const color = course ? BOAT_COLORS[course] || {} : {};
          return (
            <div key={r.raceId} className="rrb-item" title={r.raceId}>
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
