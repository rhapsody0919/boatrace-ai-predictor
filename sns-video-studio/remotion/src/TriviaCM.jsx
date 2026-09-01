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
 * 豆知識型（第1弾: 年齢と実際の1着率の関係）— 龍神レーダー TikTok Shorts
 *
 * 2026-08-25新設、2026-09-01データ再検証・再構成（generate-evergreen Routine）。
 * 旧版は本日出走選手584名（特定1日分）の「全国勝率」（レーティング値）平均を使っており、
 * 「本日」framing自体が別日に使い回すと不正確になる問題があった。会場攻略型の「全期間・
 * 実際の結果ベース」という設計方針に揃え、race_results×race_entries全件（race_id一致・
 * is_cancelled/is_no_race除外）から年代別「実際に1着になった割合」を集計し直した
 * （20代13.80%・n=58,651／30代19.87%・n=66,896←ピーク／40代17.98%・n=70,205／
 * 50代14.00%・n=42,979、計約23.9万走）。50代が20代をわずかに上回る点は旧版の
 * 「体力より経験」という結論と一致。日付非依存の恒久トリビアとして使い回せる。
 * 実例は特定日に紐づく「本日出走」ではなく、直近実績のある現役ベテラン
 * （松井繁選手・56歳、2026-08-30出走時点の全国勝率レーティング7.16）を使用。
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
// デザイナーレビュー（2026-08-25）で「巨大主役要素が無い、カテゴリタグ欠落、
// 背景データ可視化ゼロ」と要修正判定を受け、VenueRankingCMと同じ非対称配置＋
// 実データ背景バーのパターンに作り直した。「30代」を主役に据え、ピーク値を
// 右下バッジで添える構成。
const AGE_RATES = [13.8, 19.87, 17.98, 14.0]; // 20代/30代/40代/50代の実際の1着率(%)
function SceneHook() {
  const frame = useCurrentFrame();
  const kb = interpolate(frame, [0, 70], [1, 1.04], {
    extrapolateRight: "clamp",
  });
  const minRate = Math.min(...AGE_RATES);
  const maxRate = Math.max(...AGE_RATES);
  return (
    <AbsoluteFill style={{ background: NAVY_DARK, transform: `scale(${kb})` }}>
      {/* 実データの可視化: 年代別4本の平均全国勝率を背景バーに敷く */}
      <AbsoluteFill
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          justifyContent: "center",
          gap: 40,
          padding: "0 140px 340px",
        }}
      >
        {AGE_RATES.map((r, i) => {
          const h = interpolate(r, [minRate, maxRate], [50, 620]);
          const isPeak = i === 1;
          return (
            <div
              key={i}
              style={{
                width: 110,
                height: h,
                background: isPeak ? GOLD : "rgba(255,255,255,0.08)",
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
          年代別・全期間実績
        </div>
      </Pop>

      {/* 主役: 巨大な「30代」。左端からはみ出す非対称配置 */}
      <Pop
        delay={-10}
        style={{
          position: "absolute",
          left: -14,
          top: 300,
        }}
      >
        <div
          style={{
            fontSize: 260,
            fontWeight: 900,
            fontFamily: FONT,
            color: GOLD,
            lineHeight: 0.85,
            textShadow: `0 0 130px ${GOLD}aa`,
          }}
        >
          30代
        </div>
      </Pop>

      {/* ピーク値バッジ */}
      <div
        style={{
          position: "absolute",
          left: 60,
          top: 520,
          right: 60,
        }}
      >
        <Pop delay={-10}>
          <div
            style={{
              color: WHITE,
              fontSize: 60,
              fontWeight: 900,
              fontFamily: FONT,
              lineHeight: 1,
              marginBottom: 22,
            }}
          >
            が1着率のピーク
          </div>
        </Pop>
        <Pop delay={-10} style={{ display: "inline-block" }}>
          <div
            style={{
              background: GOLD,
              color: NAVY_DARK,
              fontSize: 38,
              fontWeight: 900,
              fontFamily: FONT,
              borderRadius: 14,
              padding: "10px 22px",
              whiteSpace: "nowrap",
            }}
          >
            実際の1着率 19.87%
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
              fontSize: 46,
              fontWeight: 900,
              fontFamily: FONT,
              textAlign: "center",
              lineHeight: 1.3,
              marginBottom: 10,
            }}
          >
            ボートレースは体力勝負？
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
            全国のべ約23.9万走で検証
          </div>
        </Pop>
      </div>
    </AbsoluteFill>
  );
}

// --- Scene 2: 年代別勝率グラフ（70-270f, 6.67s） ---
function AgeBar({ label, value, maxValue, isPeak, delay }) {
  const frame = useCurrentFrame();
  const local = frame - delay;
  const widthPct = interpolate(local, [0, 40], [0, (value / maxValue) * 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div style={{ width: "100%" }}>
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
            fontFamily: FONT,
            fontWeight: 800,
            fontSize: 30,
          }}
        >
          {label}
          {isPeak && (
            <span
              style={{
                color: GOLD,
                fontSize: 20,
                fontWeight: 900,
                marginLeft: 10,
              }}
            >
              ← ピーク
            </span>
          )}
        </span>
      </div>
      <div
        style={{
          width: "100%",
          height: 72,
          background: "rgba(255,255,255,0.08)",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${widthPct}%`,
            height: "100%",
            background: isPeak ? GOLD : "rgba(212,175,55,0.45)",
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            paddingRight: 18,
          }}
        >
          <span
            style={{
              color: NAVY_DARK,
              fontFamily: FONT,
              fontWeight: 900,
              fontSize: 24,
            }}
          >
            {value}%
          </span>
        </div>
      </div>
    </div>
  );
}

function SceneCompare() {
  return (
    <AbsoluteFill
      style={{
        background: NAVY_DARK,
        justifyContent: "center",
        alignItems: "center",
        padding: "0 70px",
        overflow: "hidden",
      }}
    >
      <Pop delay={-10} style={{ position: "absolute", top: 44, left: 44 }}>
        <Logo size={36} />
      </Pop>

      <div
        style={{
          position: "absolute",
          top: 220,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <Pop delay={0}>
          <div
            style={{
              color: GOLD,
              fontFamily: FONT,
              fontWeight: 900,
              fontSize: 38,
              textAlign: "center",
            }}
          >
            年代別・実際の1着率
          </div>
        </Pop>
      </div>

      <div
        style={{
          width: "100%",
          display: "flex",
          flexDirection: "column",
          gap: 46,
        }}
      >
        <AgeBar label="20代" value={13.8} maxValue={22} delay={10} />
        <AgeBar label="30代" value={19.87} maxValue={22} isPeak delay={22} />
        <AgeBar label="40代" value={17.98} maxValue={22} delay={34} />
        <AgeBar label="50代" value={14.0} maxValue={22} delay={46} />
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 260,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <Pop delay={80}>
          <div
            style={{
              display: "inline-block",
              background: `${GOLD}22`,
              border: `2px solid ${GOLD}`,
              borderRadius: 999,
              padding: "16px 32px",
              color: WHITE,
              fontFamily: FONT,
              fontWeight: 900,
              fontSize: 32,
              textAlign: "center",
            }}
          >
            50代でも、20代の実績を上回る
          </div>
        </Pop>
      </div>
    </AbsoluteFill>
  );
}

// --- Scene 3: 実例（270-330f, 2s） ---
function SceneExample() {
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
            color: "rgba(248,250,252,0.75)",
            fontSize: 28,
            fontWeight: 700,
            fontFamily: FONT,
          }}
        >
          56歳、現役トップクラスの一例
        </div>
      </Pop>
      <Pop delay={16}>
        <div
          style={{
            color: WHITE,
            fontSize: 66,
            fontWeight: 900,
            fontFamily: FONT,
            marginTop: 10,
          }}
        >
          松井繁選手
        </div>
      </Pop>
      <Pop delay={32}>
        <div
          style={{
            color: GOLD,
            fontSize: 90,
            fontWeight: 900,
            fontFamily: FONT,
            marginTop: 14,
            textShadow: `0 0 100px ${GOLD}aa`,
          }}
        >
          全国勝率7.16
        </div>
      </Pop>
      <Pop delay={44}>
        <div
          style={{
            color: "rgba(248,250,252,0.7)",
            fontSize: 24,
            fontWeight: 700,
            fontFamily: FONT,
            marginTop: 14,
            textAlign: "center",
          }}
        >
          経験を武器にするベテランの好例
        </div>
      </Pop>
    </AbsoluteFill>
  );
}

// --- Scene 4: ソフトCTA（330-420f, 3s）宣伝色を薄める ---
function SceneCTA() {
  return (
    <AbsoluteFill
      style={{
        background: NAVY_DARK,
        justifyContent: "center",
        alignItems: "center",
        overflow: "hidden",
      }}
    >
      <Pop delay={2}>
        <div
          style={{
            color: WHITE,
            fontSize: 34,
            fontWeight: 800,
            fontFamily: FONT,
            textAlign: "center",
            padding: "0 70px",
            lineHeight: 1.4,
          }}
        >
          こういう選手データ、
          <br />
          龍神レーダーで無料で見れます
        </div>
      </Pop>
      <Pop delay={22}>
        <div style={{ marginTop: 30 }}>
          <Logo size={44} />
        </div>
      </Pop>
      <Pop delay={34}>
        <div
          style={{
            marginTop: 18,
            color: GOLD,
            fontSize: 26,
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

export function TriviaCM() {
  return (
    <AbsoluteFill style={{ background: NAVY_DARK }}>
      <Sequence from={0} durationInFrames={70}>
        <SceneHook />
      </Sequence>
      <Sequence from={70} durationInFrames={200}>
        <SceneCompare />
      </Sequence>
      <Sequence from={270} durationInFrames={60}>
        <SceneExample />
      </Sequence>
      <Sequence from={330} durationInFrames={90}>
        <SceneCTA />
      </Sequence>
      <Audio src={staticFile("soundtrack-hitcheck.wav")} />
    </AbsoluteFill>
  );
}
