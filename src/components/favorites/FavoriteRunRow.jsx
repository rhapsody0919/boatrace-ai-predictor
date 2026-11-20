import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLocalizedPath } from "../../hooks/useLocalizedPath";
import { displayRacerName, racerSurname } from "../../pure/favoriteRuns";
import { racerPagePath } from "../../utils/racerPagePath";
import { getStageChip } from "../../utils/raceDetailHeading";
import { finishMarkKeyOf } from "../../utils/prevResult";
import { trackEvent } from "../../utils/analytics";
import { isAnalogyFinderEnabled } from "../../config/featureFlags";
import { GRADE_CONFIG } from "../../constants/gradeConfig";
import BoatBadge from "../race/BoatBadge";

/** 今節の1走の札の文字（レース詳細の今節タブと同じ: 着順、欠場、公式の記号、着外） */
function useFinishLabel() {
  const { t } = useTranslation();
  return (run) => {
    if (run.finishRank != null) return String(run.finishRank);
    if (run.absent) return t("meetTab.finishAbsent");
    if (run.finishMark) {
      const key = finishMarkKeyOf(run.finishMark);
      return key ? t(`dataTable.prevMark.${key}`) : run.finishMark;
    }
    return t("raceHistoryTable.finishUnknownShort");
  };
}

/** 文言の中の {{name}} の所だけを translate="no" の要素にする（成績の一言の主語は選手名、オーナー 2026-11-04） */
const NAME_SLOT = "\u0000name\u0000";
function WithRacerName({ name, render }) {
  const [before, after] = render(NAME_SLOT).split(NAME_SLOT);
  if (after === undefined) return before;
  return (
    <>
      {before}
      <span translate="no">{name}</span>
      {after}
    </>
  );
}

function RunInfo({ row, info, seriesDay }) {
  const { t } = useTranslation();
  const finishLabel = useFinishLabel();
  // 読み込み中も2つの欄の高さを取っておく（CLS を出さない）
  if (info.loading)
    return (
      <>
        <div className="favorite-runs__meet" aria-busy="true" />
        <div className="favorite-runs__stat" aria-busy="true" />
      </>
    );
  if (info.error)
    return (
      <>
        <div className="favorite-runs__meet" />
        <div className="favorite-runs__stat favorite-runs__stat--failed">
          {t("favorites.section.statFailed")}
        </div>
      </>
    );
  const { stat, meet } = info;
  return (
    <>
      <div className="favorite-runs__meet">
        <span>{t("favorites.section.meet")}</span>
        {meet.length === 0 ? (
          // 「初日」と言い切るのは、節の日目が1（または不明）のときだけ。2日目以降で走が無いのは
          // 途中からの出場・記録の遅れで、初日ではない
          seriesDay == null || seriesDay === 1 ? (
            <span>{t("favorites.section.meetFirstDay")}</span>
          ) : null
        ) : (
          <span className="favorite-runs__seq">
            {meet.map((run) => (
              <b
                key={run.raceId}
                // 行のレースの札には下線を引く（同じ選手の行はどれも同じ今節なので、締切後の行で
                // どの札がこのレースの着か分かるように。ファン評価 2周目）
                className={[
                  "favorite-runs__finish",
                  (run.finishRank === 1 || run.finishRank === 2) &&
                    "favorite-runs__finish--top",
                  run.raceId === row.raceId && "favorite-runs__finish--this",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {finishLabel(run)}
              </b>
            ))}
          </span>
        )}
      </div>
      <div className="favorite-runs__stat">
        {stat.kind !== "none" && (
          <WithRacerName
            name={racerSurname(row.name)}
            render={(name) =>
              stat.kind === "rate"
                ? t("favorites.section.statLine", {
                    name,
                    boat: row.boat,
                    n: stat.n,
                    rate: stat.ratePct,
                  })
                : t("favorites.section.statLineSmall", {
                    name,
                    boat: row.boat,
                    n: stat.n,
                  })
            }
          />
        )}
      </div>
    </>
  );
}

/** 優勝戦・準優勝戦だけ札を出す（レース詳細の見出しと同じ getStageChip） */
function pickStage(raceStage, t) {
  const stageChip = getStageChip(raceStage, t);
  return stageChip &&
    (stageChip.variant === "final" || stageChip.variant === "semifinal")
    ? stageChip
    : null;
}

function buildRunLinks(row, isPast, isJa, localize) {
  return [
    { kind: "racer_page", to: racerPagePath(row.racerId), label: "linkRacer" },
    ...(isAnalogyFinderEnabled() && !isPast
      ? [
          {
            kind: "sonar",
            to: localize(`/race/${row.raceId}?tab=sonar`),
            label: "linkSonar",
          },
        ]
      : []),
    // 思考アシストは ja 専用のページ（spec 4）
    ...(isJa && !isPast
      ? [
          {
            kind: "assist",
            to: `/race/${row.raceId}/assist`,
            label: "linkAssist",
          },
        ]
      : []),
  ];
}

function RunRaceCell({ row, grade, stage, t }) {
  return (
    <div className="favorite-runs__race">
      {grade && (
        <span
          className="favorite-runs__grade"
          style={{ backgroundColor: grade.color }}
        >
          {grade.label}
        </span>
      )}
      {stage && (
        <span
          className="favorite-runs__stage"
          data-stage={stage.variant}
          title={stage.title}
        >
          {stage.emoji} {stage.label}
        </span>
      )}
      {t(`venues.${row.venueCode}`)} {row.raceNumber}R
    </div>
  );
}

function RunLinks({ links, state, t }) {
  return (
    <div className="favorite-runs__links">
      {links.map((link) => (
        <Link
          key={link.kind}
          to={link.to}
          className="favorite-runs__link"
          onClick={() =>
            trackEvent("today_row_click", {
              row_kind: "run",
              row_link: link.kind,
              row_state: state,
              fav_state: "runs",
            })
          }
        >
          {t(`favorites.section.${link.label}`)}
        </Link>
      ))}
    </div>
  );
}

function RunRow({ row, state, extra, info, seriesDay, raceStage }) {
  const { t, i18n } = useTranslation();
  const localize = useLocalizedPath();
  const isJa = i18n.resolvedLanguage === "ja";
  const grade = ["SG", "G1"].includes(row.raceGrade)
    ? GRADE_CONFIG[row.raceGrade]
    : null;
  const stage = pickStage(raceStage, t);
  // 締切後の行は結果を見る段階なので、予測に誘導するソナー・アシストは出さない
  const isPast = state === "past";
  const links = buildRunLinks(row, isPast, isJa, localize);
  const className = [
    "favorite-runs__row",
    state === "past" && "favorite-runs__row--past",
    extra && "favorite-runs__row--extra",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <li className={className}>
      <div className="favorite-runs__time">
        {row.startTime}
        {t("home.jstNote")}
        <small>{t("favorites.section.deadline")}</small>
      </div>
      <RunRaceCell row={row} grade={grade} stage={stage} t={t} />
      <div className="favorite-runs__who">
        <BoatBadge n={row.boat} />
        <span className="favorite-runs__name" translate="no">
          {displayRacerName(row.name)}
        </span>
        {row.grade && <span className="favorite-runs__class">{row.grade}</span>}
      </div>
      <RunInfo row={row} info={info} seriesDay={seriesDay} />
      <RunLinks links={links} state={state} t={t} />
    </li>
  );
}

export { RunRow };
