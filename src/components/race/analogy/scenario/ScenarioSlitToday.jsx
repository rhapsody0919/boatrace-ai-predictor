// ②のうち「今日の展示」の欄（ScenarioTab から移した）
import { useTranslation } from "react-i18next";
import { fmtCount, fmtDate } from "../../../../utils/analogyFormat";
import { agreementVerdict } from "../../../../utils/analogyFacts";
import { k } from "./consts";

export default function ScenarioSlitToday({
  exhForms,
  agreement,
  exhibition,
  flyBoats,
  bar2,
  formName,
}) {
  const { t } = useTranslation();
  return (
              <div className="af-scn-blk">
                <h4 className="af-h4">
                  {t(`aiPredictionTab.analogy.notes.today`)}
                </h4>
                {/* 展示が2つ以上の形に当たるときは、形ごとに展示→本番の一致を出す（ファン評価: 先頭の形しか出ていなかった） */}
                {exhForms.map((f) => {
                  const ag = agreement?.forms?.[f];
                  if (!ag?.hit?.[1]) return null;
                  const verdict = agreementVerdict(ag.hit, ag.miss);
                  return (
                    <div key={f} className="af-scn-blk">
                      {bar2(
                        t(`${k}.slitAgreeHit`, { form: formName(f) }),
                        ag.hit[0] / ag.hit[1],
                      )}
                      {ag.miss?.[1]
                        ? bar2(
                            t(`${k}.slitAgreeMiss`, { form: formName(f) }),
                            ag.miss[0] / ag.miss[1],
                          )
                        : null}
                      {verdict && (
                        <p className="af-foot">
                          <span className="af-info-tag">
                            {t(`${k}.agreeVerdict.${verdict}`)}
                          </span>
                        </p>
                      )}
                    </div>
                  );
                })}
                {exhForms.some((f) => agreement?.forms?.[f]?.hit?.[1]) && (
                  <p className="af-foot">
                    {t(`${k}.agreeSource`, {
                      since: fmtDate(
                        String(agreement.period?.[0] ?? "").slice(0, 7),
                      ),
                      n: fmtCount(agreement.forms_n),
                    })}
                  </p>
                )}
                <p className="af-foot">
                  {exhibition?.forms_excluded
                    ? t(`${k}.slitDeepFly`)
                    : exhForms.length
                      ? t(
                          `${k}.${exhForms.length > 1 ? "slitTodayTagMany" : "slitTodayTagOne"}`,
                          {
                            forms: exhForms
                              .map(formName)
                              .join(t("aiPredictionTab.analogy.listSeparator")),
                            count: exhForms.length,
                          },
                        ) +
                        (flyBoats.length
                          ? t(`${k}.slitFlyShallow`, {
                              boats: flyBoats.join(
                                t("aiPredictionTab.analogy.listSeparator"),
                              ),
                            })
                          : "")
                      : t(`${k}.slitToday`, { forms: t(`${k}.noForm`) })}
                </p>
              </div>
  );
}
