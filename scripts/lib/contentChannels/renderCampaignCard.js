/**
 * CampaignEntryCard / CampaignDataExcerptCard
 * （sns-video-studio/remotion/src/）をRemotion CLIの`still`コマンドで
 * レンダリングするラッパー。renderCoverCard.jsと同じパターン
 * （`--props`はJSONファイル経由、シェルエスケープの煩雑さを避ける）。
 *
 * 企画型SNSパイプライン（docs/design/sns-hub-campaign-pipeline/）の
 * X投稿用カード生成に使う。docs/operation/sns-pipeline-x.md
 * 「企画（キャンペーン）由来のネタの場合」参照。
 */

import { execFileSync } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REMOTION_DIR = path.join(__dirname, "../../../sns-video-studio/remotion");
const ENTRY_POINT = path.join(REMOTION_DIR, "src/index.jsx");

export const COMPOSITION_IDS = {
  entryCard: "CampaignEntryCard",
  dataExcerptCard: "CampaignDataExcerptCard",
};

async function renderStill(compositionId, props, outputPath) {
  const propsPath = `${outputPath}.props.json`;
  await fs.writeFile(propsPath, JSON.stringify(props));

  try {
    execFileSync(
      "npx",
      [
        "--prefix",
        REMOTION_DIR,
        "remotion",
        "still",
        ENTRY_POINT,
        compositionId,
        outputPath,
        `--props=${propsPath}`,
      ],
      { stdio: "inherit", cwd: REMOTION_DIR },
    );
  } finally {
    await fs.unlink(propsPath).catch(() => {});
  }
}

/**
 * @param {object} props - CampaignEntryCardのprops（variant/headline/picks等）
 * @param {string} outputPath
 */
export async function renderCampaignEntryCard(props, outputPath) {
  await renderStill(COMPOSITION_IDS.entryCard, props, outputPath);
}

/**
 * @param {object} props - CampaignDataExcerptCardのprops（boats/turnPredictionTop3等）
 * @param {string} outputPath
 */
export async function renderCampaignDataExcerptCard(props, outputPath) {
  await renderStill(COMPOSITION_IDS.dataExcerptCard, props, outputPath);
}
