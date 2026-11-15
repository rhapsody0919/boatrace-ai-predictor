import { useTranslation } from "react-i18next";
import ScenarioFold from "./ScenarioFold";
import { Row, TrifectaBandBreakdown } from "./TrifectaListParts";
import {
  TOP_TRIFECTA,
  bandBreakdown,
  trifectaList,
} from "../../../utils/analogyAggregate";

/**
 * よく出た3連単（上位3つ＋残りは畳む。spec B-8・C-5）
 * @param {{tri: Record<string, number>, first?: number|null, not1?: boolean, band?: object|null,
 *   onPick?: (combo: number[]) => void, picked?: string|null, onBandRaces?: () => void, bandPicked?: boolean}} props
 *   band は着順の流れで押した帯（bandBreakdown）。押していればその帯の内訳だけを出す。
 *   onPick があれば行の件数を札にして押せる（押すとその出目の元のレース。BOA-823）。onBandRaces があれば、
 *   帯の内訳の一番下に「この帯のレースを見る」
 */
export default function TrifectaList({
  tri,
  first = null,
  not1 = false,
  band = null,
  scenario = false,
  onPick,
  picked = null,
  onBandRaces,
  bandPicked = false,
}) {
  const { t } = useTranslation();
  // 着順の流れの帯を押していれば、その帯に入る3連単だけを全部（BOA-816、ユーザー決定の案1）
  const bd = bandBreakdown(tri, band, { first, not1 });
  const all = trifectaList(tri, { first, not1 });
  const total = all.reduce((s, [, c]) => s + c, 0);
  if (bd) {
    return (
      <TrifectaBandBreakdown
        bd={bd}
        band={band}
        total={total}
        onPick={onPick}
        picked={picked}
        onBandRaces={onBandRaces}
        bandPicked={bandPicked}
      />
    );
  }
  if (!all.length)
    return (
      <p className="af-foot">{t("aiPredictionTab.analogy.similar.none")}</p>
    );
  // 棒の長さは全体に対する割合（全幅＝100%）。見えなくならない最小の幅だけ付ける
  const row = ([combo, c]) => (
    <Row
      key={combo.join("-")}
      combo={combo}
      count={c}
      total={total}
      max={total}
      minPct={2}
      onPick={onPick}
      picked={picked === combo.join("-")}
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
