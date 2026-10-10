import { useId } from "react";
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../utils/colors";
import { formationStText } from "./startFormation";

const W = 351;
const H = 232;
const TOP = 22;
// 1艇身≒0.13秒。龍神ソナーのスリットの形の絵（SlitShapeIcon）と同じ実縮尺
const SPB = 0.13;
const L = 58;
const LINE_X = W - 56;
// 遅い艇でも左の札（コース・艇番・「前付け」の札の右端 110）に重ならない位置で止める。艇の長さは40なので
// 舳先は 154 以上（ST 約0.32秒より遅い艇はここで止まる。桐生 2026-09-25 1R の 0.33 が前付けの札に重なった）
const MIN_X = 154;
// 艇の右に置く数字（「F.04」「0.15 最速」）の幅の目安
const LABEL_W = 44;

/**
 * レース結果のスタート隊形（BOA-811、承認モック docs/design/race-result-start-formation/mock）。
 * 横から見たスリット通過の並び。上が1コース、右のスリット線に近いほど早い。F は線の先に赤、出遅れは点線の艇、
 * 欠場は一番下の行に薄く。水面の色は SlitShapeIcon と同じ固定の色（ダークモードでも変えない）
 * @param {{rows: ReturnType<import("./startFormation").startFormationRows>}} props
 */
export default function RaceStartFormation({ rows }) {
  const { t } = useTranslation();
  const gid = useId().replace(/:/g, "");
  const lane = (H - TOP - 26) / Math.max(rows.length, 6);
  const k = "result.startFormation";
  return (
    <section className="rr-formation" aria-labelledby={`${gid}-h`}>
      <h5 className="rr-formation-title" id={`${gid}-h`}>
        {t(`${k}.title`)}
      </h5>
      <p className="rr-note rr-formation-caption">{t(`${k}.caption`)}</p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="rr-formation-svg"
        role="img"
        aria-label={t(`${k}.aria`)}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1d4f73" />
            <stop offset="1" stopColor="#123a57" />
          </linearGradient>
        </defs>
        <rect width={W} height={H} rx="8" fill={`url(#${gid})`} />
        <text x={LINE_X} y="14" className="rr-fm-faint" textAnchor="middle">
          {t(`${k}.slit`)}
        </text>
        <text x={W - 6} y="14" className="rr-fm-faint" textAnchor="end">
          {t(`${k}.flyingSide`)}
        </text>
        <text x="74" y="14" className="rr-fm-faint">
          {t(`${k}.slower`)}
        </text>
        {rows.slice(1).map((_, i) => (
          <line
            key={`l${i}`}
            x1="70"
            x2={W}
            y1={TOP + lane * (i + 1)}
            y2={TOP + lane * (i + 1)}
            stroke="#ffffff"
            strokeOpacity=".12"
          />
        ))}
        <line
          className="rr-fm-slit"
          x1={LINE_X}
          x2={LINE_X}
          y1={TOP - 2}
          y2={H - 22}
          stroke="#ffffff"
          strokeWidth="2"
          strokeDasharray="4 3"
        />
        {rows.map((r, i) => {
          const y = TOP + lane * i + lane / 2;
          const color = BOAT_COLORS[r.boat] || BOAT_COLORS[1];
          const badge = (
            <>
              <rect
                x="48"
                y={y - 9}
                width="18"
                height="18"
                rx="3"
                fill={color.bg}
                fillOpacity={r.absent ? 0.45 : 1}
                stroke="#ffffff"
                strokeOpacity=".5"
              />
              <text
                x="57"
                y={y + 4}
                fill={color.text}
                fillOpacity={r.absent ? 0.6 : 1}
                className="rr-fm-badge"
                textAnchor="middle"
              >
                {r.boat}
              </text>
            </>
          );
          if (r.absent)
            return (
              <g key={r.boat} data-boat={r.boat} data-absent="true">
                <text x="4" y={y + 4} className="rr-fm-label rr-fm-dim">
                  {t(`${k}.absentLabel`)}
                </text>
                {badge}
                <text x="74" y={y + 4} className="rr-fm-label rr-fm-dim">
                  {t(`${k}.absent`, { boat: r.boat })}
                </text>
              </g>
            );
          const hullAt = (x) => `M${x} ${y} l-22 -6 l-18 0 l0 12 l18 0 z`;
          return (
            <g
              key={r.boat}
              data-boat={r.boat}
              data-course={r.course}
              data-mae={r.mae ? "true" : undefined}
            >
              <text x="4" y={y + 4} className="rr-fm-label">
                {t(`${k}.course`, { course: r.course })}
              </text>
              {badge}
              {r.mae && (
                <>
                  <rect
                    x="70"
                    y={y - 8}
                    width="40"
                    height="16"
                    rx="8"
                    fill="#ffd27a"
                  />
                  <text
                    x="90"
                    y={y + 4}
                    className="rr-fm-mae"
                    textAnchor="middle"
                  >
                    {t(`${k}.mae`)}
                  </text>
                </>
              )}
              {r.late || r.st == null ? (
                <>
                  <path
                    d={hullAt(MIN_X)}
                    fill="none"
                    stroke="#cfd8dc"
                    strokeDasharray="3 2"
                    strokeWidth="1.5"
                  />
                  <text x={MIN_X + 6} y={y + 4} className="rr-fm-st rr-fm-late">
                    {t(`${k}.late`)}
                  </text>
                </>
              ) : (
                (() => {
                  // 遅い艇は左の札の手前で、大きな F（浜名湖 2026-09-14 6R の F.11）は絵の右端の手前で止める
                  const x = Math.min(
                    W - 4,
                    Math.max(
                      MIN_X,
                      LINE_X - ((r.flying ? -r.st : r.st) / SPB) * L,
                    ),
                  );
                  return (
                    <>
                      <path
                        className="rr-fm-hull"
                        d={hullAt(x)}
                        fill={color.bg}
                        stroke={r.flying ? "#ff6b6b" : "#ffffff"}
                        strokeWidth={r.flying ? 2.5 : 1}
                        strokeOpacity={r.flying ? 1 : 0.6}
                      />
                      {/* 数字は艇の右。右に収まらない大きな F だけ艇の左に置く */}
                      <text
                        x={x + LABEL_W > W ? x - 47 : x + 4}
                        y={y + 4}
                        textAnchor={x + LABEL_W > W ? "end" : undefined}
                        className={`rr-fm-st${r.flying ? " rr-fm-flying" : ""}`}
                      >
                        {formationStText(r.st, r.flying)}
                        {r.fastest ? ` ${t("result.fastestStartTag")}` : ""}
                      </text>
                    </>
                  );
                })()
              )}
            </g>
          );
        })}
        <g className="rr-fm-scale">
          <line x1={LINE_X - L} x2={LINE_X} y1={H - 14} y2={H - 14} />
          <line x1={LINE_X - L} x2={LINE_X - L} y1={H - 18} y2={H - 10} />
          <line x1={LINE_X} x2={LINE_X} y1={H - 18} y2={H - 10} />
          <text x={LINE_X - L - 6} y={H - 10} textAnchor="end">
            {t(`${k}.scale`)}
          </text>
        </g>
      </svg>
    </section>
  );
}
