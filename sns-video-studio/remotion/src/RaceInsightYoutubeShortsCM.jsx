import React from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { FONT } from "./fonts.js";
import { Logo } from "./noteVideoShared.jsx";
import { SceneCTA } from "./snsVideoShared.jsx";
import { fitHeadline } from "./textFit.js";

/**
 * YouTube Shorts向け（9:16, 1080x1920）レース単位のイン崩れ指数解説型。
 *
 * 旧`RaceInsightYoutubeCM.jsx`（16:9, 1920x1080）はShorts方針転換
 * （2026-09-05、docs/operation/sns-pipeline-youtube.md「3.」）以前に作られた
 * YouTube専用コンポジションで、幅1920前提のレイアウトのためそのまま9:16化できない。
 * 一方`LivePredictionHookCM.jsx`（X/TikTok向け9:16、予想数値フック型）は
 * イン崩れ注意度・展開予測TOP3・詳細理由という同じ実データ構成を既に9:16で
 * 確立済みのため、そのシーン設計を土台にする。ただし同ファイルのHookシーンは
 * 「本日{startTime}発走」という締切前提の文言を使っており、YouTube向けは
 * claimからレンダリング・公開までの時間差で事実と矛盾するリスクがあるため
 * （旧RaceInsightYoutubeCM.jsxのdocstring参照）、Hookシーンのみ時刻に依存しない
 * 日付ベースの中立フレーミングに書き換えている。
 */

const NAVY_DARK = "#081b2e";
const ACCENT = "#38bdf8";
const WHITE = "#f8fafc";
const GOLD = "#d4af37";

const VOLATILITY_ICON = { high: "🌪️", low: "🎯", standard: "⚖️" };
const VOLATILITY_COLOR = {
  high: "#ff9800",
  low: "#4caf50",
  standard: "#2196f3",
};
const VOLATILITY_LABEL = { high: "警戒", low: "堅め", standard: "標準" };
const HOOK_COPY_BY_LEVEL = {
  high: "逃げ切れるか、それとも荒れるか。",
  standard: "堅く決まるか、まさかの波乱か。",
  low: "順当に決まるか、一撃の波乱か。",
};

function getVolatilityLevel(percentile) {
  if (percentile >= 70) return "high";
  if (percentile <= 30) return "low";
  return "standard";
}

const TECHNIQUE_NAMES = {
  nige: "逃げ",
  sashi: "差し",
  makuri: "まくり",
  makurizashi: "まくり差し",
  nuki: "抜き",
  megumare: "恵まれ",
};
const RANK_ICONS = ["🥇", "🥈", "🥉"];

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
  const local = frame - delay;
  const scale = spring({
    frame: local,
    fps: 30,
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

function SlideIn({ children, delay = 0, style }) {
  const frame = useCurrentFrame();
  const local = frame - delay;
  const x = interpolate(local, [0, 12], [40, 0], {
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

// --- Scene 1: フック（frame=0でカバーとしても成立、時刻に依存しない中立フレーミング） ---
function SceneHook({ venue, raceNumber, raceDate, raceGrade, nigePercent, percentile }) {
  const frame = useCurrentFrame();
  const kb = interpolate(frame, [0, 75], [1, 1.04], {
    extrapolateRight: "clamp",
  });
  const volatilityLevel = getVolatilityLevel(percentile);
  const volatilityIcon = VOLATILITY_ICON[volatilityLevel];
  const volatilityColor = VOLATILITY_COLOR[volatilityLevel];
  const hookCopy = HOOK_COPY_BY_LEVEL[volatilityLevel];

  return (
    <AbsoluteFill style={{ background: NAVY_DARK, transform: `scale(${kb})` }}>
      <Pop delay={-10} style={{ position: "absolute", top: 44, left: 44 }}>
        <Logo size={38} />
      </Pop>
      <Pop delay={-10} style={{ position: "absolute", top: 50, right: 44 }}>
        <div
          style={{
            background: "rgba(255,255,255,0.1)",
            border: `1px solid ${GOLD}`,
            borderRadius: 999,
            padding: "6px 18px",
            color: GOLD,
            fontSize: 22,
            fontWeight: 700,
            fontFamily: FONT,
            whiteSpace: "nowrap",
          }}
        >
          実データで見るAI予想
        </div>
      </Pop>

      <Pop
        delay={-10}
        style={{ position: "absolute", top: 172, left: 40, right: 40 }}
      >
        <div
          style={{
            color: GOLD,
            fontSize: 58,
            fontWeight: 900,
            fontFamily: FONT,
            textAlign: "center",
            lineHeight: 1.15,
            textShadow: `0 0 30px ${GOLD}88`,
          }}
        >
          AIが見る1号艇のスタート
        </div>
      </Pop>

      <Pop
        delay={-10}
        style={{
          position: "absolute",
          top: 300,
          left: 40,
          right: 40,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 40,
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              color: "rgba(248,250,252,0.55)",
              fontSize: 26,
              fontWeight: 700,
              fontFamily: FONT,
              marginBottom: 4,
            }}
          >
            逃げ確率
          </div>
          <div
            style={{
              fontSize: 180,
              fontWeight: 900,
              fontFamily: FONT,
              color: GOLD,
              lineHeight: 0.85,
              textShadow: `0 0 90px ${GOLD}aa`,
            }}
          >
            {nigePercent}%
          </div>
        </div>
        <div
          style={{
            color: "rgba(255,255,255,0.25)",
            fontSize: 56,
            fontWeight: 300,
            marginTop: 60,
          }}
        >
          ×
        </div>
        <div
          style={{
            textAlign: "center",
            background: `${volatilityColor}20`,
            border: `2px solid ${volatilityColor}90`,
            borderRadius: 20,
            padding: "20px 26px",
          }}
        >
          <div
            style={{
              color: volatilityColor,
              fontSize: 20,
              fontWeight: 800,
              fontFamily: FONT,
              marginBottom: 6,
              whiteSpace: "nowrap",
            }}
          >
            {volatilityIcon} イン崩れ注意度
          </div>
          <div
            style={{
              fontSize: 84,
              fontWeight: 900,
              fontFamily: FONT,
              color: volatilityColor,
              lineHeight: 1,
            }}
          >
            {percentile}
          </div>
        </div>
      </Pop>

      <div style={{ position: "absolute", left: 60, top: 620, right: 60 }}>
        <Pop delay={-10} style={{ textAlign: "center" }}>
          <div
            style={{
              color: WHITE,
              fontSize: 76,
              fontWeight: 900,
              fontFamily: FONT,
              lineHeight: 1,
              marginBottom: 22,
            }}
          >
            {venue}
            {raceNumber}R
          </div>
        </Pop>
        <Pop
          delay={-10}
          style={{
            display: "flex",
            justifyContent: "center",
            marginBottom: 44,
          }}
        >
          <div
            style={{
              background: GOLD,
              color: NAVY_DARK,
              fontSize: 34,
              fontWeight: 900,
              fontFamily: FONT,
              borderRadius: 14,
              padding: "10px 22px",
              whiteSpace: "nowrap",
            }}
          >
            {raceDate}・{raceGrade}
          </div>
        </Pop>
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          background: `linear-gradient(100deg, ${GOLD} 0%, ${volatilityColor} 100%)`,
          padding: "40px 60px 84px",
        }}
      >
        <Pop delay={-10}>
          <div
            style={{
              color: NAVY_DARK,
              fontSize: 46,
              fontWeight: 900,
              fontFamily: FONT,
              textAlign: "center",
              lineHeight: 1.3,
            }}
          >
            {hookCopy}
          </div>
        </Pop>
      </div>
    </AbsoluteFill>
  );
}

// --- Scene 2: 展開予測TOP3 ---
function SceneTurnPrediction({ venue, raceNumber, patterns }) {
  return (
    <AbsoluteFill
      style={{
        background: NAVY_DARK,
        padding: "0 60px",
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
            marginBottom: 8,
          }}
        >
          🌀 展開予測 TOP3（{venue}
          {raceNumber}R）
        </div>
      </Pop>
      <Pop delay={8}>
        <div
          style={{
            color: "rgba(248,250,252,0.55)",
            fontSize: 20,
            fontFamily: FONT,
            marginBottom: 16,
          }}
        >
          龍神レーダー独自AIが読む、1着候補ランキング
        </div>
      </Pop>

      <Pop delay={16} style={{ textAlign: "center", marginBottom: 24 }}>
        <div
          style={{
            color: "rgba(248,250,252,0.55)",
            fontSize: 22,
            fontWeight: 700,
            fontFamily: FONT,
            marginBottom: 4,
          }}
        >
          1位候補の確率
        </div>
        <div
          style={{
            fontSize: 150,
            fontWeight: 900,
            fontFamily: FONT,
            color: GOLD,
            lineHeight: 0.9,
            textShadow: `0 0 80px ${GOLD}99`,
          }}
        >
          {Math.round(patterns[0].probability * 100)}%
        </div>
      </Pop>

      {patterns.map((pattern, i) => {
        const color = BOAT_COLORS[pattern.winnerCourse];
        return (
          <SlideIn
            key={pattern.winnerCourse}
            delay={20 + i * 14}
            style={{ marginBottom: 22 }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 20,
                background: "rgba(255,255,255,0.06)",
                borderRadius: 16,
                padding: "18px 24px",
              }}
            >
              <span style={{ fontSize: 40 }}>{RANK_ICONS[i]}</span>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 12,
                  background: color.bg,
                  color: color.text,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 32,
                  fontWeight: 900,
                  fontFamily: FONT,
                  flexShrink: 0,
                  border:
                    pattern.winnerCourse === 1
                      ? "2px solid rgba(0,0,0,0.15)"
                      : "none",
                }}
              >
                {pattern.winnerCourse}
              </div>
              <div
                style={{
                  color: WHITE,
                  fontSize: 32,
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
                  fontSize: 40,
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
    </AbsoluteFill>
  );
}

// --- Scene 3: イン崩れ注意度（詳細） ---
function SceneVolatility({ boatGrade, boatWinRate, percentile, reasons }) {
  const level = getVolatilityLevel(percentile);
  const icon = VOLATILITY_ICON[level];
  const accentColor = VOLATILITY_COLOR[level];
  const label = VOLATILITY_LABEL[level];

  return (
    <AbsoluteFill
      style={{
        background: NAVY_DARK,
        padding: "0 56px",
        justifyContent: "center",
      }}
    >
      <SlideIn delay={0} style={{ textAlign: "center", marginBottom: 20 }}>
        <div
          style={{
            color: "rgba(248,250,252,0.55)",
            fontSize: 22,
            fontWeight: 700,
            fontFamily: FONT,
            marginBottom: 4,
          }}
        >
          会場内パーセンタイル
        </div>
        <div
          style={{
            fontSize: 150,
            fontWeight: 900,
            fontFamily: FONT,
            color: GOLD,
            lineHeight: 0.9,
            textShadow: `0 0 80px ${GOLD}99`,
          }}
        >
          {percentile}
        </div>
      </SlideIn>
      <SlideIn delay={2}>
        <div
          style={{
            background: "rgba(255,255,255,0.05)",
            borderLeft: `6px solid ${accentColor}`,
            borderRadius: 16,
            padding: "28px 32px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 14,
            }}
          >
            <span style={{ fontSize: 32 }}>{icon}</span>
            <span
              style={{
                color: WHITE,
                fontSize: 30,
                fontWeight: 900,
                fontFamily: FONT,
              }}
            >
              イン崩れ注意度
            </span>
            <span
              style={{
                background: accentColor,
                color: level === "low" ? NAVY_DARK : WHITE,
                fontSize: 22,
                fontWeight: 800,
                fontFamily: FONT,
                padding: "4px 16px",
                borderRadius: 999,
              }}
            >
              {label}
            </span>
          </div>
          <div
            style={{
              color: "rgba(248,250,252,0.55)",
              fontSize: 18,
              fontFamily: FONT,
              marginBottom: 22,
            }}
          >
            会場内で1号艇がどれだけ崩れやすいかを示す龍神レーダー独自指標
          </div>

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
                color: "rgba(248,250,252,0.7)",
                fontSize: 18,
                fontFamily: FONT,
              }}
            >
              会場内パーセンタイル
            </span>
            <span
              style={{
                color: accentColor,
                fontSize: 40,
                fontWeight: 900,
                fontFamily: FONT,
              }}
            >
              {percentile}
            </span>
          </div>
          <div
            style={{
              position: "relative",
              height: 14,
              borderRadius: 7,
              background: "rgba(255,255,255,0.12)",
              marginBottom: 6,
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                width: `${percentile}%`,
                height: "100%",
                background: accentColor,
                borderRadius: 7,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: -4,
                bottom: -4,
                width: 3,
                background: "rgba(255,255,255,0.5)",
                transform: "translateX(-50%)",
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              color: "rgba(248,250,252,0.4)",
              fontSize: 14,
              fontFamily: FONT,
            }}
          >
            <span>堅い</span>
            <span>標準</span>
            <span>崩れやすい</span>
          </div>
        </div>
      </SlideIn>

      <SlideIn delay={26} style={{ marginTop: 26 }}>
        <div
          style={{
            background: "rgba(255,255,255,0.05)",
            borderRadius: 14,
            padding: "18px 24px",
          }}
        >
          <div
            style={{
              color: GOLD,
              fontSize: 22,
              fontWeight: 800,
              fontFamily: FONT,
              marginBottom: 10,
            }}
          >
            🚤 1号艇は{boatGrade}級・全国勝率{boatWinRate}
          </div>
          {reasons.map((line, i) => (
            <SlideIn key={line} delay={34 + i * 10} style={{ marginBottom: 10 }}>
              <div
                style={{
                  color: "rgba(248,250,252,0.85)",
                  fontSize: 20,
                  fontFamily: FONT,
                }}
              >
                ・{line}
              </div>
            </SlideIn>
          ))}
        </div>
      </SlideIn>
    </AbsoluteFill>
  );
}

export function RaceInsightYoutubeShortsTemplate({
  venue,
  raceNumber,
  raceDate,
  raceGrade,
  nigePercent,
  patterns,
  boatGrade,
  boatWinRate,
  percentile,
  reasons,
}) {
  return (
    <AbsoluteFill style={{ background: NAVY_DARK }}>
      <Sequence from={0} durationInFrames={90}>
        <SceneHook
          venue={venue}
          raceNumber={raceNumber}
          raceDate={raceDate}
          raceGrade={raceGrade}
          nigePercent={nigePercent}
          percentile={percentile}
        />
      </Sequence>
      <Sequence from={90} durationInFrames={165}>
        <SceneTurnPrediction
          venue={venue}
          raceNumber={raceNumber}
          patterns={patterns}
        />
      </Sequence>
      <Sequence from={255} durationInFrames={195}>
        <SceneVolatility
          boatGrade={boatGrade}
          boatWinRate={boatWinRate}
          percentile={percentile}
          reasons={reasons}
        />
      </Sequence>
      <Sequence from={450} durationInFrames={120}>
        <SceneCTA
          ctaLines={["展開予測とイン崩れ注意度、", "無料で見れる"]}
          subLine="気になるレースは実データでチェック"
        />
      </Sequence>
      <Audio src={staticFile("note-bgm-calm-corporate-relax.wav")} />
    </AbsoluteFill>
  );
}

// デモ・composition登録確認用（実データはprops経由で渡す運用）
export function RaceInsightYoutubeShortsCM_Demo() {
  return (
    <RaceInsightYoutubeShortsTemplate
      venue="福岡"
      raceNumber={4}
      raceDate="9/14"
      raceGrade="一般"
      nigePercent={43}
      patterns={[
        { winnerCourse: 1, technique: "nige", probability: 0.43 },
        { winnerCourse: 3, technique: "makurizashi", probability: 0.09 },
        { winnerCourse: 4, technique: "sashi", probability: 0.09 },
      ]}
      boatGrade="B1"
      boatWinRate="3.11"
      percentile={100}
      reasons={["1号艇の今節STが遅い（平均0.181秒）→ イン崩れリスク"]}
    />
  );
}
