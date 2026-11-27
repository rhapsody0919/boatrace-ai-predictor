/**
 * 会場の進入コース別の1着率の表（直近1年、BOA-1687 GS02 V1）。
 * 列は 進入コース・1着率・全国・1着の回数。母数と期間は表の上の行（VenueCharacteristicsCard）に書く。
 * 行は進入コース（枠番ではない）なので、艇の色は使わない（number-wording.md）
 * 1着率の下に、全国の同じコースと比べる棒（見せ方の型1・値の尺度、意味づけ 2026-11-26 オーナー承認）。
 * 灰の棒＝この会場の率、｜＝全国。緑▲・赤▼は全国との差を言える1コースで、24会場の線を超えたときだけ（row.dir）
 */
import { formatCount, formatRate } from "../../utils/venueSummary";
import "./VenueCourseTable.css";

// 棒の目盛りの右端（%）。表の中の一番大きい値に1割の余白（6コースの小さい率も見えるよう0からの長さ）
function scaleMax(rows) {
  return (
    Math.max(...rows.flatMap((row) => [row.rate, row.nationalRate ?? 0])) *
      1.1 || 1
  );
}

function CourseBar({ t, row, max }) {
  const tone = { higher: "good", lower: "bad" }[row.dir] ?? "plain";
  return (
    <span
      className={`venue-course-bar venue-course-bar--${tone}`}
      data-dir={row.dir ?? "none"}
    >
      <span className="venue-course-bar__track" aria-hidden="true">
        <span
          className="venue-course-bar__fill"
          style={{ width: `${(row.rate / max) * 100}%` }}
        />
        {row.nationalRate != null && (
          <span
            className="venue-course-bar__national"
            style={{ left: `${(row.nationalRate / max) * 100}%` }}
          />
        )}
      </span>
      {row.dir && (
        <span className="venue-course-bar__mark">
          {t(
            row.dir === "higher"
              ? "venueCharacteristics.courseHigher"
              : "venueCharacteristics.courseLower",
          )}
        </span>
      )}
    </span>
  );
}

export default function VenueCourseTable({ t, rows }) {
  const max = scaleMax(rows);
  return (
    <>
      <table className="venue-course-table" data-testid="venue-course-table">
        <thead>
          <tr>
            <th scope="col">{t("venueCharacteristics.courseColumn")}</th>
            <th scope="col">{t("venueCharacteristics.winRateColumn")}</th>
            <th scope="col">{t("venueCharacteristics.techniqueNational")}</th>
            <th scope="col">{t("venueCharacteristics.winsColumn")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.course} data-testid={`venue-course-row-${row.course}`}>
              <th scope="row">
                {t("venueCharacteristics.courseLabel", { course: row.course })}
              </th>
              <td className="venue-course-table__own">
                {formatRate(row.rate)}%
                <CourseBar t={t} row={row} max={max} />
              </td>
              <td>
                {row.nationalRate == null
                  ? "—"
                  : `${formatRate(row.nationalRate)}%`}
              </td>
              <td>{formatCount(row.wins)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* 棒の読み方 */}
      <p className="venue-course-bar-note">
        {t("venueCharacteristics.courseBarNote")}
      </p>
    </>
  );
}
