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
import { FONT } from "./fonts.js";
import { fitHeadline } from "./textFit.js";

/**
 * 答え合わせ型（日次アグリゲート版、YouTube Shorts 9:16）
 *
 * `AnswerCheckHookCM.jsx`は1レース単位の答え合わせ（AI予想 vs 結果の1件比較）
 * だが、`prediction-accuracy`カテゴリ（race-time-critical型）の日次ネタ提案
 * （`docs/operation/sns-topic-proposer-daily-auto.md`）が生成する題材は
 * 「本日終了した全レースのうち何%的中したか」という日次集計であり、
 * データ形状が異なる（単発レースの詳細ではなく本日の母数・的中数・的中率）。
 * 新規データ形状のため`sns-video-producer-prompt.md`制作フロー1.の方針に
 * 従い新規コンポジションとして追加する。ビジュアル言語（NAVY_DARK/GOLD/
 * Pop/SlideIn、frame=0で完成表示するHook）は`AnswerCheckHookCM.jsx`と統一する。
 *
 * props（`content_type_id`=race-time-critical、category=prediction-accuracy）は
 * 呼び出し側（チャネル別パイプラインRoutine）が当日の`predictions`×`race_results`
 * 実データを集計してから渡す。この場で捏造しない。
 */

const NAVY_DARK = "#081b2e";
const ACCENT = "#38bdf8";
const WHITE = "#f8fafc";
const GOLD = "#f59e0b";
const HIT_GREEN = "#22c55e";

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

function PulseRings({ color = ACCENT, size = 900, top = "50%" }) {
  const frame = useCurrentFrame();
  return (
    <>
      {[0, 25, 50].map((delay) => {
        const local = frame - delay;
        const scale = interpolate(local % 75, [0, 75], [0.3, 2.2], {
          extrapolateLeft: "clamp",
        });
        const opacity = interpolate(local % 75, [0, 75], [0.3, 0], {
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

// --- Scene 1: フック（frame=0でカバーとして成立） ---
function SceneHook({ dateLabel, finishedCount, courseHitRate }) {
  const { fontSize: headlineFontSize, lines: headlineLines } = fitHeadline(
    "今日のAI展開予想、当たってる？",
    {
      maxWidth: 980,
      maxLines: 2,
      fontFamily: FONT,
      fontWeight: 900,
      maxFontSize: 74,
      minFontSize: 46,
    },
  );

  return (
    <AbsoluteFill style={{ background: NAVY_DARK, overflow: "hidden" }}>
      <PulseRings color={GOLD} size={1000} top="68%" />
      <div
        style={{
          position: "absolute",
          left: -220,
          bottom: -260,
          width: 700,
          height: 700,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${ACCENT}14 0%, transparent 70%)`,
        }}
      />
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
          }}
        >
          答え合わせダイジェスト
        </div>
      </Pop>

      <div
        style={{
          position: "absolute",
          top: 170,
          bottom: 0,
          left: 0,
          right: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 56,
        }}
      >
        <Pop delay={-10} style={{ padding: "0 60px", textAlign: "center" }}>
          <div
            style={{
              color: WHITE,
              fontSize: headlineFontSize,
              fontWeight: 900,
              fontFamily: FONT,
              lineHeight: 1.25,
            }}
          >
            {headlineLines.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        </Pop>

        <Pop delay={-10} style={{ textAlign: "center" }}>
          <div
            style={{
              color: "rgba(248,250,252,0.7)",
              fontSize: 30,
              fontWeight: 700,
              fontFamily: FONT,
            }}
          >
            本日（{dateLabel}）終了 {finishedCount}レースで検証
          </div>
        </Pop>

        <Pop delay={-10} style={{ textAlign: "center" }}>
          <div
            style={{
              display: "inline-flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <div
              style={{
                color: GOLD,
                fontSize: 180,
                fontWeight: 900,
                fontFamily: FONT,
                lineHeight: 1,
                textShadow: `0 0 60px ${GOLD}66`,
              }}
            >
              {courseHitRate}%
            </div>
            <div
              style={{
                color: "rgba(248,250,252,0.6)",
                fontSize: 26,
                fontWeight: 700,
                fontFamily: FONT,
                marginTop: 12,
              }}
            >
              1着コース的中率
            </div>
          </div>
        </Pop>

        <SlideIn delay={20} style={{ textAlign: "center" }}>
          <div
            style={{
              color: "rgba(248,250,252,0.5)",
              fontSize: 24,
              fontFamily: FONT,
            }}
          >
            決まり手まで一致した割合は次のシーンで公開
          </div>
        </SlideIn>
      </div>
    </AbsoluteFill>
  );
}

// --- Scene 2: 的中率2指標（コース的中／決まり手まで一致） ---
function StatCard({ label, value, fraction, accentColor, delay }) {
  return (
    <Pop
      delay={delay}
      style={{
        background: "rgba(255,255,255,0.06)",
        border: `2px solid ${accentColor}90`,
        borderRadius: 24,
        padding: "32px 20px",
        flex: 1,
        textAlign: "center",
      }}
    >
      <div
        style={{
          color: accentColor,
          fontSize: 22,
          fontWeight: 800,
          fontFamily: FONT,
          marginBottom: 14,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 80,
          fontWeight: 900,
          fontFamily: FONT,
          color: WHITE,
          lineHeight: 1,
        }}
      >
        {value}%
      </div>
      <div
        style={{
          marginTop: 12,
          color: "rgba(248,250,252,0.6)",
          fontSize: 22,
          fontFamily: FONT,
        }}
      >
        {fraction}
      </div>
    </Pop>
  );
}

function SceneStats({
  finishedCount,
  courseHitCount,
  courseHitRate,
  techniqueHitCount,
  techniqueHitRate,
}) {
  return (
    <AbsoluteFill style={{ background: NAVY_DARK, overflow: "hidden" }}>
      <PulseRings color={ACCENT} size={1000} top="50%" />
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 60,
          padding: "0 56px",
        }}
      >
        <Pop delay={2} style={{ textAlign: "center" }}>
          <div
            style={{
              color: ACCENT,
              fontSize: 34,
              fontWeight: 900,
              fontFamily: FONT,
            }}
          >
            📊 本日{finishedCount}レースの答え合わせ
          </div>
        </Pop>

        <div style={{ display: "flex", gap: 24, width: "100%" }}>
          <StatCard
            label="1着コース的中"
            value={courseHitRate}
            fraction={`${courseHitCount} / ${finishedCount}レース`}
            accentColor={GOLD}
            delay={16}
          />
          <StatCard
            label="決まり手まで一致"
            value={techniqueHitRate}
            fraction={`${techniqueHitCount} / ${finishedCount}レース`}
            accentColor={ACCENT}
            delay={30}
          />
        </div>

        <SlideIn delay={60} style={{ width: "100%" }}>
          <div
            style={{
              background: "rgba(255,255,255,0.05)",
              borderRadius: 16,
              padding: "28px 30px",
              color: "rgba(248,250,252,0.8)",
              fontSize: 24,
              fontFamily: FONT,
              lineHeight: 1.7,
            }}
          >
            「決まり手まで一致」は、逃げ・差し・まくり等の展開まで含めて的中したレースの数。1着の艇番だけでなく、勝ち方まで予測できているかを見る指標
          </div>
        </SlideIn>
      </div>
    </AbsoluteFill>
  );
}

// --- Scene 3: CTA ---
function SceneCTA() {
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% 40%, #0f2c46 0%, ${NAVY_DARK} 100%)`,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Pop delay={4}>
        <div
          style={{
            color: WHITE,
            fontSize: 42,
            fontWeight: 900,
            fontFamily: FONT,
            textAlign: "center",
            marginBottom: 16,
            padding: "0 60px",
          }}
        >
          こういう答え合わせ、
          <br />
          無料で毎日見れます
        </div>
      </Pop>
      <Pop delay={16} style={{ marginBottom: 40 }}>
        <div
          style={{
            color: "rgba(248,250,252,0.7)",
            fontSize: 24,
            fontFamily: FONT,
          }}
        >
          明日は何%当たる？
        </div>
      </Pop>
      <Pop delay={28} style={{ marginBottom: 40 }}>
        <Logo size={48} />
      </Pop>
      <Pop delay={36}>
        <div
          style={{
            padding: "22px 64px",
            borderRadius: 999,
            background: GOLD,
            color: NAVY_DARK,
            fontSize: 44,
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

export function DailyAccuracyDigestTemplate({
  dateLabel,
  finishedCount,
  courseHitCount,
  courseHitRate,
  techniqueHitCount,
  techniqueHitRate,
}) {
  return (
    <AbsoluteFill style={{ background: NAVY_DARK }}>
      <Sequence from={0} durationInFrames={150}>
        <SceneHook
          dateLabel={dateLabel}
          finishedCount={finishedCount}
          courseHitRate={courseHitRate}
        />
      </Sequence>
      <Sequence from={150} durationInFrames={270}>
        <SceneStats
          finishedCount={finishedCount}
          courseHitCount={courseHitCount}
          courseHitRate={courseHitRate}
          techniqueHitCount={techniqueHitCount}
          techniqueHitRate={techniqueHitRate}
        />
      </Sequence>
      <Sequence from={420} durationInFrames={150}>
        <SceneCTA />
      </Sequence>
      <Audio src={staticFile("soundtrack-hitcheck.wav")} />
    </AbsoluteFill>
  );
}

// デモ・composition登録確認用（実データはprops経由で渡す運用、他テンプレートと同じ方針）
export function DailyAccuracyDigestCM_Demo() {
  return (
    <DailyAccuracyDigestTemplate
      dateLabel="9/5"
      finishedCount={120}
      courseHitCount={78}
      courseHitRate="65.0"
      techniqueHitCount={71}
      techniqueHitRate="59.2"
    />
  );
}
