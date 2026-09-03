import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import {
  SceneHook,
  SceneFeatures,
  SceneCTA,
  scaleRect,
} from "./noteVideoShared.jsx";

/**
 * note埋め込み用・機能解説型（横型 1920x1080）— 龍神レーダー「4言語切替」
 *
 * ネタ駆動マルチチャネルパイプライン初回実行（2026-09-03、new-featureソースの
 * 既存機能ライフハック型）。`NoteExplainerCM.jsx`（データ出走表）と同じ
 * Hook/特徴解説/CTAパターンを流用。
 * ハイライト座標はPlaywrightで実測した値をハードコード
 * （`docs/operation/note-video-producer-prompt.md`参照）。
 */

// language-switcher-dropdown.png はCSS px基準1600x260でクリップ撮影
// （実測: page.locator().boundingBox()、docs/operation/note-video-producer-prompt.md参照）
const IMAGE_WIDTH = 1500;
const IMAGE_TOP = 140;
const IMAGE_LEFT = (1920 - IMAGE_WIDTH) / 2;
const SOURCE_WIDTH = 1600;
const IMAGE_SCALE = IMAGE_WIDTH / SOURCE_WIDTH;
const rectOpts = {
  imageTop: IMAGE_TOP,
  imageLeft: IMAGE_LEFT,
  scale: IMAGE_SCALE,
};

// [relTop, relLeft, width, height]（Playwright boundingBox実測値、CSS px）
const RECTS = {
  trigger: [28.98, 1399.44, 54.98, 26.78],
  dropdown: [63.77, 1314.42, 140, 174],
  englishOption: [108.77, 1315.42, 138, 41],
};

const FEATURE_DURATION = 200;
const FEATURES = [
  {
    rect: RECTS.trigger,
    caption: "ヘッダー右上の🌐ボタンをタップ",
  },
  {
    rect: RECTS.dropdown,
    caption: "日本語・English・繁體中文・한국어が並ぶ",
  },
  {
    rect: RECTS.englishOption,
    caption: "好きな言語を選ぶだけで切り替え完了",
  },
].map((f, i) => ({
  box: scaleRect(f.rect, rectOpts),
  caption: f.caption,
  from: i * FEATURE_DURATION,
  durationInFrames: FEATURE_DURATION,
}));

const HOOK_DURATION = 90;
const FEATURES_DURATION = FEATURES.length * FEATURE_DURATION;
const CTA_DURATION = 210;

export function NoteExplainerCM_LanguageSwitcher() {
  return (
    <AbsoluteFill>
      <Audio
        src={staticFile("note-bgm-calm-corporate-relax.wav")}
        volume={0.4}
      />
      <Sequence from={0} durationInFrames={HOOK_DURATION}>
        <SceneHook
          title="実は4言語対応してるって知ってた？"
          subtitle="日本語・English・繁體中文・한국어をワンタップで切替"
          featureCount={FEATURES.length}
          previewImageSrc="language-switcher-dropdown.png"
        />
      </Sequence>
      <Sequence from={HOOK_DURATION} durationInFrames={FEATURES_DURATION}>
        <SceneFeatures
          imageSrc="language-switcher-dropdown.png"
          imageWidth={IMAGE_WIDTH}
          imageTop={IMAGE_TOP}
          imageLeft={IMAGE_LEFT}
          features={FEATURES}
        />
      </Sequence>
      <Sequence
        from={HOOK_DURATION + FEATURES_DURATION}
        durationInFrames={CTA_DURATION}
      >
        <SceneCTA
          featureDigest={[
            "言語ごとに専用URLで切り替え",
            "ブックマーク・SNSシェアも快適",
            "選んだ言語は次回も引き継がれる",
          ]}
        />
      </Sequence>
    </AbsoluteFill>
  );
}
