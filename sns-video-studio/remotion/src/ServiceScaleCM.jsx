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
import { fitHeadline } from "./textFit.js";

/**
 * サービスの信頼性・スケール訴求型（TikTok向け新設、2026-09-10）
 *
 * docs/proposal/tiktok-non-gambling-content-ideas.md 案3「データ規模訴求型」。
 * 絶対厳守13（TikTokは賭けの結果に影響する統計・インサイトを扱う新規制作を停止、
 * 2026-09-01/02）により会場攻略・答え合わせ・予想数値フック・トリビア系の勝率比較
 * （2026-09-09セッションで「trivia」フォーマットも同種懸念ありと判断済み）が
 * 軒並み使えない中、案3は「的中率のような結果指標を使わない」前提で低リスクと
 * 評価されていたが、2026-09-02時点でもRemotionコンポジションは未実装だった
 * （同ドキュメント「現状の運用方針」参照）。本ファイルがその初回実装。
 *
 * 表示する数値は取り扱っているデータ量そのもの（レース件数・出走データ件数・
 * 分析軸の種類数）であり、勝率・回収率・的中率等「賭けの判断材料」になりうる
 * 指標は一切含まない。
 *
 * 実データ: 2026-09-10 09:xx JST時点でSupabase実クエリにより直接取得
 * （races/race_entriesテーブルの行数）。分析軸17種類はToolTallyCM.jsxと同じ
 * /winning-techniqueページの実タブ数（TAB_KEYS、src/pages/WinningTechniqueAnalysis.jsx）
 * を再度照合済み。件数は日々増加するため、恒久利用時は再クエリして更新すること。
 */

const NAVY_DARK = "#081b2e";
const NAVY = "#0f2c46";
const WHITE = "#f8fafc";
const GOLD = "#d4af37";
const ACCENT = "#38bdf8";

const RACE_COUNT_DISPLAY = "43,068";
const ENTRY_COUNT_DISPLAY = "258,408";
const AXIS_COUNT = 17;

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

// 余白埋め用の背景装飾（AccuracyProofCM.jsxのPulseRingsと同じ設計）
function PulseRings({ color = GOLD, size = 520, top = "50%" }) {
  const frame = useCurrentFrame();
  return (
    <>
      {[0, 25, 50].map((delay) => {
        const local = frame - delay;
        const scale = interpolate(local % 75, [0, 75], [0.3, 2.4], {
          extrapolateLeft: "clamp",
        });
        const opacity = interpolate(local % 75, [0, 75], [0.28, 0], {
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

// --- Scene 1: フック（0-75f, 2.5s）。カバー画像（frame=0）としても使う ---
function SceneHook() {
  const frame = useCurrentFrame();
  const kb = interpolate(frame, [0, 75], [1, 1.04], {
    extrapolateRight: "clamp",
  });
  const { fontSize: headlineFontSize, lines: headlineLines } = fitHeadline(
    "龍神レーダーが毎日読んでいるデータ量",
    {
      maxWidth: 980,
      maxLines: 2,
      fontFamily: FONT,
      fontWeight: 800,
      maxFontSize: 46,
      minFontSize: 30,
    },
  );
  return (
    <AbsoluteFill style={{ background: NAVY_DARK, transform: `scale(${kb})` }}>
      <PulseRings top={1280} size={900} />
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
          データ規模
        </div>
      </Pop>

      <Pop
        delay={-10}
        style={{ position: "absolute", top: 170, left: 50, right: 50 }}
      >
        <div
          style={{
            color: "rgba(248,250,252,0.65)",
            fontSize: headlineFontSize,
            fontWeight: 800,
            fontFamily: FONT,
            textAlign: "center",
            lineHeight: 1.25,
          }}
        >
          {headlineLines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      </Pop>

      {/* 主役: レース件数。中央揃え（左右バランスの原則どおり） */}
      <Pop
        delay={-10}
        style={{
          position: "absolute",
          top: 330,
          left: 0,
          right: 0,
          textAlign: "center",
        }}
      >
        <div
          style={{
            color: "rgba(248,250,252,0.55)",
            fontSize: 30,
            fontWeight: 700,
            fontFamily: FONT,
            marginBottom: 6,
          }}
        >
          分析済みレース
        </div>
        <div
          style={{
            fontSize: 170,
            fontWeight: 900,
            fontFamily: FONT,
            color: GOLD,
            lineHeight: 0.85,
            textShadow: `0 0 100px ${GOLD}aa`,
          }}
        >
          {RACE_COUNT_DISPLAY}
        </div>
        <div
          style={{
            color: WHITE,
            fontSize: 44,
            fontWeight: 900,
            fontFamily: FONT,
            marginTop: 6,
          }}
        >
          レース
        </div>
      </Pop>

      {/* 副次スタット: 出走データ件数。中央揃えチップ。frame=0カバーで完全に
          見える必要があるためdelayは他要素と同じく0以下にする（2026-08-25の
          delay>0によるカバー欠落事故の教訓、絶対厳守11） */}
      <Pop
        delay={-10}
        style={{
          position: "absolute",
          top: 700,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            textAlign: "center",
            background: `${ACCENT}22`,
            border: `2px solid ${ACCENT}90`,
            borderRadius: 24,
            padding: "28px 44px",
          }}
        >
          <div
            style={{
              color: ACCENT,
              fontSize: 24,
              fontWeight: 800,
              fontFamily: FONT,
              marginBottom: 10,
            }}
          >
            出走データ
          </div>
          <div
            style={{
              fontSize: 76,
              fontWeight: 900,
              fontFamily: FONT,
              color: WHITE,
              lineHeight: 1,
            }}
          >
            {ENTRY_COUNT_DISPLAY}
            <span style={{ fontSize: 34, marginLeft: 8 }}>艇分</span>
          </div>
        </div>
      </Pop>

      {/* 余白埋め: 収集しているデータの切り口アイコン行（装飾ではなく実際の分析軸の一部） */}
      <Pop
        delay={-10}
        style={{
          position: "absolute",
          top: 940,
          left: 60,
          right: 60,
          display: "flex",
          justifyContent: "center",
          gap: 26,
        }}
      >
        {["🚤", "⏱️", "🎯", "🔧", "🏟️", "🌪️"].map((emoji) => (
          <div
            key={emoji}
            style={{
              width: 140,
              height: 140,
              borderRadius: 26,
              background: "rgba(212,175,55,0.12)",
              border: `2px solid ${GOLD}55`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 62,
            }}
          >
            {emoji}
          </div>
        ))}
      </Pop>

      <Pop
        delay={-10}
        style={{
          position: "absolute",
          top: 1120,
          left: 0,
          right: 0,
          textAlign: "center",
        }}
      >
        <div
          style={{
            color: "rgba(248,250,252,0.55)",
            fontSize: 26,
            fontWeight: 700,
            fontFamily: FONT,
          }}
        >
          これらを毎日自動収集・自動更新
        </div>
      </Pop>

      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          background: GOLD,
          padding: "36px 60px 84px",
        }}
      >
        <Pop delay={-10}>
          <div
            style={{
              color: NAVY_DARK,
              fontSize: 42,
              fontWeight: 900,
              fontFamily: FONT,
              textAlign: "center",
              lineHeight: 1.3,
            }}
          >
            全部、無料で分析中
          </div>
        </Pop>
      </div>
    </AbsoluteFill>
  );
}

// --- Scene 2: 内訳（75-285f, 7s） ---
const BREAKDOWN_ITEMS = [
  { icon: "🏁", value: RACE_COUNT_DISPLAY, unit: "レース", label: "全国24会場・過去〜現在の開催分" },
  { icon: "🚤", value: ENTRY_COUNT_DISPLAY, unit: "艇分", label: "選手・モーター・展示タイムまで記録" },
  { icon: "🔍", value: String(AXIS_COUNT), unit: "種類", label: "決まり手・調子・イン崩れ指数など分析軸" },
];

function SceneBreakdown() {
  return (
    <AbsoluteFill
      style={{
        background: NAVY,
        padding: "0 56px",
        justifyContent: "center",
      }}
    >
      <PulseRings color={ACCENT} top={960} size={640} />
      <Pop delay={-10} style={{ position: "absolute", top: 44, left: 44 }}>
        <Logo size={36} />
      </Pop>
      <Pop delay={2}>
        <div
          style={{
            color: ACCENT,
            fontSize: 34,
            fontWeight: 900,
            fontFamily: FONT,
            textAlign: "center",
            marginBottom: 44,
          }}
        >
          📡 これだけのデータを毎日更新
        </div>
      </Pop>

      {BREAKDOWN_ITEMS.map((item, i) => (
        <SlideIn
          key={item.label}
          delay={16 + i * 22}
          style={{ marginBottom: 32 }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 24,
              background: "rgba(255,255,255,0.06)",
              borderRadius: 20,
              padding: "26px 30px",
            }}
          >
            <span style={{ fontSize: 52 }}>{item.icon}</span>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  color: GOLD,
                  fontSize: 44,
                  fontWeight: 900,
                  fontFamily: FONT,
                  lineHeight: 1,
                }}
              >
                {item.value}
                <span style={{ fontSize: 24, marginLeft: 6, color: WHITE }}>
                  {item.unit}
                </span>
              </div>
              <div
                style={{
                  color: "rgba(248,250,252,0.6)",
                  fontSize: 20,
                  fontFamily: FONT,
                  marginTop: 6,
                }}
              >
                {item.label}
              </div>
            </div>
          </div>
        </SlideIn>
      ))}
    </AbsoluteFill>
  );
}

// --- Scene 3: CTA（285-375f, 3s） ---
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
      <PulseRings top="45%" />
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
          このデータ量を、
          <br />
          今すぐ無料でチェック
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

export function ServiceScaleCM() {
  return (
    <AbsoluteFill style={{ background: NAVY_DARK }}>
      <Sequence from={0} durationInFrames={75}>
        <SceneHook />
      </Sequence>
      <Sequence from={75} durationInFrames={210}>
        <SceneBreakdown />
      </Sequence>
      <Sequence from={285} durationInFrames={90}>
        <SceneCTA />
      </Sequence>
      <Audio src={staticFile("soundtrack-hitcheck.wav")} loop />
    </AbsoluteFill>
  );
}
