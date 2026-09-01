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
 * 予想数値フック型（TikTok向け・マスコット無し・実画面スクショ不要）
 *
 * LivePredictionCM_TikTok.jsx（答え合わせ型）と同じ「イン崩れ注意度カードを
 * テキストベースで再現する」設計を、結果未確定の予想フック型に転用したもの。
 * Chromiumサンドボックスの制約でPlaywrightからの外部サイト到達が
 * ブロックされる問題（2026-08-28調査で判明、プロキシ設定では解決不可）を
 * 回避するため、実画面スクショを一切使わずSupabaseの実データのみで完結する。
 *
 * データはpropsで受け取るテンプレート関数（VenueRankingTemplateと同じ方針）
 * にしているため、日替わりで題材レースを差し替えるだけで量産できる。
 */

const NAVY = "#0f2c46";
const NAVY_DARK = "#081b2e";
const ACCENT = "#38bdf8";
const WHITE = "#f8fafc";
const GREEN = "#22c55e";
const GOLD = "#f59e0b";
const FONT =
  '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';

// SceneHook（カバー）とSceneVolatilityで共有するレベル別の配色・アイコン・ラベル。
// 判定基準（getVolatilityLevel）はSceneVolatility節で定義（2026-09-01、カバーにも
// イン崩れ注意度を出すB案採用にあたり、従来SceneVolatility内にインラインだった
// 三項演算子をここに集約し二重管理を解消）
const VOLATILITY_ICON = { high: "🌪️", low: "🎯", standard: "⚖️" };
const VOLATILITY_COLOR = {
  high: "#ff9800",
  low: "#4caf50",
  standard: "#2196f3",
};
const VOLATILITY_LABEL = { high: "警戒", low: "本命有利", standard: "標準" };
const HOOK_COPY_BY_LEVEL = {
  high: "逃げ切れるか、それとも荒れるか。",
  standard: "堅く決まるか、まさかの波乱か。",
  low: "順当に決まるか、一撃の波乱か。",
};

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

// --- Scene 1: フック（0-75f, 2.5s） カバー画像（frame=0）としても使われる ---
// 2026-09-01、B案採用（ユーザー指摘: 数字ブロックだけ左寄せ固定で上のタイトルと
// ズレる／イン崩れ注意度がカバーに一切出ておらず訴求が弱い）。逃げ確率とイン崩れ
// 注意度の2つを中央揃えの統計チップとして並べ、帯コピーもレベル別に出し分ける。
function SceneHook({
  venue,
  raceNumber,
  startTime,
  raceGrade,
  nigePercent,
  percentile,
}) {
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
            fontSize: 24,
            fontWeight: 700,
            fontFamily: FONT,
          }}
        >
          本日の注目レース
        </div>
      </Pop>

      {/* タイトル: 「何の動画か」を最も目立つ要素として明示（2026-08-31、天才デザイナー・
          天才マーケター議論。数値だけでは何を示すか伝わらないという指摘への対応） */}
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

      {/* 主役: 逃げ確率とイン崩れ注意度、2つの統計を中央揃えで並べる */}
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
              fontSize: 36,
              fontWeight: 900,
              fontFamily: FONT,
              borderRadius: 14,
              padding: "10px 22px",
              whiteSpace: "nowrap",
            }}
          >
            本日{startTime}発走・{raceGrade}
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

// --- Scene 2: 展開予測TOP3（TurnPatternList.jsxの実UIをRemotion移植） ---
const TECHNIQUE_NAMES = {
  nige: "逃げ",
  sashi: "差し",
  makuri: "まくり",
  makurizashi: "まくり差し",
  nuki: "抜き",
  megumare: "恵まれ",
};
const RANK_ICONS = ["🥇", "🥈", "🥉"];

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
            marginBottom: 36,
          }}
        >
          龍神レーダー独自AIが読む、1着候補ランキング
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

// --- Scene 3: イン崩れ注意度（VolatilityDisplay.jsxの実UIをRemotion移植） ---
// レベル判定・配色・アイコンはgetVolatilityLevel/VolatilityDisplay.jsxと同じ基準
function getVolatilityLevel(percentile) {
  if (percentile >= 70) return "high";
  if (percentile <= 30) return "low";
  return "standard";
}

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

// --- Scene 3: CTA ---
// 時刻訴求（旧: 「{startTime}発走までに」）は投稿タイミングが締切に間に合わない
// 場合に文言が破綻するリスクがある（2026-08-24の実例、天才マーケター議論での指摘）
// ため、時刻に依存しない文言に変更
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
            fontSize: 44,
            fontWeight: 900,
            fontFamily: FONT,
            textAlign: "center",
            marginBottom: 16,
            padding: "0 60px",
          }}
        >
          今すぐ無料で
          <br />
          予想をチェック
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
          あなたの狙う艇は、堅い？崩れやすい？
        </div>
      </Pop>
      <Pop delay={28}>
        <Logo size={48} />
      </Pop>
    </AbsoluteFill>
  );
}

function LivePredictionHookTemplate({
  venue,
  raceNumber,
  startTime,
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
      <Sequence from={0} durationInFrames={75}>
        <SceneHook
          venue={venue}
          raceNumber={raceNumber}
          startTime={startTime}
          raceGrade={raceGrade}
          nigePercent={nigePercent}
          percentile={percentile}
        />
      </Sequence>
      <Sequence from={75} durationInFrames={150}>
        <SceneTurnPrediction
          venue={venue}
          raceNumber={raceNumber}
          patterns={patterns}
        />
      </Sequence>
      <Sequence from={225} durationInFrames={180}>
        <SceneVolatility
          boatGrade={boatGrade}
          boatWinRate={boatWinRate}
          percentile={percentile}
          reasons={reasons}
        />
      </Sequence>
      <Sequence from={405} durationInFrames={100}>
        <SceneCTA />
      </Sequence>
      <Audio src={staticFile("soundtrack-hitcheck.wav")} />
    </AbsoluteFill>
  );
}

// 2026-08-28 サンプル: 多摩川12R（本日17:15発走・G3）の実データ
// race_id=2026-08-28-05-12、predictions/racesテーブルの実測値をそのまま使用
// reasonsはHook/展開予測シーンで既出の情報（勝率6.93・逃げ確率40%）を除き、
// 新情報（今節ST）のみに絞る（天才デザイナー・天才マーケター議論の指摘を反映）
export function LivePredictionHookCM_Demo() {
  return (
    <LivePredictionHookTemplate
      venue="多摩川"
      raceNumber={12}
      startTime="17:15"
      raceGrade="G3"
      nigePercent={40}
      patterns={[
        { winnerCourse: 1, technique: "nige", probability: 0.4 },
        { winnerCourse: 2, technique: "sashi", probability: 0.11 },
        { winnerCourse: 3, technique: "makurizashi", probability: 0.07 },
      ]}
      boatGrade="A1"
      boatWinRate="6.93"
      percentile={15}
      reasons={["1号艇の今節STは標準（平均0.149秒）→ スタートは安定"]}
    />
  );
}
