/**
 * 公開済みブログ/note記事の定期抜き打ち監査（FR4b、
 * docs/design/content-multi-channel-pipeline/spec.md参照）。
 *
 * FR4の生成時品質ゲート（採点パス）だけでは、採点基準自体の盲点に
 * 気づけない。直近公開された記事から1〜2件をローテーションで人間に
 * 提示し、スポットチェックを促す（tweet-drafts等と同じ「鮮度優先で
 * 提示」パターン）。ここで質の低下傾向が見つかった場合、FR4の採点
 * 基準そのものを見直す入力にする。
 *
 * 対象は直近{RECENT_WINDOW_DAYS}日以内に公開されたブログ記事
 * （src/data/blogPosts.js）。note記事は`note-articles/{id}.md`が
 * 存在する場合のみ併記する（フローA-3のnote下書き同時生成ルールにより
 * 大半のブログ記事はnote記事も存在する）。
 *
 * 監査済み記録は data/analysis/content-quality-audit/history.json に
 * 保存する（ADR 0033のネタ履歴保存パターンを踏襲、DBではなくJSON）。
 */

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { blogPosts } from "../../../src/data/blogPosts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "../../..");
const HISTORY_PATH = path.join(
  REPO_ROOT,
  "data/analysis/content-quality-audit/history.json",
);
const RECENT_WINDOW_DAYS = 60;
const PRESENT_COUNT = 2;

function daysSince(isoDateString) {
  const diffMs = Date.now() - new Date(isoDateString).getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

async function readHistory() {
  try {
    const raw = await fs.readFile(HISTORY_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { audited: {} };
  }
}

async function noteArticleExists(id) {
  try {
    await fs.access(path.join(REPO_ROOT, "note-articles", `${id}.md`));
    return true;
  } catch {
    return false;
  }
}

export async function checkContentQualityAudit({
  windowDays = RECENT_WINDOW_DAYS,
  presentCount = PRESENT_COUNT,
} = {}) {
  const history = await readHistory();
  const audited = history.audited ?? {};

  const recent = blogPosts.filter((post) => daysSince(post.date) <= windowDays);

  const candidates = [];
  for (const post of recent) {
    const lastAuditedAt = audited[post.id]?.auditedAt ?? null;
    candidates.push({
      id: post.id,
      title: post.title,
      publishedDate: post.date,
      hasNoteArticle: await noteArticleExists(post.id),
      lastAuditedAt,
    });
  }

  // 未監査（lastAuditedAtがnull）を最優先、次点は監査日が古い順
  candidates.sort((a, b) => {
    if (!a.lastAuditedAt && !b.lastAuditedAt) {
      return b.publishedDate.localeCompare(a.publishedDate);
    }
    if (!a.lastAuditedAt) return -1;
    if (!b.lastAuditedAt) return 1;
    return a.lastAuditedAt.localeCompare(b.lastAuditedAt);
  });

  return {
    targets: candidates.slice(0, presentCount),
    recentCount: recent.length,
    windowDays,
  };
}

export async function recordAudit(id, auditedAt) {
  const history = await readHistory();
  history.audited = history.audited ?? {};
  history.audited[id] = { auditedAt };
  await fs.mkdir(path.dirname(HISTORY_PATH), { recursive: true });
  await fs.writeFile(HISTORY_PATH, JSON.stringify(history, null, 2) + "\n");
}
