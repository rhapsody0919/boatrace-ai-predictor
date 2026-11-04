/**
 * 型 f01-landscape-voice-full（完全版を横 16:9＋声に）の composition。作るのは scripts/full-picture/f01-build.mjs。
 * 台本: docs/design/full-picture-type-gate/candidates/f01-landscape-voice-full/script.md、仕様は hq drafts/fp-youtube-type-20261027.md の6節。
 * 値はすべて props（材料・声・撮った画面から作る）。ここでは並べるだけ。
 * - 冒頭: 全幅。見出しは題の問い、根拠の行に1号艇が負けた件の内訳の棒（承認した見本 v1 0-open.png の形。順位の色分けはしない）
 * - 章: 左に龍神の実画面（x48〜1184・y32〜870）、右 632px（x1240〜1872）に章の札・範囲・答えの数字・自分で見るなら。
 *   外の余白48・間の溝56、右の列の頭と画像の頭を y32 で揃える（オーナー 10/27「余白が気になる」→ visual-designer の案）
 * - 字幕: y890〜960 に1行（声と同じ文）。帯は敷かず字の影だけ（全幅の黒い帯が下の空きとつながって塊に見えた）
 * - 選手: 右の列と冒頭の棒は、艇番の隣に「フルネーム 級」（オーナー 2026-11-01）。行と字の大きさは作る側が決めて props で渡す（f01Right.js）
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
import { BG_BOTTOM, BG_TOP, MUTED, clamp, ease } from "./parts.js";
import { BOAT_COLORS } from "../../../../src/utils/colors.js";
import { NB, OPEN, RIGHT, SMALL, TODAY } from "./f01Right.js";

const GOLD = "#d4af37";
/** scripts/full-picture/f01-capture.mjs の LEFT_BOX と同じ */
const LEFT = { x: 48, y: 32, w: 1136, h: 838 };

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
  // 名前と級の列の幅・棒の長さ・左の位置は作る側が決める（f01Right.js の layoutOpen）
  const { labelW, bar: BAR, left } = open.layout;
  const label = (b) => `${b.count.toLocaleString("ja-JP")}件`;
  return (
    <AbsoluteFill>
      {/* SG・G1 の大会名（見出しの上に小さく1行。字の大きさは作る側が決める、f01.mjs の seriesSize） */}
      {open.series && (
        <div
          style={{
            position: "absolute",
            top: 44,
            width: "100%",
            textAlign: "center",
            color: MUTED,
            fontSize: open.series.size,
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
          {open.series.text}
        </div>
      )}
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
      {/* 範囲（過去の何件か）は見出しの直下。棒の名前は今日その枠にいる選手で、件数は枠ごとの過去の集計（x-channel・youtube-channel、#2079） */}
      <div
        style={{
          position: "absolute",
          top: 284,
          width: "100%",
          textAlign: "center",
          color: MUTED,
          fontSize: 32,
          fontWeight: 400,
        }}
      >
        {open.note}
      </div>
      <div style={{ position: "absolute", top: 352, left }}>
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
                  width: labelW,
                  display: "flex",
                  alignItems: "center",
                  gap: OPEN.gap,
                  fontSize: OPEN.boatSize,
                  fontWeight: 800,
                  whiteSpace: "nowrap",
                }}
              >
                <Badge boat={b.boat} size={OPEN.badge} />
                <span>号艇</span>
                <span
                  style={{
                    marginLeft: OPEN.nameGap - OPEN.gap,
                    fontSize: OPEN.nameSize,
                    fontWeight: 700,
                    color: MUTED,
                  }}
                >
                  {TODAY}
                  <span translate="no">{b.name}</span>
                  {NB}
                  {b.grade}）
                </span>
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
    </AbsoluteFill>
  );
}

/**
 * 名前と級（自動翻訳で名前が崩れないよう translate="no"）。「3号艇 品川二千翔 A1」（今日の6艇の属性）と、
 * 「3号艇（今日は品川二千翔 A1）」（過去の集計の艇。括弧は SMALL 倍・薄い色）
 */
const WHO = new RegExp(
  `(\\d号艇${NB}[^${NB}]+${NB}[AB][12]|${TODAY}[^${NB}）]+${NB}[AB][12]）)`,
);
function WithNames({ text }) {
  return text.split(WHO).map((part, i) => {
    if (i % 2 === 0) return part;
    if (part.startsWith(TODAY)) {
      const [name, grade] = part.slice(TODAY.length, -1).split(NB);
      return (
        <span
          key={i}
          style={{ fontSize: `${SMALL}em`, color: MUTED, fontWeight: 700 }}
        >
          {TODAY}
          <span translate="no">{name}</span>
          {NB}
          {grade}）
        </span>
      );
    }
    const [boat, name, grade] = part.split(NB);
    return (
      <span key={i}>
        {boat}
        {NB}
        <span translate="no">{name}</span>
        {NB}
        {grade}
      </span>
    );
  });
}

/** 右の列の1欄。行と字の大きさは作る側が決めたもの（f01Right.js の layoutRight。幅と下の線に収まることを検査済み） */
function Lines({ field, style }) {
  return (
    <div style={{ fontSize: field.size, ...style }}>
      {field.lines.map((l, i) => (
        <div key={i} style={{ whiteSpace: "nowrap" }}>
          <WithNames text={l} />
        </div>
      ))}
    </div>
  );
}

function Cut({ cut, frame }) {
  const s = cut.scale;
  const sw = cut.clip.w * s;
  const sh = cut.clip.h * s;
  const ox = LEFT.x + (LEFT.w - sw) / 2;
  // 同じ部品のカット（押す前・押した後）の箱の高さ boxH で縦の中央に置き、その箱の中では上に揃える（切り替えで位置がずれない）。
  // 違う部品は部品ごとに中央（形の札が上に小さく寄り、中央が空いていた。hq 11d 節）
  const oy = LEFT.y + (LEFT.h - (cut.boxH ?? sh)) / 2;
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
  return (
    <AbsoluteFill>
      {cut && <Cut cut={cut} frame={frame} />}
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
        {c.tag && (c.tagUntil == null || frame < c.tagUntil) && (
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
        {c.scope && (c.tagUntil == null || frame < c.tagUntil) && (
          <Lines
            field={c.right.scope}
            style={{ color: MUTED, fontWeight: 400, lineHeight: 1.4 }}
          />
        )}
        <div style={{ height: 40 }} />
        {c.answer && (
          <div style={{ opacity: fadeIn(frame, c.answerAt) }}>
            <Lines
              field={c.right.answer}
              style={{ color: GOLD, fontWeight: 900, lineHeight: 1.3 }}
            />
          </div>
        )}
        {c.answer2 && (
          <div style={{ opacity: fadeIn(frame, c.answer2At) }}>
            <Lines
              field={c.right.answer2}
              style={{ fontWeight: 700, lineHeight: 1.4 }}
            />
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
 * 終了画面: 左の画面を暗い地にするだけ。YouTube の終了画面の要素（再生リスト・登録）は YouTube Data API v3 では設定できない
 * （videos の資源に終了画面の項目が無い）ので、置き場の点線の枠と見出しは描かない（空の枠が「バグっぽい」。オーナー 11/2）。
 * 右の列の「説明欄の一番上」は隠さない
 */
function EndScreen({ from }) {
  const frame = useCurrentFrame();
  const o = fadeIn(frame, from);
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: RIGHT.x - 28,
          height: 880,
          // 実画面を写さない（重なって読めなかった。hq 11d 節）
          background: `linear-gradient(${BG_TOP}, ${BG_BOTTOM})`,
          opacity: o,
        }}
      />
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
 * サムネ（横 1280x720、オーナー 11/4 承認の形）。上の帯「{会場}{R}R {レース名} {M/D}({曜}) {日目}」（SG・G1 はその下に大会名を小さく1行）、右上の札「締切{HH:MM}」、
 * 大きな2行「{1号艇の名前} {級}」「逃げ切れる？」、下「同じ並び 過去{n0}回 1号艇の1着 {X}割」。
 * 文と大きな2行の字の大きさは作る側が決める（f01.mjs の thumb・thumbSize。長い名前は字を詰め、収まらなければ作らない）
 */
export function F01Thumb({ head = "", series = null, deadline = "", lines = [], foot = "", number = "" }) {
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
      {/* SG・G1 の大会名（上の帯の下に小さく1行。字の大きさは作る側が決める、f01.mjs の seriesSize） */}
      {series && (
        <div style={{ color: MUTED, fontSize: series.size, fontWeight: 700, whiteSpace: "nowrap", marginTop: 4 }}>
          {series.text}
        </div>
      )}
      <div
        style={{
          position: "absolute",
          top: 48,
          right: 72,
          padding: "6px 22px",
          borderRadius: 12,
          background: GOLD,
          color: "#0b1626",
          fontSize: 44,
          fontWeight: 900,
        }}
      >
        {deadline}
      </div>
      <div style={{ marginTop: series ? 32 : 56, fontWeight: 900, lineHeight: 1.15 }}>
        {lines.map((l, i) => (
          <div key={i} style={{ fontSize: l.size, whiteSpace: "nowrap" }}>
            {i === 0 ? <span translate="no">{l.text}</span> : l.text}
          </div>
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          left: 72,
          bottom: 56,
          display: "flex",
          alignItems: "baseline",
          gap: 24,
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ fontSize: 40, fontWeight: 700, color: MUTED }}>
          {foot}
        </span>
        <span
          style={{ fontSize: 120, fontWeight: 900, color: GOLD, lineHeight: 1 }}
        >
          {number}
        </span>
      </div>
    </AbsoluteFill>
  );
}
