import { useTranslation } from "react-i18next";
import BoatBadge from "../BoatBadge";

/** 艇番2つの寄与度の比較表（BOA-271 FR-1）。チャートには数値を置かず、ここで出す */
export default function BoatCompareTable({
  themes,
  boatA,
  boatB,
  sharesA,
  sharesB,
}) {
  const { t } = useTranslation();
  const pct = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
  return (
    <table className="af-compare-table">
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
        {themes.map((theme) => (
          <tr key={theme.key}>
            <td>
              {t(`aiPredictionTab.analogy.themes.${theme.key}.name`, {
                defaultValue: theme.name,
              })}
            </td>
            <td className="af-compare-value">{pct(sharesA?.[theme.key])}</td>
            <td className="af-compare-value">{pct(sharesB?.[theme.key])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
