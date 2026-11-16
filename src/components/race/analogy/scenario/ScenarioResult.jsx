// ④の結果（0件・少ない・通常の3分岐）。ScenarioTab から移した
import { useTranslation } from "react-i18next";
import ScenarioRaceList from "../ScenarioRaceList";
import { MIN_SCENARIO } from "../../../../utils/analogyScenario";
import { k } from "./consts";
import { resultText } from "./resultText";
import ScenarioFullResult from "./ScenarioFullResult";

export default function ScenarioResult({
  c,
  base,
  whole,
  E,
  sl,
  slit,
  scope,
  allOf,
  formName,
  scopeTag,
  bar2,
  racePick,
  racePanel,
  togglePick,
  data,
  entry,
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
  const { parens, head, baseName } = resultText({
    t,
    E,
    sl,
    slit,
    scope,
    allOf,
    formName,
    base,
    c,
    whole,
  });
  if (!c.n) return <p className="af-warn">{t(`${k}.none`, { head })}</p>;
  if (c.n < MIN_SCENARIO)
    return (
      <>
        <div className="af-scn-tagrow">
          {scopeTag(1, c.n)}
          <span className="af-foot">{t(`${k}.fewList`, { head })}</span>
        </div>
        <p className="af-sub">
          {t(`${k}.fewSummary`, {
            first: c.first_boat
              .map((v, i) =>
                v ? t(`${k}.boatCount`, { b: i + 1, n: v }) : null,
              )
              .filter(Boolean)
              .join(t("aiPredictionTab.analogy.listSeparator")),
            manshu: c.manshu,
          })}
        </p>
        <ScenarioRaceList races={c.races ?? []} />
      </>
    );
  return (
    <ScenarioFullResult
      c={c}
      base={base}
      parens={parens}
      baseName={baseName}
      scopeTag={scopeTag}
      bar2={bar2}
      racePick={racePick}
      racePanel={racePanel}
      togglePick={togglePick}
      data={data}
      entry={entry}
      slit={slit}
      cells={cells}
      cls={cls}
      classScope={classScope}
      first={first}
      setFirst={setFirst}
      not1={not1}
      setNot1={setNot1}
      band={band}
      setBand={setBand}
    />
  );
}
