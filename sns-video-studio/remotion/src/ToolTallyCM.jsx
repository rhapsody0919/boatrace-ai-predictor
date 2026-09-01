import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
} from "remotion";

/**
 * 一覧アピール型（第2弾: 分析ツール物量アピール）— 龍神レーダー X Shorts
 *
 * 2026-09-01新設（generate-evergreen Routine、ADR 0029の新規コンポジション試作枠）。
 * 既存の一覧アピール型（ToolCM_A）は「本日の好調・不調選手ランキング」という
 * 日替わりデータの1機能を深掘りする構成だったが、これは/winning-techniqueページの
 * 実際のタブ数（17種類、src/pages/WinningTechniqueAnalysis.jsxのTAB_KEYS）という
 * 日付非依存の恒久的な事実を使う、より狭義の「一覧アピール型」（ツール一覧タブの実画面
 * →物量訴求→CTA）。実データ: ローカル起動した本番同等画面（localhost:5173）を
 * Playwrightで実際にスクショ取得（tool-tally-tabs.png、17個のタブボタンが実際に
 * 並んでいることを画面から直接確認済み）。会場攻略型で確立した「非対称配置・GOLD統一・
 * ベタ塗り帯」のカバーデザイン方針をこの型にも適用した。
 */

const NAVY_DARK = "#081b2e";
const NAVY = "#0f2c46";
const WHITE = "#f8fafc";
const GOLD = "#d4af37";
const FONT =
  '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';

const TOOL_COUNT = 17;

// 実際の/winning-techniqueページのタブ絵文字（TAB_KEYS、src/locales/ja/common.jsonの
// analysisPage.tabs.*と同じ並び）。Scene1の余白埋め・Scene2の伏線として使う
const TAB_EMOJIS = [
  "📊",
  "🎯",
  "🔧",
  "📈",
  "⏱️",
  "🚀",
  "💔",
  "🏃",
  "⏲️",
  "📈",
  "🏆",
  "🔥",
  "💰",
  "⚔️",
  "📋",
  "🏟️",
  "🌪️",
];

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

// --- Scene 1: フック（0-75f, 2.5s）。カバー画像（frame=0）としても使う ---
function SceneHook() {
  const frame = useCurrentFrame();
  const kb = interpolate(frame, [0, 75], [1, 1.04], {
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ background: NAVY_DARK, transform: `scale(${kb})` }}>
      <Pop delay={-10} style={{ position: "absolute", top: 44, left: 44 }}>
        <Logo size={38} />
      </Pop>
      <Pop
        delay={-10}
        style={{ position: "absolute", top: 50, right: 44 }}
      >
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
          分析ツール一覧
        </div>
      </Pop>

      <Pop
        delay={-10}
        style={{ position: "absolute", top: 200, left: 40, right: 40 }}
      >
        <div
          style={{
            color: "rgba(248,250,252,0.6)",
            fontSize: 44,
            fontWeight: 800,
            fontFamily: FONT,
            textAlign: "center",
          }}
        >
          分析ツール、
          <br />
          何種類あるか知ってる？
        </div>
      </Pop>

      {/* 主役: 巨大な「17」。非対称配置＋GOLD統一（会場攻略型と同じ設計思想） */}
      <Pop
        delay={-10}
        style={{
          position: "absolute",
          top: 420,
          left: 0,
          right: 0,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          gap: 20,
        }}
      >
        <div
          style={{
            fontSize: 460,
            fontWeight: 900,
            fontFamily: FONT,
            color: GOLD,
            lineHeight: 0.8,
            textShadow: `0 0 140px ${GOLD}aa`,
          }}
        >
          {TOOL_COUNT}
        </div>
        <div
          style={{
            fontSize: 80,
            fontWeight: 900,
            fontFamily: FONT,
            color: WHITE,
            marginBottom: 60,
          }}
        >
          種類
        </div>
      </Pop>

      {/* 余白埋め: 実際の17タブの絵文字グリッド。装飾ではなく実データ（タブ一覧）そのもの */}
      <Pop
        delay={-6}
        style={{
          position: "absolute",
          top: 1130,
          left: 60,
          right: 60,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignContent: "center",
          gap: 24,
        }}
      >
        {TAB_EMOJIS.map((emoji, i) => (
          <div
            key={i}
            style={{
              width: 118,
              height: 118,
              borderRadius: 22,
              background: "rgba(212,175,55,0.12)",
              border: `2px solid ${GOLD}55`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 54,
            }}
          >
            {emoji}
          </div>
        ))}
      </Pop>

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
            全部、無料で使える
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
            実際の分析画面で確認
          </div>
        </Pop>
      </div>
    </AbsoluteFill>
  );
}

// --- Scene 2: 実画面（75-330f, 8.5s） ---
const IMG_NATIVE_WIDTH = 1188;
const IMG_NATIVE_HEIGHT = 1083;
const IMG_DISPLAY_WIDTH = 900;
const IMG_SCALE = IMG_DISPLAY_WIDTH / IMG_NATIVE_WIDTH;
const IMG_DISPLAY_HEIGHT = IMG_NATIVE_HEIGHT * IMG_SCALE;
const IMG_LEFT = (1080 - IMG_DISPLAY_WIDTH) / 2;
const IMG_TOP = 330;

function SceneReveal() {
  const frame = useCurrentFrame();
  const rise = interpolate(frame, [0, 20], [40, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ background: NAVY, overflow: "hidden" }}>
      <Pop delay={-10} style={{ position: "absolute", top: 44, left: 44 }}>
        <Logo size={36} />
      </Pop>
      <Pop
        delay={0}
        style={{
          position: "absolute",
          top: 130,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            color: GOLD,
            fontSize: 42,
            fontWeight: 900,
            fontFamily: FONT,
            textAlign: "center",
          }}
        >
          🔍 これが実際の一覧画面
        </div>
      </Pop>

      <div
        style={{
          position: "absolute",
          left: IMG_LEFT,
          top: IMG_TOP,
          width: IMG_DISPLAY_WIDTH,
          transform: `translateY(${rise}px)`,
        }}
      >
        <Img
          src={staticFile("tool-tally-tabs.png")}
          style={{
            width: "100%",
            display: "block",
            borderRadius: 20,
            boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          }}
        />
      </div>

      <Pop
        delay={30}
        style={{
          position: "absolute",
          top: IMG_TOP + IMG_DISPLAY_HEIGHT + 40,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            color: WHITE,
            fontSize: 32,
            fontWeight: 800,
            fontFamily: FONT,
            textAlign: "center",
            padding: "0 60px",
          }}
        >
          決まり手・モーター・展示タイム…
          <br />
          気になる切り口を全部カバー
        </div>
      </Pop>
    </AbsoluteFill>
  );
}

// --- Scene 3: CTA（330-405f, 2.5s） ---
function SceneCTA() {
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% 40%, ${NAVY} 0%, ${NAVY_DARK} 100%)`,
        justifyContent: "center",
        alignItems: "center",
        overflow: "hidden",
      }}
    >
      <Pop delay={2}>
        <div
          style={{
            color: WHITE,
            fontSize: 40,
            fontWeight: 900,
            fontFamily: FONT,
            textAlign: "center",
            padding: "0 60px",
            marginBottom: 16,
          }}
        >
          {TOOL_COUNT}種類のツール、
          <br />
          今すぐ無料で使える
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
          登録不要・アプリ不要
        </div>
      </Pop>
      <Pop delay={28}>
        <Logo size={48} />
      </Pop>
      <Pop delay={34} style={{ marginTop: 14 }}>
        <div
          style={{
            color: GOLD,
            fontSize: 24,
            fontWeight: 700,
            fontFamily: FONT,
            letterSpacing: 0.5,
          }}
        >
          boat-ai.jp
        </div>
      </Pop>
    </AbsoluteFill>
  );
}

export function ToolTallyCM() {
  return (
    <AbsoluteFill style={{ background: NAVY_DARK }}>
      <Sequence from={0} durationInFrames={75}>
        <SceneHook />
      </Sequence>
      <Sequence from={75} durationInFrames={255}>
        <SceneReveal />
      </Sequence>
      <Sequence from={330} durationInFrames={90}>
        <SceneCTA />
      </Sequence>
      <Audio src={staticFile("soundtrack-hitcheck.wav")} loop />
    </AbsoluteFill>
  );
}
