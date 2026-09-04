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
 * 答え合わせ型（TikTok/X向け・マスコット無し・実画面スクショ不要・props駆動テンプレート）
 *
 * 「AIが○○と予想してたレース」→「結果は？」→CTAという答え合わせ型自体は
 * `docs/operation/sns-video-producer-prompt.md`で「実装済み」と記載されていたが、
 * 2026-08-31のレビューで**props駆動の再利用可能なテンプレートとしては存在しなかった**
 * ことが判明した。既存の`LivePredictionCM_TikTok.jsx`は答え合わせ型として実在するが、
 * 2026-08-24に江戸川12Rの実データをハードコードした1回限りの実装で、別レースを扱うには
 * ファイルごと複製・書き換えが必要だった。加えて`sns_template_variants`に登録されていた
 * 過去2本（gamagori-1r-0829・karatsu-5r-0831-native）はRoutine実行環境内でその場限りに
 * 作られたテンプレート化前の実装と見られ、コミットもされていなかった。旧仕様が前提として
 * いた「実際の的中画面」（実画面スクショ）も2026-08-28に判明したPlaywright/Chromiumの
 * サンドボックス制約（本番サイトへの外部到達が一律ブロック）で実現不可能になっている。
 * 本ファイルはLivePredictionHookCM.jsxと同じ「アプリの実際の分析UI（TurnPatternList.jsx/
 * VolatilityDisplay.jsx）をRemotionに移植し、Supabase実データを差し込むだけで日替わりの
 * レースを量産できる」テンプレート方式で答え合わせ型を作り直したもの。
 *
 * カバー（frame=0）デザインはB案（AI予想 vs 結果の2値比較＋既存イン崩れ注意度バーの
 * 縮小版）を採用（2026-08-31、8人パネル議論＋ユーザー選定）。「44%」等の数字だけでは
 * 何を訴求しているか伝わらないという指摘への対応と、レース選定基準にイン崩れ注意度を
 * 使う方針（同日決定）を1画面で両方伝えられる構成にしている。
 */

const NAVY_DARK = "#081b2e";
const ACCENT = "#38bdf8";
const WHITE = "#f8fafc";
const GOLD = "#f59e0b";
const HIT_GREEN = "#22c55e";

// 艇番別カラー（公式カラー、src/utils/colors.jsのBOAT_COLORSと同じ配色）
const BOAT_COLORS = {
  1: { bg: "#ffffff", text: "#000000" },
  2: { bg: "#000000", text: "#ffffff" },
  3: { bg: "#e53935", text: "#ffffff" },
  4: { bg: "#1e88e5", text: "#ffffff" },
  5: { bg: "#fdd835", text: "#000000" },
  6: { bg: "#43a047", text: "#ffffff" },
};

const TECHNIQUE_NAMES = {
  nige: "逃げ",
  sashi: "差し",
  makuri: "まくり",
  makurizashi: "まくり差し",
  nuki: "抜き",
  megumare: "恵まれ",
};
const RANK_ICONS = ["🥇", "🥈", "🥉"];

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

function getVolatilityLevel(percentile) {
  if (percentile >= 70) return "high";
  if (percentile <= 30) return "low";
  return "standard";
}

// --- Scene 1: フック（B案） カバー画像（frame=0）としても使われる ---
// AI予想 vs 結果の2値比較＋イン崩れ注意度の縮小バーを1画面に収め、frame=0でも
// 「何を検証する動画か」が静止画のまま伝わるようにする（アニメーション完了を待たない）
function SceneHook({
  venue,
  raceNumber,
  startTime,
  raceGrade,
  resultHeadline,
  predictedBoat,
  predictedTechnique,
  predictedProbability,
  actualBoat,
  actualTechnique,
  headlineHit,
  percentile,
}) {
  // percentileはDB(predictions.feature_contributions.volatilityPercentile)と同じ
  // 0〜1のスケールで受け取る（src/utils/volatilityLevel.jsと統一）。表示・バー幅は
  // 0〜100の整数に変換してから使う（2026-08-31コードレビューで指摘: 変換を忘れると
  // Routineが実データをそのまま渡した際にバーがほぼ見えなくなり、レベル判定も狂う）
  const percentileInt = Math.round(percentile * 100);
  const level = getVolatilityLevel(percentileInt);
  const volatilityColor =
    level === "high" ? "#ff9800" : level === "low" ? "#4caf50" : "#2196f3";
  const volatilityIcon =
    level === "high" ? "🌪️" : level === "low" ? "🎯" : "⚖️";
  const volatilityLabel =
    level === "high"
      ? "注意度 高"
      : level === "low"
        ? "注意度 低"
        : "注意度 標準";

  return (
    <AbsoluteFill style={{ background: NAVY_DARK }}>
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
          答え合わせ
        </div>
      </Pop>

      {/* スポイラー見出し: 何が起きたレースかを一言で明示する（B案の主訴求） */}
      <Pop
        delay={-10}
        style={{ position: "absolute", top: 160, left: 48, right: 48 }}
      >
        <div
          style={{
            color: WHITE,
            fontSize: 62,
            fontWeight: 900,
            fontFamily: FONT,
            lineHeight: 1.25,
            textWrap: "balance",
          }}
        >
          {resultHeadline}
        </div>
      </Pop>

      {/* AI予想 vs 結果の2値比較 */}
      <div
        style={{
          position: "absolute",
          top: 420,
          left: 48,
          right: 48,
          display: "flex",
          alignItems: "center",
          gap: 20,
        }}
      >
        <Pop delay={-10} style={{ flex: 1 }}>
          <div
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.14)",
              borderRadius: 20,
              padding: "26px 20px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                color: "rgba(248,250,252,0.6)",
                fontSize: 22,
                fontWeight: 700,
                fontFamily: FONT,
                letterSpacing: 2,
              }}
            >
              AI予想
            </div>
            <div
              style={{
                color: GOLD,
                fontSize: 68,
                fontWeight: 900,
                fontFamily: FONT,
                marginTop: 8,
              }}
            >
              {predictedBoat}号艇
            </div>
            <div
              style={{
                color: "rgba(248,250,252,0.75)",
                fontSize: 22,
                fontFamily: FONT,
                marginTop: 4,
              }}
            >
              {TECHNIQUE_NAMES[predictedTechnique] || predictedTechnique}
              {Math.round(predictedProbability * 100)}%
            </div>
          </div>
        </Pop>

        <Pop delay={-10}>
          <div style={{ color: "rgba(248,250,252,0.35)", fontSize: 36 }}>→</div>
        </Pop>

        <Pop delay={-10} style={{ flex: 1 }}>
          <div
            style={{
              background: "rgba(255,255,255,0.06)",
              border: `1px solid ${headlineHit ? HIT_GREEN : "#ff9800"}55`,
              borderRadius: 20,
              padding: "26px 20px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                color: "rgba(248,250,252,0.6)",
                fontSize: 22,
                fontWeight: 700,
                fontFamily: FONT,
                letterSpacing: 2,
              }}
            >
              結果
            </div>
            <div
              style={{
                color: headlineHit ? HIT_GREEN : "#ffb74d",
                fontSize: 68,
                fontWeight: 900,
                fontFamily: FONT,
                marginTop: 8,
              }}
            >
              {actualBoat}号艇
            </div>
            <div
              style={{
                color: "rgba(248,250,252,0.75)",
                fontSize: 22,
                fontFamily: FONT,
                marginTop: 4,
              }}
            >
              {TECHNIQUE_NAMES[actualTechnique] || actualTechnique}
            </div>
          </div>
        </Pop>
      </div>

      {/* レース情報 */}
      <Pop
        delay={-10}
        style={{
          position: "absolute",
          top: 660,
          left: 48,
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <span
          style={{
            color: WHITE,
            fontSize: 34,
            fontWeight: 900,
            fontFamily: FONT,
          }}
        >
          {venue}
          {raceNumber}R
        </span>
        <span
          style={{
            background: "rgba(255,255,255,0.12)",
            color: "rgba(248,250,252,0.8)",
            fontSize: 20,
            fontWeight: 700,
            fontFamily: FONT,
            borderRadius: 10,
            padding: "5px 14px",
          }}
        >
          {startTime}発走・{raceGrade}
        </span>
      </Pop>

      {/* イン崩れ注意度の縮小バー（既存VolatilityDisplay.jsxのバーを流用、詳細は次シーンで） */}
      <div style={{ position: "absolute", left: 48, right: 48, bottom: 56 }}>
        <SlideIn delay={-14}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 10,
              color: volatilityColor,
              fontSize: 24,
              fontWeight: 800,
              fontFamily: FONT,
            }}
          >
            <span>{volatilityIcon}</span>
            <span>イン崩れ{volatilityLabel}</span>
            <span
              style={{
                marginLeft: "auto",
                color: "rgba(248,250,252,0.55)",
                fontSize: 18,
                fontWeight: 600,
              }}
            >
              このレースをAIが選んだ理由
            </span>
          </div>
          <div
            style={{
              position: "relative",
              height: 12,
              borderRadius: 6,
              background: "rgba(255,255,255,0.12)",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                width: `${percentileInt}%`,
                height: "100%",
                background: volatilityColor,
                borderRadius: 6,
              }}
            />
          </div>
        </SlideIn>
      </div>
    </AbsoluteFill>
  );
}

// --- Scene 2: 展開予測TOP3（TurnPatternList.jsxの実UIをRemotion移植、LivePredictionHookCM.jsxと共通） ---
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
          🌀 AIの予想TOP3（{venue}
          {raceNumber}R）
        </div>
      </Pop>
      <Pop delay={8}>
        <div
          style={{
            color: "rgba(248,250,252,0.55)",
            fontSize: 20,
            fontFamily: FONT,
            marginBottom: 36,
          }}
        >
          レース前にAIが出していた1着候補ランキング
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

// --- Scene 3: イン崩れ注意度 詳細（VolatilityDisplay.jsxの実UIをRemotion移植、LivePredictionHookCM.jsxと共通） ---
function SceneVolatility({ boatGrade, boatWinRate, percentile, reasons }) {
  // percentileは0〜1スケールで受け取る（SceneHookと同じ、DBの実データ単位に合わせる）
  const percentileInt = Math.round(percentile * 100);
  const level = getVolatilityLevel(percentileInt);
  const icon = level === "high" ? "🌪️" : level === "low" ? "🎯" : "⚖️";
  const accentColor =
    level === "high" ? "#ff9800" : level === "low" ? "#4caf50" : "#2196f3";
  const label =
    level === "high" ? "警戒" : level === "low" ? "本命有利" : "標準";

  return (
    <AbsoluteFill
      style={{
        background: NAVY_DARK,
        padding: "0 56px",
        justifyContent: "center",
      }}
    >
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
            会場内で1号艇がどれだけ崩れやすいかを示す龍神レーダー独自指標。今回の動画は
            この数値が高いレースを選んでいる
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
              {percentileInt}
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
                width: `${percentileInt}%`,
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
            <SlideIn
              key={line}
              delay={34 + i * 10}
              style={{ marginBottom: 10 }}
            >
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

// --- Scene 4: 結果詳細（配当・的中の答え合わせ本体） ---
// top3Hit: 実際の結果がAI予想TOP3のいずれかと一致したか。SceneHookのheadlineHit
// （見出しの単一予想が当たったか）とは別の問いであり、混同すると「2つの表示が
// 違う問いに答えて分かりにくい」という過去の撤去事例（FirstMarkAnimation）と
// 同じ失敗になる（2026-08-31コードレビューで発覚・修正）
function SceneResult({ top3Hit, actualBoat, actualTechnique, payoutText }) {
  return (
    <AbsoluteFill
      style={{
        background: NAVY_DARK,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Pop delay={4}>
        <div
          style={{
            fontSize: 90,
            marginBottom: 8,
            textAlign: "center",
          }}
        >
          {top3Hit ? "🎯" : "🌀"}
        </div>
      </Pop>
      <Pop delay={10}>
        <div
          style={{
            color: top3Hit ? HIT_GREEN : "#ffb74d",
            fontSize: 52,
            fontWeight: 900,
            fontFamily: FONT,
            marginBottom: 20,
          }}
        >
          {top3Hit ? "AI予想TOP3で的中" : "AI予想TOP3も外れる結果に"}
        </div>
      </Pop>
      <Pop delay={18}>
        <div
          style={{
            color: WHITE,
            fontSize: 40,
            fontWeight: 900,
            fontFamily: FONT,
            marginBottom: 12,
            textAlign: "center",
          }}
        >
          {actualBoat}号艇の
          {TECHNIQUE_NAMES[actualTechnique] || actualTechnique}
        </div>
      </Pop>
      <Pop delay={24}>
        <div
          style={{
            color: GOLD,
            fontSize: 30,
            fontWeight: 700,
            fontFamily: FONT,
          }}
        >
          {payoutText}
        </div>
      </Pop>
    </AbsoluteFill>
  );
}

// --- Scene 5: CTA ---
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
            fontSize: 44,
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
          次はどのレースで的中する？
        </div>
      </Pop>
      <Pop delay={28}>
        <Logo size={48} />
      </Pop>
    </AbsoluteFill>
  );
}

function AnswerCheckHookTemplate({
  venue,
  raceNumber,
  startTime,
  raceGrade,
  resultHeadline,
  predictedBoat,
  predictedTechnique,
  predictedProbability,
  actualBoat,
  actualTechnique,
  patterns,
  boatGrade,
  boatWinRate,
  percentile,
  reasons,
  payoutText,
}) {
  // 「的中」を表す値をpropsとして直接渡すのではなく、実データ（patterns/actualBoat等）
  // から必ずこの場で導出する。手入力propsとして独立させると、コードレビューで実際に
  // 発覚したように整合の取れないデータ（TOP3にactualBoatが含まれるのにisHit=falseに
  // していた）を渡せてしまうため
  const headlineHit =
    actualBoat === predictedBoat && actualTechnique === predictedTechnique;
  const top3Hit = patterns.some((p) => p.winnerCourse === actualBoat);

  return (
    <AbsoluteFill style={{ background: NAVY_DARK }}>
      <Sequence from={0} durationInFrames={90}>
        <SceneHook
          venue={venue}
          raceNumber={raceNumber}
          startTime={startTime}
          raceGrade={raceGrade}
          resultHeadline={resultHeadline}
          predictedBoat={predictedBoat}
          predictedTechnique={predictedTechnique}
          predictedProbability={predictedProbability}
          actualBoat={actualBoat}
          actualTechnique={actualTechnique}
          headlineHit={headlineHit}
          percentile={percentile}
        />
      </Sequence>
      <Sequence from={90} durationInFrames={150}>
        <SceneTurnPrediction
          venue={venue}
          raceNumber={raceNumber}
          patterns={patterns}
        />
      </Sequence>
      <Sequence from={240} durationInFrames={180}>
        <SceneVolatility
          boatGrade={boatGrade}
          boatWinRate={boatWinRate}
          percentile={percentile}
          reasons={reasons}
        />
      </Sequence>
      <Sequence from={420} durationInFrames={90}>
        <SceneResult
          top3Hit={top3Hit}
          actualBoat={actualBoat}
          actualTechnique={actualTechnique}
          payoutText={payoutText}
        />
      </Sequence>
      <Sequence from={510} durationInFrames={100}>
        <SceneCTA />
      </Sequence>
      <Audio src={staticFile("soundtrack-hitcheck.wav")} />
    </AbsoluteFill>
  );
}

// 2026-08-29実績（answer-check/gamagori-1r-0829の実データを再現）:
// 蒲郡1R、AIは1号艇の逃げをわずか40%と予想、結果は3号艇のまくりで単勝的中
export function AnswerCheckHookCM_Demo() {
  return (
    <AnswerCheckHookTemplate
      venue="蒲郡"
      raceNumber={1}
      startTime="10:50"
      raceGrade="一般戦"
      resultHeadline="1号艇、逃げ切れず"
      predictedBoat={1}
      predictedTechnique="nige"
      predictedProbability={0.4}
      actualBoat={3}
      actualTechnique="makuri"
      patterns={[
        { winnerCourse: 1, technique: "nige", probability: 0.4 },
        { winnerCourse: 3, technique: "makuri", probability: 0.08 },
        { winnerCourse: 2, technique: "sashi", probability: 0.07 },
      ]}
      boatGrade="A1"
      boatWinRate="6.93"
      percentile={0.93}
      reasons={["1号艇の今節STは平均より遅く0.18秒 → 逃げ切りに黄信号だった"]}
      payoutText="単勝 3号艇 ¥1,400"
    />
  );
}
