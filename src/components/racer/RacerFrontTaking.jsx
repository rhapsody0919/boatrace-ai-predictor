import { useTranslation } from "react-i18next";
import InlineFetchError from "../InlineFetchError";
import {
  FRONT_TAKING_MIN_RATE,
  FRONT_TAKING_MIN_RUNS,
} from "../../utils/frontTaking";
import "./RacerFrontTaking.css";

export const RACER_FRONT_TAKING_ID = "racer-front-taking";

/**
 * 選手ページの「前付けの傾向」（BOA-1422）。件数・割合・コース別の内訳を出す。
 * summary は summarizeFrontTaking の戻り値。null は取得中（高さを確保して後のずれを防ぐ）
 */
export default function RacerFrontTaking({ summary, failed, onRetry }) {
  const { t } = useTranslation();

  let body;
  if (failed) {
    body = <InlineFetchError onRetry={onRetry} />;
  } else if (!summary) {
    body = <div className="drt-skeleton racer-front-taking__skeleton" aria-hidden="true" />;
  } else if (summary.runs === 0) {
    body = <p className="racer-front-taking__lead">{t("racerFrontTaking.noRuns")}</p>;
  } else {
    body = (
      <>
        <p className="racer-front-taking__lead">
          {t("racerFrontTaking.lead", {
            runs: summary.runs,
            taken: summary.taken,
            rate: summary.rate.toFixed(0),
          })}
        </p>
        {summary.taken > 0 && (
          <ul className="racer-front-taking__courses">
            {summary.byCourse.map((count, i) =>
              count > 0 ? (
                <li key={i + 1}>
                  {t("racerFrontTaking.course", { course: i + 1, count })}
                </li>
              ) : null,
            )}
          </ul>
        )}
        <p className="racer-front-taking__note">
          {summary.isInya
            ? t("racerFrontTaking.badgeOn", {
                minRuns: FRONT_TAKING_MIN_RUNS,
                minRate: FRONT_TAKING_MIN_RATE,
              })
            : t("racerFrontTaking.badgeOff", {
                minRuns: FRONT_TAKING_MIN_RUNS,
                minRate: FRONT_TAKING_MIN_RATE,
              })}
        </p>
      </>
    );
  }

  return (
    <section
      id={RACER_FRONT_TAKING_ID}
      className="racer-front-taking"
      data-testid="racer-front-taking"
    >
      <h2 className="racer-front-taking__title">{t("racerFrontTaking.title")}</h2>
      {body}
    </section>
  );
}
