import { useTranslation } from "react-i18next";
import { roundToTotal } from "../../../utils/analogyContribution";

/**
 * テーマを押したときの内訳（BOA-271 FR-1）。似た意味の項目（勝率と2連率、その差・順位など）は
 * 学習側でまとめてある（scripts/ml/analogy/themes.py の groups）。多重共線性で個別の値は揺れるので、
 * 参考である旨を添える。棒の長さは全テーマ合計に対する割合（親のテーマの棒と同じ目盛り）。
 * 表示する % は合計が親の %（parentPct）になるように丸める
 */
export default function ContributionBreakdown({
  id,
  themeKey,
  groups,
  items,
  parentPct,
}) {
  const { t } = useTranslation();
  const byKey = new Map((items || []).map((g) => [g.key, g.share]));
  const pcts = roundToTotal(
    groups.map((g) => byKey.get(g.key) ?? 0),
    parentPct,
  );
  return (
    <div className="af-breakdown" id={id}>
      <ul className="af-breakdown-list">
        {groups.map((g, i) => {
          const share = byKey.get(g.key) ?? 0;
          return (
            <li key={g.key} className="af-breakdown-row">
              <span className="af-breakdown-name">
                {t(`aiPredictionTab.analogy.groups.${themeKey}.${g.key}`, {
                  defaultValue: g.label,
                })}
              </span>
              <span
                className="af-bar-track af-bar-track-sub"
                aria-hidden="true"
              >
                <span
                  className="af-bar-fill af-bar-fill-sub"
                  style={{ width: `${share * 100}%` }}
                />
              </span>
              <span className="af-breakdown-value">{pcts[i]}%</span>
            </li>
          );
        })}
      </ul>
      <p className="af-note">{t("aiPredictionTab.analogy.breakdownNote")}</p>
    </div>
  );
}
