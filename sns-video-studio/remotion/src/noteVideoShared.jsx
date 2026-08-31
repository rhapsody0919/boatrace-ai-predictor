import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * note埋め込み用・機能解説型（横型 1920x1080）— 龍神レーダー 共通コンポーネント
 *
 * `NoteExplainerCM.jsx`（データ出走表）で確立したHook/特徴解説/CTAのパターンを
 * 他機能（回収率分析・好調不調選手ランキング）でも再利用するため切り出した
 * （2026-09-01、3本目の動画制作で同一パターンが3箇所目に達したため共通化）。
 * デザイン原則（frame=0で完成表示・GOLD統一・中央集約CTA等）は
 * `docs/operation/note-video-producer-prompt.md`参照。
 */

export const NAVY = "#0f2c46";
export const ACCENT = "#38bdf8";
export const WHITE = "#f8fafc";
export const GOLD = "#d4af37";
export const FONT =
  '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';

export function Fade({ children, delay = 0, durationIn = 15, style }) {
  const frame = useCurrentFrame();
  const local = frame - delay;
  const opacity = interpolate(local, [0, durationIn], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const translateY = interpolate(local, [0, durationIn], [16, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{ opacity, transform: `translateY(${translateY}px)`, ...style }}
    >
      {children}
    </div>
  );
}

export function Pop({ children, delay = 0, style }) {
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

export function Logo({ size = 40 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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

// 「龍神レーダー」のレーダーを視覚化する六角形グラフィック（CTAシーンの背景装飾）
export function RadarDecoration({ size = 300 }) {
  const center = size / 2;
  const radius = size / 2 - 24;
  const points = 6;
  const angleStep = (Math.PI * 2) / points;

  const ring = (r) =>
    Array.from({ length: points }, (_, i) => {
      const angle = angleStep * i - Math.PI / 2;
      return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
    }).join(" ");

  const outerPts = Array.from({ length: points }, (_, i) => {
    const angle = angleStep * i - Math.PI / 2;
    return [
      center + radius * Math.cos(angle),
      center + radius * Math.sin(angle),
    ];
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <polygon
        points={ring(radius)}
        fill="none"
        stroke={GOLD}
        strokeWidth="1.5"
        opacity="0.5"
      />
      <polygon
        points={ring(radius * 0.66)}
        fill="none"
        stroke={GOLD}
        strokeWidth="1"
        opacity="0.35"
      />
      <polygon
        points={ring(radius * 0.33)}
        fill="none"
        stroke={GOLD}
        strokeWidth="1"
        opacity="0.25"
      />
      {outerPts.map((p, i) => (
        <React.Fragment key={i}>
          <line
            x1={center}
            y1={center}
            x2={p[0]}
            y2={p[1]}
            stroke={GOLD}
            strokeWidth="1"
            opacity="0.2"
          />
          <circle cx={p[0]} cy={p[1]} r="5" fill={GOLD} opacity="0.85" />
        </React.Fragment>
      ))}
      <circle
        cx={center}
        cy={center}
        r={radius * 0.5}
        fill="none"
        stroke={GOLD}
        strokeWidth="0.75"
        opacity="0.15"
      />
      <text
        x={center}
        y={center + 10}
        textAnchor="middle"
        fontSize="34"
        fill={GOLD}
        opacity="0.9"
      >
        🐉
      </text>
    </svg>
  );
}

// --- Scene 1: Hook（frame=0で完成表示、sns-marketing-strategy.mdの「案A」原則） ---
export function SceneHook({
  title,
  subtitle,
  featureCount,
  previewImageSrc,
  titleFontSize = 96,
}) {
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
          right: -180,
          bottom: -220,
          width: 640,
          height: 640,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${GOLD}22 0%, transparent 70%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: -140,
          top: -160,
          width: 420,
          height: 420,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${ACCENT}18 0%, transparent 70%)`,
        }}
      />

      <div
        style={{
          position: "absolute",
          top: 120,
          right: -60,
          width: 980,
          opacity: 0.4,
          maskImage:
            "linear-gradient(90deg, transparent 0%, black 22%, black 100%)",
          WebkitMaskImage:
            "linear-gradient(90deg, transparent 0%, black 22%, black 100%)",
        }}
      >
        <Img
          src={staticFile(previewImageSrc)}
          style={{
            width: "100%",
            display: "block",
            borderRadius: 16,
          }}
        />
      </div>

      <Pop delay={-10} style={{ position: "absolute", top: 56, left: 64 }}>
        <Logo size={54} />
      </Pop>

      <Pop
        delay={-10}
        style={{
          position: "absolute",
          top: 340,
          left: 64,
          width: 1080,
        }}
      >
        <div
          style={{
            color: GOLD,
            fontSize: titleFontSize,
            fontWeight: 900,
            fontFamily: FONT,
            lineHeight: 1.25,
            textShadow: `0 0 50px ${GOLD}66`,
          }}
        >
          {title}
        </div>
      </Pop>
      <Pop
        delay={-10}
        style={{ position: "absolute", top: 590, left: 64, width: 1000 }}
      >
        <div
          style={{
            color: WHITE,
            fontSize: 38,
            fontWeight: 700,
            fontFamily: FONT,
          }}
        >
          {subtitle}
        </div>
      </Pop>

      <Pop delay={-10} style={{ position: "absolute", bottom: 64, left: 64 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 12,
            color: NAVY,
            background: GOLD,
            fontSize: 26,
            fontWeight: 900,
            fontFamily: FONT,
            padding: "12px 28px",
            borderRadius: 999,
          }}
        >
          🎯 {featureCount}つのポイントを解説
        </div>
      </Pop>
    </AbsoluteFill>
  );
}

export function HighlightBox({ box, from, durationInFrames }) {
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
        boxShadow: "0 0 0 5px rgba(245,185,66,0.25)",
      }}
    />
  );
}

export function Caption({ text, from, durationInFrames }) {
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
        bottom: 56,
        left: 0,
        right: 0,
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
          fontSize: 44,
          background: "rgba(15,44,70,0.92)",
          border: `2px solid ${GOLD}`,
          borderRadius: 16,
          padding: "16px 44px",
          textAlign: "center",
        }}
      >
        {text}
      </div>
    </div>
  );
}

// rel座標([relTop, relLeft, w, h] = ソース画像のCSS px実測値)を
// 画面上の表示矩形に変換する。画像ごとにscale/offsetが異なるため呼び出し側で指定する。
export function scaleRect(
  [relTop, relLeft, w, h],
  { imageTop, imageLeft, scale },
) {
  return {
    top: imageTop + relTop * scale - 6,
    left: imageLeft + relLeft * scale - 6,
    width: w * scale + 12,
    height: h * scale + 12,
  };
}

// --- Scene 2: 特徴解説（表全体を見せたまま、行ごとにハイライト+字幕が切り替わる） ---
// features: [{ box, caption, from, durationInFrames }]（boxはscaleRectで計算済みの表示矩形）
export function SceneFeatures({
  imageSrc,
  imageWidth,
  imageTop,
  imageLeft,
  badgeLabel = "🎯 実際の龍神レーダー画面",
  features,
}) {
  return (
    <AbsoluteFill style={{ background: NAVY, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          top: 30,
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
            fontSize: 26,
            padding: "10px 26px",
            borderRadius: 999,
            border: `2px solid ${GOLD}`,
          }}
        >
          {badgeLabel}
        </div>
      </div>

      <Fade delay={0} durationIn={15}>
        <div
          style={{
            position: "absolute",
            top: imageTop,
            left: imageLeft,
            width: imageWidth,
          }}
        >
          <Img
            src={staticFile(imageSrc)}
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
        <HighlightBox
          key={f.caption}
          box={f.box}
          from={f.from}
          durationInFrames={f.durationInFrames}
        />
      ))}

      {features.map((f) => (
        <Caption
          key={f.caption}
          text={f.caption}
          from={f.from}
          durationInFrames={f.durationInFrames}
        />
      ))}
    </AbsoluteFill>
  );
}

// --- Scene 3: CTA（中央集約・縦積み構成、2026-08-31全面再設計版） ---
export function SceneCTA({ featureDigest }) {
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(135deg, #163a5c 0%, ${NAVY} 55%, #050e18 100%)`,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          opacity: 0.07,
        }}
      >
        <RadarDecoration size={880} />
      </div>
      <div
        style={{
          position: "absolute",
          right: -160,
          top: -200,
          width: 560,
          height: 560,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${GOLD}18 0%, transparent 70%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: -160,
          bottom: -220,
          width: 520,
          height: 520,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${GOLD}12 0%, transparent 70%)`,
        }}
      />

      <Pop
        delay={-10}
        style={{
          position: "absolute",
          top: 64,
          left: 0,
          right: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <Logo size={52} />
        <div
          style={{
            marginTop: 16,
            color: "rgba(248,250,252,0.7)",
            fontSize: 23,
            fontWeight: 700,
            fontFamily: FONT,
          }}
        >
          ボートレースを見える化。迷ったら、データを信じる。
        </div>
      </Pop>

      <Pop
        delay={-10}
        style={{
          position: "absolute",
          top: 220,
          left: 0,
          right: 0,
          textAlign: "center",
        }}
      >
        <div
          style={{
            color: WHITE,
            fontSize: 54,
            fontWeight: 900,
            fontFamily: FONT,
            lineHeight: 1.35,
          }}
        >
          この動画で見た内容、
          <br />
          全部無料で使えます
        </div>
      </Pop>

      <Pop
        delay={-10}
        style={{
          position: "absolute",
          top: 420,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          gap: 20,
          padding: "0 64px",
        }}
      >
        {featureDigest.map((text) => (
          <div
            key={text}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "rgba(255,255,255,0.06)",
              border: `1.5px solid ${GOLD}77`,
              borderRadius: 999,
              padding: "16px 26px",
            }}
          >
            <span style={{ color: GOLD, fontSize: 24, fontWeight: 900 }}>
              ✓
            </span>
            <span
              style={{
                color: WHITE,
                fontSize: 23,
                fontWeight: 700,
                fontFamily: FONT,
                whiteSpace: "nowrap",
              }}
            >
              {text}
            </span>
          </div>
        ))}
      </Pop>

      <Pop
        delay={-10}
        style={{
          position: "absolute",
          top: 570,
          left: 0,
          right: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <div
          style={{
            color: GOLD,
            fontSize: 36,
            fontWeight: 900,
            fontFamily: FONT,
            marginBottom: 30,
            textShadow: `0 0 30px ${GOLD}55`,
          }}
        >
          👉 無料・登録不要で今すぐ
        </div>
        <div
          style={{
            padding: "34px 100px",
            borderRadius: 999,
            background: GOLD,
            color: NAVY,
            fontSize: 68,
            fontWeight: 900,
            fontFamily: FONT,
            boxShadow: `0 24px 70px ${GOLD}55`,
          }}
        >
          boat-ai.jp
        </div>
      </Pop>
    </AbsoluteFill>
  );
}
