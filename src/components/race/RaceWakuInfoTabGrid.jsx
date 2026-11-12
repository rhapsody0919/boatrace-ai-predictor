import { BOAT_COLORS } from "../../utils/colors";
import HorizontalScrollButtons from "../common/HorizontalScrollButtons";
import { SMALL_SAMPLE_THRESHOLD } from "./basicInfoStats";
import { GRID_COURSES } from "./courseGridStats";
import {
  ExpandedRuns,
  TodayEmptyMessage,
  TodayLines,
  TodayTable,
} from "./RaceWakuInfoTabToday";

const METRICS = ["winRate", "top2Rate", "top3Rate"];

function GridCourseTh({ course, selectedNumber, t }) {
  const color = BOAT_COLORS[course] || {};
  // 今日その選手が入る枠（枠なり進入の想定）を列ヘッダで明示する。
  // セルの金の縁だけでは「これが今日のコース」と伝わらなかった
  // （2026-09-24ユーザー指摘）
  const isToday = course === selectedNumber;
  return (
    <th
      className={`rwit-grid-course-th${isToday ? " is-today" : ""}`}
      scope="col"
      style={{
        background: color.bg,
        color: color.text,
      }}
    >
      {course}
      {isToday && (
        <span className="rwit-today-mark" title={t("wakuInfo.todayBadge")}>
          {t("wakuInfo.todayMark")}
        </span>
      )}
    </th>
  );
}

function GridCell({ cell, rowKey, openCell, selectedNumber, toggleCell, t }) {
  const isSmallSample = cell.n > 0 && cell.n < SMALL_SAMPLE_THRESHOLD;
  const open =
    openCell?.from === "grid" &&
    openCell?.rowKey === rowKey &&
    openCell?.course === cell.course;
  const isOwnCourse = cell.course === selectedNumber;
  if (cell.n === 0) {
    return (
      <td className="rwit-grid-cell">
        <span className="rwit-grid-empty">—</span>
      </td>
    );
  }
  return (
    <td
      className={`rwit-grid-cell${open ? " is-open" : ""}${isOwnCourse ? " is-own-course" : ""}`}
    >
      <button
        type="button"
        className="rwit-grid-cell-button"
        onClick={() => toggleCell(rowKey, cell.course, "grid")}
        aria-expanded={open}
      >
        <span
          className={`rwit-grid-value${isSmallSample ? " is-small-sample" : ""}`}
        >
          {isSmallSample && (
            <span
              className="rwit-grid-warn"
              title={t("wakuInfo.smallSampleTitle")}
            >
              ⚠
            </span>
          )}
          {cell.value.toFixed(1)}
        </span>
        <span
          className={`rwit-grid-n${isSmallSample ? " is-small-sample" : ""}`}
        >
          {t("wakuInfo.sampleCount", { n: cell.n })}
        </span>
      </button>
    </td>
  );
}

function GridTable({ grid, openCell, selectedNumber, toggleCell, t }) {
  return (
    <table className="rwit-grid">
      <thead>
        <tr>
          <th className="rwit-grid-label-th" scope="col"></th>
          {GRID_COURSES.map((course) => (
            <GridCourseTh
              key={course}
              course={course}
              selectedNumber={selectedNumber}
              t={t}
            />
          ))}
        </tr>
      </thead>
      <tbody>
        {grid.map((row) => (
          <tr key={row.key}>
            <th className="rwit-grid-label-th" scope="row">
              {t(`wakuInfo.gridRows.${row.key}`)}
            </th>
            {row.cells.map((cell) => (
              <GridCell
                key={cell.course}
                cell={cell}
                rowKey={row.key}
                openCell={openCell}
                selectedNumber={selectedNumber}
                toggleCell={toggleCell}
                t={t}
              />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// 指標チップは全コース表の中だけに効く。カード見出しの外に置くと
// ST考察・逃げシミュレーションにも効くように見えてしまう
function MetricChips({ metric, setMetric, t }) {
  return (
    <div
      className="rwit-chip-row rwit-metric-row"
      role="group"
      aria-label={t("wakuInfo.metricLabel")}
    >
      {METRICS.map((m) => (
        <button
          key={m}
          type="button"
          className={`rwit-chip${metric === m ? " is-active" : ""}`}
          onClick={() => setMetric(m)}
        >
          {t(`wakuInfo.metrics.${m}`)}
        </button>
      ))}
    </div>
  );
}

// 全コースの比較は畳んでおく。見たい人（前づけ・進入変化を気にする層）は
// 確実に開くが、既定で見せると今日のコースが埋もれる
function AllCoursesFold({
  t,
  foldOpen,
  setFoldOpen,
  metric,
  setMetric,
  gridScroll,
  view,
  openCell,
  toggleCell,
  selectedNumber,
}) {
  const { grid, recentHeading, recentRuns } = view;
  const {
    ref: gridScrollRef,
    hasMore: gridHasMore,
    hasLess: gridHasLess,
    update: updateGridScroll,
    scrollRight: scrollGridRight,
    scrollLeft: scrollGridLeft,
  } = gridScroll;
  return (
    <div className="rwit-fold">
      <button
        type="button"
        className={`rwit-fold-summary${foldOpen ? " is-open" : ""}`}
        onClick={() => setFoldOpen((prev) => !prev)}
        aria-expanded={foldOpen}
      >
        {foldOpen ? "▾ " : "▸ "}
        {t("wakuInfo.allCoursesFold")}
      </button>
      <div className="rwit-fold-body" hidden={!foldOpen}>
        <MetricChips metric={metric} setMetric={setMetric} t={t} />
        <p className="rwit-card-sub">
          {t("wakuInfo.gridTitleWithMetric", {
            metric: t(`wakuInfo.metrics.${metric}`),
          })}
        </p>
        {/* 横スクロールはこのラッパの中だけに閉じる（ページ全体は横スクロールさせない）。
            切れていることが分かるよう「›」「‹」を重ねる（BOA-607） */}
        <div
          className={`rwit-grid-hscroll hscroll-hint${gridHasMore ? " has-more" : ""}`}
        >
          <HorizontalScrollButtons
            hasMore={gridHasMore}
            hasLess={gridHasLess}
            onMore={scrollGridRight}
            onLess={scrollGridLeft}
          />
          <div
            className="rwit-grid-wrapper"
            ref={gridScrollRef}
            onScroll={updateGridScroll}
          >
            <GridTable
              grid={grid}
              openCell={openCell}
              selectedNumber={selectedNumber}
              toggleCell={toggleCell}
              t={t}
            />
          </div>
        </div>

        {openCell?.from === "grid" && (
          <ExpandedRuns
            t={t}
            recentHeading={recentHeading}
            recentRuns={recentRuns}
            openCell={openCell}
          />
        )}
        <p className="rwit-card-sub">{t("wakuInfo.gridSubtitle")}</p>
      </div>
    </div>
  );
}

// 当社データがあるときの中身（今日の表・押した行の帯・全コース比較の折りたたみ）
function GridFilled(props) {
  const { t, sixBoatStats, selectedNumber, view, openCell, toggleCell } = props;
  const { todayRows, shownCell, recentHeading, recentRuns } = view;
  return (
    <>
      <TodayTable
        t={t}
        sixBoatStats={sixBoatStats}
        boat={selectedNumber}
        todayRows={todayRows}
        shownCell={shownCell}
        toggleCell={toggleCell}
        todayCourse={props.todayCourse}
      />
      {shownCell?.from === "today" && (
        <ExpandedRuns
          t={t}
          recentHeading={recentHeading}
          recentRuns={recentRuns}
          openCell={openCell}
        />
      )}
      <AllCoursesFold {...props} />
    </>
  );
}

// 「コース別成績」カード。PC（1200px 以上）は表を左、注意書きを右の2段（BOA-881）
export function CourseGridCard(props) {
  const { t, scopedRecords, sixBoatStats, selectedNumber, view } = props;
  const empty = !Array.isArray(scopedRecords) || scopedRecords.length === 0;
  return (
    <div className="rwit-card">
      <h3 className="rwit-card-title">{t("wakuInfo.gridTitle")}</h3>
      <div className="race-split">
        <div className="race-split__main">
          <TodayLines
            t={t}
            todayCourse={props.todayCourse}
            wakuNari={view.wakuNari}
          />
          {empty ? (
            <>
              {/* 当社データが取得中・失敗・0走でも、公式の直近3期の行は出す（BOA-1295 /code-review） */}
              <TodayTable
                t={t}
                sixBoatStats={sixBoatStats}
                boat={selectedNumber}
                todayRows={[]}
                shownCell={view.shownCell}
                toggleCell={props.toggleCell}
                todayCourse={props.todayCourse}
              />
              <TodayEmptyMessage t={t} scopedRecords={scopedRecords} />
            </>
          ) : (
            <GridFilled {...props} />
          )}
        </div>
        <div className="race-split__side">
          <p className="rwit-caveat">{t("wakuInfo.periodCaveat")}</p>
          <p className="rwit-caveat">{t("wakuInfo.gridCaveat")}</p>
        </div>
      </div>
    </div>
  );
}
