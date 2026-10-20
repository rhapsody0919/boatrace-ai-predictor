/**
 * 全貌動画 場面2「6艇の重ね図」（試作）。材料 JSON（scripts/full-picture/scene2-data.mjs の出力）を流し込むと、
 * 決まった手順で描く。LLM・乱数・日時を使わない。
 *
 * 型（~/hq/drafts/full-picture-scene-contract.md）: 上帯 y0〜330 に問い／図 y340〜1420／答えの白い吹き出しは図の直下・
 * y1420 より上・x960 より左。押す操作は指＋波紋、強調はオレンジの四角枠。1拍に1つ（押す→変わる→0.5秒→枠→答え）。
 * 型と違う1点: 実画面の撮影ではなく、同じ中身をデータから描く（見た目はソナーの重ね図・カードに寄せる）。
 */
import {
  AbsoluteFill,
  Audio,
  interpolate,
  staticFile,
  useCurrentFrame,
  Easing,
} from "remotion";
import { FONT } from "../fonts.js";
import { fitHeadline } from "../textFit.js";
import {
  RADAR_LINE,
  RADAR_TEXT,
  SCOPE_DASH,
  SCOPE_GRID,
  SCOPE_SUBTEXT,
  SCOPE_TEXT,
} from "../../../../src/components/race/analogy/analogyColors.js";
import {
  ANSWER_AT,
  BEAT,
  CHANGE_END,
  FRAME_AT,
  PRESS_AT,
  beatAt,
  scene2Timeline,
} from "./scene2Timeline.js";

const W = 1080;
const H = 1920;
const BAND = 330;
const ORANGE = "#ff8a1f";
const BG_TOP = "#12233a";
const BG_BOTTOM = "#0a1424";
const MUTED = "#a9b8cc";
const MIN_TEXT = 36;

// 重ね図
const CX = 540;
const CY = 720;
const R = 210;
const fr = (rank) => (7 - rank) / 6;
const angle = (i, n) => -Math.PI / 2 + (2 * Math.PI * i) / n;
const pt = (i, n, f) => [
  CX + R * f * Math.cos(angle(i, n)),
  CY + R * f * Math.sin(angle(i, n)),
];
// 艇の札（押す所）
const CHIP_Y = 1112;
const CHIP_H = 92;
const CHIP_W = 150;
const chipX = (b) => 45 + (b - 1) * 170;
// 答えの吹き出し
const BUBBLE = { x: 60, y: 1236, w: 880 };
// カードの頁
const PAGE = 1920;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };
const ease = Easing.bezier(0.33, 1, 0.68, 1);

/** 文字幅（Chromium の実測。Remotion の描画は実ブラウザ内） */
let ctx = null;
function textWidth(text, size, weight = 700) {
  if (!ctx && typeof document !== "undefined")
    ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return text.length * size;
  ctx.font = `${weight} ${size}px ${FONT}`;
  return ctx.measureText(text).width;
}

/** 1行に収まる最大の大きさ。36px でも1行に収まらなければ2行にする */
function fit(text, maxWidth, maxFontSize, weight = 800, maxLines = 1) {
  const opts = {
    maxWidth,
    fontFamily: FONT,
    fontWeight: weight,
    maxFontSize,
    minFontSize: MIN_TEXT,
  };
  const one = fitHeadline(text, { ...opts, maxLines: 1 });
  if (maxLines === 1 || textWidth(text, one.fontSize, weight) <= maxWidth)
    return one;
  return fitHeadline(text, { ...opts, maxLines });
}

/** オレンジの四角枠（出るときに少し縮みながら現れる） */
function Frame({ box, t }) {
  if (!box || t <= 0) return null;
  const p = interpolate(t, [0, BEAT.frameIn], [0, 1], {
    ...clamp,
    easing: ease,
  });
  const pad = 14 + (1 - p) * 18;
  return (
    <div
      style={{
        position: "absolute",
        left: box.x - pad,
        top: box.y - pad,
        width: box.w + pad * 2,
        height: box.h + pad * 2,
        border: `7px solid ${ORANGE}`,
        borderRadius: 14,
        opacity: p,
        boxShadow: `0 0 24px ${ORANGE}66`,
      }}
    />
  );
}

/** 指のアイコン＋波紋（Material Icons「touch_app」の形、Apache 2.0） */
function Finger({ x, y, t, from }) {
  if (t < 0) return null;
  const move = interpolate(t, [0, PRESS_AT], [0, 1], {
    ...clamp,
    easing: ease,
  });
  const fx = from.x + (x - from.x) * move;
  const fy = from.y + (y - from.y) * move;
  const press = interpolate(
    t,
    [PRESS_AT - 3, PRESS_AT, PRESS_AT + 4],
    [1, 0.86, 1],
    clamp,
  );
  const fade = interpolate(t, [FRAME_AT, FRAME_AT + 8], [1, 0], clamp);
  const rip = interpolate(t, [PRESS_AT, PRESS_AT + 16], [0, 1], clamp);
  const size = 120;
  return (
    <>
      {t >= PRESS_AT && rip < 1 && (
        <div
          style={{
            position: "absolute",
            left: x - 20 - rip * 70,
            top: y - 20 - rip * 70,
            width: 40 + rip * 140,
            height: 40 + rip * 140,
            borderRadius: "50%",
            border: "6px solid rgba(255,255,255,0.9)",
            opacity: 1 - rip,
          }}
        />
      )}
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        style={{
          position: "absolute",
          // 指先（11.5, 5 付近）を押す点に合わせる
          left: fx - size * (11.5 / 24),
          top: fy - size * (4 / 24),
          transform: `scale(${press})`,
          transformOrigin: "48% 17%",
          opacity: fade,
          filter: "drop-shadow(0 6px 10px rgba(0,0,0,0.55))",
        }}
      >
        <path
          fill="#ffffff"
          stroke="#0d1b2e"
          strokeWidth="0.6"
          d="M9 11.24V7.5C9 6.12 10.12 5 11.5 5S14 6.12 14 7.5v3.74c1.21-.81 2-2.18 2-3.74C16 5.01 13.99 3 11.5 3S7 5.01 7 7.5c0 1.56.79 2.93 2 3.74zm9.84 4.63l-4.54-2.26c-.17-.07-.35-.11-.54-.11H13v-6c0-.83-.67-1.5-1.5-1.5S10 6.67 10 7.5v10.74l-3.43-.72c-.08-.01-.15-.03-.24-.03-.31 0-.59.13-.79.33l-.79.8 4.94 4.94c.27.27.65.44 1.06.44h6.79c.75 0 1.33-.55 1.44-1.28l.75-5.27c.01-.07.02-.14.02-.2 0-.62-.38-1.16-.91-1.38z"
        />
      </svg>
    </>
  );
}

/** 答えの白い吹き出し（1〜2行） */
function Bubble({ lines, t, y = BUBBLE.y }) {
  if (!lines?.length || t < 0) return null;
  const p = interpolate(t, [0, 8], [0, 1], { ...clamp, easing: ease });
  const inner = BUBBLE.w - 64;
  const fitted = lines.map((l, i) =>
    fit(l, inner, i === 0 ? 46 : 40, i === 0 ? 800 : 700, 2),
  );
  return (
    <div
      style={{
        position: "absolute",
        left: BUBBLE.x,
        top: y + (1 - p) * 24,
        width: BUBBLE.w,
        background: "#ffffff",
        color: "#0d1b2e",
        borderRadius: 28,
        padding: "24px 32px",
        boxSizing: "border-box",
        opacity: p,
        boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 70,
          top: -22,
          width: 0,
          height: 0,
          borderLeft: "22px solid transparent",
          borderRight: "22px solid transparent",
          borderBottom: "24px solid #ffffff",
        }}
      />
      {fitted.map((f, i) =>
        f.lines.map((l, j) => (
          <div
            key={`${i}-${j}`}
            style={{
              fontSize: f.fontSize,
              fontWeight: i === 0 ? 800 : 700,
              lineHeight: 1.3,
              color: i === 0 ? "#0d1b2e" : "#33465f",
              whiteSpace: "nowrap",
            }}
          >
            {l}
          </div>
        )),
      )}
    </div>
  );
}

/** 艇番の札（公式の艇色） */
function BoatBadge({ b, size = 56 }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 10,
        background: RADAR_LINE[b],
        color: RADAR_TEXT[b],
        border: b === 2 ? "3px solid #ffffff" : "3px solid rgba(0,0,0,0.25)",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.max(MIN_TEXT, size * 0.68),
        fontWeight: 900,
      }}
    >
      {b}
    </div>
  );
}

/** 重ね図のそのフレームの状態（主役の艇・前の主役・切り替えの進み） */
function radarState(scene, beats, frame) {
  const beat = beatAt(beats, frame);
  const t = frame - beat.from;
  const focus = scene.radar.focus;
  if (beat.kind === "overview")
    return {
      lead: null,
      prev: null,
      p: 0,
      draw: interpolate(t, [0, 24], [0, 1], { ...clamp, easing: ease }),
    };
  if (beat.kind === "focus")
    return {
      lead: focus[beat.index].boat,
      prev: beat.index === 0 ? null : focus[beat.index - 1].boat,
      p: interpolate(t, [PRESS_AT, CHANGE_END], [0, 1], {
        ...clamp,
        easing: ease,
      }),
      draw: 1,
    };
  return {
    lead: focus[focus.length - 1]?.boat ?? null,
    prev: null,
    p: 1,
    draw: 1,
  };
}

/** 項目名（＋その艇の順位）の置き場所と箱 */
function axisLabel(i, n) {
  const dx = Math.cos(angle(i, n));
  const mid = Math.abs(dx) < 0.3;
  const [x, y] = pt(i, n, mid ? 1.45 : 1.2);
  const anchor = mid ? "middle" : dx > 0 ? "start" : "end";
  return { x, y, anchor };
}

function boxOfLabel(lab, name, sub) {
  const w = Math.max(
    textWidth(`${name} ▼`, 40, 800),
    textWidth(sub, MIN_TEXT, 600),
  );
  const left =
    lab.anchor === "middle"
      ? lab.x - w / 2
      : lab.anchor === "start"
        ? lab.x
        : lab.x - w;
  return { x: left, y: lab.y - 40, w, h: 92 };
}

function Radar({ scene, state }) {
  const { axes, boats } = scene.radar;
  const n = axes.length;
  const ring = (f) => axes.map((_, i) => pt(i, n, f).join(",")).join(" ");
  const { lead, prev, p, draw } = state;
  const emph = (b) => (b === lead ? p : 0) + (b === prev ? 1 - p : 0);
  // 6艇全体（主役なし）から1艇へ移るときだけ、ほかの艇を暗くする量が 0→1 で変わる
  const dim = lead === null ? 0 : prev === null ? p : 1;
  const order = [1, 2, 3, 4, 5, 6].sort((a, b) => emph(a) - emph(b));
  const subBoat = lead ?? null;
  const subOpacity = lead === null ? 0 : prev === null ? p : 1;
  const dashBoat = lead;
  const dash = dashBoat ? boats[dashBoat - 1].typical : null;
  return (
    <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0 }}>
      {[1, 2, 3, 4, 5, 6].map((r) => (
        <polygon
          key={r}
          points={ring(fr(r))}
          fill="none"
          stroke={`${SCOPE_GRID}${r === 1 ? 0.5 : 0.2})`}
          strokeWidth={2}
        />
      ))}
      {axes.map((_, i) => {
        const [x, y] = pt(i, n, 1);
        return (
          <line
            key={i}
            x1={CX}
            y1={CY}
            x2={x}
            y2={y}
            stroke={`${SCOPE_GRID}0.22)`}
            strokeWidth={2}
          />
        );
      })}
      {order.map((b) => {
        const e = emph(b);
        const ps = boats[b - 1].buckets
          .map((k, i) => (k ? pt(i, n, fr(k) * draw) : null))
          .filter(Boolean);
        if (ps.length < 2) return null;
        const pts = ps.map((q) => q.join(",")).join(" ");
        const w = 4.5 + 5 * e;
        const op = 0.85 * (1 - dim) + dim * (0.22 + 0.78 * e);
        const blur = dim * (1 - e) * 2.5;
        return (
          <g
            key={b}
            style={{ filter: blur > 0.05 ? `blur(${blur}px)` : undefined }}
            opacity={op}
          >
            {b === 2 && (
              <polygon
                points={pts}
                fill="none"
                stroke="#ffffff"
                strokeWidth={w + 4}
              />
            )}
            <polygon
              points={pts}
              fill={RADAR_LINE[b]}
              fillOpacity={(b <= 2 ? 0.14 : 0.24) * e}
              stroke={RADAR_LINE[b]}
              strokeWidth={w}
              strokeLinejoin="round"
            />
            {e > 0.5 &&
              ps.map(([px, py], i) => (
                <circle
                  key={i}
                  cx={px}
                  cy={py}
                  r={8}
                  fill={RADAR_LINE[b]}
                  stroke={b === 2 ? "#fff" : "#0d1b2e"}
                  strokeWidth={2.5}
                />
              ))}
          </g>
        );
      })}
      {dash && dash.some((v) => v !== null) && (
        <polygon
          points={dash
            .map((v, i) => (v === null ? null : pt(i, n, fr(v)).join(",")))
            .filter(Boolean)
            .join(" ")}
          fill="none"
          stroke={dashBoat <= 2 ? SCOPE_DASH : RADAR_LINE[dashBoat]}
          strokeWidth={4}
          strokeDasharray="12 9"
          opacity={subOpacity}
        />
      )}
      {axes.map((ax, i) => {
        const lab = axisLabel(i, n);
        const tops = [1, 2, 3, 4, 5, 6].filter(
          (b) => boats[b - 1].rankFrom[i] === 1,
        );
        const [tx, ty] = pt(i, n, 1);
        const sub = subBoat
          ? `${subBoat}号艇 ${boats[subBoat - 1].ranks[i] ?? "—"}`
          : "";
        return (
          <g key={ax.key}>
            {tops.map((b, j) => {
              const off = (j - (tops.length - 1) / 2) * 60;
              const a = angle(i, n);
              const ox = tx - Math.sin(a) * off;
              const oy = ty + Math.cos(a) * off;
              return (
                <g key={b} opacity={draw}>
                  <circle
                    cx={ox}
                    cy={oy}
                    r={28}
                    fill={RADAR_LINE[b]}
                    stroke={b === 2 ? "#fff" : "#0d1b2e"}
                    strokeWidth={3}
                  />
                  <text
                    x={ox}
                    y={oy + 13}
                    textAnchor="middle"
                    fontSize={MIN_TEXT}
                    fontWeight={900}
                    fill={RADAR_TEXT[b]}
                    fontFamily={FONT}
                  >
                    {b}
                  </text>
                </g>
              );
            })}
            <text
              x={lab.x}
              y={lab.y}
              textAnchor={lab.anchor}
              fontSize={40}
              fontWeight={800}
              fill={SCOPE_TEXT}
              fontFamily={FONT}
            >
              {ax.label} ▼
            </text>
            <text
              x={lab.x}
              y={lab.y + 44}
              textAnchor={lab.anchor}
              fontSize={MIN_TEXT}
              fontWeight={600}
              fill={SCOPE_SUBTEXT}
              fontFamily={FONT}
              opacity={subOpacity}
            >
              {sub}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Chips({ scene, state }) {
  return [1, 2, 3, 4, 5, 6].map((b) => {
    const on = b === state.lead ? state.p : b === state.prev ? 1 - state.p : 0;
    const cls = scene.radar.boats[b - 1].cls ?? "—";
    return (
      <div
        key={b}
        style={{
          position: "absolute",
          left: chipX(b),
          top: CHIP_Y,
          width: CHIP_W,
          height: CHIP_H,
          borderRadius: 16,
          boxSizing: "border-box",
          background: `rgba(255,255,255,${0.06 + 0.1 * on})`,
          border: `3px solid rgba(232,208,137,${0.25 + 0.75 * on})`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
        }}
      >
        <BoatBadge b={b} size={58} />
        <span
          style={{ fontSize: MIN_TEXT, fontWeight: 700, color: SCOPE_TEXT }}
        >
          {cls}
        </span>
      </div>
    );
  });
}

function chipBox(boats) {
  const xs = boats.map(chipX);
  return {
    x: Math.min(...xs),
    y: CHIP_Y,
    w: Math.max(...xs) + CHIP_W - Math.min(...xs),
    h: CHIP_H,
  };
}

/** 差がはっきりしている順のカード（ソナー「差がつく材料」のカードに寄せる） */
function Card({ item, boat, frameT }) {
  const top = 350;
  const left = 40;
  const width = 1000;
  const barsBase = top + 720;
  const barMax = 180;
  const pcts = item.bars.map((x) => x.pct ?? 0);
  const max = Math.max(
    ...pcts,
    item.usual ?? 0,
    0.01,
  );
  const colW = (width - 80) / 6;
  const colX = (i) => left + 40 + i * colW;
  const barW = 104;
  const barTop = (pct) => barsBase - (pct / max) * barMax;
  const today = item.todayBar;
  const frame =
    today === null
      ? {
          x: colX(0) + 6,
          y: barTop(Math.max(...pcts)) - 58,
          w: colW * 6 - 12,
          h: barsBase - barTop(Math.max(...pcts)) + 58,
        }
      : {
          x: colX(today) + (colW - barW) / 2 - 10,
          y: barTop(pcts[today]) - 58,
          w: barW + 20,
          h: barsBase - barTop(pcts[today]) + 58,
        };
  // 1号艇の全レースの1着率（割合）。画面の棒の点線
  const usualPct = item.usual ?? null;
  const title = fit(
    item.label,
    width - 80 - textWidth(item.judge, 40, 800) - 24,
    46,
    800,
  );
  return (
    <>
      <div
        style={{
          position: "absolute",
          left,
          top,
          width,
          height: 860,
          boxSizing: "border-box",
          background: "#14263e",
          border: "2px solid rgba(255,255,255,0.12)",
          borderRadius: 28,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: left + 40,
          top: top + 34,
          display: "flex",
          alignItems: "baseline",
          gap: 24,
          color: "#ffffff",
        }}
      >
        <span style={{ fontSize: title.fontSize, fontWeight: 800 }}>
          {title.lines[0]}
        </span>
        <span style={{ fontSize: 40, fontWeight: 800, color: "#e2b93b" }}>
          {item.judge}
        </span>
      </div>
      <div
        style={{
          position: "absolute",
          left: left + 40,
          top: top + 118,
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <BoatBadge b={boat} size={52} />
        <span
          style={{
            fontSize: fit(item.todayLine, width - 160, 40, 800).fontSize,
            fontWeight: 800,
            color: "#ffffff",
            whiteSpace: "nowrap",
          }}
        >
          {item.todayLine}
        </span>
      </div>
      {[item.best, item.worst].map((x, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: left + 40 + i * 470,
            top: top + 200,
            width: 450,
            height: 180,
            boxSizing: "border-box",
            background: "#0c1a2c",
            borderRadius: 20,
            padding: "18px 26px",
            color: "#ffffff",
          }}
        >
          <div style={{ fontSize: MIN_TEXT, fontWeight: 500 }}>{x.word}</div>
          <div style={{ fontSize: 64, fontWeight: 900, lineHeight: 1.1 }}>
            {x.pct}
          </div>
          <div style={{ fontSize: MIN_TEXT, color: MUTED }}>{x.count}</div>
        </div>
      ))}
      <div
        style={{
          position: "absolute",
          left: left + 40,
          top: top + 400,
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <BoatBadge b={boat} size={44} />
        <span style={{ fontSize: MIN_TEXT, color: MUTED, fontWeight: 600 }}>
          6艇中の順位ごとの1着率
        </span>
      </div>
      {usualPct !== null && (
        <div
          style={{
            position: "absolute",
            left: left + 30,
            top: barTop(usualPct) - 2,
            width: width - 60,
            borderTop: "5px dotted #2dd4bf",
          }}
        />
      )}
      {item.bars.map((x, i) => {
        const on = i === today;
        const pc = x.pct ?? 0;
        return (
          <div key={i}>
            <div
              style={{
                position: "absolute",
                left: colX(i),
                width: colW,
                top: barTop(pc) - 54,
                textAlign: "center",
                zIndex: 1,
                fontSize: 38,
                fontWeight: on ? 900 : 600,
                color: on ? "#ffffff" : "#cfd8e3",
              }}
            >
              <span style={{ background: "#14263e", padding: "0 6px" }}>
                {x.pct === null ? "—" : `${Math.round(pc * 100)}%`}
              </span>
            </div>
            <div
              style={{
                position: "absolute",
                left: colX(i) + (colW - barW) / 2,
                top: barTop(pc),
                width: barW,
                height: barsBase - barTop(pc),
                background: on ? "#e9cf86" : "#b3a77a",
                border: on ? "5px solid #c9a227" : "none",
                boxSizing: "border-box",
                borderRadius: "10px 10px 0 0",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: colX(i),
                width: colW,
                top: barsBase + 10,
                textAlign: "center",
                fontSize: MIN_TEXT,
                fontWeight: on ? 900 : 500,
                color: on ? "#e2b93b" : "#cfd8e3",
                lineHeight: 1.2,
              }}
            >
              {x.label
                .replace("（", "\n（")
                .split("\n")
                .map((s, k) => (
                  <div key={k}>{s}</div>
                ))}
            </div>
          </div>
        );
      })}
      <Frame box={frame} t={frameT} />
    </>
  );
}

function QuestionBand({ text, opacity }) {
  const f = fit(text, W - 120, 76, 900, 2);
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: W,
        height: BAND,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        opacity,
      }}
    >
      <div
        style={{
          width: 120,
          height: 10,
          borderRadius: 5,
          background: ORANGE,
          marginBottom: 28,
        }}
      />
      {f.lines.map((l, i) => (
        <div
          key={i}
          style={{
            fontSize: f.fontSize,
            fontWeight: 900,
            color: "#ffffff",
            lineHeight: 1.25,
            whiteSpace: "nowrap",
          }}
        >
          {l}
        </div>
      ))}
    </div>
  );
}

/**
 * その拍の答えの文。scene.answers（文の JSON。描画の前に1度だけ作って保存したもの）にあればそれを、
 * 無ければ文型の版を使う。同じ JSON なら同じ絵になる
 */
const answerOf = (scene, id, template) => scene.answers?.[id] ?? template;

export const scene2Duration = (scene) => scene2Timeline(scene).total;

export function FullPictureScene2(scene) {
  const frame = useCurrentFrame();
  if (!scene?.radar?.axes?.length)
    return (
      <AbsoluteFill
        style={{
          background: BG_BOTTOM,
          color: "#fff",
          fontFamily: FONT,
          fontSize: 48,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        材料が無い
      </AbsoluteFill>
    );
  const { beats, total } = scene2Timeline(scene);
  const beat = beatAt(beats, frame);
  const t = frame - beat.from;
  const state = radarState(scene, beats, frame);
  const cards = scene.cards.items;

  // 縦スクロール（重ね図 → カード1 → カード2 …）。頁 k は y = k*PAGE
  const toCards = beats.find((b) => b.kind === "toCards");
  let scroll = 0;
  if (frame >= toCards.from) {
    scroll = interpolate(frame - toCards.from, [0, toCards.len], [0, PAGE], {
      ...clamp,
      easing: ease,
    });
    if (beat.kind === "card" && beat.index > 0)
      scroll =
        PAGE * beat.index +
        interpolate(t, [0, 18], [0, PAGE], { ...clamp, easing: ease });
  }
  const cardFrameAt = (i) =>
    i === 0 ? FRAME_AT - CHANGE_END + 0 : 18 + BEAT.pause;
  const qSwitch = interpolate(
    frame - toCards.from,
    [0, 10, 14, 24],
    [1, 0, 0, 1],
    clamp,
  );
  const question =
    frame >= toCards.from + 12
      ? `${scene.cards.boat}号艇の勝敗を分ける材料`
      : "一目で分かる6艇比較";

  // 押す・枠・答え
  const focus = scene.radar.focus;
  let finger = null;
  let radarFrame = null;
  let radarAnswer = null;
  if (beat.kind === "overview") {
    const at = 24 + BEAT.pause;
    radarFrame = { box: chipBox(scene.radar.overview.frameBoats), t: t - at };
    radarAnswer = {
      lines: answerOf(scene, scene.radar.overview.id, scene.radar.overview.lines),
      t: t - (at + BEAT.frameIn + BEAT.answerGap),
    };
  } else if (beat.kind === "focus") {
    const f = focus[beat.index];
    const prevBoat = beat.index === 0 ? null : focus[beat.index - 1].boat;
    const to = { x: chipX(f.boat) + CHIP_W / 2, y: CHIP_Y + CHIP_H / 2 };
    finger = {
      ...to,
      t,
      from: prevBoat
        ? { x: chipX(prevBoat) + CHIP_W / 2, y: CHIP_Y + CHIP_H / 2 + 40 }
        : { x: 900, y: 1500 },
    };
    if (f.frameAxis !== null) {
      const lab = axisLabel(f.frameAxis, scene.radar.axes.length);
      const sub = `${f.boat}号艇 ${scene.radar.boats[f.boat - 1].ranks[f.frameAxis] ?? "—"}`;
      radarFrame = {
        box: boxOfLabel(lab, scene.radar.axes[f.frameAxis].label, sub),
        t: t - FRAME_AT,
      };
    }
    radarAnswer = { lines: answerOf(scene, f.id, f.lines), t: t - ANSWER_AT };
  }

  const fade = (f) =>
    interpolate(f, [0, 10, total - 30, total], [0, 1, 1, 0], clamp);
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(180deg, ${BG_TOP} 0%, ${BG_BOTTOM} 100%)`,
        fontFamily: FONT,
        overflow: "hidden",
      }}
    >
      {scene.bgm && (
        <Audio
          src={staticFile(scene.bgm)}
          loop
          volume={(f) => 0.35 * fade(f)}
        />
      )}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: -scroll,
          width: W,
          height: PAGE * (cards.length + 2),
        }}
      >
        <div
          style={{ position: "absolute", left: 0, top: 0, width: W, height: H }}
        >
          <Radar scene={scene} state={state} />
          <Chips scene={scene} state={state} />
          {radarFrame && <Frame box={radarFrame.box} t={radarFrame.t} />}
          {radarAnswer && (
            <Bubble lines={radarAnswer.lines} t={radarAnswer.t} />
          )}
          <div
            style={{
              position: "absolute",
              left: 60,
              top: 1470,
              width: 960,
              fontSize: MIN_TEXT,
              color: MUTED,
              lineHeight: 1.4,
            }}
          >
            集め方: 各艇とも、その艇の級別がそろうレース（{scene.cards.scope}）
          </div>
          {finger && <Finger {...finger} />}
        </div>
        {cards.map((item, i) => {
          const active = beat.kind === "card" && beat.index === i;
          return (
            <div
              key={item.key}
              style={{
                position: "absolute",
                left: 0,
                top: PAGE * (i + 1),
                width: W,
                height: H,
              }}
            >
              <Card
                item={item}
                boat={scene.cards.boat}
                frameT={active ? t - cardFrameAt(i) : -1}
              />
              {active && (
                <Bubble
                  lines={answerOf(scene, item.id, item.answer)}
                  t={t - cardFrameAt(i) - BEAT.frameIn - BEAT.answerGap}
                />
              )}
              <div
                style={{
                  position: "absolute",
                  left: 60,
                  top: 1470,
                  width: 960,
                  fontSize: MIN_TEXT,
                  color: MUTED,
                  lineHeight: 1.4,
                }}
              >
                集めたレース: {scene.cards.scope}（{scene.cards.boat}号艇の1着率
                全体{scene.cards.usual ?? "—"}）
              </div>
            </div>
          );
        })}
        {cards.length === 0 && (
          <div
            style={{
              position: "absolute",
              left: 0,
              top: PAGE,
              width: W,
              height: H,
            }}
          >
            <Bubble
              lines={answerOf(scene, scene.cards.empty?.id, scene.cards.empty?.lines)}
              t={beat.kind === "empty" ? t - 20 : -1}
              y={600}
            />
          </div>
        )}
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: W,
          height: BAND,
          background: `linear-gradient(180deg, ${BG_TOP} 85%, rgba(18,35,58,0))`,
        }}
      />
      <QuestionBand
        text={question}
        opacity={
          frame >= toCards.from
            ? qSwitch
            : interpolate(frame, [0, 10], [0, 1], clamp)
        }
      />
    </AbsoluteFill>
  );
}
