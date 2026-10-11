import { useTranslation } from "react-i18next";
import BoatBadge from "../BoatBadge";
import { fmtDate, fmtEntry, venueLabel } from "../../../utils/analogyFormat";

const k = "aiPredictionTab.analogy.scenario";

/** 30件未満の④の一覧（spec C-5）。日付・会場・R・進入 231/456・1〜3着・決まり手・3連単払戻 */
export default function ScenarioRaceList({ races }) {
  const { t } = useTranslation();
  return (
    <ul className="af-rlist">
      {races.map((r) => (
        <li key={r.race_id} className="af-rc">
          <div>
            <b className="af-num">{fmtDate(r.date)}</b>{" "}
            {venueLabel(r.venue_code, t)}
            {Number(String(r.race_id).slice(-2))}R
          </div>
          <div>
            <span className="af-bnrow">
              {String(r.finish_1_2_3)
                .split("-")
                .map((b, i) => (
                  <BoatBadge key={i} n={Number(b)} size="xs" />
                ))}
            </span>{" "}
            {r.technique
              ? t(
                  `aiPredictionTab.analogy.techniques.${r.technique}`,
                  r.technique,
                )
              : "—"}
            {"　"}
            {t(`${k}.payout`, {
              yen:
                r.payout_3tan === null
                  ? "—"
                  : r.payout_3tan.toLocaleString("ja-JP"),
            })}
          </div>
          <div className="af-sub">
            {t(`${k}.entryLabel`, { e: fmtEntry(r.course_by_boat) })}
            {"　"}
            {t(`${k}.slitLabel`, {
              forms: r.forms?.length
                ? r.forms
                    .map((f) => t(`${k}.forms.${f}.name`))
                    .join(t("aiPredictionTab.analogy.listSeparator"))
                : t(`${k}.noForm`),
            })}
          </div>
        </li>
      ))}
    </ul>
  );
}
