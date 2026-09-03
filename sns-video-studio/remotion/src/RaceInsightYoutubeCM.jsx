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
 * YouTube向け（16:9, 1920x1080）レース単位のデータ紹介型。
 *
 * X/TikTok向け`LivePredictionHookCM.jsx`（予想数値フック型、9:16）と同じ
 * 実データ（predictions.feature_contributions.unified）を扱うが、YouTubeは
 * 「本日◯時発走」という締切前提の速報訴求ではなく、実データケーススタディ
 * として時刻に依存しない過去形/中立フレーミングで見せる
 * （sns_topic_targetsをclaimした時点からレンダリング・レビュー・公開まで
 * 時間差があり、発走前提の文言は公開時に事実と矛盾するリスクがあるため）。
 * ビジュアル言語はnote埋め込み動画（noteVideoShared.jsx）と共通化し、
 * YouTube/noteチャネル間の統一感を保つ。
 */

const TECHNIQUE_NAMES = {
  nige: "逃げ",
  sashi: "差し",
  makuri: "まくり",
  makurizashi: "まくり差し",
  nuki: "抜き",
  megumare: "恵まれ",
};
const RANK_ICONS = ["🥇", "🥈", "🥉"];

// 艇番別カラー（公式カラー、src/utils/colors.jsのBOAT_COLORSと同じ配色）
const BOAT_COLORS = {
  1: { bg: "#ffffff", text: "#000000" },
  2: { bg: "#000000", text: "#ffffff" },
  3: { bg: "#e53935", text: "#ffffff" },
  4: { bg: "#1e88e5", text: "#ffffff" },
  5: { bg: "#fdd835", text: "#000000" },
  6: { bg: "#43a047", text: "#ffffff" },
};

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
function SceneHook({ venue, raceNumber, raceDate, indexPercent }) {
  const { fontSize: headlineFontSize, lines: headlineLines } = fitHeadline(
    `イン崩れ指数 ${indexPercent}%`,
    {
      maxWidth: 1100,
      maxLines: 1,
      fontFamily: FONT,
      fontWeight: 900,
      maxFontSize: 128,
      minFontSize: 72,
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
          実データで見るAI予想
        </div>
      </Pop>

      <Pop
        delay={-10}
        style={{ position: "absolute", top: 250, left: 0, right: 0, textAlign: "center" }}
      >
        <div
          style={{
            color: WHITE,
            fontSize: 34,
            fontWeight: 700,
            fontFamily: FONT,
          }}
        >
          {raceDate}　{venue}
          {raceNumber}R
        </div>
      </Pop>

      <Pop
        delay={-10}
        style={{ position: "absolute", top: 330, left: 0, right: 0, textAlign: "center" }}
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
          龍神レーダー独自AIが会場内で「1号艇が最も崩れやすい」と判定したレース
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
          🎯 実データを3つの数字で解説
        </div>
      </Pop>
    </AbsoluteFill>
  );
}

// --- Scene 2: 実データ3指標（横並び、16:9の横幅を活かす） ---
function StatCard({ label, value, unit, accentColor, delay }) {
  return (
    <Pop
      delay={delay}
      style={{
        background: "rgba(255,255,255,0.06)",
        border: `2px solid ${accentColor}90`,
        borderRadius: 24,
        padding: "36px 32px",
        width: 480,
        textAlign: "center",
      }}
    >
      <div
        style={{
          color: accentColor,
          fontSize: 24,
          fontWeight: 800,
          fontFamily: FONT,
          marginBottom: 16,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 6 }}>
        <span
          style={{
            fontSize: 96,
            fontWeight: 900,
            fontFamily: FONT,
            color: WHITE,
            lineHeight: 1,
          }}
        >
          {value}
        </span>
        <span
          style={{
            fontSize: 34,
            fontWeight: 800,
            fontFamily: FONT,
            color: "rgba(248,250,252,0.7)",
          }}
        >
          {unit}
        </span>
      </div>
    </Pop>
  );
}

function SceneStats({ indexPercent, boatWinRate, nigePercent, reasons }) {
  return (
    <AbsoluteFill
      style={{
        background: NAVY,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Pop delay={2} style={{ position: "absolute", top: 90, left: 0, right: 0, textAlign: "center" }}>
        <div
          style={{
            color: ACCENT,
            fontSize: 34,
            fontWeight: 900,
            fontFamily: FONT,
          }}
        >
          📊 このレースの実データ
        </div>
      </Pop>

      <div style={{ display: "flex", gap: 32, marginTop: 20 }}>
        <StatCard
          label="イン崩れ指数（会場内）"
          value={indexPercent}
          unit="%"
          accentColor="#ff9800"
          delay={16}
        />
        <StatCard
          label="1号艇 全国勝率"
          value={boatWinRate}
          unit=""
          accentColor={ACCENT}
          delay={30}
        />
        <StatCard
          label="AI逃げ確率"
          value={nigePercent}
          unit="%"
          accentColor={GOLD}
          delay={44}
        />
      </div>

      <div style={{ position: "absolute", bottom: 100, left: 160, right: 160 }}>
        {reasons.map((line, i) => (
          <SlideIn key={line} delay={70 + i * 12} style={{ marginBottom: 12 }}>
            <div
              style={{
                color: "rgba(248,250,252,0.85)",
                fontSize: 24,
                fontFamily: FONT,
                textAlign: "center",
              }}
            >
              ・{line}
            </div>
          </SlideIn>
        ))}
      </div>
    </AbsoluteFill>
  );
}

// --- Scene 3: 展開予測TOP3 ---
function SceneTurnPrediction({ venue, raceNumber, patterns }) {
  return (
    <AbsoluteFill
      style={{
        background: NAVY,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Pop delay={2} style={{ textAlign: "center", marginBottom: 8 }}>
        <div
          style={{
            color: ACCENT,
            fontSize: 34,
            fontWeight: 900,
            fontFamily: FONT,
          }}
        >
          🌀 展開予測 TOP3（{venue}
          {raceNumber}R）
        </div>
      </Pop>
      <Pop delay={8} style={{ marginBottom: 36 }}>
        <div
          style={{
            color: "rgba(248,250,252,0.6)",
            fontSize: 22,
            fontFamily: FONT,
            textAlign: "center",
          }}
        >
          龍神レーダー独自AIが読む、1着候補ランキング
        </div>
      </Pop>

      <div style={{ width: 1200 }}>
        {patterns.map((pattern, i) => {
          const color = BOAT_COLORS[pattern.winnerCourse];
          return (
            <SlideIn key={pattern.winnerCourse} delay={20 + i * 14} style={{ marginBottom: 22 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 24,
                  background: "rgba(255,255,255,0.06)",
                  borderRadius: 18,
                  padding: "22px 32px",
                }}
              >
                <span style={{ fontSize: 46 }}>{RANK_ICONS[i]}</span>
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 14,
                    background: color.bg,
                    color: color.text,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 36,
                    fontWeight: 900,
                    fontFamily: FONT,
                    flexShrink: 0,
                    border: pattern.winnerCourse === 1 ? "2px solid rgba(0,0,0,0.15)" : "none",
                  }}
                >
                  {pattern.winnerCourse}
                </div>
                <div
                  style={{
                    color: WHITE,
                    fontSize: 36,
                    fontWeight: 900,
                    fontFamily: FONT,
                    flex: 1,
                  }}
                >
                  {TECHNIQUE_NAMES[pattern.technique] || pattern.technique}
                </div>
                <div
                  style={{
                    color: GOLD,
                    fontSize: 46,
                    fontWeight: 900,
                    fontFamily: FONT,
                  }}
                >
                  {Math.round(pattern.probability * 100)}%
                </div>
              </div>
            </SlideIn>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

export function RaceInsightYoutubeTemplate({
  venue,
  raceNumber,
  raceDate,
  indexPercent,
  boatWinRate,
  nigePercent,
  reasons,
  patterns,
  featureDigest,
}) {
  return (
    <AbsoluteFill style={{ background: NAVY }}>
      <Sequence from={0} durationInFrames={90}>
        <SceneHook
          venue={venue}
          raceNumber={raceNumber}
          raceDate={raceDate}
          indexPercent={indexPercent}
        />
      </Sequence>
      <Sequence from={90} durationInFrames={180}>
        <SceneStats
          indexPercent={indexPercent}
          boatWinRate={boatWinRate}
          nigePercent={nigePercent}
          reasons={reasons}
        />
      </Sequence>
      <Sequence from={270} durationInFrames={180}>
        <SceneTurnPrediction venue={venue} raceNumber={raceNumber} patterns={patterns} />
      </Sequence>
      <Sequence from={450} durationInFrames={150}>
        <SceneCTA featureDigest={featureDigest} />
      </Sequence>
      <Audio src={staticFile("note-bgm-calm-corporate-relax.wav")} />
    </AbsoluteFill>
  );
}

// デモ・composition登録確認用（実データはprops経由で渡す運用、VenueRankingTemplateと同じ方針）
export function RaceInsightYoutubeCM_Demo() {
  return (
    <RaceInsightYoutubeTemplate
      venue="住之江"
      raceNumber={6}
      raceDate="9/3"
      indexPercent={100}
      boatWinRate="2.61"
      nigePercent={33}
      reasons={[
        "1号艇の全国勝率が非常に低い（2.61）→ イン崩れリスク高",
        "1号艇の今節STが遅い（平均0.190秒）→ イン崩れリスク",
      ]}
      patterns={[
        { winnerCourse: 1, technique: "nige", probability: 0.33 },
        { winnerCourse: 3, technique: "makurizashi", probability: 0.1 },
        { winnerCourse: 5, technique: "makurizashi", probability: 0.08 },
      ]}
      featureDigest={["AI予想", "イン崩れ指数", "無料"]}
    />
  );
}
