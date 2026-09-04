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
 * 対決煽り型（第1弾: 大村6R 1号艇vs6号艇）— 龍神レーダー TikTok Shorts
 *
 * 2026-08-25新設。出走表データで2艇を対決させ、「AIはどっちを本命視するか」を
 * 見せる型。今回のデータでは全国勝率は6号艇が圧倒的に上（4.02%→6.67%）だが、
 * AIスコアはコース有利を評価して1号艇の方が高い（2490 vs 2391）。「実力だけでは
 * 読めない、コースの影響をAIがどう評価しているか」という透明性の訴求。
 *
 * 実データ出典: 2026-08-25 大村6R（race_id: 2026-08-25-22-06、締切14:47）の
 * race_entries（1号艇 多羅尾達之・6号艇 佐藤博亮）。射幸心を煽る配当訴求ではなく、
 * AIの予想根拠を見せる構成。案A（会場攻略型と同じ非対称配置・ベタ塗りフック帯）を
 * 2艇対決用にアレンジ。
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

function PulseRings({ color = GOLD }) {
  const frame = useCurrentFrame();
  return (
    <>
      {[0, 25, 50].map((delay) => {
        const local = frame - delay;
        const scale = interpolate(local % 75, [0, 75], [0.3, 2.6], {
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

// --- Scene 1: フック（0-70f, 2.33s） ---
// デザイナーレビュー（2026-08-25）で「左右対称のVS配置は案Aの非対称原則に反する、
// 背景データ可視化が無い」と要修正判定を受け、VenueRankingCMと同じ非対称配置＋
// 実データ背景バーのパターンに作り直した。1号艇を主役に据え、6号艇は右下に
// 小さく対比バッジとして添える構成。
const BOAT_RATES = [4.02, 4.94, 2.19, 7.84, 5.72, 6.67]; // 大村6R、1〜6号艇の全国勝率
function SceneHook() {
  const frame = useCurrentFrame();
  const kb = interpolate(frame, [0, 70], [1, 1.04], {
    extrapolateRight: "clamp",
  });
  const minRate = Math.min(...BOAT_RATES);
  const maxRate = Math.max(...BOAT_RATES);
  return (
    <AbsoluteFill style={{ background: NAVY_DARK, transform: `scale(${kb})` }}>
      {/* 実データの可視化: 大村6R全6艇の全国勝率を背景バーに敷く */}
      <AbsoluteFill
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          justifyContent: "center",
          gap: 22,
          padding: "0 90px 340px",
        }}
      >
        {BOAT_RATES.map((r, i) => {
          const h = interpolate(r, [minRate, maxRate], [50, 620]);
          const isBoat1 = i === 0;
          return (
            <div
              key={i}
              style={{
                width: 70,
                height: h,
                background: isBoat1 ? GOLD : "rgba(255,255,255,0.08)",
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
          大村6R・実データ対決
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

      {/* 対比バッジ: 6号艇の実力優位を主役の右下に重ねる */}
      <div
        style={{
          position: "absolute",
          left: 520,
          top: 780,
          right: 60,
        }}
      >
        <Pop delay={-10}>
          <div
            style={{
              color: WHITE,
              fontSize: 84,
              fontWeight: 900,
              fontFamily: FONT,
              lineHeight: 1,
              marginBottom: 22,
            }}
          >
            VS 6号艇
          </div>
        </Pop>
        <Pop delay={-10} style={{ display: "inline-block" }}>
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
            全国勝率+2.65pt上
          </div>
        </Pop>
      </div>

      {/* 下部フック帯: ベタ塗り・ハードエッジ */}
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
              fontSize: 50,
              fontWeight: 900,
              fontFamily: FONT,
              textAlign: "center",
              lineHeight: 1.3,
              marginBottom: 10,
            }}
          >
            AIはどっちを本命にしてる？
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
            本日開催・実際の出走表データで検証
          </div>
        </Pop>
      </div>
    </AbsoluteFill>
  );
}

// --- Scene 2: スペック比較（70-210f, 4.67s）実データを左右対比で見せる ---
function StatRow({ label, boat1Value, boat6Value, delay, boat6Win }) {
  return (
    <SlideIn
      delay={delay}
      style={{
        display: "flex",
        alignItems: "center",
        marginBottom: 40,
      }}
    >
      <div
        style={{
          flex: 1,
          textAlign: "right",
          paddingRight: 20,
          color: boat6Win ? "rgba(248,250,252,0.55)" : WHITE,
          fontSize: 52,
          fontWeight: 900,
          fontFamily: FONT,
        }}
      >
        {boat1Value}
      </div>
      <div
        style={{
          width: 180,
          textAlign: "center",
          color: "rgba(248,250,252,0.5)",
          fontSize: 26,
          fontWeight: 700,
          fontFamily: FONT,
          flexShrink: 0,
        }}
      >
        {label}
      </div>
      <div
        style={{
          flex: 1,
          textAlign: "left",
          paddingLeft: 20,
          color: boat6Win ? GOLD : WHITE,
          fontSize: 52,
          fontWeight: 900,
          fontFamily: FONT,
        }}
      >
        {boat6Value}
      </div>
    </SlideIn>
  );
}

function SceneCompare() {
  return (
    <AbsoluteFill
      style={{
        background: NAVY_DARK,
        padding: "0 50px",
        justifyContent: "center",
      }}
    >
      <Pop delay={-10} style={{ position: "absolute", top: 44, left: 44 }}>
        <Logo size={36} />
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
          📋 実データ比較
        </div>
      </Pop>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 64,
          padding: "0 10px",
        }}
      >
        <Pop delay={0} style={{ textAlign: "center", flex: 1 }}>
          <div
            style={{
              color: "rgba(248,250,252,0.6)",
              fontSize: 26,
              fontWeight: 800,
              fontFamily: FONT,
              marginBottom: 10,
            }}
          >
            1号艇（イン）
          </div>
          <div
            style={{
              color: WHITE,
              fontSize: 46,
              fontWeight: 900,
              fontFamily: FONT,
            }}
          >
            多羅尾達之
          </div>
        </Pop>
        <Pop delay={8} style={{ textAlign: "center", flex: 1 }}>
          <div
            style={{
              color: GOLD,
              fontSize: 26,
              fontWeight: 800,
              fontFamily: FONT,
              marginBottom: 10,
            }}
          >
            6号艇（アウト）
          </div>
          <div
            style={{
              color: GOLD,
              fontSize: 46,
              fontWeight: 900,
              fontFamily: FONT,
            }}
          >
            佐藤博亮
          </div>
        </Pop>
      </div>

      <StatRow
        label="級別"
        boat1Value="B1"
        boat6Value="A1"
        delay={16}
        boat6Win
      />
      <StatRow
        label="全国勝率"
        boat1Value="4.02%"
        boat6Value="6.67%"
        delay={26}
        boat6Win
      />
      <StatRow
        label="年齢"
        boat1Value="53歳"
        boat6Value="38歳"
        delay={36}
        boat6Win
      />

      <Pop delay={54} style={{ marginTop: 50, textAlign: "center" }}>
        <div
          style={{
            display: "inline-block",
            background: `${GOLD}22`,
            border: `2px solid ${GOLD}`,
            borderRadius: 999,
            padding: "16px 32px",
            color: GOLD,
            fontSize: 32,
            fontWeight: 900,
            fontFamily: FONT,
          }}
        >
          全国勝率は6号艇が+2.65pt上
        </div>
      </Pop>
    </AbsoluteFill>
  );
}

// --- Scene 3: どんでん返し（210-320f, 3.67s）AIの本命は1号艇 ---
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
      <PulseRings />
      <Pop delay={0}>
        <div
          style={{
            color: WHITE,
            fontSize: 42,
            fontWeight: 900,
            fontFamily: FONT,
            textAlign: "center",
            lineHeight: 1.3,
          }}
        >
          実力は6号艇が上、なのに
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
            marginTop: 6,
          }}
        >
          AIの本命は…
        </div>
      </Pop>
      <Pop delay={40}>
        <div
          style={{
            color: WHITE,
            fontSize: 160,
            fontWeight: 900,
            fontFamily: FONT,
            marginTop: 14,
            lineHeight: 0.9,
            background: "rgba(255,255,255,0.08)",
            borderRadius: 28,
            padding: "8px 40px",
            textShadow: `0 8px 40px ${GOLD}55`,
          }}
        >
          1号艇
        </div>
      </Pop>
      <Pop delay={62}>
        <div
          style={{
            color: "rgba(248,250,252,0.75)",
            fontSize: 26,
            fontWeight: 700,
            fontFamily: FONT,
            marginTop: 18,
            textAlign: "center",
          }}
        >
          コースの有利さも、AIはちゃんと数値で見ている
        </div>
      </Pop>
    </AbsoluteFill>
  );
}

// --- Scene 4: CTA（320-390f, 2.33s） ---
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
            fontSize: 42,
            fontWeight: 900,
            fontFamily: FONT,
            textAlign: "center",
            marginBottom: 16,
            padding: "0 60px",
          }}
        >
          この対決、無料で見られる
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
          全レースのAIスコアが毎日見られる
        </div>
      </Pop>
      <Pop delay={28}>
        <Logo size={48} />
      </Pop>
    </AbsoluteFill>
  );
}

export function RivalryCM() {
  return (
    <AbsoluteFill style={{ background: NAVY_DARK }}>
      <Sequence from={0} durationInFrames={70}>
        <SceneHook />
      </Sequence>
      <Sequence from={70} durationInFrames={140}>
        <SceneCompare />
      </Sequence>
      <Sequence from={210} durationInFrames={110}>
        <SceneTwist />
      </Sequence>
      <Sequence from={320} durationInFrames={70}>
        <SceneCTA />
      </Sequence>
      <Audio src={staticFile("soundtrack-hitcheck.wav")} />
    </AbsoluteFill>
  );
}
