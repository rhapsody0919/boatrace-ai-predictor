/**
 * 全貌動画 場面2「6艇の重ね図」。材料 JSON（scripts/full-picture/scene2-data.mjs の出力）と文の JSON（answers）を
 * 流し込むと、決まった手順で描く。LLM・乱数・日時を使わない。同じ JSON なら同じ絵。
 *
 * 型（~/hq/drafts/full-picture-scene-contract.md）: 上帯 y0〜330 に問い／図 y340〜1420／答えの白い吹き出しは図の直下・
 * y1420 より上・x960 より左。押す操作は指＋波紋、強調はオレンジの四角枠。1拍に1つ（押す→変わる→0.5秒→枠→答え）。
 * 実画面の撮影ではなく、同じ中身をデータから描く（2026-10-20 オーナー決定）。見た目はソナーの重ね図・カードに寄せる。
 * 配置は scene2Layout.js（はみ出し・札との重なりを verify-full-picture-scene2.js が検査する）。
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
import { BG_BOTTOM, BG_TOP, CARD_BG, MUTED, PAGE, answerOf, clamp, ease, fit1, fr, textWidth } from "./parts.js";
import { BoatBadge, Bubble, Finger, Frame, Note, QuestionBand } from "./parts.jsx";
import {
  RADAR_LINE,
  RADAR_TEXT,
  SCOPE_DASH,
  SCOPE_GRID,
  SCOPE_LINE,
  SCOPE_SUBTEXT,
  SCOPE_TEXT,
} from "../../../../src/components/race/analogy/analogyColors.js";
import {
  BEAT,
  CARD_SCROLL,
  CHANGE_END,
  DRAW_END,
  FRAME_AT,
  OVERVIEW_FRAME_AT,
  PRESS_AT,
  answerWindows,
  beatAt,
  cardFrameAt,
  scene2Timeline,
} from "./scene2Timeline.js";
import {
  BADGE_R,
  BAND,
  BUBBLE,
  BUBBLE_INNER,
  CARD,
  CHIP,
  FRAME_PAD,
  H,
  MIN_TEXT,
  NAME_SIZE,
  SUB_SIZE,
  W,
  angle,
  cardBarFrame,
  cardColW,
  cardColX,
  cardPairBox,
  chipX,
  labelBox,
  radarGeom,
  vertex,
} from "./scene2Layout.js";

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
      draw: interpolate(t, [0, DRAW_END], [0, 1], { ...clamp, easing: ease }),
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

/** 項目名の文字と、その艇の順位の行 */
const axisSub = (boat, rank) => `${boat}号艇 ${rank ?? "—"}`;
function axisBox(scene, i, boat) {
  const n = scene.radar.axes.length;
  const sub = boat ? axisSub(boat, scene.radar.boats[boat - 1].ranks[i]) : "";
  const w = Math.max(
    textWidth(scene.radar.axes[i].label, NAME_SIZE, 800) +
      textWidth(" ▼", 28, 700),
    textWidth(sub, SUB_SIZE, 600),
  );
  return labelBox(i, n, w);
}

/**
 * 1艇の線。記録の無い軸（当地の記録なし等）は、その前後で線を切る（飛ばして閉じると、値がある形に見える）
 * @returns {string[]} SVG の path の d（つながった区間ごと）
 */
function boatPaths(buckets, n, draw) {
  const pts = buckets.map((k, i) => (k ? vertex(i, n, fr(k) * draw) : null));
  if (pts.every(Boolean)) return [`M${pts.map((q) => q.join(",")).join("L")}Z`];
  // 欠けた軸の次から一周して、つながった区間ごとに開いた線にする
  const start = pts.findIndex((q, i) => q && !pts[(i - 1 + n) % n]);
  const segs = [];
  let cur = [];
  for (let k = 0; k < n; k++) {
    const q = pts[(start + k) % n];
    if (q) cur.push(q);
    else if (cur.length) (segs.push(cur), (cur = []));
  }
  if (cur.length) segs.push(cur);
  return segs.map((s) => `M${s.map((q) => q.join(",")).join("L")}`);
}

function Radar({ scene, state }) {
  const { axes, boats } = scene.radar;
  const n = axes.length;
  const { CX, CY } = radarGeom(n);
  const ring = (f) => axes.map((_, i) => vertex(i, n, f).join(",")).join(" ");
  const { lead, prev, p, draw } = state;
  const emph = (b) => (b === lead ? p : 0) + (b === prev ? 1 - p : 0);
  // 6艇全体（主役なし）から1艇へ移るときだけ、ほかの艇を暗くする量が 0→1 で変わる
  const dim = lead === null ? 0 : prev === null ? p : 1;
  const order = [1, 2, 3, 4, 5, 6].sort((a, b) => emph(a) - emph(b));
  const dash = lead ? boats[lead - 1].typical : null;
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
        const [x, y] = vertex(i, n);
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
        const paths = boatPaths(boats[b - 1].buckets, n, draw);
        const closed = paths.length === 1 && paths[0].endsWith("Z");
        const w = 4.5 + 5 * e;
        const op = 0.85 * (1 - dim) + dim * (0.22 + 0.78 * e);
        const blur = dim * (1 - e) * 2.5;
        // 2号艇: 強調していないときは画面と同じ灰色の半透明。強調したときは黒に白の縁
        const two = b === 2 && e < 0.5;
        const color = two ? SCOPE_LINE[2] : RADAR_LINE[b];
        return (
          <g
            key={b}
            style={{ filter: blur > 0.05 ? `blur(${blur}px)` : undefined }}
            opacity={two ? op * 0.75 : op}
          >
            {b === 2 &&
              !two &&
              paths.map((d, k) => (
                <path
                  key={k}
                  d={d}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth={w + 4}
                />
              ))}
            {paths.map((d, k) => (
              <path
                key={k}
                d={d}
                fill={closed ? color : "none"}
                fillOpacity={(b <= 2 ? 0.14 : 0.24) * e}
                stroke={color}
                strokeWidth={two ? w + 2 : w}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
            {e > 0.5 &&
              boats[b - 1].buckets.map((k, i) => {
                if (!k) return null;
                const [px, py] = vertex(i, n, fr(k));
                return (
                  <circle
                    key={i}
                    cx={px}
                    cy={py}
                    r={8}
                    fill={RADAR_LINE[b]}
                    stroke={b === 2 ? "#fff" : "#0d1b2e"}
                    strokeWidth={2.5}
                  />
                );
              })}
          </g>
        );
      })}
      {dash && dash.some((v) => v !== null) && (
        <polygon
          points={dash
            .map((v, i) => (v === null ? null : vertex(i, n, fr(v)).join(",")))
            .filter(Boolean)
            .join(" ")}
          fill="none"
          stroke={lead <= 2 ? SCOPE_DASH : RADAR_LINE[lead]}
          strokeWidth={4}
          strokeDasharray="12 9"
          opacity={dim}
        />
      )}
      {axes.map((ax, i) => {
        const tops = [1, 2, 3, 4, 5, 6].filter(
          (b) => boats[b - 1].rankFrom[i] === 1,
        );
        const [tx, ty] = vertex(i, n);
        // 項目名の下の行は、強調の形と同じ進みで前の艇から入れ替える
        const subs = [
          lead && { boat: lead, op: prev === null ? p : p },
          prev && { boat: prev, op: 1 - p },
        ].filter((x) => x && x.op > 0.01);
        const box = axisBox(scene, i, lead ?? prev);
        const cx = box.x + box.w / 2;
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
                    r={BADGE_R}
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
            <text x={cx} y={box.y + 40} textAnchor="middle" fontFamily={FONT}>
              <tspan fontSize={NAME_SIZE} fontWeight={800} fill={SCOPE_TEXT}>
                {ax.label}
              </tspan>
              <tspan
                fontSize={28}
                fontWeight={700}
                fill={SCOPE_TEXT}
                fillOpacity={0.55}
              >
                {" ▼"}
              </tspan>
            </text>
            {subs.map((s) => (
              <text
                key={s.boat}
                x={cx}
                y={box.y + 84}
                textAnchor="middle"
                fontSize={SUB_SIZE}
                fontWeight={600}
                fill={SCOPE_SUBTEXT}
                fontFamily={FONT}
                opacity={s.op}
              >
                {axisSub(s.boat, boats[s.boat - 1].ranks[i])}
              </text>
            ))}
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
          top: CHIP.y,
          width: CHIP.w,
          height: CHIP.h,
          borderRadius: 16,
          boxSizing: "border-box",
          background: `rgba(255,255,255,${0.06 + 0.1 * on})`,
          border: `3px solid rgba(232,208,137,${0.25 + 0.75 * on})`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
        }}
      >
        <BoatBadge b={b} size={54} />
        <span
          style={{ fontSize: MIN_TEXT, fontWeight: 700, color: SCOPE_TEXT }}
        >
          {cls}
        </span>
      </div>
    );
  });
}

const chipBoxOf = (b) => ({ x: chipX(b), y: CHIP.y, w: CHIP.w, h: CHIP.h });
const chipCenter = (b) => chipX(b) + CHIP.w / 2;

/** 差がはっきりしている順のカード（ソナー「差がつく材料」のカードに寄せる） */
function Card({ item, boat, frameT }) {
  const { top, left, width, barsBase, barMax, barW } = CARD;
  const pcts = item.bars.map((x) => x.pct ?? 0);
  const max = Math.max(...pcts, item.usual ?? 0, 0.01);
  const colW = cardColW;
  const colX = cardColX;
  const barTop = (pct) => barsBase - (pct / max) * barMax;
  const barFrame = (i) => cardBarFrame(i, pcts[i], max);
  // 今日の順位の棒とその上の%。今日の順位を当てはめない日（優勝戦・準優勝戦の今節の着順点）は、文が比べる1位と6位
  const frames =
    item.todayBar === null
      ? [barFrame(0), barFrame(5)]
      : [barFrame(item.todayBar)];
  const title = fit1(
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
          height: CARD.height,
          boxSizing: "border-box",
          background: CARD_BG,
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
        <span
          style={{
            fontSize: title.fontSize,
            fontWeight: 800,
            whiteSpace: "nowrap",
          }}
        >
          {title.lines[0]}
        </span>
        <span
          style={{
            fontSize: 40,
            fontWeight: 800,
            color: "#e2b93b",
            whiteSpace: "nowrap",
          }}
        >
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
            fontSize: fit1(item.todayLine, width - 160, 40, 800).fontSize,
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
            left: cardPairBox(i).x,
            top: cardPairBox(i).y,
            width: cardPairBox(i).w,
            height: cardPairBox(i).h,
            boxSizing: "border-box",
            background: "#0c1a2c",
            borderRadius: 20,
            padding: "18px 26px 20px",
            color: "#ffffff",
          }}
        >
          <div style={{ fontSize: MIN_TEXT, fontWeight: 500, lineHeight: 1.3 }}>
            {x.word}
          </div>
          <div style={{ fontSize: 64, fontWeight: 900, lineHeight: 1.2 }}>
            {x.pct}
          </div>
          <div style={{ fontSize: MIN_TEXT, color: MUTED, lineHeight: 1.3 }}>
            {x.count}
          </div>
        </div>
      ))}
      <div
        style={{
          position: "absolute",
          left: left + 40,
          top: top + 446,
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
      {item.usual !== null && item.usual !== undefined && (
        <div
          style={{
            position: "absolute",
            left: left + 30,
            top: barTop(item.usual) - 2,
            width: width - 60,
            borderTop: "5px dotted #2dd4bf",
          }}
        />
      )}
      {item.bars.map((x, i) => {
        const on = i === item.todayBar;
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
                fontSize: 38,
                fontWeight: on ? 900 : 600,
                color: on ? "#ffffff" : "#cfd8e3",
                zIndex: 1,
              }}
            >
              <span style={{ background: CARD_BG, padding: "0 6px" }}>
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
      {frames.map((b, k) => (
        <Frame key={k} box={b} t={frameT} />
      ))}
    </>
  );
}

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
  const focus = scene.radar.focus;

  // 縦スクロール（重ね図 → カード1 → カード2 …）。頁 k は y = k*PAGE
  // 入口版（重ね図だけ）はカードの頁へ送らない
  const toCards = beats.find((b) => b.kind === "toCards") ?? { from: Infinity, len: 1 };
  let scroll = 0;
  if (frame >= toCards.from) {
    scroll = interpolate(frame - toCards.from, [0, toCards.len], [0, PAGE], {
      ...clamp,
      easing: ease,
    });
    if (beat.kind === "card" && beat.index > 0)
      scroll =
        PAGE * beat.index +
        interpolate(t, [0, CARD_SCROLL], [0, PAGE], { ...clamp, easing: ease });
  }
  const qSwitch = !Number.isFinite(toCards.from) ? 1 : interpolate(
    frame - toCards.from,
    [0, 10, 14, 24],
    [1, 0, 0, 1],
    clamp,
  );
  const question =
    frame >= toCards.from + 12
      ? `${scene.cards.boat}号艇の勝敗を分ける材料`
      : "一目で分かる6艇比較";

  // 押す・枠
  let finger = null;
  let radarFrames = [];
  if (beat.kind === "overview") {
    // 答えの艇ごとに別の枠（1・2・5号艇なら3つ。間の艇を囲まない）
    radarFrames = scene.radar.overview.frameBoats.map((b) => ({
      box: chipBoxOf(b),
      t: t - OVERVIEW_FRAME_AT,
    }));
  } else if (beat.kind === "focus") {
    const f = focus[beat.index];
    const prevBoat = beat.index === 0 ? null : focus[beat.index - 1].boat;
    finger = {
      x: chipCenter(f.boat),
      y: CHIP.y + CHIP.h / 2,
      t,
      from: prevBoat
        ? { x: chipCenter(prevBoat), y: CHIP.y + CHIP.h / 2 + 40 }
        : { x: 860, y: 1320 },
    };
    if (f.frameAxis !== null)
      radarFrames = [
        { box: axisBox(scene, f.frameAxis, f.boat), t: t - FRAME_AT },
      ];
  }

  // 答え: 次の拍で押すまで残し、図が変わる間に消す
  const bubbles = answerWindows(beats)
    .filter((w) => frame >= w.start && frame < w.end)
    .map((w) => {
      const out =
        frame < w.hold ? 1 : interpolate(frame, [w.hold, w.end], [1, 0], clamp);
      if (w.kind === "overview")
        return {
          page: 0,
          key: "overview",
          lines: answerOf(
            scene,
            scene.radar.overview.id,
            scene.radar.overview.lines,
          ),
          t: frame - w.start,
          out,
          tail: chipCenter(scene.radar.overview.frameBoats[0]),
        };
      if (w.kind === "focus") {
        const f = focus[w.index];
        return {
          page: 0,
          key: f.id,
          lines: answerOf(scene, f.id, f.lines),
          t: frame - w.start,
          out,
          tail: chipCenter(f.boat),
        };
      }
      if (w.kind === "card") {
        const c = cards[w.index];
        return {
          page: w.index + 1,
          key: c.id,
          lines: answerOf(scene, c.id, c.answer),
          t: frame - w.start,
          out,
        };
      }
      return {
        page: 1,
        key: "empty",
        lines: answerOf(scene, scene.cards.empty?.id, scene.cards.empty?.lines),
        t: frame - w.start,
        out,
        y: 600,
      };
    });
  const bubblesOn = (page) =>
    bubbles
      .filter((b) => b.page === page)
      .map((b) => <Bubble key={b.key} {...b} />);

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
          {radarFrames.map((f, k) => (
            <Frame key={k} box={f.box} t={f.t} />
          ))}
          {bubblesOn(0)}
          <Note
            lines={[
              "集め方: 各艇とも、その艇の級別がそろうレース",
              `（${scene.cards.scope}）`,
            ]}
          />
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
              {bubblesOn(i + 1)}
              <Note
                lines={[
                  `集めたレース: ${scene.cards.scope}`,
                  `（${scene.cards.boat}号艇の1着率 全体${scene.cards.usual ?? "—"}）`,
                ]}
              />
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
            {bubblesOn(1)}
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
