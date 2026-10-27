/**
 * 型 f01-landscape-voice-full（完全版を横 16:9＋声に）の composition。作るのは scripts/full-picture/f01-build.mjs。
 * 台本: docs/design/full-picture-type-gate/candidates/f01-landscape-voice-full/script.md、仕様は hq drafts/fp-youtube-type-20261027.md の6節。
 * 値はすべて props（材料・声・撮った画面から作る）。ここでは並べるだけ。
 * - 冒頭: 全幅。見出しは題の問い、根拠の行に1号艇が負けた件の内訳の棒（承認した見本 v1 0-open.png の形。順位の色分けはしない）
 * - 章: 左に龍神の実画面（x48〜1184・y32〜870）、右 632px（x1240〜1872）に章の札・範囲・答えの数字・自分で見るなら。
 *   外の余白48・間の溝56、右の列の頭と画像の頭を y32 で揃える（オーナー 10/27「余白が気になる」→ visual-designer の案）
 * - 字幕: y890〜960 に1行（声と同じ文）。帯は敷かず字の影だけ（全幅の黒い帯が下の空きとつながって塊に見えた）
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
/** scripts/full-picture/f01-capture.mjs の LEFT_BOX と同じ */
const LEFT = { x: 48, y: 32, w: 1136, h: 838 };
const RIGHT = { x: 1240, w: 632 };
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

/** 冒頭（字幕が無いので y960 まで使う）。棒の塊は件数の字の幅を含めて左右中央 */
function Open({ open }) {
  const frame = useCurrentFrame();
  const max = Math.max(...open.bars.map((b) => b.count));
  const BAR = 820;
  const label = (b) => `${b.count.toLocaleString("ja-JP")}件`;
  const countW = Math.max(
    ...open.bars.map((b) => textWidth(label(b), 58, 800)),
  );
  const left = Math.round((1920 - (190 + 24 + BAR + 24 + countW)) / 2);
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          top: 96,
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
          top: 168,
          width: "100%",
          textAlign: "center",
          fontSize: 84,
          fontWeight: 900,
          letterSpacing: 1,
        }}
      >
        {open.title}
      </div>
      <div style={{ position: "absolute", top: 330, left }}>
        {open.bars.map((b, i) => {
          const at = 20 + i * 8;
          const w = interpolate(
            frame,
            [at, at + 15],
            [0, (b.count / max) * BAR],
            { ...clamp, easing: ease },
          );
          return (
            <div
              key={b.boat}
              style={{
                display: "flex",
                alignItems: "center",
                height: 104,
                opacity: fadeIn(frame, at),
              }}
            >
              <div
                style={{
                  width: 190,
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  fontSize: 52,
                  fontWeight: 800,
                }}
              >
                <Badge boat={b.boat} size={60} />
                <span>号艇</span>
              </div>
              <div
                style={{
                  width: w,
                  height: 60,
                  background: "#5a6478",
                  marginLeft: 24,
                }}
              />
              <div style={{ marginLeft: 24, fontSize: 58, fontWeight: 800 }}>
                {label(b)}
              </div>
            </div>
          );
        })}
      </div>
      <div
        style={{
          position: "absolute",
          top: 884,
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

/** 答えの数字: 64px、収まらなければ 48px、まだ越えたら2行 */
function AnswerLine({ text }) {
  const size = textWidth(text, 64, 900) <= RIGHT.w ? 64 : 48;
  return (
    <div
      style={{ color: GOLD, fontSize: size, fontWeight: 900, lineHeight: 1.3 }}
    >
      {text}
    </div>
  );
}

/** 答え2: 1行に入らなければ「・」で区切って1区切り1行（1字だけが次の行に落ちないように） */
function SubLine({ text }) {
  const lines = textWidth(text, 36, 700) <= RIGHT.w ? [text] : text.split("・");
  return (
    <div style={{ fontSize: 36, fontWeight: 700, lineHeight: 1.4 }}>
      {lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  );
}

function Cut({ cut, frame, boxH }) {
  const s = cut.scale;
  const sw = cut.clip.w * s;
  const sh = cut.clip.h * s;
  const ox = LEFT.x + (LEFT.w - sw) / 2;
  // 章の中でいちばん高いカットの箱で縦の中央に置き、その箱の中では上に揃える（押す前・押した後で位置がずれない）
  const oy = LEFT.y + (LEFT.h - boxH) / 2;
  let cursor = null;
  if (cut.cursor) {
    const { x, y, w, h, at } = cut.cursor;
    const tx = ox + (x + w / 2) * s;
    const ty = oy + (y + h / 2) * s;
    const p = interpolate(frame, [at - 15, at], [0, 1], {
      ...clamp,
      easing: ease,
    });
    if (frame >= at - 15 && frame < at + 6)
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
          borderRadius: 8,
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
  const boxH = Math.max(...c.cuts.map((x) => x.clip.h * x.scale));
  return (
    <AbsoluteFill>
      {cut && <Cut cut={cut} frame={frame} boxH={boxH} />}
      <div
        style={{
          position: "absolute",
          left: RIGHT.x,
          top: LEFT.y,
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
              fontSize: 32,
              fontWeight: 700,
            }}
          >
            {c.tag}
          </div>
        )}
        {c.scope && (
          <div style={{ color: MUTED, fontSize: 32, fontWeight: 400 }}>
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
          <div style={{ opacity: fadeIn(frame, c.answer2At) }}>
            <SubLine text={c.answer2} />
          </div>
        )}
      </div>
      {c.path && (
        <div
          style={{
            position: "absolute",
            left: RIGHT.x,
            top: 774,
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
            top: 600,
            width: RIGHT.w,
            opacity: fadeIn(frame, c.footAt),
          }}
        >
          <div style={{ color: MUTED, fontSize: 28 }}>このレースのページは</div>
          <div style={{ fontSize: 40, fontWeight: 800, color: "#fff" }}>
            {c.foot}
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
}

/**
 * 終了画面の要素の場所（要素は YouTube 側で置く。ここでは枠と、要素の外の上に説明の字）。
 * 左の画面の下半分に暗い幕を重ねて置く（右の列の「説明欄の一番上」と、左上の押していない軸の枠は隠さない）
 */
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
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 420,
          width: RIGHT.x - 28,
          height: 460,
          background: "rgba(10,20,36,0.92)",
          opacity: o,
        }}
      />
      {box(LEFT.x + 72, 470, 600, 338, "全貌 完全版の再生リスト")}
      {box(LEFT.x + 772, 540, 220, 220, "チャンネル登録", true)}
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
          {c.open ? <Open open={c.open} /> : <Chapter c={c} />}
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
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span
            style={{
              fontSize: 44,
              fontWeight: 700,
              textShadow: "0 2px 8px rgba(0,0,0,0.8)",
            }}
          >
            {sub.text}
          </span>
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

/**
 * サムネ（横 1280x720）。hq の型の thumb「問い10字前後＋数字1つ」（m02-thumb-word: 表・数字の羅列は載せない）。
 * 数字は冒頭と同じ範囲の過去の1号艇の1着（約X割）
 */
export function F01Thumb({ head, question, number, numberLabel }) {
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(${BG_TOP}, ${BG_BOTTOM})`,
        fontFamily: FONT,
        color: "#fff",
        padding: "56px 72px",
      }}
    >
      <div style={{ color: MUTED, fontSize: 40, fontWeight: 700 }}>{head}</div>
      <div
        style={{
          marginTop: 70,
          fontSize: 116,
          fontWeight: 900,
          lineHeight: 1.15,
        }}
      >
        {question}
      </div>
      <div
        style={{
          position: "absolute",
          left: 72,
          bottom: 64,
          display: "flex",
          alignItems: "baseline",
          gap: 28,
        }}
      >
        <span style={{ fontSize: 44, fontWeight: 700, color: MUTED }}>
          {numberLabel}
        </span>
        <span
          style={{ fontSize: 180, fontWeight: 900, color: GOLD, lineHeight: 1 }}
        >
          {number}
        </span>
      </div>
    </AbsoluteFill>
  );
}
