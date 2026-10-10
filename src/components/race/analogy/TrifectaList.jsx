import { useTranslation } from "react-i18next";
import ScenarioFold from "./ScenarioFold";
import BoatBadge from "../BoatBadge";
import { fmtCount, fmtPct } from "../../../utils/analogyFormat";
import {
  TOP_TRIFECTA,
  bandBreakdown,
  trifectaList,
} from "../../../utils/analogyAggregate";
import { SCOPE_FLOW } from "./analogyColors";

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
 * @param {{tri: Record<string, number>, first?: number|null, not1?: boolean, band?: object|null}} props
 *   band は着順の流れで押した帯（bandBreakdown）。押していればその帯の内訳だけを出す
 */
export default function TrifectaList({
  tri,
  first = null,
  not1 = false,
  band = null,
  scenario = false,
}) {
  const { t } = useTranslation();
  // 着順の流れの帯を押していれば、その帯に入る3連単だけを全部（BOA-816、ユーザー決定の案1）
  const bd = bandBreakdown(tri, band, { first, not1 });
  const all = trifectaList(tri, { first, not1 });
  const total = all.reduce((s, [, c]) => s + c, 0);
  if (bd) {
    // 各行は帯を押す前の一覧と同じ「全体の割合・件数」。帯の中の大きさは棒の長さで見せ、
    // 帯が全体のどれくらいかは見出しに1回だけ（2026-10-10 ファンパネル案C、ユーザー決定）
    const max = bd.rows[0][1];
    return (
      <div className="af-tri-band" data-testid="analogy-band-breakdown">
        <p className="af-tri-band-h">
          <i
            className="af-tri-band-sw"
            style={{ background: SCOPE_FLOW[band.a] }}
            aria-hidden="true"
          />
          {t("aiPredictionTab.analogy.flow.breakdown", {
            from: band.p + 1,
            a: band.a,
            to: band.p + 2,
            b: band.b,
            n: fmtCount(bd.total),
            p: fmtPct(bd.total / total),
          })}
        </p>
        <p className="af-foot">
          {t("aiPredictionTab.analogy.flow.breakdownBack")}
        </p>
        <div className="af-bars">
          {bd.rows.map(([combo, c]) => (
            <Row
              key={combo.join("-")}
              combo={combo}
              count={c}
              total={total}
              max={max}
            />
          ))}
        </div>
      </div>
    );
  }
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
