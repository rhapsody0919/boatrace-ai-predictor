import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import {
  SceneHook,
  SceneFeatures,
  SceneCTA,
  scaleRect,
} from "./noteVideoShared.jsx";

/**
 * note埋め込み用・機能解説型（横型 1920x1080）— 龍神レーダー「選手×艇番別回収率分析」
 *
 * `NoteExplainerCM.jsx`（データ出走表）で確立したパターンを`noteVideoShared.jsx`経由で再利用。
 * 実データはPlaywrightで`/winning-technique?tab=returnrate`を撮影（多摩川1Rの実例、
 * 2026-09-01時点）。ハイライトは記事の「活用のポイント」に対応する4行を選定：
 * 回収率100%超の黒字例・単勝でも黒字の例・サンプル数が多い安定例・回収率0%の要注意例。
 */

const IMAGE_WIDTH = 1600;
const IMAGE_TOP = 300;
const IMAGE_LEFT = (1920 - IMAGE_WIDTH) / 2;
const TABLE_SCALE = IMAGE_WIDTH / 1160;
const rectOpts = {
  imageTop: IMAGE_TOP,
  imageLeft: IMAGE_LEFT,
  scale: TABLE_SCALE,
};

// [relTop, relLeft, width, height]（Playwright実測値、note-return-rate-table.png基準）
const ROW_RECTS = {
  row1_fukuda: [66.39, 21, 1118, 47.11],
  row2_kashima: [113.5, 21, 1118, 46.61],
  row3_uehara: [160.11, 21, 1118, 46.61],
  row5_goto: [253.33, 21, 1118, 46.61],
};

const FEATURE_DURATION = 200;
const FEATURES = [
  {
    rect: ROW_RECTS.row1_fukuda,
    caption: "複勝回収率149%。手堅く儲かる選手も見える",
  },
  {
    rect: ROW_RECTS.row2_kashima,
    caption: "単勝回収率138%。買い続けてもプラス収支に",
  },
  {
    rect: ROW_RECTS.row3_uehara,
    caption: "サンプル数21件、実績の信頼度も一目でわかる",
  },
  {
    rect: ROW_RECTS.row5_goto,
    caption: "回収率0%の選手も。サンプル数と合わせて要確認",
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

export function NoteExplainerCM_ReturnRate() {
  return (
    <AbsoluteFill>
      <Audio
        src={staticFile("note-bgm-calm-corporate-relax.wav")}
        volume={0.4}
      />
      <Sequence from={0} durationInFrames={HOOK_DURATION}>
        <SceneHook
          title="回収率分析とは？"
          subtitle="勝率だけでなく“儲かるか”を選手×艇番別に見る新機能"
          featureCount={FEATURES.length}
          previewImageSrc="note-return-rate-table.png"
        />
      </Sequence>
      <Sequence from={HOOK_DURATION} durationInFrames={FEATURES_DURATION}>
        <SceneFeatures
          imageSrc="note-return-rate-table.png"
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
            "選手×艇番別の実回収率",
            "単勝・複勝を両方比較",
            "サンプル数も一緒に確認",
          ]}
        />
      </Sequence>
    </AbsoluteFill>
  );
}
