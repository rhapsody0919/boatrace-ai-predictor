import { useTranslation } from "react-i18next";
import BoatBadge from "../BoatBadge";
import { roundToTotal } from "../../../utils/analogyContribution";

/** 艇番2つの寄与度の比較表（BOA-271 FR-1）。チャートには数値を置かず、ここで出す */
export default function BoatCompareTable({
  themes,
  boatA,
  boatB,
  sharesA,
  sharesB,
}) {
  const { t } = useTranslation();
  // 列ごとに合計が100%になるように丸める。行が無い艇番は「—」
  const column = (shares) => {
    if (!shares) return themes.map(() => "—");
    const p = roundToTotal(
      themes.map((th) => shares[th.key] ?? 0),
      100,
    );
    return p.map((v) => `${v}%`);
  };
  const colA = column(sharesA);
  const colB = column(sharesB);
  return (
    <table className="af-compare-table">
      {/* 着順の率（3連対率など）と読み違えないよう、表が「効きの割合」であることを表の上に書く（ファン評価3周目） */}
      <caption className="af-compare-caption">
        {t("aiPredictionTab.analogy.compareCaption")}
      </caption>
      <thead>
        <tr>
          <th scope="col">{t("aiPredictionTab.analogy.themeColumn")}</th>
          {[boatA, boatB].map((b, i) => (
            <th scope="col" key={i} className={`af-compare-col-${i}`}>
              <BoatBadge n={b} size="sm" />
              <span className="af-compare-boat">
                {t("aiPredictionTab.analogy.boatLabel", { n: b })}
              </span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {themes.map((theme, i) => (
          <tr key={theme.key}>
            <td>
              {t(`aiPredictionTab.analogy.themes.${theme.key}.name`, {
                defaultValue: theme.name,
              })}
            </td>
            <td className="af-compare-value">{colA[i]}</td>
            <td className="af-compare-value">{colB[i]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
