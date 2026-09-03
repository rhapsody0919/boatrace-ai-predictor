/**
 * DataQuoteCard（sns-video-studio/remotion/src/DataQuoteCard.jsx）を
 * Remotion CLIの `still` コマンドでレンダリングするラッパー。
 * `--props`はJSONファイル経由で渡す（インラインJSON文字列はシェル
 * エスケープが煩雑なため）。
 */

import { execFileSync } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REMOTION_DIR = path.join(__dirname, "../../../sns-video-studio/remotion");
const ENTRY_POINT = path.join(REMOTION_DIR, "src/index.jsx");

export const COMPOSITION_IDS = {
  blogOrNote: "DataQuoteCard-Cover",
  youtubeThumbnail: "DataQuoteCard-YouTubeThumbnail",
};

/**
 * @param {{compositionId: string, headline: string, statValue?: string, statLabel?: string, caption?: string, outputPath: string}} opts
 */
export async function renderCoverCard({
  compositionId,
  headline,
  statValue = "",
  statLabel = "",
  caption = "",
  outputPath,
}) {
  const propsPath = `${outputPath}.props.json`;
  await fs.writeFile(
    propsPath,
    JSON.stringify({ headline, statValue, statLabel, caption }),
  );

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
