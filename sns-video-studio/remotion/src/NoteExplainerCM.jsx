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
  useVideoConfig,
} from "remotion";

/**
 * note埋め込み用・機能解説型（横型 1920x1080）— 龍神レーダー
 *
 * 2026-08-31新設: X/TikTok向けの縦型(1080x1920)・12-15秒・バズ訴求型とは別の型。
 * note読者は既に興味を持って記事を読みに来ている層のため、フックで止めさせる必要が薄く、
 * 実画面をじっくり見せる「プロダクトデモ」調のトーンにする（8人パネル議論、2026-08-31決定）。
 * YouTube限定公開でアップロードし、noteエディタにURLを貼って埋め込む運用を想定。
 *
 * 2026-08-31改訂（天才デザイナー・天才マーケター議論）: 初版は表画像を1枚見せるだけで
 * 「特徴を一つ一つアピールする」訴求が弱いとの指摘。表全体を見せたまま3つの行に順番に
 * ハイライト枠を当てて視線誘導し（デザイナー案）、各行の価値を機能説明ではなく
 * ベネフィットで言い切る字幕を添える（マーケター案）方式に作り直した。
 * ハイライト座標はPlaywrightで実測した値（tmp/measure-rows.mjs）をハードコード。
 *
 * BGMは`soundtrack.wav`を使わない（X/TikTok用の使い回しとして却下された、2026-08-31）。
 * 新規にPixabay Content Licenseの「Calm Corporate Relax」（331music、
 * https://pixabay.com/music/corporate-calm-corporate-relax-591992/）を採用。
 * `note-bgm-calm-corporate-relax.wav`（25秒に切り出し・末尾2秒フェードアウト済み）を使用する。
 */

const NAVY = "#0f2c46";
const ACCENT = "#38bdf8";
const WHITE = "#f8fafc";
const GOLD = "#d4af37"; // X/TikTok版と統一（sns-marketing-strategy.mdの「案A」ブランドカラー）
const FONT =
  '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';

function Fade({ children, delay = 0, durationIn = 15, style }) {
  const frame = useCurrentFrame();
  const local = frame - delay;
  const opacity = interpolate(local, [0, durationIn], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const translateY = interpolate(local, [0, durationIn], [16, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{ opacity, transform: `translateY(${translateY}px)`, ...style }}
    >
      {children}
    </div>
  );
}

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

function Logo({ size = 40 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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

// 「龍神レーダー」のレーダーを視覚化する六角形グラフィック。
// 2026-08-31追加: CTAシーン中央の空白が単なる区切り線では物足りないとの指摘を受け、
// ブランド名を象徴する装飾として採用（天才デザイナー案）。
function RadarDecoration({ size = 300 }) {
  const center = size / 2;
  const radius = size / 2 - 24;
  const points = 6;
  const angleStep = (Math.PI * 2) / points;

  const ring = (r) =>
    Array.from({ length: points }, (_, i) => {
      const angle = angleStep * i - Math.PI / 2;
      return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
    }).join(" ");

  const outerPts = Array.from({ length: points }, (_, i) => {
    const angle = angleStep * i - Math.PI / 2;
    return [
      center + radius * Math.cos(angle),
      center + radius * Math.sin(angle),
    ];
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <polygon
        points={ring(radius)}
        fill="none"
        stroke={GOLD}
        strokeWidth="1.5"
        opacity="0.5"
      />
      <polygon
        points={ring(radius * 0.66)}
        fill="none"
        stroke={GOLD}
        strokeWidth="1"
        opacity="0.35"
      />
      <polygon
        points={ring(radius * 0.33)}
        fill="none"
        stroke={GOLD}
        strokeWidth="1"
        opacity="0.25"
      />
      {outerPts.map((p, i) => (
        <React.Fragment key={i}>
          <line
            x1={center}
            y1={center}
            x2={p[0]}
            y2={p[1]}
            stroke={GOLD}
            strokeWidth="1"
            opacity="0.2"
          />
          <circle cx={p[0]} cy={p[1]} r="5" fill={GOLD} opacity="0.85" />
        </React.Fragment>
      ))}
      <circle
        cx={center}
        cy={center}
        r={radius * 0.5}
        fill="none"
        stroke={GOLD}
        strokeWidth="0.75"
        opacity="0.15"
      />
      <text
        x={center}
        y={center + 10}
        textAnchor="middle"
        fontSize="34"
        fill={GOLD}
        opacity="0.9"
      >
        🐉
      </text>
    </svg>
  );
}

// --- Scene 1: Hook（0-90f, 3秒） ---
// 2026-08-31再改訂: sns-marketing-strategy.mdの「案A」原則（frame=0で完成された見た目、
// ロゴ固定表示、GOLD統一、画面全体を使う非対称配置）をnote版にも適用。
// 主要要素は全てdelay=-10（frame=0時点で既に表示済み）にし、frame=0問題を構造的に回避する。
function SceneHook({ title, subtitle, featureCount, previewImageSrc }) {
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(135deg, #163a5c 0%, ${NAVY} 55%, #081521 100%)`,
        overflow: "hidden",
      }}
    >
      {/* 右下の装飾円: 空白を埋めつつ奥行きを出す */}
      <div
        style={{
          position: "absolute",
          right: -180,
          bottom: -220,
          width: 640,
          height: 640,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${GOLD}22 0%, transparent 70%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: -140,
          top: -160,
          width: 420,
          height: 420,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${ACCENT}18 0%, transparent 70%)`,
        }}
      />

      {/* 右半分: 実際の画面プレビューを薄く敷き、「これから見る本物の画面」を予告する
          （2026-08-31追加、右半分が空白でユーザー指摘） */}
      <div
        style={{
          position: "absolute",
          top: 120,
          right: -60,
          width: 980,
          opacity: 0.4,
          maskImage:
            "linear-gradient(90deg, transparent 0%, black 22%, black 100%)",
          WebkitMaskImage:
            "linear-gradient(90deg, transparent 0%, black 22%, black 100%)",
        }}
      >
        <Img
          src={staticFile(previewImageSrc)}
          style={{
            width: "100%",
            display: "block",
            borderRadius: 16,
          }}
        />
      </div>

      <Pop delay={-10} style={{ position: "absolute", top: 56, left: 64 }}>
        <Logo size={54} />
      </Pop>

      <Pop
        delay={-10}
        style={{
          position: "absolute",
          top: 340,
          left: 64,
          width: 1080,
        }}
      >
        <div
          style={{
            color: GOLD,
            fontSize: 96,
            fontWeight: 900,
            fontFamily: FONT,
            lineHeight: 1.25,
            textShadow: `0 0 50px ${GOLD}66`,
          }}
        >
          {title}
        </div>
      </Pop>
      <Pop
        delay={-10}
        style={{ position: "absolute", top: 590, left: 64, width: 1000 }}
      >
        <div
          style={{
            color: WHITE,
            fontSize: 38,
            fontWeight: 700,
            fontFamily: FONT,
          }}
        >
          {subtitle}
        </div>
      </Pop>

      <Pop delay={-10} style={{ position: "absolute", bottom: 64, left: 64 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 12,
            color: NAVY,
            background: GOLD,
            fontSize: 26,
            fontWeight: 900,
            fontFamily: FONT,
            padding: "12px 28px",
            borderRadius: 999,
          }}
        >
          🎯 {featureCount}つのポイントを解説
        </div>
      </Pop>
    </AbsoluteFill>
  );
}

// tmp/measure-rows.mjsで実測したCSS px座標（テーブル画像基準、1232x685相当）を
// IMAGE_WIDTH表示スケールに変換したもの
const IMAGE_WIDTH = 1400;
const IMAGE_HEIGHT = 781; // note-data-race-table.png 実測比率(2464x1374)から算出
const IMAGE_TOP = 90;
const IMAGE_LEFT = (1920 - IMAGE_WIDTH) / 2;
const TABLE_SCALE = IMAGE_WIDTH / 1232;

// [relTop, relLeft, width, height]（tmp/measure-rows.mjs実測値）
const ROW_RECTS = {
  gradeWinRate: [150.89, 17.5, 1197, 53.98],
  motor2Rate: [242.27, 17.5, 1197, 37.39],
  form: [279.66, 17.5, 1197, 37.39],
  exhibitionTime: [429.22, 17.5, 1197, 37.39],
  winningTechnique: [519.59, 17.5, 1197, 52],
  returnRate: [571.59, 17.5, 1197, 37.39],
};

function highlightBox([relTop, relLeft, w, h]) {
  return {
    top: IMAGE_TOP + relTop * TABLE_SCALE - 6,
    left: IMAGE_LEFT + relLeft * TABLE_SCALE - 6,
    width: w * TABLE_SCALE + 12,
    height: h * TABLE_SCALE + 12,
  };
}

function HighlightBox({ rect, from, durationInFrames }) {
  const frame = useCurrentFrame();
  const local = frame - from;
  const fadeIn = interpolate(local, [4, 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(
    local,
    [durationInFrames - 12, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const opacity = Math.min(fadeIn, fadeOut);
  const box = highlightBox(rect);
  return (
    <div
      style={{
        position: "absolute",
        ...box,
        border: `4px solid ${GOLD}`,
        borderRadius: 10,
        opacity,
        boxShadow: "0 0 0 5px rgba(245,185,66,0.25)",
      }}
    />
  );
}

function Caption({ text, from, durationInFrames }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - from - 8;
  const scale = spring({
    frame: Math.max(local, 0),
    fps,
    config: { damping: 12, mass: 0.5 },
  });
  const fadeIn = interpolate(local, [0, 6], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(
    frame - from,
    [durationInFrames - 12, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const opacity = Math.min(fadeIn, fadeOut);
  return (
    <div
      style={{
        position: "absolute",
        bottom: 56,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        opacity,
        transform: `scale(${scale})`,
      }}
    >
      <div
        style={{
          color: WHITE,
          fontFamily: FONT,
          fontWeight: 900,
          fontSize: 44,
          background: "rgba(15,44,70,0.92)",
          border: `2px solid ${GOLD}`,
          borderRadius: 16,
          padding: "16px 44px",
          textAlign: "center",
        }}
      >
        {text}
      </div>
    </div>
  );
}

// --- Scene 2: 特徴解説（表全体を見せたまま、行ごとにハイライト+字幕が切り替わる） ---
function SceneFeatures({ imageSrc, features }) {
  // features: [{ rect, caption, from, durationInFrames }]
  return (
    <AbsoluteFill style={{ background: NAVY, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          top: 30,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            background: "rgba(15,44,70,0.85)",
            color: GOLD,
            fontFamily: FONT,
            fontWeight: 800,
            fontSize: 26,
            padding: "10px 26px",
            borderRadius: 999,
            border: `2px solid ${GOLD}`,
          }}
        >
          🎯 実際の龍神レーダー画面
        </div>
      </div>

      <Fade delay={0} durationIn={15}>
        <div
          style={{
            position: "absolute",
            top: IMAGE_TOP,
            left: IMAGE_LEFT,
            width: IMAGE_WIDTH,
          }}
        >
          <Img
            src={staticFile(imageSrc)}
            style={{
              width: "100%",
              display: "block",
              borderRadius: 16,
              boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
            }}
          />
        </div>
      </Fade>

      {features.map((f) => (
        <HighlightBox
          key={f.caption}
          rect={f.rect}
          from={f.from}
          durationInFrames={f.durationInFrames}
        />
      ))}

      {features.map((f) => (
        <Caption
          key={f.caption}
          text={f.caption}
          from={f.from}
          durationInFrames={f.durationInFrames}
        />
      ))}
    </AbsoluteFill>
  );
}

// --- Scene 3: CTA（7秒） ---
// 2026-08-31 全面再設計（天才デザイナー案）: 左右2カラム構成が視線の往復と不自然な
// 空白を生む根本原因だったため、中央集約・縦積み構成にゼロから作り直した。
// CTAボタン自体を動画内で最大の要素にし「最後の着地点」として画面下部に主役配置する。
// 視線の流れ: ロゴ→タグライン→見出し→3特徴（横並びピル）→巨大CTA、上から下へ一直線。
function SceneCTA({ featureDigest }) {
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(135deg, #163a5c 0%, ${NAVY} 55%, #050e18 100%)`,
        overflow: "hidden",
      }}
    >
      {/* 背景装飾: 「龍神レーダー」を象徴する六角形を画面中央にごく薄く敷く */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          opacity: 0.07,
        }}
      >
        <RadarDecoration size={880} />
      </div>
      <div
        style={{
          position: "absolute",
          right: -160,
          top: -200,
          width: 560,
          height: 560,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${GOLD}18 0%, transparent 70%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: -160,
          bottom: -220,
          width: 520,
          height: 520,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${GOLD}12 0%, transparent 70%)`,
        }}
      />

      {/* 上部: ロゴ+タグライン（中央揃え、控えめ） */}
      <Pop
        delay={-10}
        style={{
          position: "absolute",
          top: 64,
          left: 0,
          right: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <Logo size={52} />
        <div
          style={{
            marginTop: 16,
            color: "rgba(248,250,252,0.7)",
            fontSize: 23,
            fontWeight: 700,
            fontFamily: FONT,
          }}
        >
          ボートレースを見える化。迷ったら、データを信じる。
        </div>
      </Pop>

      {/* メインメッセージ: 画面中央に大きく */}
      <Pop
        delay={-10}
        style={{
          position: "absolute",
          top: 220,
          left: 0,
          right: 0,
          textAlign: "center",
        }}
      >
        <div
          style={{
            color: WHITE,
            fontSize: 54,
            fontWeight: 900,
            fontFamily: FONT,
            lineHeight: 1.35,
          }}
        >
          この動画で見た内容、
          <br />
          全部無料で使えます
        </div>
      </Pop>

      {/* 3特徴: 横並びピルで画面幅を自然に使う */}
      <Pop
        delay={-10}
        style={{
          position: "absolute",
          top: 420,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          gap: 20,
          padding: "0 64px",
        }}
      >
        {featureDigest.map((text) => (
          <div
            key={text}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "rgba(255,255,255,0.06)",
              border: `1.5px solid ${GOLD}77`,
              borderRadius: 999,
              padding: "16px 26px",
            }}
          >
            <span style={{ color: GOLD, fontSize: 24, fontWeight: 900 }}>
              ✓
            </span>
            <span
              style={{
                color: WHITE,
                fontSize: 23,
                fontWeight: 700,
                fontFamily: FONT,
                whiteSpace: "nowrap",
              }}
            >
              {text}
            </span>
          </div>
        ))}
      </Pop>

      {/* 巨大CTA: 動画内で最大の要素、最後の着地点として画面下部の主役に */}
      <Pop
        delay={-10}
        style={{
          position: "absolute",
          top: 570,
          left: 0,
          right: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <div
          style={{
            color: GOLD,
            fontSize: 36,
            fontWeight: 900,
            fontFamily: FONT,
            marginBottom: 30,
            textShadow: `0 0 30px ${GOLD}55`,
          }}
        >
          👉 無料・登録不要で今すぐ
        </div>
        <div
          style={{
            padding: "34px 100px",
            borderRadius: 999,
            background: GOLD,
            color: NAVY,
            fontSize: 68,
            fontWeight: 900,
            fontFamily: FONT,
            boxShadow: `0 24px 70px ${GOLD}55`,
          }}
        >
          boat-ai.jp
        </div>
      </Pop>
    </AbsoluteFill>
  );
}

// 50秒構成（8人パネル議論、2026-08-31改訂）: 6特徴×200f(6.67秒)でより詳細に伝える
const FEATURE_DURATION = 200;
const FEATURES = [
  {
    rect: ROW_RECTS.gradeWinRate,
    caption: "肩書だけじゃない、実力を数値で比較",
  },
  {
    rect: ROW_RECTS.motor2Rate,
    caption: "機体の強さも一目で比較できる",
  },
  {
    rect: ROW_RECTS.form,
    caption: "今、勢いのある選手が一目でわかる",
  },
  {
    rect: ROW_RECTS.exhibitionTime,
    caption: "直前の動きの速さで仕上がりを見る",
  },
  {
    rect: ROW_RECTS.winningTechnique,
    caption: "その艇がどう勝ってきたかがわかる",
  },
  {
    rect: ROW_RECTS.returnRate,
    caption: "勝つだけじゃない、“儲かるか”も見える",
  },
].map((f, i) => ({
  ...f,
  from: i * FEATURE_DURATION,
  durationInFrames: FEATURE_DURATION,
}));

const HOOK_DURATION = 90;
const FEATURES_DURATION = FEATURES.length * FEATURE_DURATION;
const CTA_DURATION = 210;

export function NoteExplainerCM_DataRaceTable() {
  return (
    <AbsoluteFill>
      <Audio
        src={staticFile("note-bgm-calm-corporate-relax.wav")}
        volume={0.4}
      />
      <Sequence from={0} durationInFrames={HOOK_DURATION}>
        <SceneHook
          title="データ出走表とは？"
          subtitle="6選手の分析データを1画面で比較できる新機能"
          featureCount={FEATURES.length}
          previewImageSrc="note-data-race-table.png"
        />
      </Sequence>
      <Sequence from={HOOK_DURATION} durationInFrames={FEATURES_DURATION}>
        <SceneFeatures
          imageSrc="note-data-race-table.png"
          features={FEATURES}
        />
      </Sequence>
      <Sequence
        from={HOOK_DURATION + FEATURES_DURATION}
        durationInFrames={CTA_DURATION}
      >
        <SceneCTA
          featureDigest={[
            "実力を数値で比較",
            "勢いのある選手がわかる",
            "勝率だけじゃない、儲かるかも見える",
          ]}
        />
      </Sequence>
    </AbsoluteFill>
  );
}
