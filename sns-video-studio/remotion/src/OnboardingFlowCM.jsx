import React from "react";
import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
} from "remotion";

/**
 * オンボーディング操作キャプチャ動画（9:16縦長、サイト埋め込み用）
 *
 * docs/design/onboarding-guide-revamp/video-script.md の5シーン構成を実装。
 * 埋め込み先（FirstVisitGuideCard・HowToUse.jsx）がモバイル最優先の縦長
 * カードで、中身もスマホの縦長実画面キャプチャのため、キャンバス自体も
 * 9:16縦長にする（16:9横長にすると、縦長画面を横長枠に収めた上でさらに
 * 狭いモバイル幅に収める二重の縮小が起き、文字が読めないほど小さくなる。
 * 2026-09-01のローカル確認で発覚し、横長版から作り直した）。
 * 実データ: 多摩川2R（2026-09-01、締切12:00、結果未確定）。
 * スクショはPlaywrightで取得済み
 * （sns-video-studio/archive/tmp/capture-onboarding-flow.mjs）。
 */

const NAVY = "#0d1b2e";
const GOLD = "#c9a227";
const WHITE = "#f8fafc";
const FONT =
  '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';

function Pop({ children, delay = 0, style }) {
  const frame = useCurrentFrame();
  const local = frame - delay;
  const scale = spring({
    frame: local,
    fps: 30,
    config: { damping: 14, mass: 0.5 },
  });
  const opacity = interpolate(local, [0, 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div style={{ opacity, transform: `scale(${scale})`, ...style }}>
      {children}
    </div>
  );
}

function Caption({ children, delay = 0 }) {
  return (
    <Pop
      delay={delay}
      style={{
        position: "absolute",
        bottom: 90,
        left: 40,
        right: 40,
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "rgba(13,27,46,0.92)",
          color: WHITE,
          fontFamily: FONT,
          fontWeight: 700,
          fontSize: 44,
          lineHeight: 1.4,
          padding: "24px 32px",
          borderRadius: 28,
          border: `2px solid ${GOLD}`,
          textAlign: "center",
        }}
      >
        {children}
      </div>
    </Pop>
  );
}

function ScreenshotCard({ src, width, height, style }) {
  return (
    <Img
      src={staticFile(src)}
      style={{
        width,
        height,
        objectFit: "contain",
        borderRadius: 20,
        boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
        ...style,
      }}
    />
  );
}

// スクショ実寸（sns-video-studio/archive/tmp/capture-onboarding-flow.mjs、390px viewport幅で撮影）
const NATIVE = {
  scene1: { w: 390, h: 844 },
  scene2: { w: 366, h: 431 },
  scene3: { w: 290, h: 333 },
  scene4: { w: 290, h: 495 },
  scene5: { w: 332, h: 740 },
};

function displaySize(key, targetHeight) {
  const { w, h } = NATIVE[key];
  return { width: Math.round((targetHeight * w) / h), height: targetHeight };
}

// --- Scene 1: 会場選択（0-5s, 150f） ---
function Scene1() {
  const size = displaySize("scene1", 1550);
  return (
    <AbsoluteFill
      style={{
        background: NAVY,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Pop delay={-10}>
        <ScreenshotCard
          src="onboarding-scene1-venue-select.png"
          width={size.width}
          height={size.height}
        />
      </Pop>
      <Caption delay={10}>まずは今日開催中の会場を選びます</Caption>
    </AbsoluteFill>
  );
}

// --- Scene 2: レース選択（5-10s, 150f） ---
function Scene2() {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, 90], [1, 1.1], {
    extrapolateRight: "clamp",
  });
  const size = displaySize("scene2", 1000);
  return (
    <AbsoluteFill
      style={{
        background: NAVY,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Pop delay={0} style={{ transform: `scale(${scale})` }}>
        <ScreenshotCard
          src="onboarding-scene2-race-card.png"
          width={size.width}
          height={size.height}
        />
      </Pop>
      <Caption delay={10}>気になるレースの「詳細を見る」をタップ</Caption>
    </AbsoluteFill>
  );
}

// --- Scene 3: AIの展開予測（10-20s, 300f） ---
function Scene3() {
  const frame = useCurrentFrame();
  const ringOpacity = interpolate(frame, [30, 40, 90, 100], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const size = displaySize("scene3", 780);
  return (
    <AbsoluteFill
      style={{
        background: NAVY,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Pop delay={0} style={{ position: "relative" }}>
        <ScreenshotCard
          src="onboarding-scene3-turn-prediction.png"
          width={size.width}
          height={size.height}
        />
        {/* 「1 逃げ 38%」行の実測相対位置に強調枠 */}
        <div
          style={{
            position: "absolute",
            left: size.width * 0.79,
            top: size.height * 0.47,
            width: size.width * 0.18,
            height: size.height * 0.08,
            border: `4px solid ${GOLD}`,
            borderRadius: 8,
            opacity: ringOpacity,
          }}
        />
      </Pop>
      <Caption delay={20}>
        AIが1号艇の「逃げ」確率をどう見ているか、ひと目でわかります
      </Caption>
    </AbsoluteFill>
  );
}

// --- Scene 4: イン崩れ指数（20-32s, 360f） ---
function Scene4() {
  const size = displaySize("scene4", 1150);
  return (
    <AbsoluteFill
      style={{
        background: NAVY,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Pop delay={0}>
        <ScreenshotCard
          src="onboarding-scene4-volatility.png"
          width={size.width}
          height={size.height}
        />
      </Pop>
      <Caption delay={15}>荒れそうなレースかどうかも一目瞭然</Caption>
    </AbsoluteFill>
  );
}

// --- Scene 5: データ出走表（32-45s, 390f） ---
function Scene5() {
  const size = displaySize("scene5", 1550);
  return (
    <AbsoluteFill
      style={{
        background: NAVY,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Pop delay={0}>
        <ScreenshotCard
          src="onboarding-scene5-data-table.png"
          width={size.width}
          height={size.height}
        />
      </Pop>
      <Caption delay={15}>
        自分でじっくり分析したい方は、データ出走表で6艇を比較できます
      </Caption>
    </AbsoluteFill>
  );
}

export function OnboardingFlowCM() {
  return (
    <AbsoluteFill>
      <Sequence from={0} durationInFrames={150}>
        <Scene1 />
      </Sequence>
      <Sequence from={150} durationInFrames={150}>
        <Scene2 />
      </Sequence>
      <Sequence from={300} durationInFrames={300}>
        <Scene3 />
      </Sequence>
      <Sequence from={600} durationInFrames={360}>
        <Scene4 />
      </Sequence>
      <Sequence from={960} durationInFrames={390}>
        <Scene5 />
      </Sequence>
    </AbsoluteFill>
  );
}
