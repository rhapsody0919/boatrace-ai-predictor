import { SMALL_SAMPLE_THRESHOLD } from "./basicInfoStats";
import { TODAY_METRICS } from "./courseGridStats";
import RecentRunsBar from "./RecentRunsBar";

// 1艇ずつの表の先頭の「直近3期」の行（BOA-1295）。値は6艇の表の同じ艇の行（公式の期別成績）。
// 当社データの行と違い直近の走が無いので押せない。件数の線は6艇の表と同じ（warn・none は ⚠、none は率を出さない）
export function Recent3Row({ stats, boat, t }) {
  const label = (
    <th className="rwit-today-label-th" scope="row">
      <span className="rwit-today-label-static">
        {t("wakuInfo.gridRows.recent3")}
      </span>
    </th>
  );
  if (stats.status !== "ready") {
    return (
      <tr className="rwit-today-row rwit-today-row-recent3">
        {label}
        <td colSpan={TODAY_METRICS.length + 1} className="rwit-today-metric-td">
          {stats.status === "loading" ? (
            <span className="rwit-loading">{t("wakuInfo.loading")}</span>
          ) : (
            <span className="rwit-today-empty">
              — {t("wakuInfo.sixBoat.fetchError")}
            </span>
          )}
        </td>
      </tr>
    );
  }
  const row = stats.rows.find((r) => r.boat === boat);
  if (!row) return null;
  const small = row.reliability !== "ok";
  return (
    <tr className="rwit-today-row rwit-today-row-recent3">
      {label}
      {TODAY_METRICS.map((m) => {
        const value = row.reliability === "none" ? null : row[m];
        return (
          <td key={m} className="rwit-today-metric-td">
            {value == null ? (
              <span className="rwit-today-empty">—</span>
            ) : (
              <span
                className={`rwit-today-value${small ? " is-small-sample" : ""}`}
              >
                {value.toFixed(1)}
              </span>
            )}
          </td>
        );
      })}
      <td className={`rwit-today-n-td${small ? " is-small-sample" : ""}`}>
        {small && (
          <span
            className="rwit-grid-warn"
            title={t("wakuInfo.smallSampleTitle")}
          >
            ⚠
          </span>
        )}
        {row.entries}
      </td>
    </tr>
  );
}

function TodayHead({ t }) {
  return (
    <thead>
      <tr>
        <th className="rwit-today-label-th" scope="col">
          {t("wakuInfo.periodHeader")}
        </th>
        {TODAY_METRICS.map((m) => (
          <th key={m} className="rwit-today-metric-th" scope="col">
            {t(`wakuInfo.metrics.${m}`)}
          </th>
        ))}
        <th className="rwit-today-n-th" scope="col">
          {t("wakuInfo.nHeader")}
        </th>
      </tr>
    </thead>
  );
}

function TodayRow({ row, shownCell, toggleCell, todayCourse, t }) {
  const isSmallSample = row.n > 0 && row.n < SMALL_SAMPLE_THRESHOLD;
  const open = shownCell?.from === "today" && shownCell?.rowKey === row.key;
  return (
    <tr className={`rwit-today-row${open ? " is-open" : ""}`}>
      <th className="rwit-today-label-th" scope="row">
        {row.n === 0 ? (
          <span className="rwit-today-label-static">
            {t(`wakuInfo.gridRows.${row.key}`)}
          </span>
        ) : (
          <button
            type="button"
            className="rwit-today-label-button"
            onClick={() => toggleCell(row.key, todayCourse, "today")}
            aria-expanded={open}
          >
            {t(`wakuInfo.gridRows.${row.key}`)}
          </button>
        )}
      </th>
      {TODAY_METRICS.map((m) => (
        <td key={m} className="rwit-today-metric-td">
          {row.metrics[m] === null ? (
            <span className="rwit-today-empty">—</span>
          ) : (
            <span
              className={`rwit-today-value${isSmallSample ? " is-small-sample" : ""}`}
            >
              {row.metrics[m].toFixed(1)}
            </span>
          )}
        </td>
      ))}
      {/* 参考値マークは走数のセルに1つだけ出す。行の3指標は同じ母数を
          共有するので、セルごとに⚠を繰り返すと記号だけが目立つ */}
      <td
        className={`rwit-today-n-td${isSmallSample ? " is-small-sample" : ""}`}
      >
        {isSmallSample && (
          <span
            className="rwit-grid-warn"
            title={t("wakuInfo.smallSampleTitle")}
          >
            ⚠
          </span>
        )}
        {row.n}
      </td>
    </tr>
  );
}

// 今日の想定コースの表。当社データが無いときは todayRows が空で、「直近3期」の行だけが残る
export function TodayTable({
  t,
  sixBoatStats,
  boat,
  todayRows,
  shownCell,
  toggleCell,
  todayCourse,
}) {
  return (
    <table className="rwit-today-table">
      <TodayHead t={t} />
      <tbody>
        <Recent3Row stats={sixBoatStats} boat={boat} t={t} />
        {todayRows.map((row) => (
          <TodayRow
            key={row.key}
            row={row}
            shownCell={shownCell}
            toggleCell={toggleCell}
            todayCourse={todayCourse}
            t={t}
          />
        ))}
      </tbody>
    </table>
  );
}

// 押した行の直近走の帯（既定ビュー・全コース表で共通）
export function ExpandedRuns({ t, recentHeading, recentRuns, openCell }) {
  return (
    <div className="rwit-expanded">
      <p className="rwit-expanded-note">{recentHeading}</p>
      {recentRuns.length === 0 ? (
        <p className="rwit-expanded-empty">{t("wakuInfo.noRecentFinishes")}</p>
      ) : (
        <RecentRunsBar
          // 押した行・コースが変わったら作り直す。作り直さないと、
          // 件数と最新の走が同じ期間に切り替えたとき、右端（最新）へ
          // 送り直されない（BOA-601 ファン評価2周目）
          key={openCell ? `${openCell.rowKey}-${openCell.course}` : "none"}
          runs={recentRuns}
        />
      )}
    </div>
  );
}

// 当社データが取得中・失敗・0走のときの一言
export function TodayEmptyMessage({ t, scopedRecords }) {
  if (scopedRecords === undefined) {
    return <p className="rwit-loading">{t("wakuInfo.loading")}</p>;
  }
  if (scopedRecords === null) {
    return <p className="rwit-empty">{t("wakuInfo.fetchError")}</p>;
  }
  return <p className="rwit-empty">{t("wakuInfo.noData")}</p>;
}

// 既定ビューは「今日その選手が入る想定コース」1本に絞る（2026-09-24再設計）。
// 6コース×1指標の表はモバイル390pxで横スクロールが要るうえ、読み手が
// 本当に見たいのは今日のコースだった。列を1本にすると横幅が余るので
// 1着率・2連対率・3連対率を同時に出せる＝最も見られる部分の情報は増える
export function TodayLines({ t, todayCourse, wakuNari }) {
  return (
    <>
      <p className="rwit-today-line">
        <strong className="rwit-today-course">
          {t("wakuInfo.todayCourseHeading", { course: todayCourse })}
        </strong>
        <span className="rwit-today-assumption">
          {t("wakuInfo.wakuNariAssumption")}
        </span>
      </p>
      {wakuNari.rate !== null && (
        <p className="rwit-waku-nari">
          {t("wakuInfo.wakuNariRate", {
            rate: wakuNari.rate.toFixed(0),
            n: wakuNari.n,
          })}
        </p>
      )}
    </>
  );
}
