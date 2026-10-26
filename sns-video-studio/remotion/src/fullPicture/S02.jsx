/**
 * 型 s02-loss-breakdown-card の札と重ね（静止画）。数字と文は scripts/full-picture/s02.mjs、つなぐのは prototype-s02.mjs（ffmpeg）。
 * 台本: docs/design/full-picture-type-gate/candidates/s02-loss-breakdown-card/script.md
 * - S02Card: 冒頭 1.5秒の札（背景あり）。y250〜1400 に収める
 * - S02Overlay: 答えの頁・着順の流れの場面に重ねる透明の画像。問いの1行（question）と艇ごとの件数の札（chips）。
 *   答えの頁は y1420 まで使うので、その下（y1440〜1700）に置き、x940 より右（Shorts の右のボタン列）には置かない
 */
import { AbsoluteFill } from "remotion";
import { FONT } from "../fonts.js";
import { BG_BOTTOM, BG_TOP, MUTED, fit1 } from "./parts.js";
import { BOAT_COLORS } from "../../../../src/utils/colors.js";

const GOLD = "#d4af37";
const LEFT = 60;
const RIGHT = 940;

export function S02Card({ head, lines, band }) {
  // 主の文字は2行とも同じ大きさで幅に収める（件数が4桁の日も。最大 84px）。収まらなければ止める（黙ってはみ出さない）
  const size = Math.min(
    ...lines.map((l) => {
      const f = fit1(l, RIGHT - LEFT, 84, 900);
      if (!f) throw new Error(`札の文字が ${RIGHT - LEFT}px に収まらない: ${l}`);
      return f.fontSize;
    }),
  );
  const total = band.win + band.loss;
  // 帯は割合どおりの幅（件数の字は帯の上の行に出すので、狭い側でもはみ出さない）
  const winW = Math.round((band.win / total) * (RIGHT - LEFT));
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(${BG_TOP}, ${BG_BOTTOM})`,
        fontFamily: FONT,
        color: "#fff",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: LEFT,
          top: 300,
          width: RIGHT - LEFT,
          fontSize: 48,
          fontWeight: 700,
          color: MUTED,
        }}
      >
        {head}
      </div>
      <div
        style={{
          position: "absolute",
          left: LEFT,
          top: 520,
          width: RIGHT - LEFT,
        }}
      >
        {lines.map((l, i) => (
          <div
            key={i}
            style={{
              fontSize: size,
              fontWeight: 900,
              lineHeight: 1.4,
              color: i === lines.length - 1 ? GOLD : "#fff",
              whiteSpace: "nowrap",
            }}
          >
            {l}
          </div>
        ))}
      </div>
      {/* 件数だけの帯（割合は答えの頁に任せる。台本会議 youtube-channel P2）。件数の字は上の行、帯は割合どおり */}
      <div style={{ position: "absolute", left: LEFT, top: 960, width: RIGHT - LEFT, display: "flex", justifyContent: "space-between", fontSize: 52, fontWeight: 900 }}>
        <span style={{ color: "#fff" }}>1着 {band.win.toLocaleString("ja-JP")}件</span>
        <span style={{ color: GOLD }}>負け {band.loss.toLocaleString("ja-JP")}件</span>
      </div>
      <div style={{ position: "absolute", left: LEFT, top: 1050, width: RIGHT - LEFT, height: 60, display: "flex", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ width: winW, background: "#ffffff" }} />
        <div style={{ flex: 1, background: GOLD }} />
      </div>
      <div style={{ position: "absolute", left: LEFT, top: 1140, width: RIGHT - LEFT, fontSize: 36, color: MUTED }}>1号艇の過去の着順（級の並びが同じ・枠なり）</div>
    </AbsoluteFill>
  );
}

export function S02Overlay({ question = null, chips = null }) {
  return (
    <AbsoluteFill style={{ background: "transparent", fontFamily: FONT }}>
      {question && (
        <div
          style={{
            position: "absolute",
            left: LEFT,
            top: 1440,
            width: RIGHT - LEFT,
            textAlign: "center",
            fontSize: 60,
            fontWeight: 900,
            color: GOLD,
            textShadow: "0 2px 8px #000",
          }}
        >
          {question}
        </div>
      )}
      {chips && (
        <div
          style={{
            position: "absolute",
            left: LEFT,
            top: question ? 1540 : 1450,
            width: RIGHT - LEFT,
          }}
        >
          <div
            style={{
              fontSize: 40,
              fontWeight: 800,
              color: "#fff",
              marginBottom: 12,
              textShadow: "0 2px 8px #000",
            }}
          >
            {chips.title}
          </div>
          <div style={{ display: "flex", gap: 16 }}>
            {chips.by.map((c) => (
              <div
                key={c.boat}
                style={{
                  flex: 1,
                  height: 130,
                  borderRadius: 16,
                  background: BOAT_COLORS[c.boat].bg,
                  color: BOAT_COLORS[c.boat].text,
                  border: c.boat === 2 ? "3px solid #fff" : "none",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div style={{ fontSize: 36, fontWeight: 800 }}>
                  {c.boat}号艇
                </div>
                <div style={{ fontSize: 56, fontWeight: 900 }}>
                  {c.count.toLocaleString("ja-JP")}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
}
