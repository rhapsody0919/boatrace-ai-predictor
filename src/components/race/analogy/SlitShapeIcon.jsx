import { useId } from "react";
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../../utils/colors";

/**
 * スリット通過の並び（横から見た図、1艇身≒0.13秒の実縮尺。BOA-635 の SlitScene と同じ描き方。BOA-635 と共用できる形）
 * @param {{st: (number|null)[], height?: number, reference?: (number|null)[]|null, refLabel?: string|null}} props
 *   st・reference はコース順の ST（秒）。reference は点線（会場のそのコースの全選手の平均）。
 *   refLabel を渡すと、図の上に点線の意味と「早い →」を描き込む（今日のスタートの手がかり。承認モック sonar-tab v3）
 */
export default function SlitShapeIcon({
  st,
  height = 110,
  reference = null,
  refLabel = null,
}) {
  const { t } = useTranslation();
  const gid = useId().replace(/:/g, "");
  const n = st.length;
  const W = 260;
  const H = height;
  const top = refLabel ? 18 : 4;
  const lane = (H - top - 14) / n;
  const L = 64;
  const lineX = W - 14;
  const SPB = 0.13;
  const ok = [...st, ...(reference ?? [])].filter(
    (v) => v !== null && v !== undefined,
  );
  const mn = ok.length ? Math.min(...ok) : 0;
  const xOf = (v) => lineX - ((v - mn) / SPB) * L;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={t("aiPredictionTab.analogy.scenario.slitAria")}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1d4f73" />
          <stop offset="1" stopColor="#123a57" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${gid})`} />
      {st.map((_, i) => (
        <path
          key={`w${i}`}
          d={`M0 ${top + lane * (i + 1)} q20 -2 40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0`}
          stroke="#ffffff"
          strokeOpacity=".18"
          fill="none"
        />
      ))}
      <line
        x1={lineX}
        y1="0"
        x2={lineX}
        y2={H}
        stroke="#ff8a3d"
        strokeWidth="1.8"
      />
      <text
        x={lineX - 4}
        y={H - 4}
        fontSize="12"
        textAnchor="end"
        fill="#ffd2b0"
      >
        {t("aiPredictionTab.analogy.scenario.slitLine")}
      </text>
      {st.map((v, i) => {
        if (v === null || v === undefined) return null;
        const x = xOf(v);
        const y = top + lane * i + lane / 2;
        const hh = Math.max(3, lane * 0.32);
        const col = BOAT_COLORS[i + 1].bg;
        return (
          <g key={`b${i}`}>
            <path
              d={`M${x - L} ${y - hh} L${x - L * 0.22} ${y - hh} Q${x} ${y - hh * 0.4} ${x} ${y} Q${x} ${y + hh * 0.4} ${x - L * 0.22} ${y + hh} L${x - L} ${y + hh} Z`}
              fill="#f4f1ea"
              stroke="#556070"
              strokeWidth=".8"
            />
            <rect
              x={x - L * 0.62}
              y={y - hh * 0.75}
              width={L * 0.22}
              height={hh * 1.5}
              rx={hh * 0.5}
              fill={col}
              stroke="#1f2937"
              strokeWidth=".6"
            />
            <circle
              cx={x - L * 0.38}
              cy={y}
              r={hh * 0.72}
              fill={col}
              stroke="#1f2937"
              strokeWidth=".6"
            />
            <text
              x={x - L + 7}
              y={y + 3.5}
              fontSize={Math.min(10, lane * 0.6)}
              fontWeight="700"
              fill="#1f2937"
            >
              {i + 1}
            </text>
          </g>
        );
      })}
      {(reference ?? []).map((v, i) => {
        if (v === null || v === undefined) return null;
        const x = xOf(v);
        const y = top + lane * i + lane / 2;
        return (
          <line
            key={`r${i}`}
            x1={x}
            y1={y - lane * 0.48}
            x2={x}
            y2={y + lane * 0.48}
            stroke="#e8d089"
            strokeWidth="1.8"
            strokeDasharray="3 2"
          />
        );
      })}
      {refLabel && (
        <g pointerEvents="none">
          <line
            x1="8"
            y1="7"
            x2="8"
            y2="15"
            stroke="#e8d089"
            strokeWidth="1.8"
            strokeDasharray="3 2"
          />
          <text x="13" y="14" fontSize="11" fill="#e8d089">
            {t("aiPredictionTab.analogy.scenario.slitRefLegend", {
              name: refLabel,
            })}
          </text>
          <text
            x={lineX - 4}
            y="14"
            fontSize="11"
            fontWeight="700"
            textAnchor="end"
            fill="#ffd2b0"
          >
            {t("aiPredictionTab.analogy.scenario.slitFaster")}
          </text>
        </g>
      )}
      <g>
        <line
          x1="12"
          y1={H - 6}
          x2={12 + L}
          y2={H - 6}
          stroke="#e8f1ff"
          strokeWidth="1.2"
        />
        <line x1="12" y1={H - 9} x2="12" y2={H - 3} stroke="#e8f1ff" />
        <line x1={12 + L} y1={H - 9} x2={12 + L} y2={H - 3} stroke="#e8f1ff" />
        <text x={16 + L} y={H - 3} fontSize="12" fill="#e8f1ff">
          {t("aiPredictionTab.analogy.scenario.slitScale")}
        </text>
      </g>
    </svg>
  );
}
