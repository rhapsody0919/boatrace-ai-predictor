/**
 * YouTube Shorts【人気薄の1着】（縦 1080x1920・25〜35秒・声つき、BOA-1284）。props は作り手（scripts/upset-win/daily.mjs）の bundle.json そのまま。
 * 型・文・検査は model.js。描く前に checkBundle を通し、通らなければ描かずに止める（作らない）。画面の文は bundle.texts だけを描く
 * （texts は checkBundle が値から作り直した文と照らしてある）。
 * 文字は y≤1400・x≤940（Shorts の下の帯と右のボタン列の外）。各コマで DOM の実際の箱を測り、越えたら止める。
 * 見本: hq drafts/fp-youtube-type/b-upset/（b1-hook・b2-table・b3-result、オーナー 2026-11-04 承認）。色・並びは見本に合わせ、
 * 位置は安全な範囲に収めるため上に詰めた（見本の下の帯 y1760 の札は y1330 に）。
 *
 * 描く: npx remotion render src/index.jsx UpsetWinShort out.mp4 --props=bundle.json --public-dir=<声の wav のある所>
 */
import { useLayoutEffect, useRef } from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  cancelRender,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { FONT } from "../fonts.js";
import { useGlyphGuard } from "../fonts/useGlyphGuard.js";
import { fitHeadline } from "../textFit.js";
import rules from "../../risk-rules.json";
import { matchRiskRules } from "../../../../scripts/lib/riskRuleMatcher.js";
import {
  CENTER_MAX_W,
  CX,
  MIN_FONT,
  SAFE,
  TABLE,
  checkBundle,
  redCells,
  tableLayout,
  timeline,
} from "./model.js";

const BG = "#0c1830";
const INK = "#f5f5f5";
const SUB = "#96a5be";
const GOLD = "#e8b830";
const RED = "#e65050";
const BOAT = {
  1: ["#ffffff", "#141414"],
  2: ["#141414", "#ffffff"],
  3: ["#dc3232", "#ffffff"],
  4: ["#286edc", "#ffffff"],
  5: ["#f0c828", "#141414"],
  6: ["#28964a", "#ffffff"],
};
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };
const fadeIn = (frame, at, len = 8) =>
  interpolate(frame, [at, at + len], [0, 1], clamp);

/** 文字の要素（data-uw で箱の検査の対象にする）。幅に収まる大きさまで下げる（36px でも収まらなければ元の大きさで描き、箱の検査で止める） */
function T({
  x = null,
  y,
  size,
  color = INK,
  weight = 900,
  w = null,
  align = "left",
  children,
  style = {},
}) {
  const centered = x == null;
  const maxW = centered ? CENTER_MAX_W : (w ?? SAFE.right - 10 - x);
  const fit = fitHeadline(children, {
    maxWidth: maxW,
    maxLines: 1,
    fontFamily: FONT,
    fontWeight: weight,
    maxFontSize: size,
    minFontSize: Math.min(size, MIN_FONT),
    step: 1,
  });
  const fs =
    fit.lines.length === 1 && fit.lines[0] === children ? fit.fontSize : size;
  const pos = centered
    ? { left: CX - CENTER_MAX_W / 2, width: CENTER_MAX_W, textAlign: "center" }
    : { left: x, ...(w ? { width: w, textAlign: align } : {}) };
  return (
    <div
      style={{
        position: "absolute",
        top: y,
        fontSize: fs,
        fontWeight: weight,
        color,
        whiteSpace: "nowrap",
        lineHeight: 1.2,
        ...pos,
        ...style,
      }}
    >
      <span data-uw="">{children}</span>
    </div>
  );
}

function Frame({ t, footer }) {
  return (
    <>
      <T x={60} y={140} size={40} color={SUB} weight={700}>
        {t.header}
      </T>
      <T x={60} y={1330} size={36} color={SUB} weight={700}>
        {footer}
      </T>
    </>
  );
}

function Hook({ t }) {
  const f = useCurrentFrame();
  const two = t.hook.length === 2;
  return (
    <>
      <Frame t={t} footer={t.footer} />
      {t.hook.map((line, i) => (
        <T
          key={i}
          y={two ? 400 + i * 160 : 400 + i * 160}
          size={120}
          style={{ opacity: fadeIn(f, i * 5) }}
        >
          {line}
        </T>
      ))}
      <T y={780} size={150} color={GOLD} style={{ opacity: fadeIn(f, 12) }}>
        {t.hook_em}
      </T>
      <T y={1060} size={64} style={{ opacity: fadeIn(f, 18) }}>
        {t.hook_who}
      </T>
      <T y={1150} size={56} color={SUB} style={{ opacity: fadeIn(f, 18) }}>
        {t.hook_odds}
      </T>
    </>
  );
}

function Table({ b, t }) {
  const f = useCurrentFrame();
  const { cols, gradeX, nameW } = tableLayout(b);
  const red = redCells(b);
  const rowY = (i) => TABLE.top + 70 + i * TABLE.rowH;
  return (
    <>
      <Frame t={t} footer={t.footer} />
      <T y={220} size={72}>
        {t.table_title}
      </T>
      <T
        x={TABLE.boatX}
        y={TABLE.top}
        size={TABLE.headFont}
        color={SUB}
        weight={700}
      >
        {t.table_head[0]}
      </T>
      <T
        x={TABLE.nameX}
        y={TABLE.top}
        size={TABLE.headFont}
        color={SUB}
        weight={700}
      >
        {t.table_head[1]}
      </T>
      <T
        x={gradeX}
        y={TABLE.top}
        size={TABLE.headFont}
        color={SUB}
        weight={700}
      >
        {t.table_head[2]}
      </T>
      {cols.map((c, i) => {
        // 2行の見出し（「モーター」「2連率」）は1行目を上に出す
        const lines = t.table_head[3 + i].split("\n");
        return lines.map((line, j) => (
          <T
            key={`${c.key}-${j}`}
            x={c.x}
            w={c.w}
            align="right"
            y={TABLE.top - (lines.length - 1 - j) * 44}
            size={TABLE.headFont}
            color={SUB}
            weight={700}
          >
            {line}
          </T>
        ));
      })}
      {t.table_rows.map((row, i) => {
        const boat = i + 1;
        const y = rowY(i);
        const [bg, fg] = BOAT[boat];
        const op = fadeIn(f, 6 + i * 3);
        return (
          <div key={boat} style={{ opacity: op }}>
            {boat === b.rank1 && (
              <div
                style={{
                  position: "absolute",
                  left: 40,
                  top: y - 22,
                  width: SAFE.right + 16 - 40,
                  height: 114,
                  border: `6px solid ${GOLD}`,
                  borderRadius: 16,
                  boxSizing: "border-box",
                }}
              />
            )}
            <div
              style={{
                position: "absolute",
                left: TABLE.boatX,
                top: y - 6,
                width: TABLE.boatW,
                height: 70,
                borderRadius: 10,
                background: bg,
                border: "2px solid #5a5a5a",
                boxSizing: "border-box",
                color: fg,
                fontSize: 50,
                fontWeight: 900,
                textAlign: "center",
                lineHeight: "66px",
              }}
            >
              {row[0]}
            </div>
            <T x={TABLE.nameX} w={nameW} y={y} size={TABLE.font}>
              {row[1]}
            </T>
            <T x={gradeX} y={y} size={TABLE.font}>
              {row[2]}
            </T>
            {cols.map((c, j) => {
              const isRed = c.key !== "odds" && red[c.key]?.includes(boat);
              return (
                <T
                  key={c.key}
                  x={c.x}
                  w={c.w}
                  align="right"
                  y={y}
                  size={TABLE.font}
                  color={isRed ? RED : INK}
                >
                  {row[3 + j]}
                </T>
              );
            })}
          </div>
        );
      })}
      <T x={60} y={rowY(6) + 10} size={40} color={RED} weight={700}>
        {t.table_note}
      </T>
    </>
  );
}

function Result({ t }) {
  const f = useCurrentFrame();
  return (
    <>
      <Frame t={t} footer={t.footer_last} />
      <T y={290} size={60} color={SUB}>
        {t.result_label}
      </T>
      <T y={380} size={88} color={GOLD}>
        {t.result}
      </T>
      <T y={640} size={52} style={{ opacity: fadeIn(f, 20) }}>
        {t.cond}
      </T>
      <T y={730} size={60} style={{ opacity: fadeIn(f, 26) }}>
        {t.year_n}
      </T>
      <T y={830} size={160} color={GOLD} style={{ opacity: fadeIn(f, 32) }}>
        {t.year_k}
      </T>
      <T y={1050} size={72} style={{ opacity: fadeIn(f, 40) }}>
        {t.one_in}
      </T>
      <T
        y={1160}
        size={40}
        color={SUB}
        weight={700}
        style={{ opacity: fadeIn(f, 40) }}
      >
        {t.tie}
      </T>
    </>
  );
}

/** 文字の箱が SAFE（x≤940・y≤1400）を越えたら描くのを止める（黙ってはみ出さない） */
function useBoundsGuard(ref) {
  const frame = useCurrentFrame();
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const rr = root.getBoundingClientRect();
    const scale = rr.width / 1080 || 1;
    for (const el of root.querySelectorAll("[data-uw]")) {
      const r = el.getBoundingClientRect();
      const right = (r.right - rr.left) / scale;
      const bottom = (r.bottom - rr.top) / scale;
      const left = (r.left - rr.left) / scale;
      if (right > SAFE.right + 0.5 || bottom > SAFE.bottom + 0.5 || left < -0.5)
        cancelRender(
          new Error(
            `文字が安全な範囲（x≤${SAFE.right}・y≤${SAFE.bottom}）を越えた（コマ ${frame}、x${Math.round(left)}〜${Math.round(right)}・下端 y${Math.round(bottom)}）: ${el.textContent}`,
          ),
        );
    }
  }, [frame, ref]);
}

const VIEWS = { hook: Hook, table: Table, result: Result };

export function UpsetWinShort(b) {
  const why = checkBundle(b, { rules: rules.rules, matchRiskRules });
  if (why.length)
    cancelRender(
      new Error(
        `【人気薄の1着】の bundle が検査を通らない（作らない）:\n- ${why.join("\n- ")}`,
      ),
    );
  const ref = useRef(null);
  useBoundsGuard(ref);
  useGlyphGuard();
  const tl = timeline(b);
  return (
    <AbsoluteFill style={{ background: BG, fontFamily: FONT, color: INK }}>
      <div
        ref={ref}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 1080,
          height: 1920,
        }}
      >
        {tl.chapters.map((c) => {
          const View = VIEWS[c.id];
          return (
            <Sequence
              key={c.id}
              from={c.from}
              durationInFrames={c.len}
              layout="none"
            >
              <View b={b} t={b.texts} />
              <Audio src={staticFile(b.pages[c.id].file)} />
            </Sequence>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

export const upsetWinMetadata = ({ props }) => ({
  durationInFrames: Math.max(1, timeline(props).total),
});
