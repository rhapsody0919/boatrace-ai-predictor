/**
 * 全貌動画の場面で共通に使う部品（オレンジの枠・指と波紋・答えの吹き出し・艇番の札・上帯の問い・下の注記）。
 * 型（~/hq/drafts/full-picture-scene-contract.md「全場面共通」）の見た目をここに1つだけ持つ。
 */
import { interpolate } from "remotion";
import { FONT } from "../fonts.js";
import { fitHeadline } from "../textFit.js";
import { RADAR_LINE, RADAR_TEXT } from "../../../../src/components/race/analogy/analogyColors.js";
import { BEAT, FRAME_AT, PRESS_AT } from "./scene2Timeline.js";
import { BAND, BUBBLE, BUBBLE_ACCENT, BUBBLE_INNER, FRAME_PAD, MIN_TEXT, W, bubbleLine } from "./scene2Layout.js";
import { MUTED, ORANGE, clamp, ease, fit1 } from "./parts.js";

/** オレンジの四角枠（出るときに少し縮みながら現れる） */
export function Frame({ box, t }) {
  if (!box || t <= 0) return null;
  const p = interpolate(t, [0, BEAT.frameIn], [0, 1], {
    ...clamp,
    easing: ease,
  });
  const pad = FRAME_PAD + (1 - p) * 18;
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
        boxSizing: "border-box",
      }}
    />
  );
}

/** 指のアイコン＋波紋（Material Icons「touch_app」の形、Apache 2.0） */
export function Finger({ x, y, t, from }) {
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
  const size = 110;
  return (
    <>
      {t >= PRESS_AT && rip < 1 && (
        <div
          style={{
            position: "absolute",
            left: x - 20 - rip * 60,
            top: y - 20 - rip * 60,
            width: 40 + rip * 120,
            height: 40 + rip * 120,
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
          // 指先（11.5, 4 付近）を押す点に合わせる
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

/** 答えの白い吹き出し（1〜2行、各行1行に収める）。tail は尖りの x（押した札の中心） */
export function Bubble({ lines, t, out = 1, tail = BUBBLE.x + 90, y = BUBBLE.y, lead = 0, accent = null }) {
  if (!lines?.length || t < 0 || out <= 0) return null;
  const p = interpolate(t, [0, 8], [0, 1], { ...clamp, easing: ease });
  const tailX = Math.min(Math.max(tail - BUBBLE.x - 22, 30), BUBBLE.w - 74);
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
        padding: `${BUBBLE.padY}px ${BUBBLE.padX}px`,
        boxSizing: "border-box",
        opacity: p * out,
        boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: tailX,
          top: -22,
          width: 0,
          height: 0,
          borderLeft: "22px solid transparent",
          borderRight: "22px solid transparent",
          borderBottom: "24px solid #ffffff",
        }}
      />
      {lines.map((l, i) => {
        const st = bubbleLine(i, lead);
        const f = fit1(l, BUBBLE_INNER, st.size, st.weight);
        return (
          <div
            key={i}
            style={{
              fontSize: f.fontSize,
              fontWeight: st.weight,
              lineHeight: 1.3,
              color: st.color,
              whiteSpace: "nowrap",
            }}
          >
            {accent && i === lead && f.lines[0].includes(accent)
              ? f.lines[0].split(accent).flatMap((part, k) => (k === 0 ? [part] : [<span key={k} style={{ color: BUBBLE_ACCENT }}>{accent}</span>, part]))
              : f.lines[0]}
          </div>
        );
      })}
    </div>
  );
}

/** 艇番の札（公式の艇色） */
export function BoatBadge({ b, size = 56 }) {
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
        flexShrink: 0,
      }}
    >
      {b}
    </div>
  );
}

export function QuestionBand({ text, opacity }) {
  const f = fitHeadline(text, {
    maxWidth: W - 120,
    maxLines: 2,
    fontFamily: FONT,
    fontWeight: 900,
    maxFontSize: 76,
    minFontSize: MIN_TEXT,
  });
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

/** 下の注記（重要でない下段。y1700 まで・x940 まで） */
export function Note({ lines }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 60,
        top: 1462,
        width: 880,
        fontSize: MIN_TEXT,
        color: MUTED,
        lineHeight: 1.4,
      }}
    >
      {lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  );
}

