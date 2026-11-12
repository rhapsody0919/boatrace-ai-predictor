// ④の決まり手｜万舟（ScenarioFullResult から移した）
import { useTranslation } from "react-i18next";
import { TechniqueBars } from "../OutcomeBars";
import { fmtCount } from "../../../../utils/analogyFormat";
import { MIN_SCENARIO } from "../../../../utils/analogyScenario";
import { k, share } from "./consts";

export default function ScenarioTechPair({
  c,
  base,
  baseName,
  bar2,
  racePick,
  racePanel,
  togglePick,
}) {
  const { t } = useTranslation();
  return (
        <div className="af-pair">
          <div className="af-scn-blk">
            <h4 className="af-h4">{t(`${k}.techHeadingShort`)}</h4>
            <TechniqueBars
              counts={c.technique}
              n={c.n}
              reference={Object.fromEntries(
                Object.entries(base.technique).map(([kk, v]) => [
                  kk,
                  share(v, base.n),
                ]),
              )}
              selected={racePick?.kind === "tech" ? racePick.tech : null}
              onSelect={(tech) =>
                togglePick({ group: "tech", kind: "tech", tech })
              }
            />
            {racePanel("tech")}
          </div>
          <div className="af-scn-blk">
            <h4 className="af-h4">{t(`${k}.manshu`)}</h4>
            {bar2(t(`${k}.keyScenario`), share(c.manshu, c.payout_known))}
            {bar2(baseName, share(base.manshu, base.payout_known))}
            <p className="af-foot">
              {t(`${k}.manshuCount`, {
                hits: fmtCount(c.manshu),
                n: fmtCount(c.payout_known),
              })}
            </p>
            {c.manshu > 0 && (
              <button
                type="button"
                className="af-cnt-chip af-cnt-btn"
                aria-pressed={racePick?.kind === "manshu"}
                data-af-control="scenario_races_manshu"
                onClick={() => togglePick({ group: "manshu", kind: "manshu" })}
              >
                {t("aiPredictionTab.analogy.count", { n: fmtCount(c.manshu) })}{" "}
                ›
              </button>
            )}
            {racePanel("manshu")}
          </div>
        </div>
  );
}
