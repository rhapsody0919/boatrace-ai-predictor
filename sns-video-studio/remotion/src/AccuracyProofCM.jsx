import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { FONT } from "./fonts.js";
import { fitHeadline } from "./textFit.js";

/**
 * 一覧アピール型（イン崩れ指数の実績証明）— 龍神レーダー Shorts
 *
 * 2026-08-25: マスコットテスト3日目（キャラC）の2本目。
 * /winning-technique の「イン崩れ指数の実績」機能が実データ。
 * 「イン崩れ確率高」ラベルのレースは実際に63.3%の確率で1号艇が1着になっていない
 * （全体平均45.4%、集計1,632レース、2026年8月11日運用開始の新AI予想モデル）。
 * 個別レースの答え合わせではなく、AIの警告シグナルそのものの精度を証明する型。
 * Playwrightで実画面をスクショ取得済み（inkuzure-jisseki-chart.png）。
 */

const NAVY = "#0f2c46";
const ACCENT = "#38bdf8";
const WHITE = "#f8fafc";
const GREEN = "#22c55e";
const GOLD = "#d4af37";

function Pop({ children, delay = 0, style }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - delay;
  const scale = spring({
    frame: local,
    fps,
    config: { damping: 12, mass: 0.5 },
  });
  const opacity = interpolate(local, [0, 6], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div style={{ opacity, transform: `scale(${scale})`, ...style }}>
      {children}
    </div>
  );
}

function PulseRings({ color = ACCENT, size = 420, top = "50%" }) {
  const frame = useCurrentFrame();
  return (
    <>
      {[0, 25, 50].map((delay) => {
        const local = frame - delay;
        const scale = interpolate(local % 75, [0, 75], [0.3, 2.6], {
          extrapolateLeft: "clamp",
        });
        const opacity = interpolate(local % 75, [0, 75], [0.35, 0], {
          extrapolateLeft: "clamp",
        });
        return (
          <div
            key={delay}
            style={{
              position: "absolute",
              top,
              left: "50%",
              width: size,
              height: size,
              marginLeft: -size / 2,
              marginTop: -size / 2,
              borderRadius: "50%",
              border: `3px solid ${color}`,
              transform: `scale(${scale})`,
              opacity,
            }}
          />
        );
      })}
    </>
  );
}

function Logo({ size = 44 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: size / 4,
          background: ACCENT,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: size * 0.55,
        }}
      >
        🐉
      </div>
      <span
        style={{
          color: WHITE,
          fontSize: size * 0.5,
          fontWeight: 900,
          fontFamily: FONT,
          letterSpacing: -1,
        }}
      >
        龍神レーダー
      </span>
    </div>
  );
}

function Mascot({ src, size = 260, style }) {
  return (
    <Img
      src={staticFile(src)}
      style={{
        width: size,
        height: "auto",
        objectFit: "contain",
        filter: "drop-shadow(0 12px 24px rgba(0,0,0,0.35))",
        ...style,
      }}
    />
  );
}

// inkuzure-jisseki-chart.png 実測値（1200x292）
const CARD_NATIVE_WIDTH = 1200;
const CARD_NATIVE_HEIGHT = 292;
const CARD_DISPLAY_WIDTH = 1000;
const CARD_SCALE = CARD_DISPLAY_WIDTH / CARD_NATIVE_WIDTH;
const CARD_DISPLAY_HEIGHT = CARD_NATIVE_HEIGHT * CARD_SCALE;
const CARD_LEFT = (1080 - CARD_DISPLAY_WIDTH) / 2;
const CARD_TOP = 460;

// 「63.3%」（イン崩れ確率高バーの右端ラベル）の実測位置(x1094,y221,w56,h24)に余白を足したハイライト枠
const HIGHLIGHT_REL = { x: 1074, y: 203, width: 100, height: 58 };
const HIGHLIGHT_BOX = {
  left: CARD_LEFT + HIGHLIGHT_REL.x * CARD_SCALE,
  top: CARD_TOP + HIGHLIGHT_REL.y * CARD_SCALE,
  width: HIGHLIGHT_REL.width * CARD_SCALE,
  height: HIGHLIGHT_REL.height * CARD_SCALE,
};

function HighlightRing({ delay = 0 }) {
  const frame = useCurrentFrame();
  const local = frame - delay;
  const scale = spring({ frame: local, fps: 30, config: { damping: 14 } });
  const opacity = interpolate(local, [0, 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        ...HIGHLIGHT_BOX,
        border: "6px solid #f59e0b",
        borderRadius: 16,
        opacity,
        transform: `scale(${scale})`,
        boxShadow: "0 0 0 6px rgba(245,158,11,0.25)",
      }}
    />
  );
}

// --- Scene 1: フック（0-75f, 2.5s） ---
// 2026-09-12: 「AIが警告したレース、実際どれくらい当たってるのか」という
// 問いかけのみの構成はフック強度基準未達（docs/reference/brand-kit.md
// 「シーンのフック強度均一化」）。ヒーロー数値を別枠追加するのではなく、
// 見出し自体を実数値（63.3% / 平均45.4%）に差し替えてGOLD・108px以上にした
function SceneHook({ mascotSrc }) {
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% 30%, #1c4a73 0%, ${NAVY} 65%)`,
        justifyContent: "center",
        alignItems: "center",
        padding: "0 70px",
        overflow: "hidden",
      }}
    >
      <PulseRings size={760} />
      <div
        style={{
          position: "absolute",
          top: 110,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            background: "rgba(15,44,70,0.85)",
            color: WHITE,
            fontFamily: FONT,
            fontWeight: 800,
            fontSize: 26,
            padding: "10px 26px",
            borderRadius: 999,
            border: `2px solid ${ACCENT}`,
          }}
        >
          🔍 AI予想の実績証明
        </div>
      </div>
      <Pop delay={-10} style={{ textAlign: "center" }}>
        <div
          style={{
            color: WHITE,
            fontSize: 28,
            fontWeight: 700,
            fontFamily: FONT,
            marginBottom: 4,
          }}
        >
          AIが「荒れる」と警告したレースは
        </div>
        <div
          style={{
            color: GOLD,
            fontSize: 138,
            fontWeight: 900,
            fontFamily: FONT,
            lineHeight: 1,
          }}
        >
          63.3%
        </div>
        <div
          style={{
            color: WHITE,
            fontSize: 28,
            fontWeight: 700,
            fontFamily: FONT,
            marginTop: 10,
            marginBottom: 4,
          }}
        >
          で1号艇が1着を外れる（全体平均）
        </div>
        <div
          style={{
            color: GOLD,
            fontSize: 112,
            fontWeight: 900,
            fontFamily: FONT,
            lineHeight: 1,
          }}
        >
          45.4%
        </div>
      </Pop>
      <Pop delay={-10} style={{ marginTop: 28 }}>
        <Mascot src={mascotSrc} size={160} />
      </Pop>
    </AbsoluteFill>
  );
}

// --- Scene 2: 実画面（75-350f, 9.2s） ---
const REVEAL_HIGHLIGHT_MAX_WIDTH = 940; // 1080 - 左右余白70px*2弱
function SceneReveal({ mascotSrc }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const kb = interpolate(frame, [0, durationInFrames], [1, 1.04], {
    extrapolateRight: "clamp",
  });
  // 2026-09-12: 「平均より18ポイントも高い…！」40px GREENはフック強度基準未達。
  // GOLD・108px以上に統一し、可変長でも崩れないようfitHeadline()でサイズを決める
  const highlightFit = fitHeadline("平均より18ポイント高い", {
    maxWidth: REVEAL_HIGHLIGHT_MAX_WIDTH,
    maxLines: 2,
    fontFamily: FONT,
    fontWeight: 900,
    maxFontSize: 140,
    minFontSize: 108,
  });

  return (
    <AbsoluteFill style={{ background: NAVY, overflow: "hidden" }}>
      <PulseRings color={GREEN} size={900} top="10%" />
      <div
        style={{
          position: "absolute",
          top: 90,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            background: "rgba(15,44,70,0.85)",
            color: WHITE,
            fontFamily: FONT,
            fontWeight: 800,
            fontSize: 26,
            padding: "12px 28px",
            borderRadius: 999,
            border: `2px solid ${ACCENT}`,
          }}
        >
          🎯 実際の龍神レーダー画面（実績ページ）
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: CARD_LEFT,
          top: CARD_TOP,
          width: CARD_DISPLAY_WIDTH,
          transform: `scale(${kb})`,
          transformOrigin: "50% 0%",
        }}
      >
        <Img
          src={staticFile("inkuzure-jisseki-chart.png")}
          style={{
            width: "100%",
            display: "block",
            borderRadius: 20,
            boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          }}
        />
      </div>
      <HighlightRing delay={20} />

      <div
        style={{
          position: "absolute",
          top: CARD_TOP + CARD_DISPLAY_HEIGHT + 50,
          left: 0,
          right: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "0 70px",
        }}
      >
        <Pop delay={40}>
          <div
            style={{
              color: GOLD,
              fontFamily: FONT,
              fontWeight: 900,
              lineHeight: 1.15,
              textAlign: "center",
            }}
          >
            {highlightFit.lines.map((line, i) => (
              <div key={i} style={{ fontSize: highlightFit.fontSize }}>
                {line}
              </div>
            ))}
          </div>
        </Pop>
        <Pop delay={55} style={{ marginTop: 24 }}>
          <Mascot src={mascotSrc} size={200} />
        </Pop>
      </div>
    </AbsoluteFill>
  );
}

// --- Scene 3: CTA（350-425f, 2.5s） ---
const CTA_HEADLINE_MAX_WIDTH = 940; // 1080 - 左右padding60px*2弱
function SceneCTA() {
  // 2026-09-12: 「AI予想の実績、全部公開中」34px GREENはフック強度基準未達。
  // GOLD・108px以上・fitHeadline()で統一
  const headlineFit = fitHeadline("AI予想の実績、全部公開中", {
    maxWidth: CTA_HEADLINE_MAX_WIDTH,
    maxLines: 2,
    fontFamily: FONT,
    fontWeight: 900,
    maxFontSize: 130,
    minFontSize: 108,
  });
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% 40%, #163a5c 0%, ${NAVY} 55%, #050e18 100%)`,
        justifyContent: "center",
        alignItems: "center",
        overflow: "hidden",
      }}
    >
      <PulseRings color={GREEN} size={760} />
      <Pop delay={2}>
        <div
          style={{
            color: GOLD,
            fontWeight: 900,
            fontFamily: FONT,
            marginBottom: 34,
            textAlign: "center",
            padding: "0 60px",
            lineHeight: 1.2,
          }}
        >
          {headlineFit.lines.map((line, i) => (
            <div key={i} style={{ fontSize: headlineFit.fontSize }}>
              {line}
            </div>
          ))}
        </div>
      </Pop>
      <Pop delay={10}>
        <Logo size={110} />
      </Pop>
      <Pop delay={20}>
        <div
          style={{
            marginTop: 40,
            padding: "20px 50px",
            borderRadius: 999,
            background: ACCENT,
            color: NAVY,
            fontSize: 40,
            fontWeight: 900,
            fontFamily: FONT,
          }}
        >
          boat-ai.jp
        </div>
      </Pop>
    </AbsoluteFill>
  );
}

export function AccuracyProofCM_C() {
  const mascotSrc = "mascot-c.png";
  return (
    <AbsoluteFill>
      <Audio src={staticFile("soundtrack-hitcheck.wav")} />
      <Sequence from={0} durationInFrames={75}>
        <SceneHook mascotSrc={mascotSrc} />
      </Sequence>
      <Sequence from={75} durationInFrames={275}>
        <SceneReveal mascotSrc={mascotSrc} />
      </Sequence>
      <Sequence from={350} durationInFrames={75}>
        <SceneCTA />
      </Sequence>
    </AbsoluteFill>
  );
}
