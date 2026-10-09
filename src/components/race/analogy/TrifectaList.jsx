import { useTranslation } from "react-i18next";
import ScenarioFold from "./ScenarioFold";
import BoatBadge from "../BoatBadge";
import { fmtCount, fmtPct } from "../../../utils/analogyFormat";
import { TOP_TRIFECTA, trifectaList } from "../../../utils/analogyAggregate";

function Row({ combo, count, total, max }) {
  const { t } = useTranslation();
  return (
    <div className="af-bar">
      <span className="af-tri">
        {combo.map((b, i) => (
          <span key={i}>
            {i > 0 && <span className="af-tri-sep">-</span>}
            <BoatBadge n={b} size="xs" />
          </span>
        ))}
      </span>
      <span className="af-trk">
        <span
          className="af-trk-f"
          style={{ width: `${(count / max) * 100}%` }}
        />
      </span>
      <span className="af-bar-v">
        {fmtPct(count / total, 1)}{" "}
        <small>
          {t("aiPredictionTab.analogy.count", { n: fmtCount(count) })}
        </small>
      </span>
    </div>
  );
}

/**
 * よく出た3連単（上位3つ＋残りは畳む。spec B-8・C-5）
 * @param {{tri: Record<string, number>, first?: number|null, not1?: boolean}} props
 */
export default function TrifectaList({
  tri,
  first = null,
  not1 = false,
  scenario = false,
}) {
  const { t } = useTranslation();
  const all = trifectaList(tri, { first, not1 });
  const total = all.reduce((s, [, c]) => s + c, 0);
  if (!all.length)
    return (
      <p className="af-foot">{t("aiPredictionTab.analogy.similar.none")}</p>
    );
  const max = all[0][1];
  const row = ([combo, c]) => (
    <Row
      key={combo.join("-")}
      combo={combo}
      count={c}
      total={total}
      max={max}
    />
  );
  return (
    <>
      <div className="af-bars">{all.slice(0, TOP_TRIFECTA).map(row)}</div>
      {all.length > TOP_TRIFECTA && scenario && (
        <ScenarioFold
          title={t("aiPredictionTab.analogy.similar.triMore", {
            k: all.length - TOP_TRIFECTA,
            m: all.length,
          })}
          preview={t("aiPredictionTab.analogy.similar.triMorePreview")}
        >
          <div className="af-bars">{all.slice(TOP_TRIFECTA).map(row)}</div>
        </ScenarioFold>
      )}
      {all.length > TOP_TRIFECTA && !scenario && (
        <details className="af-details">
          <summary>
            {t("aiPredictionTab.analogy.similar.triMore", {
              k: all.length - TOP_TRIFECTA,
              m: all.length,
            })}
          </summary>
          <div className="af-bars">{all.slice(TOP_TRIFECTA).map(row)}</div>
        </details>
      )}
    </>
  );
}
