/**
 * フローA（新機能マルチチャネル展開）で最近公開されたコンテンツを、
 * sns-hub側の型・キャラ選定ロジック（x-operations-playbook.md・
 * sns-video-producer-prompt.md）が参照できる「素材候補」として一覧化する。
 *
 * 注意: これは「新機能を告知する投稿を強制する」ものではない。
 * x-operations-playbook.mdの型・キャラ選定ロジック4番に「新機能告知単体は
 * 選ばない」という既存ルールがあり、本チェックはそれと矛盾しない —
 * あくまで「使っていい新鮮な題材（実データ・スクリーンショット）が
 * 存在する」という情報を提示するだけで、採用するかどうか・どう料理するか
 * （推し活・人間味のある文脈に落とし込む等）は既存ロジックの判断に委ねる。
 * 詳細: docs/design/content-ops-flow/spec.md A4
 */

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESIGN_DIR = path.join(__dirname, "../../../docs/design");
const EXCLUDED_DIR_NAMES = new Set(["_template"]);
const RECENT_WINDOW_DAYS = 21;

function daysSince(isoDateString) {
  const diffMs = Date.now() - new Date(isoDateString).getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export async function checkRecentFlowAContent({
  windowDays = RECENT_WINDOW_DAYS,
} = {}) {
  let entries;
  try {
    entries = await fs.readdir(DESIGN_DIR, { withFileTypes: true });
  } catch {
    return { items: [] };
  }

  const items = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || EXCLUDED_DIR_NAMES.has(entry.name)) continue;
    const filePath = path.join(DESIGN_DIR, entry.name, "content-index.json");
    let data;
    try {
      data = JSON.parse(await fs.readFile(filePath, "utf-8"));
    } catch {
      continue;
    }
    if (data.not_applicable) continue;
    const age = daysSince(data.released);
    if (age > windowDays) continue;

    const hasPromotableMaterial =
      (data.content?.blog_posts?.length ?? 0) > 0 ||
      (data.content?.youtube_videos?.length ?? 0) > 0 ||
      (data.content?.note_articles?.length ?? 0) > 0;
    if (!hasPromotableMaterial) continue;

    items.push({
      slug: entry.name,
      feature: data.feature,
      released: data.released,
      ageDays: age,
      blogPosts: data.content.blog_posts,
      youtubeVideos: data.content.youtube_videos,
      noteArticles: data.content.note_articles,
    });
  }

  items.sort((a, b) => a.ageDays - b.ageDays);
  return { items };
}
