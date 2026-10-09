import { useTranslation } from "react-i18next";
import BoatBadge from "../BoatBadge";
import { comboLabel, venueLabel } from "../../../utils/analogyFormat";
import { parseScopeKey, scopeKind } from "../../../utils/analogyFacts";

const k = "aiPredictionTab.analogy.facts";

/**
 * 「同じ級別の組み合わせ」が何をそろえているかの絵と1文（承認モック sonar-tab v3、2026-10-08 ユーザー決定）。
 * 範囲キーがそろえているのは、6艇の級別ごとの艇数（艇番は問わない）と、選んだ艇の級別だけ
 * （scripts/ml/analogy/v16_defs.py の class_combo・scope_keys）。どの枠に誰がいたかまでは合わせていないので、
 * 選んだ艇の枠だけ級別を描き、ほかの5枠は「問わない」と描く。会場の全レース（VA）は級別をそろえていないので1文だけ、
 * G1（VG）・全国の全レース（NA）は何も出さない
 * @param {{scopeKey: string}} props
 */
export default function ScopeCombo({ scopeKey }) {
  const { t } = useTranslation();
  const kind = scopeKind(scopeKey);
  const s = parseScopeKey(scopeKey);
  // 全レース系のうち説明文があるのは会場の全レース（VA）だけ。G1（VG）・全国の全レース（NA）は札の名前で足りる
  if (kind === "VG" || kind === "NA") return null;
  if (kind !== "VC" && kind !== "NC" && kind !== "NCR")
    return (
      <p className="af-sub">
        {t(`${k}.scopeDesc.${kind}`, {
          venue: venueLabel(s.venue, t),
          boat: s.boat,
        })}
      </p>
    );
  const c = comboLabel(s.combo, t);
  const round =
    kind === "NCR"
      ? t(`${k}.comboRound`, {
          round: t(`aiPredictionTab.analogy.rounds.${s.round}`),
        })
      : "";
  return (
    <div className="af-combo" data-testid="analogy-scope-combo">
      {!c.uniform && (
        <div className="af-combo-lanes" aria-hidden="true">
          {[1, 2, 3, 4, 5, 6].map((b) => (
            <span key={b} className="af-combo-lane">
              <BoatBadge n={b} size="xs" />
              <span className={b === s.boat ? "is-fixed" : "is-free"}>
                {b === s.boat ? s.cls : t(`${k}.comboFree`)}
              </span>
            </span>
          ))}
        </div>
      )}
      <p className="af-combo-text">
        {c.uniform
          ? t(`${k}.comboUniform`, { combo: c.text, round })
          : t(`${k}.comboSentence`, {
              combo: c.text,
              boat: s.boat,
              cls: s.cls,
              round,
            })}
      </p>
    </div>
  );
}
