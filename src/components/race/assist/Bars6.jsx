import BoatBadge from "../BoatBadge";
import { BOAT_LINE_COLORS } from "../../../utils/colors";

/**
 * 6艇の縦棒（承認モック v7 の bars6）。値は割合（0〜1）か、そのままの%（raw）。
 * 最良は金枠（.ind-best）だけで示し、隠し文字「（6艇で一番）」は付けない（図の数字と二重にしない。handoff §16）
 * @param {{values: Array<number|null>, raw?: boolean, best?: Set<number>|null, digits?: number}} props
 */
export default function Bars6({
  values,
  raw = false,
  best = null,
  digits = 0,
}) {
  const pcts = values.map((v) => (v == null ? null : raw ? v : v * 100));
  const max = Math.max(1, ...pcts.filter((p) => p != null));
  const text = (p) => (p == null ? "—" : `${p.toFixed(digits)}%`);
  return (
    <div
      className="ta-bars6"
      role="img"
      aria-label={pcts.map((p, i) => `${i + 1}号艇 ${text(p)}`).join("、")}
    >
      {pcts.map((p, i) => (
        <div key={i + 1} className="ta-bars6-col">
          <span
            className={`ta-num ta-bars6-val${best?.has(i + 1) ? " ind-best" : ""}`}
          >
            {text(p)}
          </span>
          <span
            className="ta-bars6-bar"
            style={{
              height: `${((p ?? 0) / max) * 100}%`,
              background: BOAT_LINE_COLORS[i + 1],
            }}
          />
          <BoatBadge n={i + 1} size="sm" />
        </div>
      ))}
    </div>
  );
}
