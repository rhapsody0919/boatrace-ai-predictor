// ④の結果のうち、件数が足りるときの全体（ScenarioTab から移した）
import { useTranslation } from "react-i18next";
import { MIN_SCENARIO } from "../../../../utils/analogyScenario";
import { k } from "./consts";
import ScenarioBoatPair from "./ScenarioBoatPair";
import ScenarioTechPair from "./ScenarioTechPair";
import ScenarioFlowSplit from "./ScenarioFlowSplit";

export default function ScenarioFullResult({
  c,
  base,
  parens,
  baseName,
  scopeTag,
  bar2,
  racePick,
  racePanel,
  togglePick,
  data,
  entry,
  slit,
  cells,
  cls,
  classScope,
  first,
  setFirst,
  not1,
  setNot1,
  band,
  setBand,
}) {
  const { t } = useTranslation();
  return (
      <>
        <div className="af-scn-tagrow">
          {scopeTag(1, c.n)}
          {parens.length > 0 && (
            <span className="af-foot">
              {parens.join(t("aiPredictionTab.analogy.listComma"))}
            </span>
          )}
        </div>
        <div className="af-key">
          <span>
            <i className="is-bar" />
            {t(`${k}.keyScenario`)}
          </span>
          <span>
            <i className="is-dot" />
            {baseName}
          </span>
          <span>
            <i className="is-err" />
            {t("aiPredictionTab.analogy.similar.keyErrShort")}
          </span>
          <span>{t(`${k}.keyThin`, { n: MIN_SCENARIO })}</span>
        </div>
        {/* PC では1着｜3着以内、決まり手｜万舟を左右に（BOA-813） */}
        <ScenarioBoatPair
          c={c}
          racePick={racePick}
          racePanel={racePanel}
          togglePick={togglePick}
          data={data}
          entry={entry}
          slit={slit}
          cells={cells}
          cls={cls}
          classScope={classScope}
        />
        <ScenarioTechPair
          c={c}
          base={base}
          baseName={baseName}
          bar2={bar2}
          racePick={racePick}
          racePanel={racePanel}
          togglePick={togglePick}
        />
        {/* PC では着順の流れを左、よく出た3連単を右に（BOA-813） */}
        <ScenarioFlowSplit
          c={c}
          racePick={racePick}
          racePanel={racePanel}
          togglePick={togglePick}
          first={first}
          setFirst={setFirst}
          not1={not1}
          setNot1={setNot1}
          band={band}
          setBand={setBand}
        />
      </>
  );
}
