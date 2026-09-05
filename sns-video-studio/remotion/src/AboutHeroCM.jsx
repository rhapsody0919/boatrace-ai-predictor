import React from "react";
import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
} from "remotion";

/**
 * /aboutページのヒーロー動画（デスクトップ・モバイル共通ロジック、幅高さのみ variant で分岐）
 *
 * 旧動画（2026-08-16、PR #308）はunifiedモデル刷新後の内容だったが、その後の
 * ブランド刷新（BoatAI→龍神レーダー）・開催場一覧ページ再設計（3階層ナビ化、
 * 2026-08-28/29）を反映しないまま放置され、オープニング/クロージングの
 * ロゴが「BoatAI」のまま、UI画面が旧ヘッダー・旧会場ナビのままだった
 * （2026-09-02指摘）。PR #308と同じ手法（Playwrightで本番相当の現行UIを
 * 撮影し、変わらない部分は新規タイトルカードで構成）で作り直す。
 * BGMは既存音源（Rocket Power by Kevin MacLeod、CC BY 4.0）を継続使用。
 * 実データ: 住之江1R（2026-09-02、締切15:17、結果未確定）。
 */

const NAVY = "#0d1b2e";
const GOLD = "#c9a227";
const WHITE = "#f8fafc";
const GRAY = "#94a3b8";
const FONT =
  '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';

function Pop({ children, delay = 0, style }) {
  const frame = useCurrentFrame();
  const local = frame - delay;
  const scale = spring({
    frame: local,
    fps: 30,
    config: { damping: 14, mass: 0.5 },
  });
  const opacity = interpolate(local, [0, 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div style={{ opacity, transform: `scale(${scale})`, ...style }}>
      {children}
    </div>
  );
}

function KenBurns({ children, durationInFrames, from = 1, to = 1.06 }) {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, durationInFrames], [from, to], {
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{ width: "100%", height: "100%", transform: `scale(${scale})` }}
    >
      {children}
    </div>
  );
}

function Caption({ children, delay = 0, variant }) {
  const bottom = variant === "mobile" ? 56 : 40;
  const fontSize = variant === "mobile" ? 34 : 30;
  return (
    <Pop
      delay={delay}
      style={{
        position: "absolute",
        bottom,
        left: variant === "mobile" ? 28 : 60,
        right: variant === "mobile" ? 28 : 60,
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "rgba(13,27,46,0.92)",
          color: WHITE,
          fontFamily: FONT,
          fontWeight: 700,
          fontSize,
          lineHeight: 1.4,
          padding: variant === "mobile" ? "16px 24px" : "14px 28px",
          borderRadius: 20,
          border: `2px solid ${GOLD}`,
          textAlign: "center",
        }}
      >
        {children}
      </div>
    </Pop>
  );
}

function TitleCard({ eyebrow, title, children }) {
  return (
    <AbsoluteFill
      style={{
        background: NAVY,
        justifyContent: "center",
        alignItems: "center",
        padding: "0 6%",
      }}
    >
      <Pop delay={0} style={{ textAlign: "center" }}>
        {eyebrow && (
          <div
            style={{
              color: GOLD,
              fontFamily: FONT,
              fontWeight: 700,
              letterSpacing: 6,
              fontSize: 22,
              marginBottom: 20,
            }}
          >
            {eyebrow}
          </div>
        )}
        {title && (
          <div
            style={{
              color: WHITE,
              fontFamily: FONT,
              fontWeight: 800,
              fontSize: 46,
              lineHeight: 1.35,
            }}
          >
            {title}
          </div>
        )}
      </Pop>
      {children}
    </AbsoluteFill>
  );
}

// --- Scene 1: Opening (0-4s, 120f) ---
function SceneOpening({ variant }) {
  return (
    <AbsoluteFill
      style={{
        background: NAVY,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Pop delay={0} style={{ textAlign: "center" }}>
        <div
          style={{
            color: WHITE,
            fontFamily: FONT,
            fontWeight: 800,
            fontSize: variant === "mobile" ? 64 : 88,
            letterSpacing: 2,
          }}
        >
          龍神レーダー
        </div>
        <div
          style={{
            width: variant === "mobile" ? 220 : 340,
            height: 2,
            background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)`,
            margin: "24px auto",
          }}
        />
        <div
          style={{
            color: WHITE,
            fontFamily: FONT,
            fontWeight: 700,
            fontSize: variant === "mobile" ? 30 : 38,
            marginBottom: 12,
          }}
        >
          AIが、レースを読む。
        </div>
        <div
          style={{
            color: GRAY,
            fontFamily: FONT,
            fontSize: variant === "mobile" ? 18 : 20,
            marginBottom: 28,
          }}
        >
          ボートレースAI予想サービス
        </div>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            border: `1px solid ${GOLD}`,
            borderRadius: 999,
            padding: "10px 22px",
            color: GOLD,
            fontFamily: FONT,
            fontWeight: 600,
            fontSize: variant === "mobile" ? 16 : 18,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: GOLD,
              display: "inline-block",
            }}
          />
          完全無料・登録不要
        </div>
      </Pop>
    </AbsoluteFill>
  );
}

// --- Scene 2: 課題提起 (4-9s, 150f) ---
function SceneProblem({ variant }) {
  return (
    <TitleCard>
      <Pop delay={0} style={{ textAlign: "center", marginTop: 20 }}>
        <div
          style={{
            color: WHITE,
            fontFamily: FONT,
            fontWeight: 800,
            fontSize: variant === "mobile" ? 40 : 52,
            lineHeight: 1.5,
          }}
        >
          6艇 × 3着。
          <br />
          3連単は<span style={{ color: GOLD }}>120通り</span>。
        </div>
        <div
          style={{
            width: variant === "mobile" ? 260 : 420,
            height: 1,
            background: "rgba(255,255,255,0.25)",
            margin: "36px auto",
          }}
        />
        <div
          style={{
            color: GRAY,
            fontFamily: FONT,
            fontSize: variant === "mobile" ? 20 : 24,
          }}
        >
          選手・モーター・展示…情報は多すぎ、時間は足りない。
        </div>
      </Pop>
    </TitleCard>
  );
}

// --- Full-bleed screenshot scene (screenshot already matches canvas size) ---
function ScreenshotScene({ src, caption, delay, durationInFrames, variant }) {
  return (
    <AbsoluteFill style={{ background: NAVY }}>
      <KenBurns durationInFrames={durationInFrames}>
        <Img
          src={staticFile(src)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </KenBurns>
      <Caption delay={delay} variant={variant}>
        {caption}
      </Caption>
    </AbsoluteFill>
  );
}

// --- Cropped element scene (image smaller than canvas, floats on navy) ---
function CardScreenshotScene({
  src,
  nativeWidth,
  nativeHeight,
  targetWidth,
  caption,
  delay,
  variant,
}) {
  const height = Math.round((targetWidth * nativeHeight) / nativeWidth);
  return (
    <AbsoluteFill
      style={{
        background: NAVY,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Pop delay={0}>
        <Img
          src={staticFile(src)}
          style={{
            width: targetWidth,
            height,
            borderRadius: 16,
            boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
          }}
        />
      </Pop>
      <Caption delay={delay} variant={variant}>
        {caption}
      </Caption>
    </AbsoluteFill>
  );
}

// --- 45項目データ分析カード ---
const DATA_ITEMS = [
  "全国勝率",
  "当地勝率",
  "モーター2連率",
  "ボート2連率",
  "展示タイム",
  "展示ST",
  "級別（A1〜B2）",
  "会場特性",
];

function SceneDataItems({ variant }) {
  return (
    <TitleCard
      eyebrow="DATA ANALYSIS"
      title="45項目のデータを、AIが毎レース分析。"
    >
      <div
        style={{
          marginTop: 36,
          display: "grid",
          gridTemplateColumns: variant === "mobile" ? "1fr" : "1fr 1fr",
          gap: 14,
          width: variant === "mobile" ? "80%" : "56%",
        }}
      >
        {DATA_ITEMS.map((label, i) => (
          <Pop key={label} delay={10 + i * 3}>
            <div
              style={{
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 10,
                padding: variant === "mobile" ? "14px 18px" : "16px 22px",
                color: WHITE,
                fontFamily: FONT,
                fontWeight: 600,
                fontSize: variant === "mobile" ? 20 : 22,
                background: "rgba(255,255,255,0.03)",
              }}
            >
              <span style={{ color: GOLD, marginRight: 10 }}>◆</span>
              {label}
            </div>
          </Pop>
        ))}
      </div>
    </TitleCard>
  );
}

// --- BLOG & TOOLS カード（撤去済み「週間実績レポート」を実在機能に差し替え） ---
const BLOG_TOOLS_ITEMS = [
  ["会場別攻略ガイド", "24会場それぞれの特性とデータを解説"],
  ["データ分析ツール", "モーター調子・選手調子・決まり手を自分で分析"],
  ["使い方ガイド", "動画つきで迷わず使える"],
];

function SceneBlogTools({ variant }) {
  return (
    <TitleCard
      eyebrow="BLOG & TOOLS"
      title="攻略コンテンツも分析ツールも、無料。"
    >
      <div
        style={{
          marginTop: 32,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          width: variant === "mobile" ? "82%" : "50%",
        }}
      >
        {BLOG_TOOLS_ITEMS.map(([title, desc], i) => (
          <Pop key={title} delay={10 + i * 6}>
            <div
              style={{
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 12,
                padding: "16px 20px",
                background: "rgba(255,255,255,0.03)",
                display: "flex",
                gap: 14,
                alignItems: "flex-start",
              }}
            >
              <div
                style={{
                  color: GOLD,
                  fontFamily: FONT,
                  fontWeight: 800,
                  fontSize: 20,
                  minWidth: 26,
                }}
              >
                0{i + 1}
              </div>
              <div>
                <div
                  style={{
                    color: WHITE,
                    fontFamily: FONT,
                    fontWeight: 700,
                    fontSize: variant === "mobile" ? 20 : 22,
                  }}
                >
                  {title}
                </div>
                <div
                  style={{
                    color: GRAY,
                    fontFamily: FONT,
                    fontSize: variant === "mobile" ? 15 : 16,
                    marginTop: 4,
                  }}
                >
                  {desc}
                </div>
              </div>
            </div>
          </Pop>
        ))}
      </div>
    </TitleCard>
  );
}

// --- Closing ---
function SceneClosing({ variant }) {
  return (
    <AbsoluteFill
      style={{
        background: NAVY,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Pop delay={0} style={{ textAlign: "center" }}>
        <div
          style={{
            color: WHITE,
            fontFamily: FONT,
            fontWeight: 800,
            fontSize: variant === "mobile" ? 52 : 72,
            marginBottom: 20,
          }}
        >
          龍神レーダー
        </div>
        <div
          style={{
            width: variant === "mobile" ? 220 : 340,
            height: 2,
            background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)`,
            margin: "0 auto 28px",
          }}
        />
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            border: `1px solid ${GOLD}`,
            borderRadius: 999,
            padding: "10px 22px",
            color: GOLD,
            fontFamily: FONT,
            fontWeight: 600,
            fontSize: variant === "mobile" ? 16 : 18,
            marginBottom: 18,
          }}
        >
          完全無料・登録不要
        </div>
        <div
          style={{
            color: GRAY,
            fontFamily: FONT,
            fontWeight: 600,
            fontSize: variant === "mobile" ? 18 : 20,
            letterSpacing: 1,
          }}
        >
          boat-ai.jp
        </div>
      </Pop>
    </AbsoluteFill>
  );
}

function SceneHome(p) {
  return (
    <ScreenshotScene
      {...p}
      src={`about-hero-${p.variant}-home.png`}
      caption="今日開催中の24会場を一目で確認"
      delay={10}
      durationInFrames={150}
    />
  );
}

function ScenePrediction(p) {
  return (
    <ScreenshotScene
      {...p}
      src={`about-hero-${p.variant}-prediction.png`}
      caption="AIが展開・荒れやすさを毎レース分析"
      delay={15}
      durationInFrames={240}
    />
  );
}

function SceneDataTable(p) {
  return (
    <CardScreenshotScene
      {...p}
      src={`about-hero-${p.variant}-datatable.png`}
      nativeWidth={p.variant === "mobile" ? 728 : 1152}
      nativeHeight={p.variant === "mobile" ? 1398 : 698}
      targetWidth={p.variant === "mobile" ? 760 : 1360}
      caption="45項目以上のデータを比較できる出走表"
      delay={12}
    />
  );
}

function SceneTools(p) {
  return (
    <ScreenshotScene
      {...p}
      src={`about-hero-${p.variant}-tools.png`}
      caption="16種類以上の分析タブでさらに深掘り"
      delay={15}
      durationInFrames={210}
    />
  );
}

function SceneAccuracy(p) {
  return (
    <ScreenshotScene
      {...p}
      src={`about-hero-${p.variant}-accuracy.png`}
      caption="実測値をすべて公開"
      delay={12}
      durationInFrames={180}
    />
  );
}

const SCENES = [
  { from: 0, dur: 120, Comp: SceneOpening },
  { from: 120, dur: 150, Comp: SceneProblem },
  { from: 270, dur: 150, Comp: SceneHome },
  { from: 420, dur: 240, Comp: ScenePrediction },
  { from: 660, dur: 180, Comp: SceneDataTable },
  { from: 840, dur: 150, Comp: SceneDataItems },
  { from: 990, dur: 210, Comp: SceneTools },
  { from: 1200, dur: 180, Comp: SceneAccuracy },
  { from: 1380, dur: 150, Comp: SceneBlogTools },
  { from: 1530, dur: 150, Comp: SceneClosing },
];

export function AboutHeroDesktop() {
  return (
    <AbsoluteFill>
      {SCENES.map((scene, i) => (
        <Sequence key={i} from={scene.from} durationInFrames={scene.dur}>
          <scene.Comp variant="desktop" />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}

export function AboutHeroMobile() {
  return (
    <AbsoluteFill>
      {SCENES.map((scene, i) => (
        <Sequence key={i} from={scene.from} durationInFrames={scene.dur}>
          <scene.Comp variant="mobile" />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
