// ②形のステップ（ScenarioTab から移した）
import { useTranslation } from "react-i18next";
import ScenarioFold from "../ScenarioFold";
import SlitHint from "../SlitHint";
import SlitShapePicker, { SlitChosen } from "../SlitShapePicker";
import { ATTACK_BOAT } from "../../../../utils/analogyScenario";
import { k } from "./consts";
import ScenarioSlitToday from "./ScenarioSlitToday";

export default function ScenarioSlitStep({
  data,
  players,
  cells,
  entry,
  slit,
  version,
  setVersion,
  pick,
  rows,
  badges,
  exhibition,
  exhibitionStage,
  exhForms,
  flyBoats,
  agreement,
  raceId,
  waku,
  slitCollapsed,
  openSlit,
  chooseForm,
  bar2,
  formName,
  onOpenMeetForm,
}) {
  const { t } = useTranslation();
  return (
      <section className="af-scn-sec" id="af-scn-s2">
        <h3 className="af-h3 af-scn-h">
          <span className="af-stepn">{t(`${k}.stepLabel`, { n: 2 })}</span>
          {t(`${k}.slitHeadingShort`)}
        </h3>
        {slitCollapsed ? (
          <SlitChosen
            forms={cells[entry].forms}
            slit={slit}
            onChange={openSlit}
          />
        ) : (
          <>
            <SlitHint
              courseSt={data.course_st}
              players={players}
              version={version}
              onVersion={pick(setVersion)}
              rows={rows}
              exhibition={exhibition}
              exhibitionStage={exhibitionStage}
              venue={Number(String(raceId).split("-")[3])}
              selectedForm={slit}
              onForm={chooseForm}
              waku={waku}
            />
            <SlitShapePicker
              forms={cells[entry].forms}
              slit={slit}
              onSlit={chooseForm}
              badges={badges}
              todayForms={
                exhibitionStage && !exhibition?.forms_excluded ? exhForms : []
              }
            />
            {exhibitionStage && (
<ScenarioSlitToday
exhForms={exhForms}
agreement={agreement}
exhibition={exhibition}
flyBoats={flyBoats}
bar2={bar2}
formName={formName}
/>
            )}
            {!exhibitionStage && <p className="af-foot">{t(`${k}.slitPre`)}</p>}
            <ScenarioFold
              title={t(`${k}.termsFold`)}
              preview={t(`${k}.termsPreview`)}
            >
              <ul className="af-notes-ul">
                <li>{t(`${k}.termKado`)}</li>
                <li>{t(`${k}.termPic`)}</li>
                {["flat", "wall", "d2", "d3", "kado", "d1", "dash"].map((f) => (
                  <li key={f}>
                    {t(`${k}.slitDef`, {
                      form: formName(f),
                      def: t(`${k}.forms.${f}.def`),
                    })}
                  </li>
                ))}
                <li>{t(`${k}.termOverlap`)}</li>
                <li>{t(`${k}.termShare`)}</li>
              </ul>
            </ScenarioFold>
          </>
        )}
        {/* 攻める艇の今節の足へ（BOA-885）。攻める艇が決まる形（カド・ダッシュ等）を枠なりで見ているときだけ */}
        {onOpenMeetForm && waku && ATTACK_BOAT[slit] && (
          <button
            type="button"
            className="af-link af-meetform-link"
            onClick={() => onOpenMeetForm(ATTACK_BOAT[slit])}
          >
            {t(`${k}.meetFormLink`, { b: ATTACK_BOAT[slit] })}
          </button>
        )}
      </section>
  );
}
