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

/**
 * 一覧アピール型（決まり手データ分析）— 龍神レーダー Shorts
 *
 * 2026-08-24: マスコットテスト2日目（キャラB）の2本目。/winning-technique の
 * 「決まり手データ分析」機能（過去90日間の枠番別決まり手構成比）が実データ。
 * 江戸川1号艇の逃げ率93.61%という実際の集計値を使用。
 * Playwrightで実画面をスクショ取得済み（kimarite-edogawa-chart.png）。
 */

const NAVY = "#0f2c46";
const ACCENT = "#38bdf8";
const WHITE = "#f8fafc";
const GREEN = "#22c55e";
const FONT =
  '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';

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

// kimarite-edogawa-chart.png 実測値（1152x669）
const CARD_NATIVE_WIDTH = 1152;
const CARD_NATIVE_HEIGHT = 669;
const CARD_DISPLAY_WIDTH = 980;
const CARD_SCALE = CARD_DISPLAY_WIDTH / CARD_NATIVE_WIDTH;
const CARD_DISPLAY_HEIGHT = CARD_NATIVE_HEIGHT * CARD_SCALE;
const CARD_LEFT = (1080 - CARD_DISPLAY_WIDTH) / 2;
const CARD_TOP = 460;

// 「93.61%」の実測位置(x918,y525,w85,h25)に余白を足したハイライト枠
const HIGHLIGHT_REL = { x: 900, y: 512, width: 120, height: 45 };
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
          top: 140,
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
            fontSize: 28,
            padding: "12px 28px",
            borderRadius: 999,
            border: `2px solid ${ACCENT}`,
          }}
        >
          🎯 決まり手データ分析
        </div>
      </div>
      <Pop delay={0} style={{ marginBottom: 36 }}>
        <Mascot src={mascotSrc} size={400} />
      </Pop>
      <Pop delay={12}>
        <div
          style={{
            color: WHITE,
            fontSize: 46,
            fontWeight: 900,
            fontFamily: FONT,
            textAlign: "center",
            lineHeight: 1.4,
          }}
        >
          江戸川の1号艇、
          <br />
          逃げで勝つ確率が
          <br />
          異常に高いです
        </div>
      </Pop>
    </AbsoluteFill>
  );
}

// --- Scene 2: 実画面（75-350f, 9.2s） ---
function SceneReveal({ mascotSrc }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const kb = interpolate(frame, [0, durationInFrames], [1, 1.04], {
    extrapolateRight: "clamp",
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
          🎯 実際の龍神レーダー画面（江戸川）
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
          src={staticFile("kimarite-edogawa-chart.png")}
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
          top: CARD_TOP + CARD_DISPLAY_HEIGHT + 70,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <Pop delay={40}>
          <div
            style={{
              color: GREEN,
              fontFamily: FONT,
              fontWeight: 900,
              fontSize: 40,
              textAlign: "center",
            }}
          >
            1号艇の1着、219回中205回が逃げ！
          </div>
        </Pop>
      </div>

      <div
        style={{
          position: "absolute",
          top: CARD_TOP + CARD_DISPLAY_HEIGHT + 170,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <Pop delay={55}>
          <Mascot src={mascotSrc} size={200} />
        </Pop>
      </div>
    </AbsoluteFill>
  );
}

// --- Scene 3: CTA（350-425f, 2.5s） ---
function SceneCTA() {
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
            color: GREEN,
            fontSize: 34,
            fontWeight: 900,
            fontFamily: FONT,
            marginBottom: 34,
            textAlign: "center",
            padding: "0 60px",
          }}
        >
          会場ごとの決まり手傾向、無料公開中
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

export function KimariteCM_B() {
  const mascotSrc = "mascot-b.png";
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
