/**
 * MorningDigestXCard（sns-video-studio/remotion/src/MorningDigestCM.jsx）を
 * Remotion CLIの`still`コマンドでレンダリングするラッパー。
 * renderCoverCard.js / renderCampaignCard.js と同じパターン
 * （`--props`はJSONファイル経由、シェルエスケープの煩雑さを避ける）。
 *
 * 「本日のデータ一覧」型（morning-digest）X投稿用の画像生成に使う。
 * docs/operation/sns-pipeline-morning-digest.md 参照。
 */

import { execFileSync } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REMOTION_DIR = path.join(__dirname, "../../../sns-video-studio/remotion");
const ENTRY_POINT = path.join(REMOTION_DIR, "src/index.jsx");

export const COMPOSITION_IDS = {
  xCard: "MorningDigestXCard",
};

/**
 * @param {{dateLabel: string, venueCount: number, raceCount: number, nigeRows: object[], makuriRows: object[]}} props
 * @param {string} outputPath
 */
export async function renderMorningDigestXCard(props, outputPath) {
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
        COMPOSITION_IDS.xCard,
        outputPath,
        `--props=${propsPath}`,
      ],
      { stdio: "inherit", cwd: REMOTION_DIR },
    );
  } finally {
    await fs.unlink(propsPath).catch(() => {});
  }
}
