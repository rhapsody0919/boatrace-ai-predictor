import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import {
  SceneHook,
  SceneFeatures,
  SceneCTA,
  scaleRect,
} from "./noteVideoShared.jsx";

/**
 * note埋め込み用・機能解説型（横型 1920x1080）— 龍神レーダー「言語切替（4言語対応）」
 *
 * content-multi-channel-pipeline（new-featureソース、既存機能の使い方ライフハック型）
 * の第1弾。NoteExplainerCM.jsx（データ出走表）と同じHook/特徴解説/CTA構成を再利用する。
 *
 * ハイライト座標は1200x630のデスクトップスクリーンショット（`note-language-switcher.png`）
 * 上でPlaywright実測した値をハードコード（.tmp-verify/measure-desktop.mjs実行結果）。
 */

const IMAGE_WIDTH = 1500;
const IMAGE_TOP = 90;
const IMAGE_LEFT = (1920 - IMAGE_WIDTH) / 2;
const IMAGE_SCALE = IMAGE_WIDTH / 1200;
const rectOpts = {
  imageTop: IMAGE_TOP,
  imageLeft: IMAGE_LEFT,
  scale: IMAGE_SCALE,
};

// [relTop, relLeft, width, height]（1200x630スクリーンショット上の実測値）
const OPTION_RECTS = {
  ja: [64.77, 915.42, 138, 44],
  en: [108.77, 915.42, 138, 41],
  zhTW: [149.77, 915.42, 138, 44],
  ko: [193.77, 915.42, 138, 43],
};

const FEATURE_DURATION = 150;
const FEATURES = [
  {
    rect: OPTION_RECTS.ja,
    caption: "まずは日本語でスタート",
  },
  {
    rect: OPTION_RECTS.en,
    caption: "海外ユーザーも英語でそのまま使える",
  },
  {
    rect: OPTION_RECTS.zhTW,
    caption: "台湾など繁体字圏の読者にも対応",
  },
  {
    rect: OPTION_RECTS.ko,
    caption: "韓国語でも同じデータ分析が見られる",
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

export const LANGUAGE_SWITCHER_DURATION =
  HOOK_DURATION + FEATURES_DURATION + CTA_DURATION;

export function NoteExplainerCM_LanguageSwitcher() {
  return (
    <AbsoluteFill>
      <Audio
        src={staticFile("note-bgm-calm-corporate-relax.wav")}
        volume={0.4}
      />
      <Sequence from={0} durationInFrames={HOOK_DURATION}>
        <SceneHook
          title="言語切替とは？"
          subtitle="英語・繁体字・韓国語もワンタップで切り替えられる"
          featureCount={FEATURES.length}
          previewImageSrc="note-language-switcher.png"
        />
      </Sequence>
      <Sequence from={HOOK_DURATION} durationInFrames={FEATURES_DURATION}>
        <SceneFeatures
          imageSrc="note-language-switcher.png"
          imageWidth={IMAGE_WIDTH}
          imageTop={IMAGE_TOP}
          imageLeft={IMAGE_LEFT}
          badgeLabel="🌐 画面右上の切替メニュー"
          features={FEATURES}
        />
      </Sequence>
      <Sequence
        from={HOOK_DURATION + FEATURES_DURATION}
        durationInFrames={CTA_DURATION}
      >
        <SceneCTA
          featureDigest={[
            "4言語に完全対応（日本語/英語/繁体字/韓国語）",
            "切り替えるとURLも自動で言語別に",
            "選手名などの固有名詞はそのまま表示",
          ]}
        />
      </Sequence>
    </AbsoluteFill>
  );
}
