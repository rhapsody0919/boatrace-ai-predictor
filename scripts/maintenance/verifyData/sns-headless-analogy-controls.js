/**
 * verify-sns-headless.js の道具（龍神ソナーの上部の操作 AnalogyControls.jsx を描いて箱の入れ子を返す）。verify ではない。
 * 撮る前に待つ印（analogy-controls）が、展示の前（段の札）と後（段のボタン2つ）のどちらでも外側の箱にあるかを見るため。
 * 訳は読まない（i18next の無い useTranslation は鍵を返す。その案内は黙らせる）。DB・ネットには繋がない。
 */
import { renderJsx } from "../../lib/renderJsx.js";

const CONTROLS = new URL(
  "../../../src/components/race/analogy/AnalogyControls.jsx",
  import.meta.url,
);

/** @returns {Promise<{box: boolean, chip: boolean, stageButtons: number}>} 箱の有無と、箱の中の段の札・段のボタンの数 */
export async function analogyControlsShape(exhibitionReady) {
  const warn = console.warn;
  console.warn = () => {};
  const view = await renderJsx(CONTROLS, {
    stage: "racecard",
    exhibitionReady,
    stageChipKey: "chipBefore",
    onStage() {},
    target: 1,
    onTarget() {},
    showTarget: true,
  }).finally(() => {
    console.warn = warn;
  });
  const box = view.container.querySelector('[data-testid="analogy-controls"]');
  const shape = {
    box: Boolean(box),
    chip: Boolean(box?.querySelector('[data-testid="analogy-stage-chip"]')),
    stageButtons:
      box?.querySelectorAll('[data-af-control="stage"] button').length ?? 0,
  };
  await view.unmount();
  return shape;
}
