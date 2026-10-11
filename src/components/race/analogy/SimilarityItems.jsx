import { useTranslation } from "react-i18next";
import { fmtCount, fmtPct } from "../../../utils/analogyFormat";
import {
  inDistance,
  itemRates,
  layerItemKeys,
} from "../../../utils/analogyAggregate";
import { itemValue } from "../../../utils/analogySimilarDisplay";

const k = "aiPredictionTab.analogy.similar";

/**
 * 何が似ている？（spec B-6）と全33項目の表
 * @param {{neighbors: object[], items: object[], exhibitionStage: boolean, conditions: object,
 *   poolRate: Record<string, number>, poolRateExhibition: boolean, today: object|null}} props
 *   poolRateExhibition は、展示後の段が展示で決まる項目の pool_rate を今日の展示の値で数え直したか（#1296）
 */
export default function SimilarityItems({
  neighbors,
  items,
  exhibitionStage,
  conditions,
  poolRate,
  poolRateExhibition,
  today,
}) {
  const { t } = useTranslation();
  const n = neighbors.length;
  const rates = itemRates(neighbors, items);
  const fixed = layerItemKeys(conditions);
  const label = (key) => t(`${k}.items.${key}.label`);
  const main = items.filter(
    (it) =>
      inDistance(it, exhibitionStage) &&
      !it.dup &&
      !fixed.includes(it.key) &&
      rates[it.key].rate !== null &&
      rates[it.key].n >= 5,
  );
  const strong = main
    .filter((it) => rates[it.key].rate >= 0.5)
    .sort((a, b) => rates[b.key].rate - rates[a.key].rate);
  const weak = main
    .filter((it) => rates[it.key].rate < 0.5)
    .sort((a, b) => rates[a.key].rate - rates[b.key].rate);
  const row = (it) => {
    const r = rates[it.key];
    return (
      <div key={it.key} className="af-lk">
        <span>
          {label(it.key)}
          <small>
            {t(`${k}.todayValue`, { v: itemValue(it.key, today, t) })}
          </small>
        </span>
        <span className="af-trk">
          <span className="af-trk-f" style={{ width: `${r.rate * 100}%` }} />
          {r.nearRate !== null && r.nearRate > r.rate && (
            <span
              className="af-trk-near"
              style={{
                left: `${r.rate * 100}%`,
                width: `${(r.nearRate - r.rate) * 100}%`,
              }}
            />
          )}
        </span>
        <span className="af-bar-v">
          {fmtPct(r.rate)}
          {r.nearRate !== null && r.nearRate > r.rate + 0.005 && (
            <small>{t(`${k}.withNear`, { p: fmtPct(r.nearRate) })}</small>
          )}
        </span>
      </div>
    );
  };
  const sorted = [...items].sort(
    (a, b) => (rates[b.key].rate ?? -1) - (rates[a.key].rate ?? -1),
  );
  return (
    <details className="af-details">
      <summary>{t(`${k}.likeSummary`)}</summary>
      <p className="af-sub">{t(`${k}.likeLede`, { n: fmtCount(n) })}</p>
      {fixed.length > 0 && <p className="af-foot">{t(`${k}.likeFixed`)}</p>}
      {strong.length ? (
        strong.map(row)
      ) : (
        <p className="af-foot">{t(`${k}.likeNone`)}</p>
      )}
      {weak.length > 0 && (
        <>
          <h4 className="af-h4">{t(`${k}.likeWeak`)}</h4>
          {weak.map(row)}
        </>
      )}
      <p className="af-foot">{t(`${k}.weightOrder`)}</p>
      <details className="af-details">
        <summary>{t(`${k}.allItems`, { n: items.length })}</summary>
        <div className="af-tbl">
          <table className="af-like-table">
            <thead>
              <tr>
                <th scope="col">{t(`${k}.colItem`)}</th>
                <th scope="col">{t(`${k}.colSame`, { n: fmtCount(n) })}</th>
                <th scope="col">{t(`${k}.colNear`)}</th>
                <th scope="col">{t(`${k}.colPool`)}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((it) => {
                const r = rates[it.key];
                const used = inDistance(it, exhibitionStage);
                return (
                  <tr key={it.key}>
                    <td>
                      {label(it.key)}
                      {!used && (
                        <small className="af-muted"> {t(`${k}.notUsed`)}</small>
                      )}
                      <small>
                        {t(`${k}.todayValue`, {
                          v: itemValue(it.key, today, t),
                        })}
                      </small>
                      <small className="af-muted">
                        {t(`${k}.items.${it.key}.same`)}
                      </small>
                    </td>
                    <td>
                      {r.rate === null || it.noDistance ? (
                        "—"
                      ) : (
                        <>
                          {fmtPct(r.rate)} <small>{`${r.same}/${r.n}`}</small>
                        </>
                      )}
                    </td>
                    <td>
                      {r.nearRate === null || it.noDistance
                        ? "—"
                        : fmtPct(r.nearRate)}
                    </td>
                    <td>
                      {/* 展示で決まる項目（天候・風・波・展示タイムの差）の割合は、朝のバッチが展示前に数えるので今日の
                          値が無く 0 になる。展示後の段が数え直した応答（pool_rate_exhibition）のときだけ出す
                          （ファン評価4周目、2026-10-07） */}
                      {poolRate?.[it.key] === undefined ||
                      (it.exhibition && !poolRateExhibition)
                        ? "—"
                        : fmtPct(poolRate[it.key])}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </details>
  );
}
