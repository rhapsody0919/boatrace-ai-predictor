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

/**
 * X/TikTok向け・縦型(1080x1920)ショート — 龍神レーダー「言語切替（4言語対応）」
 *
 * content-multi-channel-pipeline（new-featureソース、既存機能の使い方ライフハック型）。
 * ToolShowcaseCM.jsxのHook/ZoomedTool（実画面スクショの上部だけ見せる）/CTA構成パターンを再利用。
 * 素材は`lang-switcher-{lang}.png`（1080幅、Playwright実測でヘッダー+切替メニューが
 * 上部に収まることを確認済み）。isGamblingRelevant:falseのためTikTokにも展開可（成績・確率と無関係）。
 */

const NAVY = "#0f2c46";
const ACCENT = "#38bdf8";
const WHITE = "#f8fafc";
const GREEN = "#22c55e";

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

function PulseRings({ color = ACCENT }) {
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
              top: "50%",
              left: "50%",
              width: 420,
              height: 420,
              marginLeft: -210,
              marginTop: -210,
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

// --- Scene 1: フック（0-60f, 2s） ---
function SceneHook() {
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% 32%, #1c4a73 0%, ${NAVY} 65%)`,
        justifyContent: "center",
        alignItems: "center",
        padding: "0 70px",
        overflow: "hidden",
      }}
    >
      <PulseRings />
      <Pop delay={-10}>
        <div
          style={{
            color: WHITE,
            fontSize: 44,
            fontWeight: 900,
            fontFamily: FONT,
            textAlign: "center",
            lineHeight: 1.35,
          }}
        >
          無料のボートレースサイトが
        </div>
      </Pop>
      <Pop delay={8}>
        <div
          style={{
            color: ACCENT,
            fontSize: 88,
            fontWeight: 900,
            fontFamily: FONT,
            marginTop: 10,
            textShadow: "0 8px 40px rgba(56,189,248,0.55)",
          }}
        >
          4言語対応
        </div>
      </Pop>
      <Pop delay={26}>
        <div
          style={{
            color: WHITE,
            fontSize: 32,
            fontWeight: 800,
            fontFamily: FONT,
            marginTop: 16,
          }}
        >
          って、知ってた？
        </div>
      </Pop>
    </AbsoluteFill>
  );
}

// スクリーンショット（1080幅x260高、ヘッダー+言語切替メニューだけを撮影済み。
// 下に続くレース一覧は含まない）を横幅いっぱいに等倍表示する。横方向は
// 一切拡大しない（端の文字が切れるのを防ぐ、ToolShowcaseCM.jsxのZoomedToolと同じ教訓）
const HEADER_IMAGE_HEIGHT = 260;

function LangSlide({ src, badge, delay = 0 }) {
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% 70%, #1c4a73 0%, ${NAVY} 65%)`,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: 1080,
          height: HEADER_IMAGE_HEIGHT,
          boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
        }}
      >
        <Img src={staticFile(src)} style={{ width: 1080, display: "block" }} />
      </div>
      <div
        style={{
          position: "absolute",
          top: HEADER_IMAGE_HEIGHT + 140,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <Pop delay={delay + 3}>
          <div
            style={{
              color: NAVY,
              background: ACCENT,
              fontFamily: FONT,
              fontWeight: 900,
              fontSize: 44,
              padding: "16px 40px",
              borderRadius: 999,
              boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
            }}
          >
            {badge}
          </div>
        </Pop>
      </div>
    </AbsoluteFill>
  );
}

// --- Scene 2: モンタージュ（60-340f, 9.33s）4言語を順番に見せる ---
function SceneMontage() {
  const frame = useCurrentFrame();
  const SLIDE = 70;
  const slides = [
    { src: "lang-switcher-ja.png", badge: "🇯🇵 日本語" },
    { src: "lang-switcher-en.png", badge: "🇺🇸 English" },
    { src: "lang-switcher-zh-TW.png", badge: "🇹🇼 繁體中文" },
    { src: "lang-switcher-ko.png", badge: "🇰🇷 한국어" },
  ];
  const index = Math.min(Math.floor(frame / SLIDE), slides.length - 1);
  const slide = slides[index];
  return (
    <LangSlide src={slide.src} badge={slide.badge} delay={index * SLIDE} />
  );
}

// --- Scene 3: CTA（340-430f, 3s） ---
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
      <PulseRings color={GREEN} />
      <Pop delay={2}>
        <div
          style={{
            color: GREEN,
            fontSize: 30,
            fontWeight: 900,
            fontFamily: FONT,
            marginBottom: 22,
            textAlign: "center",
            padding: "0 60px",
          }}
        >
          画面右上の🌐から、いつでも切替
        </div>
      </Pop>
      <Pop delay={10}>
        <Logo size={76} />
      </Pop>
      <Pop delay={20}>
        <div
          style={{
            marginTop: 28,
            padding: "16px 40px",
            borderRadius: 999,
            background: ACCENT,
            color: NAVY,
            fontSize: 32,
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

export const LANGUAGE_SWITCHER_SHORT_DURATION = 430;

export function LanguageSwitcherCM() {
  return (
    <AbsoluteFill>
      <Audio src={staticFile("soundtrack-hitcheck.wav")} />
      <Sequence from={0} durationInFrames={60}>
        <SceneHook />
      </Sequence>
      <Sequence from={60} durationInFrames={280}>
        <SceneMontage />
      </Sequence>
      <Sequence from={340} durationInFrames={90}>
        <SceneCTA />
      </Sequence>
    </AbsoluteFill>
  );
}
