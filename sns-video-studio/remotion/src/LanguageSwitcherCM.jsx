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
import { Fade, Logo, RadarDecoration, NAVY, GOLD, WHITE, FONT } from "./noteVideoShared.jsx";
import { SceneCTA } from "./snsVideoShared.jsx";

/**
 * X/TikTok向けショート動画（縦型 1080x1920）— 龍神レーダー「4言語切替」
 *
 * ネタ駆動マルチチャネルパイプライン初回実行（2026-09-03、new-featureソースの
 * 既存機能ライフハック型、isGamblingRelevant:false）。成績・確率を一切扱わない
 * UI機能紹介のためTikTokにも展開可能。
 *
 * CTAはbrand-kit.md「X / TikTok 動画CTA」ルールに従い、新規テンプレートとして
 * `snsVideoShared.jsx`のSceneCTAを使用する（既存21本の移行対象ではなく新規制作）。
 * タイトルは全編を通してヘッダー固定表示し、
 * 「タイトルがないのでわかりづらい」という過去の却下理由（tiktok/venue-ranking系）
 * を踏まえて最も目立つ位置に常設する。
 */

function TitleBar({ text }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 90,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        padding: "0 48px",
      }}
    >
      <div
        style={{
          color: GOLD,
          fontFamily: FONT,
          fontWeight: 900,
          fontSize: 64,
          lineHeight: 1.3,
          textAlign: "center",
          textShadow: `0 0 40px ${GOLD}55`,
        }}
      >
        {text}
      </div>
    </div>
  );
}

function HighlightBox({ box, from, durationInFrames }) {
  const frame = useCurrentFrame();
  const local = frame - from;
  const fadeIn = interpolate(local, [4, 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(
    local,
    [durationInFrames - 12, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const opacity = Math.min(fadeIn, fadeOut);
  return (
    <div
      style={{
        position: "absolute",
        ...box,
        border: `4px solid ${GOLD}`,
        borderRadius: 10,
        opacity,
        boxShadow: "0 0 0 5px rgba(212,175,55,0.25)",
      }}
    />
  );
}

function Caption({ text, from, durationInFrames }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - from - 8;
  const scale = spring({
    frame: Math.max(local, 0),
    fps,
    config: { damping: 12, mass: 0.5 },
  });
  const fadeIn = interpolate(local, [0, 6], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(
    frame - from,
    [durationInFrames - 12, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const opacity = Math.min(fadeIn, fadeOut);
  return (
    <div
      style={{
        position: "absolute",
        bottom: 340,
        left: 48,
        right: 48,
        display: "flex",
        justifyContent: "center",
        opacity,
        transform: `scale(${scale})`,
      }}
    >
      <div
        style={{
          color: WHITE,
          fontFamily: FONT,
          fontWeight: 900,
          fontSize: 42,
          background: "rgba(15,44,70,0.92)",
          border: `2px solid ${GOLD}`,
          borderRadius: 16,
          padding: "18px 32px",
          textAlign: "center",
        }}
      >
        {text}
      </div>
    </div>
  );
}

// screenshot: language-switcher-dropdown.png（CSS px基準1600x260でPlaywright実測クリップ撮影）
const IMAGE_WIDTH = 980;
const IMAGE_LEFT = (1080 - IMAGE_WIDTH) / 2;
const IMAGE_TOP = 760;
const SOURCE_WIDTH = 1600;
const IMAGE_SCALE = IMAGE_WIDTH / SOURCE_WIDTH;

function scaleRect([relTop, relLeft, w, h]) {
  return {
    top: IMAGE_TOP + relTop * IMAGE_SCALE - 6,
    left: IMAGE_LEFT + relLeft * IMAGE_SCALE - 6,
    width: w * IMAGE_SCALE + 12,
    height: h * IMAGE_SCALE + 12,
  };
}

// [relTop, relLeft, width, height]（Playwright boundingBox実測値、CSS px）
const RECTS = {
  trigger: [28.98, 1399.44, 54.98, 26.78],
  dropdown: [63.77, 1314.42, 140, 174],
};

const HOOK_DURATION = 75;
const SCREEN_DURATION = 240;
const CTA_DURATION = 105;

function SceneHook() {
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(135deg, #163a5c 0%, ${NAVY} 55%, #081521 100%)`,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "38%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          opacity: 0.1,
        }}
      >
        <RadarDecoration size={640} />
      </div>
      <div style={{ position: "absolute", top: 56, left: 48 }}>
        <Logo size={44} />
      </div>
      <Fade delay={-10} style={{ position: "absolute", top: 500, left: 0, right: 0 }}>
        <div
          style={{
            color: GOLD,
            fontFamily: FONT,
            fontWeight: 900,
            fontSize: 76,
            lineHeight: 1.3,
            textAlign: "center",
            padding: "0 60px",
            textShadow: `0 0 50px ${GOLD}66`,
          }}
        >
          実は4言語対応
          <br />
          してるって知ってた？
        </div>
      </Fade>
      <Fade delay={-10} style={{ position: "absolute", top: 900, left: 0, right: 0 }}>
        <div
          style={{
            color: WHITE,
            fontFamily: FONT,
            fontWeight: 700,
            fontSize: 38,
            textAlign: "center",
          }}
        >
          日本語 / English / 繁體中文 / 한국어
        </div>
      </Fade>
    </AbsoluteFill>
  );
}

function SceneScreenshot() {
  const frame = useCurrentFrame();
  const features = [
    { box: scaleRect(RECTS.trigger), caption: "🌐ボタンをタップ", from: 0, durationInFrames: 120 },
    { box: scaleRect(RECTS.dropdown), caption: "好きな言語を選ぶだけ", from: 120, durationInFrames: 120 },
  ];
  return (
    <AbsoluteFill style={{ background: NAVY, overflow: "hidden" }}>
      <TitleBar text="4言語切替の使い方" />
      <div
        style={{
          position: "absolute",
          top: 260,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            background: "rgba(15,44,70,0.85)",
            color: GOLD,
            fontFamily: FONT,
            fontWeight: 800,
            fontSize: 30,
            padding: "12px 30px",
            borderRadius: 999,
            border: `2px solid ${GOLD}`,
          }}
        >
          🎯 実際の龍神レーダー画面
        </div>
      </div>
      <Fade delay={0} durationIn={15}>
        <div
          style={{
            position: "absolute",
            top: IMAGE_TOP,
            left: IMAGE_LEFT,
            width: IMAGE_WIDTH,
          }}
        >
          <Img
            src={staticFile("language-switcher-dropdown.png")}
            style={{
              width: "100%",
              display: "block",
              borderRadius: 16,
              boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
            }}
          />
        </div>
      </Fade>
      {features.map((f) => (
        <HighlightBox key={f.caption} box={f.box} from={f.from} durationInFrames={f.durationInFrames} />
      ))}
      {features.map((f) => (
        <Caption key={f.caption} text={f.caption} from={f.from} durationInFrames={f.durationInFrames} />
      ))}
    </AbsoluteFill>
  );
}

export function LanguageSwitcherCM() {
  return (
    <AbsoluteFill>
      <Audio src={staticFile("soundtrack.wav")} volume={0.35} />
      <Sequence from={0} durationInFrames={HOOK_DURATION}>
        <SceneHook />
      </Sequence>
      <Sequence from={HOOK_DURATION} durationInFrames={SCREEN_DURATION}>
        <SceneScreenshot />
      </Sequence>
      <Sequence from={HOOK_DURATION + SCREEN_DURATION} durationInFrames={CTA_DURATION}>
        <SceneCTA
          ctaLines={["4言語対応してるって、", "無料で使える"]}
          subLine="日本語 / English / 繁體中文 / 한국어"
        />
      </Sequence>
    </AbsoluteFill>
  );
}
