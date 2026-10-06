import { useTranslation } from "react-i18next";
import NoteList from "./NoteList";
import useAnalogyContribution from "../../../hooks/useAnalogyContribution";
import {
  ITEM_GROUPS,
  SIMILAR_ITEMS,
  inDistance,
} from "../../../utils/analogyAggregate";
import { layerKind } from "../../../utils/analogyLayer";
import { fmtDate } from "../../../utils/analogyFormat";

const k = "aiPredictionTab.analogy.sources";

/**
 * 使っている項目（3タブ共通の下部、spec FR-D）
 * @param {{stage: "racecard"|"exhibition", period: [string, string]|null, conditions: object|null}} props
 *   conditions は類似レースの層の条件（タブ2を開いた後に分かる。無ければ共通の3条件だけ書く）
 */
export default function DataSources({ stage, period, conditions }) {
  const { t } = useTranslation();
  const ex = stage === "exhibition";
  const ai = useAnalogyContribution({
    venue: 0,
    grade: "all",
    round: "all",
    target: 1,
    stage: "exhibition",
  });
  const label = (key) =>
    t(`aiPredictionTab.analogy.similar.items.${key}.label`);
  const used = ITEM_GROUPS.map((g) => [
    g,
    SIMILAR_ITEMS.filter(
      (it) => it.group === g && !it.dup && inDistance(it, ex),
    ).map((it) => label(it.key)),
  ]).filter(([, l]) => l.length);
  const notUsed = SIMILAR_ITEMS.filter(
    (it) => (ex || !it.exhibition) && !inDistance(it, ex),
  ).map((it) => label(it.key));
  const sep = t("aiPredictionTab.analogy.listSeparator");
  const kind = conditions ? layerKind(conditions, t) : null;
  const layer = [kind, t(`${k}.similarLayerBase`)].filter(Boolean).join(sep);
  const aiPeriod = ai.data?.testPeriod
    ? t("aiPredictionTab.analogy.period", {
        from: fmtDate(ai.data.testPeriod[0]),
        to: fmtDate(ai.data.testPeriod[1]),
      })
    : "—";
  return (
    <details className="af-fold">
      <summary>{t(`${k}.summary`)}</summary>
      <div className="af-fold-inner">
        <h3>{t(`${k}.facts`)}</h3>
        <ul>
          <li>{t(`${k}.factsItems`)}</li>
          <li>{t(`${k}.factsFinish`)}</li>
          <li>{t(`${k}.factsWind`)}</li>
        </ul>
        <h3>{t(`${k}.similar`)}</h3>
        <ul>
          <li>{t(`${k}.similarLayer`, { cond: layer })}</li>
          <li>
            {t(`${k}.similarDistance`, {
              stage: t(`aiPredictionTab.analogy.stage.${stage}`),
            })}
            <ul>
              {used.map(([g, l]) => (
                <li key={g}>
                  {t(`aiPredictionTab.analogy.similar.groups.${g}`)}:{" "}
                  {l.join(sep)}
                </li>
              ))}
            </ul>
          </li>
          {notUsed.length > 0 && (
            <li>{t(`${k}.similarNotUsed`, { items: notUsed.join(sep) })}</li>
          )}
          <li>{ex ? t(`${k}.similarPost`) : t(`${k}.similarPre`)}</li>
        </ul>
        <h3>{t(`${k}.scenario`)}</h3>
        <ul>
          <li>{t(`${k}.scenarioEntry`)}</li>
          <li>{t(`${k}.scenarioSlit`)}</li>
          <li>{t(`${k}.scenarioResult`)}</li>
        </ul>
        <NoteList
          title={t(`aiPredictionTab.analogy.notes.period`)}
          texts={[
            period &&
              t(`${k}.period`, {
                from: fmtDate(period[0]),
                to: fmtDate(period[1]),
                ai: aiPeriod,
              }),
            t(`${k}.interval`),
          ]}
        />
      </div>
    </details>
  );
}
