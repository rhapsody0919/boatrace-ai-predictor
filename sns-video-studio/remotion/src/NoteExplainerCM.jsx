import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import {
  SceneHook,
  SceneFeatures,
  SceneCTA,
  scaleRect,
} from "./noteVideoShared.jsx";

/**
 * note埋め込み用・機能解説型（横型 1920x1080）— 龍神レーダー「データ出走表」
 *
 * 2026-08-31新設: X/TikTok向けの縦型(1080x1920)・12-15秒・バズ訴求型とは別の型。
 * note読者は既に興味を持って記事を読みに来ている層のため、フックで止めさせる必要が薄く、
 * 実画面をじっくり見せる「プロダクトデモ」調のトーンにする（8人パネル議論、2026-08-31決定）。
 * YouTube限定公開でアップロードし、noteエディタにURLを貼って埋め込む運用を想定。
 *
 * Hook/特徴解説/CTAの共通実装は`noteVideoShared.jsx`に切り出し済み（2026-09-01、
 * 回収率分析・好調不調ランキングの動画制作で3箇所目の再利用が発生したため共通化）。
 * ハイライト座標はPlaywrightで実測した値をハードコード（`docs/operation/note-video-producer-prompt.md`参照）。
 */

// tmp/measure-rows.mjsで実測したCSS px座標（テーブル画像基準、1232x685相当）を
// IMAGE_WIDTH表示スケールに変換したもの
const IMAGE_WIDTH = 1400;
const IMAGE_TOP = 90;
const IMAGE_LEFT = (1920 - IMAGE_WIDTH) / 2;
const TABLE_SCALE = IMAGE_WIDTH / 1232;
const rectOpts = {
  imageTop: IMAGE_TOP,
  imageLeft: IMAGE_LEFT,
  scale: TABLE_SCALE,
};

// [relTop, relLeft, width, height]（実測値）
const ROW_RECTS = {
  gradeWinRate: [150.89, 17.5, 1197, 53.98],
  motor2Rate: [242.27, 17.5, 1197, 37.39],
  form: [279.66, 17.5, 1197, 37.39],
  exhibitionTime: [429.22, 17.5, 1197, 37.39],
  winningTechnique: [519.59, 17.5, 1197, 52],
  returnRate: [571.59, 17.5, 1197, 37.39],
};

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
  box: scaleRect(f.rect, rectOpts),
  caption: f.caption,
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
            "実力を数値で比較",
            "勢いのある選手がわかる",
            "勝率だけじゃない、儲かるかも見える",
          ]}
        />
      </Sequence>
    </AbsoluteFill>
  );
}
