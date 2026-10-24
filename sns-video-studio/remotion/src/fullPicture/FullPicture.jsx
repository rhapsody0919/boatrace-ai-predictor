/**
 * 全貌動画（全場面を1本に）。props: { scenes: [{ id, kind: "scene2"|"step", data }], answers, bgm }
 * 並びは型どおり（1 条件 → 2 6艇の重ね図 → 2b 類似レース → 3 軸 → 4 展開 → 5 相手 → 6 機力と調子 → 8 展示後に見るところ）。
 * 場面の間は切り替え（場面の中の段は縦スクロール）。BGM は全体で1本を繰り返す。
 */
import { AbsoluteFill, Audio, Series, interpolate, staticFile } from "remotion";
import { FONT } from "../fonts.js";
import { BG_BOTTOM, BG_TOP, clamp } from "./parts.js";
import { FullPictureScene2 } from "./Scene2Compare.jsx";
import { StepScene } from "./StepScene.jsx";
import { sceneDuration } from "./fullPictureTimeline.js";

/** badgePlace: 出どころの札の置き場（sourceBadge.js の BADGE_PLACES のキー）。完全版は "band"、入口版は渡さない（札を出さない） */
export function FullPicture({ scenes = [], answers = {}, bgm = null, badgePlace = null }) {
  const total = scenes.reduce((s, x) => s + sceneDuration(x, answers), 0);
  const fade = (f) =>
    interpolate(f, [0, 10, total - 30, total], [0, 1, 1, 0], clamp);
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(180deg, ${BG_TOP} 0%, ${BG_BOTTOM} 100%)`,
        fontFamily: FONT,
        overflow: "hidden",
      }}
    >
      {bgm && (
        <Audio src={staticFile(bgm)} loop volume={(f) => 0.35 * fade(f)} />
      )}
      <Series>
        {scenes
          .filter((x) => sceneDuration(x, answers) > 0)
          .map((x) => (
            <Series.Sequence key={x.id} durationInFrames={sceneDuration(x, answers)}>
              {x.kind === "scene2" ? (
                <FullPictureScene2 {...x.data} answers={answers} badgePlace={badgePlace} />
              ) : (
                <AbsoluteFill
                  style={{
                    background: `linear-gradient(180deg, ${BG_TOP} 0%, ${BG_BOTTOM} 100%)`,
                  }}
                >
                  <StepScene scene={{ ...x.data, answers, badgePlace }} />
                </AbsoluteFill>
              )}
            </Series.Sequence>
          ))}
      </Series>
    </AbsoluteFill>
  );
}
