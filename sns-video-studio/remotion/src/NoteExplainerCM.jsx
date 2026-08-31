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
const GOLD = "#f5b942";
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

// --- Scene 1: Hook（0-90f, 3秒） ---
function SceneHook({ title, subtitle }) {
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(135deg, #163a5c 0%, ${NAVY} 60%, #081521 100%)`,
        justifyContent: "center",
        alignItems: "center",
        overflow: "hidden",
      }}
    >
      <Fade delay={0} durationIn={18}>
        <div
          style={{
            color: WHITE,
            fontSize: 72,
            fontWeight: 900,
            fontFamily: FONT,
            textAlign: "center",
            lineHeight: 1.4,
            padding: "0 120px",
          }}
        >
          {title}
        </div>
      </Fade>
      <Fade delay={16} durationIn={18} style={{ marginTop: 28 }}>
        <div
          style={{
            color: ACCENT,
            fontSize: 34,
            fontWeight: 700,
            fontFamily: FONT,
            textAlign: "center",
          }}
        >
          {subtitle}
        </div>
      </Fade>
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
            color: WHITE,
            fontFamily: FONT,
            fontWeight: 800,
            fontSize: 26,
            padding: "10px 26px",
            borderRadius: 999,
            border: `2px solid ${ACCENT}`,
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

// --- Scene 3: CTA（4秒） ---
function SceneCTA() {
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(135deg, #163a5c 0%, ${NAVY} 55%, #050e18 100%)`,
        justifyContent: "center",
        alignItems: "center",
        overflow: "hidden",
      }}
    >
      <Fade delay={0} durationIn={15}>
        <Logo size={90} />
      </Fade>
      <Fade delay={12} durationIn={15} style={{ marginTop: 36 }}>
        <div
          style={{
            color: WHITE,
            fontSize: 32,
            fontWeight: 700,
            fontFamily: FONT,
            textAlign: "center",
          }}
        >
          無料・登録不要で今すぐチェック
        </div>
      </Fade>
      <Fade delay={22} durationIn={15} style={{ marginTop: 30 }}>
        <div
          style={{
            padding: "18px 46px",
            borderRadius: 999,
            background: GOLD,
            color: NAVY,
            fontSize: 38,
            fontWeight: 900,
            fontFamily: FONT,
          }}
        >
          boat-ai.jp
        </div>
      </Fade>
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
        <SceneCTA />
      </Sequence>
    </AbsoluteFill>
  );
}
