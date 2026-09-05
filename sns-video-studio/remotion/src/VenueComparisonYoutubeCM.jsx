import React from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { NAVY, GOLD, WHITE, ACCENT, FONT, Logo, SceneCTA } from "./noteVideoShared.jsx";
import { fitHeadline } from "./textFit.js";

/**
 * YouTube向け（16:9, 1920x1080）会場特性・比較解説型。
 *
 * `RaceInsightYoutubeCM.jsx`（レース単位のデータ紹介型）と同じビジュアル言語・
 * シーン構成（Hook→データ→解説→CTA）を踏襲しつつ、特定1レースではなく
 * 「会場ごとの体系的な傾向」を扱う（`VenueRankingCM.jsx`の思想と同じだが、
 * あちらは24会場フルランキングTOP5/WORST5型で、本コンポジションは
 * 特定会場 vs 比較対象群という2〜3件の少数比較に特化した軽量版）。
 * データはpropsで受け取る（VenueRankingTemplateと同じ方針）。
 */

const RED = "#f87171";

function Pop({ children, delay = 0, style }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - delay;
  const scale = spring({ frame: local, fps, config: { damping: 12, mass: 0.5 } });
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

function SlideIn({ children, delay = 0, style }) {
  const frame = useCurrentFrame();
  const local = frame - delay;
  const x = interpolate(local, [0, 12], [50, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = interpolate(local, [0, 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div style={{ opacity, transform: `translateX(${x}px)`, ...style }}>
      {children}
    </div>
  );
}

// --- Scene 1: フック（frame=0でサムネイルとしても成立、GOLD統一） ---
function SceneHook({ headline, subCaption, categoryTag }) {
  const { fontSize: headlineFontSize, lines: headlineLines } = fitHeadline(
    headline,
    {
      maxWidth: 1500,
      maxLines: 1,
      fontFamily: FONT,
      fontWeight: 900,
      maxFontSize: 108,
      minFontSize: 60,
    },
  );

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

      <Pop delay={-10} style={{ position: "absolute", top: 56, left: 64 }}>
        <Logo size={52} />
      </Pop>
      <Pop delay={-10} style={{ position: "absolute", top: 60, right: 64 }}>
        <div
          style={{
            background: "rgba(255,255,255,0.1)",
            border: `1px solid ${GOLD}`,
            borderRadius: 999,
            padding: "8px 22px",
            color: GOLD,
            fontSize: 24,
            fontWeight: 700,
            fontFamily: FONT,
          }}
        >
          {categoryTag}
        </div>
      </Pop>

      <Pop
        delay={-10}
        style={{ position: "absolute", top: 340, left: 0, right: 0, textAlign: "center" }}
      >
        <div
          style={{
            color: GOLD,
            fontSize: headlineFontSize,
            fontWeight: 900,
            fontFamily: FONT,
            lineHeight: 1.15,
            textShadow: `0 0 60px ${GOLD}77`,
          }}
        >
          {headlineLines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      </Pop>

      <Pop
        delay={-10}
        style={{ position: "absolute", top: 560, left: 0, right: 0, textAlign: "center" }}
      >
        <div
          style={{
            color: "rgba(248,250,252,0.8)",
            fontSize: 30,
            fontWeight: 700,
            fontFamily: FONT,
          }}
        >
          {subCaption}
        </div>
      </Pop>

      <Pop delay={-10} style={{ position: "absolute", bottom: 64, left: 0, right: 0, textAlign: "center" }}>
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
          🎯 実データで会場の傾向を解説
        </div>
      </Pop>
    </AbsoluteFill>
  );
}

// --- Scene 2: 会場別比較バー ---
function VenueBar({ venue, value, sample, ratio, highlight, delay }) {
  const barColor = highlight ? GOLD : ACCENT;
  return (
    <SlideIn delay={delay} style={{ marginBottom: 26 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 8,
        }}
      >
        <span
          style={{
            color: WHITE,
            fontSize: 38,
            fontWeight: 800,
            fontFamily: FONT,
          }}
        >
          {venue}
          {highlight && (
            <span style={{ color: GOLD, fontSize: 24, marginLeft: 12 }}>
              ← 今回のテーマ会場
            </span>
          )}
        </span>
        <span
          style={{
            color: barColor,
            fontSize: 44,
            fontWeight: 900,
            fontFamily: FONT,
          }}
        >
          {value}
        </span>
      </div>
      <div
        style={{
          height: 20,
          borderRadius: 10,
          background: "rgba(255,255,255,0.1)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${ratio}%`,
            background: barColor,
            borderRadius: 10,
          }}
        />
      </div>
      <span
        style={{
          color: "rgba(248,250,252,0.5)",
          fontSize: 20,
          fontFamily: FONT,
        }}
      >
        {sample}レースを集計
      </span>
    </SlideIn>
  );
}

function SceneCompare({ heading, bars, avgLabel, avgValue }) {
  return (
    <AbsoluteFill
      style={{
        background: NAVY,
        padding: "0 120px",
        justifyContent: "center",
      }}
    >
      <Pop delay={2}>
        <div
          style={{
            color: ACCENT,
            fontSize: 34,
            fontWeight: 900,
            fontFamily: FONT,
            marginBottom: 34,
          }}
        >
          {heading}
        </div>
      </Pop>
      {bars.map((bar, i) => (
        <VenueBar key={bar.venue} {...bar} delay={12 + i * 10} />
      ))}
      <Pop delay={12 + bars.length * 10 + 8} style={{ marginTop: 10 }}>
        <div
          style={{
            color: "rgba(248,250,252,0.65)",
            fontSize: 24,
            fontFamily: FONT,
            borderTop: "1px solid rgba(255,255,255,0.15)",
            paddingTop: 18,
          }}
        >
          {avgLabel}：<span style={{ color: WHITE, fontWeight: 800 }}>{avgValue}</span>
        </div>
      </Pop>
    </AbsoluteFill>
  );
}

// --- Scene 3: 解説（なぜ差が出るか） ---
function SceneExplain({ heading, reasons }) {
  return (
    <AbsoluteFill
      style={{
        background: NAVY,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Pop delay={2} style={{ textAlign: "center", marginBottom: 40 }}>
        <div
          style={{
            color: ACCENT,
            fontSize: 34,
            fontWeight: 900,
            fontFamily: FONT,
          }}
        >
          {heading}
        </div>
      </Pop>
      <div style={{ width: 1300 }}>
        {reasons.map((line, i) => (
          <SlideIn key={line} delay={16 + i * 16} style={{ marginBottom: 22 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 20,
                background: "rgba(255,255,255,0.06)",
                borderRadius: 18,
                padding: "26px 32px",
              }}
            >
              <span style={{ fontSize: 32 }}>💡</span>
              <span
                style={{
                  color: WHITE,
                  fontSize: 28,
                  fontWeight: 700,
                  fontFamily: FONT,
                  lineHeight: 1.5,
                }}
              >
                {line}
              </span>
            </div>
          </SlideIn>
        ))}
      </div>
    </AbsoluteFill>
  );
}

export function VenueComparisonYoutubeTemplate({
  headline,
  subCaption,
  categoryTag,
  compareHeading,
  bars,
  avgLabel,
  avgValue,
  explainHeading,
  reasons,
  featureDigest,
}) {
  return (
    <AbsoluteFill style={{ background: NAVY }}>
      <Sequence from={0} durationInFrames={90}>
        <SceneHook headline={headline} subCaption={subCaption} categoryTag={categoryTag} />
      </Sequence>
      <Sequence from={90} durationInFrames={180}>
        <SceneCompare heading={compareHeading} bars={bars} avgLabel={avgLabel} avgValue={avgValue} />
      </Sequence>
      <Sequence from={270} durationInFrames={180}>
        <SceneExplain heading={explainHeading} reasons={reasons} />
      </Sequence>
      <Sequence from={450} durationInFrames={150}>
        <SceneCTA featureDigest={featureDigest} />
      </Sequence>
      <Audio src={staticFile("note-bgm-calm-corporate-relax.wav")} />
    </AbsoluteFill>
  );
}

// デモ・composition登録確認用（実データはprops経由で渡す運用、VenueRankingTemplateと同じ方針）
export function VenueComparisonYoutubeCM_Demo() {
  return (
    <VenueComparisonYoutubeTemplate
      headline="桐生のイン逃げ率は51.7%"
      subCaption="汽水会場平均45.8%より高い（過去90日実データ）"
      categoryTag="会場データで比較"
      compareHeading="📊 イン逃げ率（1号艇の逃げ勝ち）比較"
      bars={[
        { venue: "桐生（淡水）", value: "51.7%", sample: "573", ratio: 100, highlight: true },
        { venue: "浜名湖（汽水）", value: "49.8%", sample: "624", ratio: 96 },
        { venue: "江戸川（汽水）", value: "41.7%", sample: "444", ratio: 81 },
      ]}
      avgLabel="汽水会場平均（江戸川・浜名湖）"
      avgValue="45.8%"
      explainHeading="🌊 なぜ差が出るのか"
      reasons={[
        "桐生は淡水コースで、潮の満ち引きの影響を受けず水面が安定しやすい",
        "江戸川・浜名湖は汽水（海水が混ざる水域）で、潮位・流れの変化が水面コンディションに影響しやすい",
        "水面が安定するほど1号艇はスタートで進入コースを守りやすく、逃げ勝ちにつながりやすい",
      ]}
      featureDigest={["AI予想", "会場データ", "無料"]}
    />
  );
}
