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

/**
 * 出目分布型（第1弾: 1号艇の粘り込み率）— 龍神レーダー TikTok Shorts
 *
 * 2026-08-25新設。試験運用型（絶対厳守ルール3の例外運用、sns-video-producer-prompt.md参照）。
 * 「射幸心を煽らない」ルールへの抵触懸念があるため、配当額・倍率は一切使わず、
 * 「出現率」という統計値のみで構成する。
 *
 * 実データ出典: race_results全件（39,497レース、is_cancelled/is_no_raceを除く）。
 * 当初「会場別に一番出やすい3連単パターン」を検討したが、全24会場で最頻出が
 * 「1-2-3」に固定され差も3pt程度と小さく（大村14.91%〜芦屋11.66%）、訴求として
 * 弱いと判断し不採用。代わりに「1号艇が1着を逃した場合、2着に来る確率」という
 * 切り口に変更した。ランダムなら20%（1号艇除く5艇のうち1艇が2着枠）のところ、
 * 実際は30〜43%で1号艇が2着に来ており、統計的に十分な差がある。
 */

const NAVY = "#0f2c46";
const NAVY_DARK = "#081b2e";
const WHITE = "#f8fafc";
const GOLD = "#d4af37";
const FONT =
  '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';

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

// 1着コース別・1号艇が2着に来る確率（全期間、39,497レース集計）
const SECOND_PLACE_DATA = [
  { winner: "2号艇", rate: 42.7 },
  { winner: "3号艇", rate: 40.0 },
  { winner: "5号艇", rate: 35.9 },
  { winner: "6号艇", rate: 34.8 },
  { winner: "4号艇", rate: 30.5 },
];
const RANDOM_BASELINE = 20;

// --- Scene 1: フック（0-75f, 2.5s） ---
function SceneHook() {
  const frame = useCurrentFrame();
  const kb = interpolate(frame, [0, 75], [1, 1.04], {
    extrapolateRight: "clamp",
  });
  const maxRate = SECOND_PLACE_DATA[0].rate;
  return (
    <AbsoluteFill style={{ background: NAVY_DARK, transform: `scale(${kb})` }}>
      {/* 実データの可視化: 5パターンのミニバーを背景に敷く */}
      <AbsoluteFill
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          justifyContent: "center",
          gap: 30,
          padding: "0 110px 340px",
        }}
      >
        {SECOND_PLACE_DATA.map((d, i) => {
          const h = interpolate(d.rate, [0, maxRate], [50, 620]);
          return (
            <div
              key={i}
              style={{
                width: 90,
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
          出目データ・実データ
        </div>
      </Pop>

      {/* 主役: 巨大な「42.7%」。左端からはみ出す非対称配置 */}
      <Pop delay={-10} style={{ position: "absolute", left: 44, top: 250 }}>
        <div
          style={{
            color: GOLD,
            fontSize: 32,
            fontWeight: 800,
            fontFamily: FONT,
            marginBottom: 8,
          }}
        >
          2号艇が1着でも、1号艇が2着に来る確率
        </div>
      </Pop>
      <Pop delay={-10} style={{ position: "absolute", left: 40, top: 320 }}>
        <div
          style={{
            fontSize: 200,
            fontWeight: 900,
            fontFamily: FONT,
            color: GOLD,
            lineHeight: 0.9,
            textShadow: `0 0 130px ${GOLD}aa`,
          }}
        >
          42.7%
        </div>
      </Pop>

      <div style={{ position: "absolute", left: 60, top: 700, right: 60 }}>
        <Pop delay={-10} style={{ display: "inline-block" }}>
          <div
            style={{
              background: GOLD,
              color: NAVY_DARK,
              fontSize: 32,
              fontWeight: 900,
              fontFamily: FONT,
              borderRadius: 14,
              padding: "10px 22px",
              whiteSpace: "nowrap",
            }}
          >
            ランダムなら20%のはず
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
            1号艇が1着を逃したら、もう終わり？
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
            全国39,497レースの3連単データで検証
          </div>
        </Pop>
      </div>
    </AbsoluteFill>
  );
}

// --- ランキング行 ---
function RankRow({ rank, label, rate, delay, maxRate }) {
  return (
    <SlideIn
      delay={delay}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 20,
        marginBottom: 26,
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
            {label}が1着でも
          </span>
          <span
            style={{
              color: GOLD,
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
              background: GOLD,
              borderRadius: 6,
            }}
          />
        </div>
      </div>
    </SlideIn>
  );
}

// --- Scene 2: ランキング（75-280f, 約6.8s） ---
function SceneRanking() {
  const maxRate = SECOND_PLACE_DATA[0].rate;
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
          📌 1号艇が2着に粘り込む確率
        </div>
      </Pop>
      {SECOND_PLACE_DATA.map((d, i) => (
        <RankRow
          key={d.winner}
          rank={i + 1}
          label={d.winner}
          rate={d.rate}
          maxRate={maxRate}
          delay={10 + i * 8}
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
          全国全会場・全期間の3連単結果を集計
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
            fontSize: 40,
            fontWeight: 900,
            fontFamily: FONT,
            textAlign: "center",
            lineHeight: 1.3,
          }}
        >
          ランダムなら20%のはずが
        </div>
      </Pop>
      <Pop delay={20}>
        <div
          style={{
            color: GOLD,
            fontSize: 44,
            fontWeight: 900,
            fontFamily: FONT,
            textAlign: "center",
            marginTop: 10,
          }}
        >
          実際は最大42.7%
        </div>
      </Pop>
      <Pop delay={44}>
        <div
          style={{
            color: "rgba(248,250,252,0.75)",
            fontSize: 26,
            fontWeight: 700,
            fontFamily: FONT,
            marginTop: 22,
            textAlign: "center",
          }}
        >
          1号艇は、1着を逃してもしぶとく粘る
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
          出目データ、無料で見れる
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
          会場別・コース別の出現パターンをチェック
        </div>
      </Pop>
      <Pop delay={28}>
        <Logo size={48} />
      </Pop>
    </AbsoluteFill>
  );
}

export function OutcomeDistributionCM() {
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
