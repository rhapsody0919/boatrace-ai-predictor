import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { GRADE_LABELS } from "./raceGradeLabels";
import { translateTechnique } from "./raceIndicators";
import { formatPayout } from "../../utils/formatters";
import { finishMarkKeyOf } from "../../utils/prevResult";
import { groupRunsByMeet } from "./basicInfoStats";
import "./RecentRunsTable.css";

// ST は公式の表記にそろえて先頭の 0 を省く（0.14 → .14）。F は記号を前に付ける
const formatSt = (race) => {
  if (race.startTiming == null) return race.isFlying ? "F" : "-";
  const s = Number(race.startTiming).toFixed(2).replace(/^0/, "");
  return race.isFlying ? `F${s}` : s;
};

// 見出し行には年月だけを出す（2026/9）。行の日付は月日だけなので年はここで補う。
// 「9/28〜9/29」のように日の範囲を出すと、節の開催期間に読まれる。実際は表に入った走の
// 日付の幅で、同じ節でも選手やページで変わった（BOA-623 ファン評価1周目）
const formatMonth = (date) => `${date.slice(0, 4)}/${Number(date.slice(5, 7))}`;
const formatPeriod = (first, last) =>
  formatMonth(first) === formatMonth(last)
    ? formatMonth(first)
    : `${formatMonth(first)}〜${formatMonth(last)}`;

/**
 * 選手の走を、節ごとの見出し行つきの6列で並べる表（BOA-623）。
 * 基本情報タブの「直近10走」と、選手ページの「レース一覧」が使う。
 *
 * 列は「日付・R・枠番・進入・ST・着順」（＋PC だけ単勝配当）。並びは
 * 「どの枠から、何コースに入り、STが何番目で、何着か」の読む順にした。
 * 以前の11列（RaceHistoryTable）は 375px で幅 約770px あり、最初の画面に
 * 入るのは「日付・会場・R・着順」だけで、枠番・ST は横に送らないと見えなかった。
 *
 * - 会場・グレード・レース名は、節ごとの見出し行に1回だけ出す
 *   （同じ節は10行とも同じ値で、レース名だけで 252px を取っていた）
 * - 日付は月日（09-14）。年は見出し行の期間に出す（選手ページは2年分並ぶ）
 * - レース種別（予選・準優など）は R の下に小さく、決まり手は1着のときだけ
 *   着順の下に小さく出す
 * - ST にはそのレースの6艇の中での順位（F を除く）を「(4)」で添え、表の下に凡例を出す
 * - 単勝配当は PC だけ（選手の力を表す数字ではないため、375px では省く）
 *
 * 行のクリックは onClick で遷移する（iOS の WebKit は `<tr>` の
 * position: relative を効かせず、行全体リンクの ::after が横スワイプを止めた。
 * BOA-609）。日付の `<Link>` は残すので、中クリック・新しいタブはそのまま。
 *
 * 今節タブの日別の表は展示の列を持つなど用途が違うので、引き続き
 * RaceHistoryTable を使う。
 *
 * @param {Array} rows getRecentRaces / aggregateRacerVenueBoatStats の matchedRaces の行。
 *   新しい順で渡す（いちばん上が前走）。直近10走と選手ページで向きをそろえる
 * @param {(raceId: string) => string} [buildRaceHref]
 */
function RecentRunsTable({
  rows,
  buildRaceHref = (raceId) => `/race/${raceId}`,
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const groups = groupRunsByMeet(rows);

  const renderFinish = (race) => {
    if (race.finishRank != null) return race.finishRank;
    if (race.absent) return t("basicInfo.finishAbsent");
    const key = finishMarkKeyOf(race.finishMark);
    if (key) {
      return (
        <abbr title={t(`result.mark.${key}`)}>
          {t(`dataTable.prevMark.${key}`)}
        </abbr>
      );
    }
    return race.finishMark ?? t("basicInfo.finishUnknown");
  };

  return (
    <div className="rrt-wrap">
      <table className="rrt-table">
        <thead>
          <tr>
            <th className="rrt-left">{t("raceHistoryTable.date")}</th>
            <th className="rrt-left">{t("raceHistoryTable.raceNo")}</th>
            <th>{t("raceHistoryTable.boatNumber")}</th>
            <th>{t("raceHistoryTable.entryCourse")}</th>
            <th>{t("raceHistoryTable.startTiming")}</th>
            <th>{t("raceHistoryTable.finish")}</th>
            <th className="rrt-pc">{t("raceHistoryTable.payout")}</th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={`${g.firstDate}-${g.venueCode}-${g.raceTitle}`}>
            <tr className="rrt-group">
              <td colSpan={7}>
                {g.raceGrade && (
                  <span
                    className={`rrt-grade${g.raceGrade === "ippan" ? " is-ippan" : ""}`}
                  >
                    {t(
                      `raceHistoryTable.grades.${g.raceGrade}`,
                      GRADE_LABELS[g.raceGrade] ?? g.raceGrade,
                    )}
                  </span>
                )}
                <b>{t(`venues.${g.venueCode}`, String(g.venueCode))}</b>
                {g.raceTitle && (
                  <span className="rrt-title" translate="no">
                    {g.raceTitle}
                  </span>
                )}
                <span className="rrt-period">
                  {formatPeriod(g.firstDate, g.lastDate)}
                </span>
              </td>
            </tr>
            {g.rows.map((race) => (
              <tr
                key={race.raceId}
                className="rrt-row"
                onClick={(e) => {
                  if (e.target.closest("a")) return;
                  navigate(buildRaceHref(race.raceId));
                }}
              >
                <td className="rrt-left">
                  <Link className="rrt-link" to={buildRaceHref(race.raceId)}>
                    {race.raceId.slice(5, 10)}
                  </Link>
                </td>
                <td className="rrt-left">
                  {race.raceNo != null ? `${race.raceNo}R` : "-"}
                  {race.raceStage && (
                    <span
                      className="rrt-sub"
                      translate="no"
                      title={race.raceStage}
                    >
                      {race.raceStage}
                    </span>
                  )}
                </td>
                <td>{race.boatNumber ?? "-"}</td>
                <td>{race.entryCourse ?? "-"}</td>
                <td
                  className={`rrt-st${race.startTimingRank === 1 ? " is-top" : ""}`}
                >
                  {formatSt(race)}
                  {/* 順位は今節タブの表と同じ「(4)」。丸数字は字形が小さく、375px で
                      読めなかった（BOA-623 ファン評価1周目） */}
                  {race.startTimingRank != null && (
                    <span className="rrt-st-rank">
                      ({race.startTimingRank})
                    </span>
                  )}
                </td>
                <td
                  className={`rrt-finish${race.finishRank === 1 ? " is-win" : ""}`}
                >
                  {renderFinish(race)}
                  {race.finishRank === 1 && race.winningTechnique != null && (
                    <span
                      className="rrt-sub"
                      title={translateTechnique(t, race.winningTechnique)}
                    >
                      {translateTechnique(t, race.winningTechnique)}
                    </span>
                  )}
                </td>
                <td className="rrt-pc">
                  {race.finishRank === 1 && race.payoutWin != null
                    ? formatPayout(race.payoutWin)
                    : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
      <p className="rrt-legend">{t("raceHistoryTable.stRankLegend")}</p>
    </div>
  );
}

export default RecentRunsTable;
