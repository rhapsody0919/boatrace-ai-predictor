import { useTranslation } from "react-i18next";
import BoatBadge from "../BoatBadge";
import { BOAT_COLORS } from "../../../utils/colors";
import { SCOPE_FLOW, SCOPE_SUBTEXT } from "./analogyColors";
import { CX, CY, R, ang } from "./SimilarSonarGeometry";
import { fmtDate, fmtCount, venueLabel } from "../../../utils/analogyFormat";

/** 輪のラベルを置く向き（1号艇と2号艇の扇の境目の線上。点が一番集まる1号艇の扇の中に置かない） */
const LABEL_ANGLE = (-60 * Math.PI) / 180;
const BOATS = [1, 2, 3, 4, 5, 6];
const K = "aiPredictionTab.analogy.similar";

const raceInfo = (x, t) =>
  [
    `${fmtDate(x.date)} ${venueLabel(x.venue_code, t)}${x.race_number}R`,
    x.grade ? t(`aiPredictionTab.analogy.grades.${x.grade}`, x.grade) : null,
    x.round ? t(`aiPredictionTab.analogy.outlook.roundNames.${x.round}`) : null,
  ]
    .filter(Boolean)
    .join(" ");

function SonarResult({ x }) {
  const { t } = useTranslation();
  return (
    <>
      <span className="af-bnrow">
        {(x.finish ?? []).map((b, i) => (
          <BoatBadge key={i} n={b} size="xs" />
        ))}
      </span>{" "}
      {x.technique
        ? t(`aiPredictionTab.analogy.techniques.${x.technique}`, x.technique)
        : ""}
      {x.payout_3tan
        ? `\u3000${t(`${K}.payout`, { yen: x.payout_3tan.toLocaleString("ja-JP") })}`
        : ""}
    </>
  );
}

/** 1着の艇ごとの扇（押せる） */
export function SonarSectors({ selectedBoat, counts, onBoat }) {
  const { t } = useTranslation();
  return BOATS.map((b) => {
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
        aria-label={t(`${K}.sector`, { b, n: fmtCount(counts[b - 1]) })}
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
  });
}

export function SonarRings({ rings, n, rOf }) {
  return (
    <>
      {rings.map((r) => (
        <circle
          key={`r${r}`}
          cx={CX}
          cy={CY}
          r={rOf(r)}
          fill="none"
          stroke="#c9a227"
          strokeOpacity="0.45"
          pointerEvents="none"
        />
      ))}
      <circle
        cx={CX}
        cy={CY}
        r={rOf(n)}
        fill="none"
        stroke="#c9a227"
        strokeOpacity="0.7"
        pointerEvents="none"
      />
    </>
  );
}

export function SonarDots({ pts, picked, first, pickedIds, dotR }) {
  const { t } = useTranslation();
  const pointLabel = (x) =>
    t(`${K}.point`, {
      date: fmtDate(x.date),
      venue: venueLabel(x.venue_code, t),
      r: x.race_number,
      b: x.finish?.[0],
    });
  return pts.map(({ x, b, cx, cy }) => {
    const hl = picked === x.race_id || first === x.race_id;
    const sub = !hl && pickedIds.has(x.race_id);
    return (
      <circle
        key={x.race_id}
        cx={cx.toFixed(1)}
        cy={cy.toFixed(1)}
        r={hl ? 6 : sub ? 4.6 : dotR}
        fill={SCOPE_FLOW[b]}
        stroke={hl || sub ? "#fff" : "#0d1b2e"}
        strokeWidth={hl ? 2.5 : sub ? 1.5 : 0.8}
        pointerEvents="none"
        aria-label={pointLabel(x)}
      />
    );
  });
}

/** タップで拾った範囲の輪と、長押し中に満ちる輪 */
export function SonarOverlays({ picks, press }) {
  return (
    <>
      {picks && (
        <circle
          cx={picks.x}
          cy={picks.y}
          r={picks.r}
          fill="rgba(232,208,137,.12)"
          stroke={SCOPE_SUBTEXT}
          strokeDasharray="3 3"
          pointerEvents="none"
        />
      )}
      {press && (
        <circle
          className="af-sonar-press"
          cx={press.x}
          cy={press.y}
          r={press.r}
          fill="none"
          stroke="#f3ead0"
          strokeWidth="3"
          pathLength="100"
          strokeDasharray="100"
          strokeDashoffset="100"
          pointerEvents="none"
        />
      )}
    </>
  );
}

/** 輪の目安。1号艇と2号艇の扇の境目の線上に、縁取りを付けて置く（点の上でも読める） */
export function SonarRingLabels({ rings, n, rOf }) {
  const { t } = useTranslation();
  return [...rings, n].map((r) => (
    <text
      key={`l${r}`}
      x={CX + rOf(r) * Math.cos(LABEL_ANGLE) + 4}
      y={CY + rOf(r) * Math.sin(LABEL_ANGLE) - 3}
      fill={r === n ? "#f3ead0" : SCOPE_SUBTEXT}
      fontSize="14"
      fontWeight={r === n ? 700 : 400}
      paintOrder="stroke"
      stroke="#0d1b2e"
      strokeWidth="3.5"
      pointerEvents="none"
    >
      {t(`${K}.ring`, { n: fmtCount(r) })}
    </text>
  ));
}

export function SonarBoatButtons({ onBoat, closeTip }) {
  return BOATS.map((b) => {
    const a = (ang(b) * Math.PI) / 180;
    const x = CX + (R + 18) * Math.cos(a);
    const y = CY + (R + 18) * Math.sin(a);
    // 図の外の艇番も押せる（点が密な扇は、扇を押しても点のタップになるため）。
    // 読み上げ・キーボードは扇の role="button" が受け持つので、ここは指・マウスだけ
    return (
      <g
        key={`b${b}`}
        style={{ cursor: "pointer" }}
        onClick={(e) => {
          e.stopPropagation();
          closeTip();
          onBoat(b);
        }}
        data-af-control="similar_boat"
        data-af-toggle
        data-af-tap
        data-testid={`analogy-sonar-boat-${b}`}
      >
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
  });
}

export function SonarSweep() {
  return (
    <>
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
      <circle cx={CX} cy={CY} r="6" fill={SCOPE_SUBTEXT} pointerEvents="none" />
    </>
  );
}

export function SonarTip({ tip }) {
  const { t } = useTranslation();
  return (
    <div
      className="af-sonar-tip"
      role="status"
      style={{ left: tip.left, top: tip.top }}
      data-testid="analogy-sonar-tip"
    >
      <b>{t(`${K}.tipRank`, { n: tip.p.rank })}</b>
      <br />
      {raceInfo(tip.p.x, t)}
      <br />
      <SonarResult x={tip.p.x} />
    </div>
  );
}

/** 図の下（PC は右）に並べる、拾った点の行 */
export function SonarPicks({ picks, first, onPick }) {
  const { t } = useTranslation();
  if (!picks) return <p className="af-sub">{t(`${K}.picksEmpty`)}</p>;
  return (
    <>
      {picks.list.length > 1 && (
        <p className="af-sub">
          {t(`${K}.picksLede`, { n: picks.list.length })}
        </p>
      )}
      {[...picks.list]
        .sort((a, b) => a.rank - b.rank)
        .map((p) => (
          <div
            key={p.x.race_id}
            className={`af-sonar-pick${p.x.race_id === first ? " is-first" : ""}`}
            data-testid="analogy-sonar-pick"
          >
            <span className="af-sonar-pick-rank">
              {t(`${K}.ring`, { n: p.rank })}
            </span>
            <span className="af-sonar-pick-race">{raceInfo(p.x, t)}</span>
            <button
              type="button"
              className="af-btn"
              data-af-control="similar_point_open"
              onClick={() => onPick(p.x.race_id)}
            >
              {t(`${K}.pickCompare`)}
            </button>
            <span className="af-sonar-pick-res">
              <SonarResult x={p.x} />
            </span>
          </div>
        ))}
    </>
  );
}
