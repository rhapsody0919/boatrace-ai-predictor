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

/**
 * 選手×艇番回収率型（第1弾: 艇番別・単勝回収率）— 龍神レーダー TikTok Shorts
 *
 * 2026-08-25新設。試験運用型（絶対厳守ルール3の例外運用、sns-video-producer-prompt.md参照）。
 * 「射幸心を煽らない」ルールへの抵触懸念があるため、金額・倍率は一切使わず、
 * 「回収率（%）」という統計値のみで構成する。「儲かる」等の直接的な射幸心ワードも
 * 避け、「効率」という言葉に留める。
 *
 * 実データ出典: race_results全件（39,497レース）から艇番別の単勝回収率を算出
 * （艇番Xが1着だった全レースのpayout_win合計 ÷ 総レース数×100円）。
 * 1号艇90.0% > 3号艇74.1% > 4号艇69.5% > 2号艇68.9% > 5号艇63.5% > 6号艇39.0%。
 * 「勝率が高い人気艇ほど回収率は下がる」という一般的な直感に反し、
 * 勝率最高の1号艇が回収率も最高という結果。当初「選手×艇番」の組み合わせで
 * 検討したが、90日〜180日単位だとサンプルが痩せる懸念があったため、
 * 全期間・艇番単位の恒久データに変更した。
 */

const NAVY = "#0f2c46";
const NAVY_DARK = "#081b2e";
const WHITE = "#f8fafc";
const GOLD = "#d4af37";
const RED = "#f87171";

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
  const x = interpolate(local, [0, 12], [60, 0], {
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

function Logo({ size = 40 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: size / 4,
          background: GOLD,
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

// 艇番別・単勝回収率（全期間、39,497レース集計）
const RETURN_RATE_DATA = [
  { boat: "1号艇", rate: 90.0 },
  { boat: "3号艇", rate: 74.1 },
  { boat: "4号艇", rate: 69.5 },
  { boat: "2号艇", rate: 68.9 },
  { boat: "5号艇", rate: 63.5 },
  { boat: "6号艇", rate: 39.0 },
];

// --- Scene 1: フック（0-75f, 2.5s） ---
function SceneHook() {
  const frame = useCurrentFrame();
  const kb = interpolate(frame, [0, 75], [1, 1.04], {
    extrapolateRight: "clamp",
  });
  const rates = RETURN_RATE_DATA.map((d) => d.rate);
  const minRate = Math.min(...rates);
  const maxRate = Math.max(...rates);
  return (
    <AbsoluteFill style={{ background: NAVY_DARK, transform: `scale(${kb})` }}>
      {/* 実データの可視化: 6艇分のミニバーを背景に敷く */}
      <AbsoluteFill
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          justifyContent: "center",
          gap: 22,
          padding: "0 100px 340px",
        }}
      >
        {RETURN_RATE_DATA.map((d, i) => {
          const h = interpolate(d.rate, [minRate, maxRate], [50, 620]);
          return (
            <div
              key={i}
              style={{
                width: 70,
                height: h,
                background: i === 0 ? GOLD : "rgba(255,255,255,0.08)",
                borderRadius: "4px 4px 0 0",
              }}
            />
          );
        })}
      </AbsoluteFill>

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
            fontSize: 24,
            fontWeight: 700,
            fontFamily: FONT,
          }}
        >
          回収率データ・実データ
        </div>
      </Pop>

      {/* 主役: 巨大な「1」。左端からはみ出す非対称配置 */}
      <Pop
        delay={-10}
        style={{
          position: "absolute",
          left: -50,
          top: 250,
          display: "flex",
          alignItems: "flex-end",
        }}
      >
        <div
          style={{
            fontSize: 560,
            fontWeight: 900,
            fontFamily: FONT,
            color: GOLD,
            lineHeight: 0.8,
            textShadow: `0 0 130px ${GOLD}aa`,
          }}
        >
          1
        </div>
        <div
          style={{
            fontSize: 130,
            fontWeight: 900,
            fontFamily: FONT,
            color: GOLD,
            marginBottom: 64,
            marginLeft: 4,
          }}
        >
          号艇
        </div>
      </Pop>

      <div style={{ position: "absolute", left: 520, top: 780, right: 60 }}>
        <Pop delay={-10}>
          <div
            style={{
              color: WHITE,
              fontSize: 40,
              fontWeight: 900,
              fontFamily: FONT,
              lineHeight: 1,
              marginBottom: 22,
            }}
          >
            単勝回収率
          </div>
        </Pop>
        <Pop delay={-10} style={{ display: "inline-block" }}>
          <div
            style={{
              background: GOLD,
              color: NAVY_DARK,
              fontSize: 44,
              fontWeight: 900,
              fontFamily: FONT,
              borderRadius: 14,
              padding: "10px 22px",
              whiteSpace: "nowrap",
            }}
          >
            90.0%
          </div>
        </Pop>
      </div>

      {/* 下部フック帯 */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          background: GOLD,
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
              marginBottom: 10,
            }}
          >
            一番"効率がいい"艇番は？
          </div>
        </Pop>
        <Pop delay={-10}>
          <div
            style={{
              color: `${NAVY_DARK}cc`,
              fontSize: 26,
              fontWeight: 700,
              fontFamily: FONT,
              textAlign: "center",
            }}
          >
            全国39,497レースの単勝実績から算出
          </div>
        </Pop>
      </div>
    </AbsoluteFill>
  );
}

// --- ランキング行 ---
function RankRow({ rank, label, rate, delay, maxRate, isWorst }) {
  return (
    <SlideIn
      delay={delay}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 20,
        marginBottom: 22,
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          background: rank === 1 ? GOLD : "rgba(255,255,255,0.12)",
          color: rank === 1 ? NAVY_DARK : WHITE,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 26,
          fontWeight: 900,
          fontFamily: FONT,
          flexShrink: 0,
        }}
      >
        {rank}
      </div>
      <div style={{ flex: 1 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 6,
          }}
        >
          <span
            style={{
              color: WHITE,
              fontSize: 32,
              fontWeight: 800,
              fontFamily: FONT,
            }}
          >
            {label}
          </span>
          <span
            style={{
              color: isWorst ? RED : GOLD,
              fontSize: 36,
              fontWeight: 900,
              fontFamily: FONT,
            }}
          >
            {rate}%
          </span>
        </div>
        <div
          style={{
            height: 12,
            borderRadius: 6,
            background: "rgba(255,255,255,0.1)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${(rate / maxRate) * 100}%`,
              background: isWorst ? RED : GOLD,
              borderRadius: 6,
            }}
          />
        </div>
      </div>
    </SlideIn>
  );
}

// --- Scene 2: 艇番別ランキング（75-280f, 約6.8s） ---
function SceneRanking() {
  const maxRate = RETURN_RATE_DATA[0].rate;
  return (
    <AbsoluteFill
      style={{
        background: NAVY_DARK,
        padding: "0 70px",
        justifyContent: "center",
      }}
    >
      <Pop delay={2}>
        <div
          style={{
            color: GOLD,
            fontSize: 34,
            fontWeight: 900,
            fontFamily: FONT,
            marginBottom: 26,
          }}
        >
          💰 艇番別・単勝回収率ランキング
        </div>
      </Pop>
      {RETURN_RATE_DATA.map((d, i) => (
        <RankRow
          key={d.boat}
          rank={i + 1}
          label={d.boat}
          rate={d.rate}
          maxRate={maxRate}
          isWorst={i === RETURN_RATE_DATA.length - 1}
          delay={10 + i * 7}
        />
      ))}
      <Pop delay={70}>
        <div
          style={{
            color: "rgba(248,250,252,0.5)",
            fontSize: 18,
            fontFamily: FONT,
            marginTop: 6,
          }}
        >
          単勝100円を買い続けた場合の払戻金合計の割合（全国全会場・全期間）
        </div>
      </Pop>
    </AbsoluteFill>
  );
}

// --- Scene 3: 種明かし（280-380f, 3.33s） ---
function SceneTwist() {
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(150deg, #143752 0%, ${NAVY} 55%, ${NAVY_DARK} 100%)`,
        justifyContent: "center",
        alignItems: "center",
        padding: "0 60px",
        overflow: "hidden",
      }}
    >
      <Pop delay={0}>
        <div
          style={{
            color: WHITE,
            fontSize: 38,
            fontWeight: 900,
            fontFamily: FONT,
            textAlign: "center",
            lineHeight: 1.3,
          }}
        >
          人気が集中するほど
          <br />
          効率は下がるはずが…
        </div>
      </Pop>
      <Pop delay={26}>
        <div
          style={{
            color: GOLD,
            fontSize: 40,
            fontWeight: 900,
            fontFamily: FONT,
            textAlign: "center",
            marginTop: 16,
          }}
        >
          勝率No.1の1号艇が、効率もNo.1
        </div>
      </Pop>
    </AbsoluteFill>
  );
}

// --- Scene 4: CTA（380-450f, 2.33s） ---
function SceneCTA() {
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% 40%, ${NAVY} 0%, ${NAVY_DARK} 100%)`,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Pop delay={4}>
        <div
          style={{
            color: WHITE,
            fontSize: 40,
            fontWeight: 900,
            fontFamily: FONT,
            textAlign: "center",
            marginBottom: 16,
            padding: "0 60px",
          }}
        >
          回収率データ、無料で見れる
        </div>
      </Pop>
      <Pop delay={16} style={{ marginBottom: 40 }}>
        <div
          style={{
            color: "rgba(248,250,252,0.7)",
            fontSize: 26,
            fontFamily: FONT,
          }}
        >
          選手×艇番別の回収率も本日出走選手で見れる
        </div>
      </Pop>
      <Pop delay={28}>
        <Logo size={48} />
      </Pop>
    </AbsoluteFill>
  );
}

export function ReturnRateCM() {
  return (
    <AbsoluteFill style={{ background: NAVY_DARK }}>
      <Sequence from={0} durationInFrames={75}>
        <SceneHook />
      </Sequence>
      <Sequence from={75} durationInFrames={205}>
        <SceneRanking />
      </Sequence>
      <Sequence from={280} durationInFrames={100}>
        <SceneTwist />
      </Sequence>
      <Sequence from={380} durationInFrames={70}>
        <SceneCTA />
      </Sequence>
      <Audio src={staticFile("soundtrack-hitcheck.wav")} />
    </AbsoluteFill>
  );
}
