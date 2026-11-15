import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { GRADE_LABELS } from "./raceGradeLabels";
import { raceStageLabel } from "../../constants/raceStageConfig";
import { translateTechnique } from "./raceIndicators";
import { finishMarkKeyOf } from "../../utils/prevResult";

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

// レース番号の下のレース種別。ja・分類できない会場独自の名前は公式表記のまま
// （translate="no"）、ja 以外で分類できたものは区分の訳を出し、公式表記はツールチップに残す（BOA-621）
function RaceStageSub({ label, official }) {
  return (
    <span
      className="rrt-sub rrt-stage"
      translate={label.isOfficial ? "no" : undefined}
      // 狭い列で区分名が省略されても全文と公式表記をツールチップで読めるようにする
      title={label.isOfficial ? official : `${label.text} (${official})`}
    >
      {label.text}
    </span>
  );
}

function FinishCell({ race }) {
  const { t } = useTranslation();
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
  if (race.finishMark) return race.finishMark;
  // 順位不明（4〜6着のどれか。古いレースは上位3着しか持っていない）。全文
  // 「Unplaced (rank unknown)」は英語の 375px で着順の列を 190px に広げたので、
  // 短い表記にして全文は title に出す（BOA-623 ファン評価2周目の修正の確認で発見）
  return (
    <abbr title={t("basicInfo.finishUnknown")}>
      {t("raceHistoryTable.finishUnknownShort")}
    </abbr>
  );
}

// 節の見出し行（会場・グレード・レース名・期間）
export function RunGroupHeadRow({ g }) {
  const { t } = useTranslation();
  return (
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
  );
}

// 1走の行
export function RunRow({ race, buildRaceHref }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const href = buildRaceHref(race.raceId);
  return (
    <tr
      className="rrt-row"
      onClick={(e) => {
        if (e.target.closest("a")) return;
        navigate(href);
      }}
    >
      <td className="rrt-left">
        <Link className="rrt-link" to={href}>
          {race.raceId.slice(5, 10)}
        </Link>
      </td>
      <td className="rrt-left">
        {race.raceNo != null ? `${race.raceNo}R` : "-"}
        {race.raceStage && (
          <RaceStageSub
            label={raceStageLabel(race.raceStage, t, i18n.language)}
            official={race.raceStage}
          />
        )}
      </td>
      <td>{race.boatNumber ?? "-"}</td>
      <td>{race.entryCourse ?? "-"}</td>
      <td className={`rrt-st${race.startTimingRank === 1 ? " is-top" : ""}`}>
        {formatSt(race)}
        {/* 順位は今節タブの表と同じ「(4)」。丸数字は字形が小さく、375px で
          読めなかった（BOA-623 ファン評価1周目） */}
        {race.startTimingRank != null && (
          <span className="rrt-st-rank">({race.startTimingRank})</span>
        )}
      </td>
      <td className={`rrt-finish${race.finishRank === 1 ? " is-win" : ""}`}>
        <FinishCell race={race} />
        {race.finishRank === 1 && race.winningTechnique != null && (
          <span
            className="rrt-sub rrt-technique"
            title={translateTechnique(t, race.winningTechnique)}
          >
            {/* 英語の「Makuri-zashi (Sweep & pass)」は括弧の説明を省く。
            375px で「Makuri…」と切れて読めなかった（3周目） */}
            {translateTechnique(t, race.winningTechnique).replace(
              / \(.*\)$/,
              "",
            )}
          </span>
        )}
      </td>
      <td className="rrt-pc">
        {race.finishRank === 1 && race.payoutWin != null
          ? t("raceHistoryTable.payoutCell", {
              amount: race.payoutWin.toLocaleString(),
            })
          : "-"}
      </td>
    </tr>
  );
}
