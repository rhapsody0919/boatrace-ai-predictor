// ③攻める艇のステップ（ScenarioTab から移した）
import { useTranslation } from "react-i18next";
import AttackTable from "../AttackTable";
import { scopeName } from "../../../../utils/analogyFormat";
import { k } from "./consts";

export default function ScenarioAttackStep({
  slit,
  openSlit,
  ctx,
  scope,
  sc,
  data,
  waku,
  exhibitionStage,
  exhibition,
  motorRank,
  cls,
  classScope,
  c,
}) {
  const { t } = useTranslation();
  return (
      <section className="af-scn-sec" id="af-scn-s3">
        <h3 className="af-h3 af-scn-h">
          <span className="af-stepn">{t(`${k}.stepLabel`, { n: 3 })}</span>
          {t(`${k}.attackHeading`)}
        </h3>
        {slit !== "any" && (
          <div className="af-scn-tagrow">
            <button type="button" className="af-ctx-tag" onClick={openSlit}>
              {ctx} ✎
            </button>
            <span className="af-info-tag">{scope}</span>
          </div>
        )}
        <AttackTable
          attack={sc.attack}
          refAttack={data.reference?.attack ?? null}
          refName={
            data.reference
              ? scopeName(data.reference.scope, t, { short: true })
              : null
          }
          slit={slit}
          waku={waku}
          exhibitionStage={exhibitionStage}
          exhRank={exhibition?.exh_time_rank ?? null}
          motorRank={motorRank}
          classes={cls}
          boats={data.boats ?? null}
          classScope={classScope}
          scenarioN={c.n}
        />
      </section>
  );
}
