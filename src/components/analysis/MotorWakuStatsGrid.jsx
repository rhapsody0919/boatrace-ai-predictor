import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SMALL_SAMPLE_THRESHOLD } from "../race/basicInfoStats";
import InlineFetchError from "../InlineFetchError";
import { useHorizontalScrollHint } from "../../hooks/useHorizontalScrollHint";
import { formatGenerationDate } from "../../utils/motorGeneration";
import { formatRateOrCount } from "../../utils/smallSampleRate";
import "./MotorConditionChart.css";
import "../common/HorizontalScrollHint.css";

/**
 * MotorWakuStatsGrid - モーター単体の枠番（進入コース）別成績・展示タイム推移
 * （BOA-301 FR-2/FR-3）。艇番の色（BOAT_COLORS）は使わず中立色にする
 * （screens.md参照。BOA-257解消後、艇番と進入コースが一致しないケースが
 * 可視化されるため、艇番色と混同させないための判断）。
 *
 * embedded=trueの時は、今日そのレースで割り当てられている艇番
 * （highlightCourse、進入コース確定前のためあくまで艇番＝暫定値）の
 * 行のみを表示し、タップで全6コースに展開する（レース詳細ページの
 * 「モータ情報」タブ向けの凝縮ビュー）。embedded=falseの時は常に全6コース
 * を表示する（分析ツール「モーター調子」タブのフル版向け）
 *
 * 集計期間は現行モーターの世代（使用開始日以降）。generationStartがnullの
 * 会場（使用開始日が不明）は、別モーターの成績を混ぜないよう表を出さない。
 * 使用開始日そのものは画面に出さない（ADR-0067 2026-09-28追記）
 */
function ExhibitionSparkline({ trend }) {
  // 2点だけの直線は「推移」に読めないので、3点未満では出さない（BOA-513）
  if (!trend || trend.length < 3) return null;
  const times = trend.map((t) => t.time);
  const min = Math.min(...times);
  const max = Math.max(...times);
  const range = max - min || 1;
  const width = 80;
  const height = 24;
  const points = times
    .map((t, i) => {
      const x = (i / (times.length - 1)) * width;
      // 展示タイムは速い(小さい)ほど良いため、上に行くほど速いタイムになるよう反転する
      const y = height - ((t - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      className="motor-waku-sparkline"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden="true"
    >
      <polyline points={points} fill="none" strokeWidth="1.5" />
    </svg>
  );
}

function MotorWakuRow({ row, onSelectCourse, isHighlighted }) {
  const { t } = useTranslation();
  const isSmallSample =
    row.raceCount > 0 && row.raceCount < SMALL_SAMPLE_THRESHOLD;

  return (
    <tr
      className={`motor-waku-row ${isHighlighted ? "motor-waku-row-highlight" : ""}`}
      onClick={() => onSelectCourse(row.course)}
    >
      <td>
        <span className="motor-waku-course-badge">{row.course}</span>
      </td>
      <td className={`rate ${isSmallSample ? "is-small-sample" : ""}`}>
        {/* n が小さいときは率でなく「2/3」で出す（BOA-513、ファン4人のパネル）。
            分数に母数が入っているので、(n=◯) は十分な n のときだけ添える */}
        {row.raceCount > 0 ? (
          <>
            {formatRateOrCount(
              row.winRate,
              row.raceCount,
              SMALL_SAMPLE_THRESHOLD,
            )}
            {!isSmallSample && (
              <span className="motor-waku-n">
                {t("analysis.motor.sampleCount", { n: row.raceCount })}
              </span>
            )}
          </>
        ) : (
          "-"
        )}
      </td>
      <td className={`rate ${isSmallSample ? "is-small-sample" : ""}`}>
        {formatRateOrCount(row.top2Rate, row.raceCount, SMALL_SAMPLE_THRESHOLD)}
      </td>
      <td className={`rate ${isSmallSample ? "is-small-sample" : ""}`}>
        {formatRateOrCount(row.top3Rate, row.raceCount, SMALL_SAMPLE_THRESHOLD)}
      </td>
      <td className="motor-waku-exhibition-cell">
        {row.avgExhibitionTime !== null ? (
          <>
            <span>{row.avgExhibitionTime.toFixed(2)}</span>
            <ExhibitionSparkline trend={row.exhibitionTrend} />
          </>
        ) : (
          "-"
        )}
      </td>
    </tr>
  );
}

function MotorWakuStatsGrid({
  rows,
  generationStart,
  fetchFailed,
  embedded,
  highlightCourse,
  onSelectCourse,
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(!embedded);
  // 375px では3連率・展示タイム推移の列が右に切れる。切れていることに気づけるよう、
  // モータ情報の一覧表と同じ横スクロールの目印を付ける（BOA-513）
  const {
    ref: scrollRef,
    hasMore: scrollHasMore,
    update: updateScroll,
    scrollRight,
  } = useHorizontalScrollHint([rows?.length, expanded]);

  if (!rows || rows.length === 0) return null;

  if (fetchFailed || generationStart === null) {
    return (
      <div className="motor-waku-stats-grid">
        <h3 className="selected-motor-heading">
          {t("analysis.motor.wakuStatsHeading")}
        </h3>
        {fetchFailed ? (
          <InlineFetchError />
        ) : (
          <div className="empty-state">
            {t("analysis.motor.wakuStatsUnknownGeneration")}
          </div>
        )}
      </div>
    );
  }

  const highlightedRow = rows.find((r) => r.course === highlightCourse);
  const visibleRows =
    embedded && !expanded && highlightedRow ? [highlightedRow] : rows;

  return (
    <div className="motor-waku-stats-grid">
      <h3 className="selected-motor-heading">
        {t("analysis.motor.wakuStatsHeading")}
      </h3>
      <p className="table-note">
        {t("analysis.motor.wakuStatsWindowNote", {
          n: SMALL_SAMPLE_THRESHOLD,
          date: formatGenerationDate(generationStart, { short: true }),
        })}
      </p>
      <div
        className={`table-wrapper hscroll-hint${scrollHasMore ? " has-more" : ""}`}
      >
        {scrollHasMore && (
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
        <div className="table-scroll" ref={scrollRef} onScroll={updateScroll}>
          <table className="motor-ranking-table motor-waku-table">
            <thead>
              <tr>
                <th>{t("analysis.motor.courseHeader")}</th>
                <th>{t("analysis.motor.firstPlaceRateHeader")}</th>
                {/* セルに「%」が付くので、見出しは1着率と同じく (%) を付けない（BOA-513） */}
                <th>{t("analysis.motor.legend2")}</th>
                <th>{t("analysis.motor.legend3")}</th>
                <th>{t("analysis.motor.exhibitionTrendHeader")}</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <MotorWakuRow
                  key={row.course}
                  row={row}
                  onSelectCourse={onSelectCourse}
                  isHighlighted={row.course === highlightCourse}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {embedded && !expanded && (
        <button
          type="button"
          className="motor-waku-expand-btn"
          onClick={() => setExpanded(true)}
        >
          {t("analysis.motor.wakuStatsExpand")}
        </button>
      )}
      <p className="table-note">{t("analysis.motor.wakuStatsNote")}</p>
    </div>
  );
}

export default MotorWakuStatsGrid;
