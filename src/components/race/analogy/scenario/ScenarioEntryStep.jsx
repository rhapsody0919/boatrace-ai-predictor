// ①進入のステップ（ScenarioTab から移した）
import { useTranslation } from "react-i18next";
import ScenarioFold from "../ScenarioFold";
import EntryPatternPicker from "../EntryPatternPicker";
import { fmtCount, fmtDate } from "../../../../utils/analogyFormat";
import { MIN_SCENARIO } from "../../../../utils/analogyScenario";
import { k } from "./consts";

export default function ScenarioEntryStep({
  cells,
  entry,
  chooseEntry,
  todayEntry,
  exhibitionStage,
  entryAgree,
  agreement,
  bar2,
  allOf,
  scope,
}) {
  const { t } = useTranslation();
  return (
      <section className="af-scn-sec" id="af-scn-s1">
        <h3 className="af-h3 af-scn-h">
          <span className="af-stepn">{t(`${k}.stepLabel`, { n: 1 })}</span>
          {t(`${k}.entryHeading`)}
        </h3>
        <EntryPatternPicker
          cells={cells}
          entry={entry}
          onEntry={chooseEntry}
          todayEntry={todayEntry}
        />
        {exhibitionStage && todayEntry && entryAgree?.[1] && (
          <div className="af-scn-blk">
            {bar2(
              t(`${k}.entryAgreeBar`, {
                entry: t(`${k}.entryShort.${todayEntry}`),
              }),
              entryAgree[0] / entryAgree[1],
            )}
            <p className="af-foot">
              {t(`${k}.agreeSource`, {
                since: fmtDate(String(agreement.period?.[0] ?? "").slice(0, 7)),
                n: fmtCount(entryAgree[1]),
              })}
            </p>
          </div>
        )}
        <ScenarioFold
          title={t(`${k}.entryHowTo`)}
          preview={t(`${k}.entryHowToPreview`)}
        >
          <ul className="af-notes-ul">
            <li>{t(`${k}.entryFootShare`, { name: allOf(scope) })}</li>
            <li>{t(`${k}.entryFootMae`)}</li>
            <li>{t(`${k}.entryFootDash`)}</li>
            <li>{t(`${k}.entryFootFew`, { n: MIN_SCENARIO })}</li>
            {!exhibitionStage && <li>{t(`${k}.entryPre`)}</li>}
          </ul>
        </ScenarioFold>
      </section>
  );
}
