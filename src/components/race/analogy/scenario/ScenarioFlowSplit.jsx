// ④の着順の流れ｜よく出た3連単（ScenarioFullResult から移した）
import { useTranslation } from "react-i18next";
import FinishSankey from "../FinishSankey";
import AnalogySplit from "../AnalogySplit";
import TrifectaList from "../TrifectaList";

export default function ScenarioFlowSplit({
  c,
  racePick,
  racePanel,
  togglePick,
  first,
  setFirst,
  not1,
  setNot1,
  band,
  setBand,
}) {
  const { t } = useTranslation();
  return (
        <AnalogySplit
          fig={
            <div className="af-scn-blk">
              <h4 className="af-h4">
                {t("aiPredictionTab.analogy.flow.heading")}
              </h4>
              <FinishSankey
                tri={c.tri}
                first={first}
                onFirst={setFirst}
                not1={not1}
                onNot1={setNot1}
                band={band}
                onBand={setBand}
                scenario
              />
            </div>
          }
        >
          <div className="af-scn-blk">
            <h4 className="af-h4">
              {t("aiPredictionTab.analogy.similar.triHeading")}
            </h4>
            <TrifectaList
              tri={c.tri}
              first={first}
              not1={not1}
              band={band}
              scenario
              picked={
                racePick?.kind === "tri" ? racePick.combo.join("-") : null
              }
              onPick={(combo) =>
                togglePick({ group: "tri", kind: "tri", combo })
              }
              bandPicked={racePick?.kind === "band"}
              onBandRaces={
                band
                  ? () =>
                      togglePick({
                        group: "tri",
                        kind: "band",
                        p: band.p,
                        a: band.a,
                        b: band.b,
                      })
                  : undefined
              }
            />
            {racePanel("tri")}
          </div>
        </AnalogySplit>
  );
}
