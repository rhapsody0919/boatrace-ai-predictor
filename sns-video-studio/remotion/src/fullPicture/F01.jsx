/**
 * 型 f01-landscape-voice-full（完全版を横 16:9＋声に）の試作の composition。関門の段4。型の表にはまだ載せない。
 * 台本: docs/design/full-picture-type-gate/candidates/f01-landscape-voice-full/script.md、仕様は hq drafts/fp-youtube-type-20261027.md の6節。
 * 値はすべて props（scripts/full-picture/prototype-f01.mjs が材料・声・撮った画面から作る）。ここでは並べるだけ。
 * - 冒頭: 全幅。見出しは題の問い、根拠の行に1号艇が負けた件の内訳の棒（承認した見本 v1 0-open.png の形。順位の色分けはしない）
 * - 章: 左に龍神の実画面（x24〜1260・y20〜870）、右 650px に章の札・範囲の札・答えの数字1行・自分で見るなら
 * - 字幕: y890〜960 に1行（声と同じ文）。下の y972〜 は使わない
 * - 強調: 実画面の色は変えず、GOLD の枠を0.3秒で重ねる。カーソルは押す0.5秒前から動き、押した後は消す
 */
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { FONT } from "../fonts.js";
import { BG_BOTTOM, BG_TOP, MUTED, clamp, ease, textWidth } from "./parts.js";
import { BOAT_COLORS } from "../../../../src/utils/colors.js";

const GOLD = "#d4af37";
const LEFT = { x: 24, y: 20, w: 1236, h: 850 };
const RIGHT = { x: 1290, w: 600 };
const FADE = 9; // 0.3秒

const fadeIn = (frame, from) =>
  interpolate(frame, [from, from + FADE], [0, 1], clamp);

function Badge({ boat, size = 56 }) {
  const c = BOAT_COLORS[boat];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: 8,
        background: c.bg,
        color: c.text,
        border: boat === 1 ? "2px solid #94a3b8" : "none",
        fontWeight: 900,
        fontSize: size * 0.62,
      }}
    >
      {boat}
    </span>
  );
}

function Open({ open, from }) {
  const frame = useCurrentFrame();
  const max = Math.max(...open.bars.map((b) => b.count));
  return (
    <AbsoluteFill style={{ alignItems: "center" }}>
      <div
        style={{
          position: "absolute",
          top: 86,
          width: "100%",
          textAlign: "center",
          color: MUTED,
          fontSize: 38,
          fontWeight: 400,
        }}
      >
        {open.head}
      </div>
      <div
        style={{
          position: "absolute",
          top: 160,
          width: "100%",
          textAlign: "center",
          fontSize: 84,
          fontWeight: 900,
          letterSpacing: 1,
        }}
      >
        {open.title}
      </div>
      <div style={{ position: "absolute", top: 320, left: 500, width: 1000 }}>
        {open.bars.map((b, i) => {
          const at = from + 20 + i * 8;
          const w = interpolate(
            frame,
            [at, at + 15],
            [0, (b.count / max) * 640],
            { ...clamp, easing: ease },
          );
          return (
            <div
              key={b.boat}
              style={{
                display: "flex",
                alignItems: "center",
                height: 95,
                opacity: fadeIn(frame, at),
              }}
            >
              <div
                style={{
                  width: 160,
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  fontSize: 44,
                  fontWeight: 800,
                }}
              >
                <Badge boat={b.boat} size={50} />
                <span>号艇</span>
              </div>
              <div
                style={{
                  width: w,
                  height: 52,
                  background: "#5a6478",
                  marginLeft: 20,
                }}
              />
              <div
                style={{ marginLeft: 20, fontSize: 46, fontWeight: 800 }}
              >{`${b.count.toLocaleString("ja-JP")}件`}</div>
            </div>
          );
        })}
      </div>
      <div
        style={{
          position: "absolute",
          top: 812,
          width: "100%",
          textAlign: "center",
          color: MUTED,
          fontSize: 30,
          fontWeight: 400,
        }}
      >
        {open.note}
      </div>
    </AbsoluteFill>
  );
}

/** 答えの数字1行: 64px・14字まで、越えたら 48px、まだ越えたら2行 */
function AnswerLine({ text }) {
  const size = textWidth(text, 64, 900) <= RIGHT.w ? 64 : 48;
  return (
    <div
      style={{ color: GOLD, fontSize: size, fontWeight: 900, lineHeight: 1.4 }}
    >
      {text}
    </div>
  );
}

function Cut({ cut, frame }) {
  const sw = cut.clip.w * cut.scale;
  const sh = cut.clip.h * cut.scale;
  const ox = LEFT.x + (LEFT.w - sw) / 2;
  // 上に揃える（同じ部品の押す前・押した後で、高さが変わっても位置がずれない）
  const oy = LEFT.y;
  const s = cut.scale;
  // カーソル: 押す0.5秒前（15コマ）に画面の右下から動き始め、押した後は消す
  let cursor = null;
  if (cut.cursor) {
    const { x, y, w, h, at } = cut.cursor;
    const tx = ox + (x + w / 2) * s;
    const ty = oy + (y + h / 2) * s;
    const p = interpolate(frame, [at - 15, at], [0, 1], {
      ...clamp,
      easing: ease,
    });
    const vis = frame >= at - 15 && frame < at + 6;
    if (vis)
      cursor = (
        <svg
          width={44}
          height={56}
          viewBox="0 0 22 28"
          style={{
            position: "absolute",
            left: interpolate(p, [0, 1], [tx + 160, tx]),
            top: interpolate(p, [0, 1], [ty + 120, ty]),
          }}
        >
          <path
            d="M1 1 L1 21 L6 16 L10 26 L14 24 L10 15 L17 15 Z"
            fill="#fff"
            stroke="#000"
            strokeWidth={1.5}
          />
        </svg>
      );
  }
  return (
    <>
      <Img
        src={staticFile(cut.file)}
        style={{
          position: "absolute",
          left: ox,
          top: oy,
          width: sw,
          height: sh,
          borderRadius: 6,
          boxShadow: "0 6px 24px rgba(0,0,0,0.45)",
        }}
      />
      {(cut.gold ?? []).map((g, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: ox + g.x * s - 4,
            top: oy + g.y * s - 4,
            width: g.w * s + 8,
            height: g.h * s + 8,
            border: `5px solid ${GOLD}`,
            borderRadius: 8,
            opacity: fadeIn(frame, g.at),
          }}
        />
      ))}
      {cursor}
    </>
  );
}

function Chapter({ c }) {
  const frame = useCurrentFrame();
  const cut = [...c.cuts].reverse().find((x) => frame >= x.from) ?? c.cuts[0];
  return (
    <AbsoluteFill>
      {cut && <Cut cut={cut} frame={frame} />}
      <div
        style={{
          position: "absolute",
          left: RIGHT.x,
          top: 40,
          width: RIGHT.w,
          display: "flex",
          flexDirection: "column",
          gap: 22,
          lineHeight: 1.4,
        }}
      >
        {c.tag && (
          <div
            style={{
              alignSelf: "flex-start",
              border: `2px solid ${MUTED}`,
              borderRadius: 8,
              padding: "6px 16px",
              fontSize: 30,
              fontWeight: 700,
            }}
          >
            {c.tag}
          </div>
        )}
        {c.scope && (
          <div style={{ color: MUTED, fontSize: 30, fontWeight: 400 }}>
            {c.scope}
          </div>
        )}
        <div style={{ height: 40 }} />
        {c.answer && (
          <div style={{ opacity: fadeIn(frame, c.answerAt) }}>
            <AnswerLine text={c.answer} />
          </div>
        )}
        {c.answer2 && (
          <div
            style={{
              fontSize: 34,
              fontWeight: 700,
              opacity: fadeIn(frame, c.answer2At),
            }}
          >
            {c.answer2}
          </div>
        )}
      </div>
      {c.path && (
        <div
          style={{
            position: "absolute",
            left: RIGHT.x,
            top: 700,
            width: RIGHT.w,
            opacity: fadeIn(frame, c.pathAt),
          }}
        >
          <div style={{ color: MUTED, fontSize: 28 }}>自分で見るなら</div>
          <div style={{ fontSize: 36, fontWeight: 700 }}>{c.path}</div>
        </div>
      )}
      {c.foot && (
        <div
          style={{
            position: "absolute",
            left: RIGHT.x,
            top: 760,
            width: RIGHT.w,
            fontSize: 40,
            fontWeight: 800,
            color: "#fff",
            opacity: fadeIn(frame, c.footAt),
          }}
        >
          {c.foot}
        </div>
      )}
    </AbsoluteFill>
  );
}

/** 終了画面の要素の場所（要素は YouTube 側で置く。ここでは枠と、要素の外の上に説明の字） */
function EndScreen({ from }) {
  const frame = useCurrentFrame();
  const o = fadeIn(frame, from);
  const box = (left, top, w, h, label, round = false) => (
    <div style={{ position: "absolute", left, top, opacity: o }}>
      <div style={{ color: MUTED, fontSize: 26, marginBottom: 8 }}>{label}</div>
      <div
        style={{
          width: w,
          height: h,
          border: `2px dashed ${MUTED}`,
          borderRadius: round ? h / 2 : 8,
          background: "rgba(10,20,36,0.85)",
        }}
      />
    </div>
  );
  return (
    <AbsoluteFill>
      {box(RIGHT.x, 250, 560, 315, "全貌 完全版の再生リスト")}
      {box(RIGHT.x + 180, 620, 200, 200, "チャンネル登録", true)}
    </AbsoluteFill>
  );
}

/**
 * @param {{total: number, chapters: object[], subs: {text: string, from: number, to: number}[], audio: {file: string, from: number}[], bgm?: string|null, end?: {from: number}|null}} p
 */
export function F01Landscape({
  chapters,
  subs,
  audio,
  bgm = null,
  end = null,
}) {
  const frame = useCurrentFrame();
  const sub = subs.find((s) => frame >= s.from && frame < s.to);
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(${BG_TOP}, ${BG_BOTTOM})`,
        fontFamily: FONT,
        color: "#fff",
      }}
    >
      {chapters.map((c) => (
        <Sequence
          key={c.id}
          from={c.from}
          durationInFrames={c.len}
          layout="none"
        >
          {c.open ? <Open open={c.open} from={0} /> : <Chapter c={c} />}
        </Sequence>
      ))}
      {end && <EndScreen from={end.from} />}
      {sub && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 890,
            width: 1920,
            height: 70,
            background: "rgba(5,10,20,0.88)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span style={{ fontSize: 40, fontWeight: 700 }}>{sub.text}</span>
        </div>
      )}
      {audio.map((a) => (
        <Sequence key={a.file} from={a.from} layout="none">
          <Audio src={staticFile(a.file)} />
        </Sequence>
      ))}
      {bgm && <Audio src={staticFile(bgm)} volume={0.07} loop />}
    </AbsoluteFill>
  );
}
