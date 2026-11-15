import { useTranslation } from "react-i18next";
import BoatBadge from "../BoatBadge";
import { fmtCount, fmtPct } from "../../../utils/analogyFormat";
import { SCOPE_FLOW } from "./analogyColors";

export function Row({
  combo,
  count,
  total,
  max,
  onPick,
  picked = false,
  minPct = 0,
}) {
  const { t } = useTranslation();
  const body = (
    <>
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
          style={{ width: `${Math.max((count / max) * 100, minPct)}%` }}
        />
      </span>
      <span className="af-bar-v">
        {fmtPct(count / total, 1)}{" "}
        {onPick ? (
          // 件数の札: 押すとこの出目の元のレースが下に開く（BOA-823）
          <span className="af-cnt-chip">
            {t("aiPredictionTab.analogy.count", { n: fmtCount(count) })} ›
          </span>
        ) : (
          <small>
            {t("aiPredictionTab.analogy.count", { n: fmtCount(count) })}
          </small>
        )}
      </span>
    </>
  );
  return onPick ? (
    <button
      type="button"
      className={`af-bar${picked ? " is-selected" : ""}`}
      aria-pressed={picked}
      data-af-control="scenario_races_tri"
      onClick={() => onPick(combo)}
    >
      {body}
    </button>
  ) : (
    <div className="af-bar">{body}</div>
  );
}

/** 着順の流れの帯を押したときの、その帯に入る3連単の内訳 */
export function TrifectaBandBreakdown({
  bd,
  band,
  total,
  onPick,
  picked,
  onBandRaces,
  bandPicked,
}) {
  const { t } = useTranslation();
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
            onPick={onPick}
            picked={picked === combo.join("-")}
          />
        ))}
      </div>
      {onBandRaces && (
        <button
          type="button"
          className="af-rl-band"
          aria-pressed={bandPicked}
          data-af-control="scenario_races_band"
          onClick={onBandRaces}
        >
          {t("aiPredictionTab.analogy.scenario.races.bandLink")}
        </button>
      )}
    </div>
  );
}
