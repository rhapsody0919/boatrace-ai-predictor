import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import BoatBadge from "../BoatBadge";
import { BOAT_COLORS } from "../../../utils/colors";
import { SCOPE_FLOW, SCOPE_SUBTEXT } from "./analogyColors";
import { fmtDate, fmtCount, venueLabel } from "../../../utils/analogyFormat";

const CX = 220;
const CY = 220;
const R = 188;
const ang = (b) => -90 + (b - 1) * 60;

/**
 * ソナー（spec B-5。承認版モックの renderSonar と同じ描き方）。中心＝今日、点＝類似レース（似ている順の
 * 何番目かで中心からの距離）、扇＝1着の艇の方向。点はマウスを重ねる／長押しでレースの情報、押すと見比べる。
 * 扇を押すと「どの艇が勝った？」の棒と同じく、その艇で絞る
 * @param {{neighbors: object[], total: number, selectedBoat: number|null, onBoat: (b:number)=>void,
 *   picked: string|null, onPick: (raceId: string)=>void, todayLabel: string}} props
 */
export default function SimilarSonar({
  neighbors,
  total,
  selectedBoat,
  onBoat,
  picked,
  onPick,
  todayLabel,
}) {
  const { t } = useTranslation();
  const [tip, setTip] = useState(null);
  const box = useRef(null);
  const timer = useRef(null);
  const longPressed = useRef(false);
  useEffect(() => () => clearTimeout(timer.current), []);
  const lm = Math.min(total, 800);
  const lin = lm < 100;
  const rOf = (rk) =>
    lin
      ? 18 + ((R - 24) * Math.max(1, rk)) / lm
      : 18 + ((R - 24) * Math.log10(Math.max(1, rk))) / Math.log10(800);
  const rings = lin
    ? [...new Set([5, 10, lm].filter((x) => x <= lm))]
    : [10, 100, 800];
  const counts = [1, 2, 3, 4, 5, 6].map(
    (b) => neighbors.filter((x) => x.finish?.[0] === b).length,
  );
  const n = neighbors.length;
  const pointLabel = (x) =>
    t("aiPredictionTab.analogy.similar.point", {
      date: fmtDate(x.date),
      venue: venueLabel(x.venue_code, t),
      r: x.race_number,
      b: x.finish?.[0],
    });
  const show = (x, el) => {
    const br = box.current?.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    if (!br) return;
    setTip({
      x,
      left: Math.max(4, Math.min(br.width - 224, er.left - br.left - 100)),
      top: er.top - br.top + 14,
    });
  };
  return (
    <div className="af-dark af-sonar" ref={box}>
      <svg
        viewBox="0 0 440 440"
        role="group"
        aria-label={t("aiPredictionTab.analogy.similar.sonarLabel", {
          n: fmtCount(n),
        })}
        onPointerLeave={() => setTip(null)}
      >
        {[1, 2, 3, 4, 5, 6].map((b) => {
          const a0 = ((ang(b) - 30) * Math.PI) / 180;
          const a1 = ((ang(b) + 30) * Math.PI) / 180;
          return (
            <path
              key={`s${b}`}
              d={`M${CX},${CY}L${CX + R * Math.cos(a0)},${CY + R * Math.sin(a0)}A${R},${R} 0 0 1 ${CX + R * Math.cos(a1)},${CY + R * Math.sin(a1)}Z`}
              fill={SCOPE_FLOW[b]}
              fillOpacity={selectedBoat === b ? 0.16 : 0.05}
              stroke="#0d1b2e"
              role="button"
              tabIndex={0}
              aria-label={t("aiPredictionTab.analogy.similar.sector", {
                b,
                n: fmtCount(counts[b - 1]),
              })}
              aria-pressed={selectedBoat === b}
              data-af-control="similar_boat"
              data-af-toggle
              style={{ cursor: "pointer" }}
              onClick={() => onBoat(b)}
              onKeyDown={(e) =>
                (e.key === "Enter" || e.key === " ") &&
                (e.preventDefault(), onBoat(b))
              }
            />
          );
        })}
        {rings.map((r) => (
          <g key={`r${r}`} pointerEvents="none">
            <circle
              cx={CX}
              cy={CY}
              r={rOf(r)}
              fill="none"
              stroke="#c9a227"
              strokeOpacity={r <= n ? 0.45 : 0.18}
              strokeDasharray={r > n ? "3 4" : undefined}
            />
            <text
              x={CX + 4}
              y={CY - rOf(r) + 11}
              fill={SCOPE_SUBTEXT}
              fontSize="14"
              opacity="0.9"
            >
              {t("aiPredictionTab.analogy.similar.ring", { n: r })}
            </text>
          </g>
        ))}
        {neighbors.map((x, i) => {
          const b = x.finish?.[0];
          if (!b || b < 1 || b > 6) return null;
          const rank = i + 1;
          const frac = ((rank * 0.6180339) % 1) * 0.84 + 0.08;
          const a = ((ang(b) - 30 + 60 * frac) * Math.PI) / 180;
          const rr = rOf(rank);
          const hl = picked === x.race_id;
          return (
            <circle
              key={x.race_id}
              cx={(CX + rr * Math.cos(a)).toFixed(1)}
              cy={(CY + rr * Math.sin(a)).toFixed(1)}
              r={hl ? 6 : n > 300 ? 2.4 : n > 100 ? 3.2 : 4.2}
              fill={SCOPE_FLOW[b]}
              stroke={hl ? "#fff" : "#0d1b2e"}
              strokeWidth={hl ? 2.5 : 0.8}
              role="button"
              tabIndex={-1}
              aria-label={pointLabel(x)}
              style={{ cursor: "pointer" }}
              onMouseEnter={(e) => show({ ...x, rank }, e.currentTarget)}
              onPointerDown={(e) => {
                if (e.pointerType === "mouse") return;
                const el = e.currentTarget;
                clearTimeout(timer.current);
                timer.current = setTimeout(() => {
                  longPressed.current = true;
                  show({ ...x, rank }, el);
                }, 450);
              }}
              onPointerUp={() => clearTimeout(timer.current)}
              onContextMenu={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                if (longPressed.current) {
                  longPressed.current = false;
                  return;
                }
                onPick(x.race_id);
              }}
            />
          );
        })}
        {[1, 2, 3, 4, 5, 6].map((b) => {
          const a = (ang(b) * Math.PI) / 180;
          const x = CX + (R + 18) * Math.cos(a);
          const y = CY + (R + 18) * Math.sin(a);
          return (
            <g key={`b${b}`} pointerEvents="none">
              <rect
                x={x - 11}
                y={y - 11}
                width="22"
                height="22"
                rx="4"
                fill={BOAT_COLORS[b].bg}
                stroke="#94a3b8"
              />
              <text
                x={x}
                y={y + 5}
                textAnchor="middle"
                fontSize="13"
                fontWeight="700"
                fill={BOAT_COLORS[b].text}
              >
                {b}
              </text>
            </g>
          );
        })}
        {/* 回る線は飾り。1着の扇（押せる）と同じ形・色にすると特定の艇を指しているように見えるので、細い線にする（BOA-778） */}
        <g className="af-sweep" pointerEvents="none" aria-hidden="true">
          <line
            x1={CX}
            y1={CY}
            x2={CX + R}
            y2={CY}
            stroke={SCOPE_SUBTEXT}
            strokeOpacity=".35"
            strokeWidth="1"
          />
        </g>
        <circle
          cx={CX}
          cy={CY}
          r="6"
          fill={SCOPE_SUBTEXT}
          pointerEvents="none"
        />
      </svg>
      {tip && (
        <div className="af-sonar-tip" style={{ left: tip.left, top: tip.top }}>
          <b>
            {t("aiPredictionTab.analogy.similar.tipRank", { n: tip.x.rank })}
          </b>
          <br />
          {fmtDate(tip.x.date)} {venueLabel(tip.x.venue_code, t)}
          {tip.x.race_number}R{" "}
          {[
            tip.x.grade
              ? t(`aiPredictionTab.analogy.grades.${tip.x.grade}`, tip.x.grade)
              : null,
            tip.x.round
              ? t(`aiPredictionTab.analogy.outlook.roundNames.${tip.x.round}`)
              : null,
          ]
            .filter(Boolean)
            .join(" ")}
          <br />
          <span className="af-bnrow">
            {(tip.x.finish ?? []).map((b, i) => (
              <BoatBadge key={i} n={b} size="xs" />
            ))}
          </span>{" "}
          {tip.x.technique
            ? t(
                `aiPredictionTab.analogy.techniques.${tip.x.technique}`,
                tip.x.technique,
              )
            : ""}
          {tip.x.payout_3tan
            ? `\u3000${t("aiPredictionTab.analogy.similar.payout", { yen: tip.x.payout_3tan.toLocaleString("ja-JP") })}`
            : ""}
        </div>
      )}
      <div className="af-dark-cap">
        <span>{todayLabel}</span>
        <span>
          {t("aiPredictionTab.analogy.similar.shown", { n: fmtCount(n) })}
        </span>
      </div>
    </div>
  );
}
