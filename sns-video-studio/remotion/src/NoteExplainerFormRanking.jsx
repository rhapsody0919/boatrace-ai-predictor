import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import {
  SceneHook,
  SceneFeatures,
  SceneCTA,
  scaleRect,
} from "./noteVideoShared.jsx";

/**
 * note埋め込み用・機能解説型（横型 1920x1080）— 龍神レーダー「本日の好調・不調選手ランキング」
 *
 * `NoteExplainerCM.jsx`（データ出走表）で確立したパターンを`noteVideoShared.jsx`経由で再利用。
 * この機能は「急上昇TOP10」「急下降TOP10」の2テーブル構成のため、特徴解説パートを
 * 2つのサブシーンに分け、テーブル画像を切り替えながらそれぞれ3行ずつハイライトする。
 * 急上昇テーブルは新人選手のデビュー直後（勝率0.00→X）の行を避け、記事のFAQで
 * 「参考程度に」と注記した通り実力上昇が読み取れる3〜5位（既存選手）を選定した。
 * 実データはPlaywrightで`/winning-technique?tab=formranking`を撮影（2026-09-01時点）。
 */

const IMAGE_WIDTH = 1400;
const IMAGE_TOP = 170;
const IMAGE_LEFT = (1920 - IMAGE_WIDTH) / 2;

const SCALE_UP = IMAGE_WIDTH / 1160;
const SCALE_DOWN = IMAGE_WIDTH / 1128;
const rectOptsUp = {
  imageTop: IMAGE_TOP,
  imageLeft: IMAGE_LEFT,
  scale: SCALE_UP,
};
const rectOptsDown = {
  imageTop: IMAGE_TOP,
  imageLeft: IMAGE_LEFT,
  scale: SCALE_DOWN,
};

// [relTop, relLeft, width, height]（Playwright実測値）
const UP_RECTS = {
  higuchi: [202.5, 21, 1118, 46.61],
  nomura: [249.11, 21, 1118, 46.61],
  ishikura: [295.72, 21, 1118, 46.61],
};
const DOWN_RECTS = {
  fushimi: [92.78, 5, 1118, 47.11],
  goto: [139.89, 5, 1118, 46.61],
  inoue: [186.5, 5, 1118, 46.61],
};

const FEATURE_DURATION = 200;

const FEATURES_UP = [
  {
    rect: UP_RECTS.higuchi,
    caption: "約90日で勝率+0.92。上向いている選手が一目で",
  },
  {
    rect: UP_RECTS.nomura,
    caption: "レースを選ばず、本日出走の全選手から発見できる",
  },
  {
    rect: UP_RECTS.ishikura,
    caption: "急上昇選手は狙い目の根拠に",
  },
].map((f, i) => ({
  box: scaleRect(f.rect, rectOptsUp),
  caption: f.caption,
  from: i * FEATURE_DURATION,
  durationInFrames: FEATURE_DURATION,
}));

const FEATURES_DOWN = [
  {
    rect: DOWN_RECTS.fushimi,
    caption: "約90日で勝率-1.69。調子を落とした選手も一目で",
  },
  {
    rect: DOWN_RECTS.goto,
    caption: "急下降選手は除外判断の根拠に",
  },
  {
    rect: DOWN_RECTS.inoue,
    caption: "選手名タップで、本日のレースの調子タブへ移動",
  },
].map((f, i) => ({
  box: scaleRect(f.rect, rectOptsDown),
  caption: f.caption,
  from: i * FEATURE_DURATION,
  durationInFrames: FEATURE_DURATION,
}));

const HOOK_DURATION = 90;
const UP_DURATION = FEATURES_UP.length * FEATURE_DURATION;
const DOWN_DURATION = FEATURES_DOWN.length * FEATURE_DURATION;
const CTA_DURATION = 210;

export function NoteExplainerCM_FormRanking() {
  return (
    <AbsoluteFill>
      <Audio
        src={staticFile("note-bgm-calm-corporate-relax.wav")}
        volume={0.4}
      />
      <Sequence from={0} durationInFrames={HOOK_DURATION}>
        <SceneHook
          title="好調・不調ランキングとは？"
          subtitle="レースを選ばず、本日の注目選手を先に発見できる新機能"
          featureCount={FEATURES_UP.length + FEATURES_DOWN.length}
          previewImageSrc="note-form-ranking-up-table.png"
          titleFontSize={80}
        />
      </Sequence>
      <Sequence from={HOOK_DURATION} durationInFrames={UP_DURATION}>
        <SceneFeatures
          imageSrc="note-form-ranking-up-table.png"
          imageWidth={IMAGE_WIDTH}
          imageTop={IMAGE_TOP}
          imageLeft={IMAGE_LEFT}
          badgeLabel="🔥 急上昇選手TOP10"
          features={FEATURES_UP}
        />
      </Sequence>
      <Sequence
        from={HOOK_DURATION + UP_DURATION}
        durationInFrames={DOWN_DURATION}
      >
        <SceneFeatures
          imageSrc="note-form-ranking-down-table.png"
          imageWidth={IMAGE_WIDTH}
          imageTop={IMAGE_TOP}
          imageLeft={IMAGE_LEFT}
          badgeLabel="📉 急下降選手TOP10"
          features={FEATURES_DOWN}
        />
      </Sequence>
      <Sequence
        from={HOOK_DURATION + UP_DURATION + DOWN_DURATION}
        durationInFrames={CTA_DURATION}
      >
        <SceneCTA
          featureDigest={[
            "会場・レース選択が不要",
            "急上昇TOP10・急下降TOP10",
            "選手名タップで詳細確認",
          ]}
        />
      </Sequence>
    </AbsoluteFill>
  );
}
