#!/usr/bin/env node
/**
 * セッション開始時チェックの統合スクリプト。
 *
 * これまでCLAUDE.mdに散在していた5つの「セッション開始時確認」ルール
 * （Xツイート下書き・X動画・TikTok・選手ニュース・集客調査スキル）と、
 * 新設した2項目（トレーサビリティ索引カバレッジ・品質バックログ）を
 * 1回の実行で集約する。CLAUDE.md側は「このスクリプトを実行し結果を
 * 報告する」の1行に統合する（詳細ロジックの説明はこのファイルのコメント
 * が正本）。
 *
 * 各項目の判定ロジック・出典:
 * 1) tweetDrafts   … note-articles/tweet-drafts.md の `- [ ] 投稿済み` 件数
 * 2) xVideo        … data/analysis/x-posts/history.json の本日投稿状況
 * 3) tiktok        … data/analysis/tiktok-posts/history.json の本日投稿状況
 * 4) racerNews     … data/analysis/racer-news-pending-review/pending.json の pending件数
 * 5) growthSkills  … data/analysis/{x,tiktok}-growth/ の最新レポート鮮度
 * 6) contentIndex  … docs/design/content-ops-flow/spec.md C5
 * 7) qualityBacklog… docs/design/content-ops-flow/spec.md C6
 * 8) recentFlowA   … docs/design/content-ops-flow/spec.md A4（sns-hub型選定ロジックへの素材提示）
 * 9) deprecatedTerms… docs/reference/deprecated-terms.json に対する grep 検知（フローC-7）
 * 10) missingContentIndex… AppRouter.jsxの新規ルートのうちcontent-index.json
 *     未カバーのものを検知（フローA-1、2026-09-01追加）。「PRマージを単一
 *     トリガーとする」という運用ルール自体には検知機構が無かった穴を埋める。
 *     新ルート＝ブログが要る新機能とは限らないため強制はせず提示のみ
 * 11) contentQualityAudit… 直近公開ブログ/note記事のスポットチェック対象を
 *     ローテーション提示（FR4b、content-multi-channel-pipeline/spec.md）。
 *     生成時の自己採点だけでは気づけない盲点を人間の目で拾う
 *
 * 使い方: node scripts/maintenance/session-start-check.js [--json]
 */

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { checkContentIndexCoverage } from "./content-ops-checks/check-content-index-coverage.js";
import { checkVisualAssetAge } from "./content-ops-checks/check-visual-asset-age.js";
import { checkQualityBacklog } from "./content-ops-checks/check-quality-backlog.js";
import { checkRecentFlowAContent } from "./content-ops-checks/check-recent-flow-a-content.js";
import { checkDeprecatedTerms } from "./content-ops-checks/check-deprecated-terms.js";
import { checkMissingContentIndex } from "./content-ops-checks/check-missing-content-index.js";
import { checkContentQualityAudit } from "./content-ops-checks/check-content-quality-audit.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "../..");
const VISUAL_ASSET_STALE_DAYS = 90;

async function readJsonSafe(relPath, fallback) {
  try {
    const raw = await fs.readFile(path.join(REPO_ROOT, relPath), "utf-8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function checkTweetDrafts() {
  let raw;
  try {
    raw = await fs.readFile(
      path.join(REPO_ROOT, "note-articles/tweet-drafts.md"),
      "utf-8",
    );
  } catch {
    return { pendingCount: 0, oldestDate: null };
  }

  const lines = raw.split("\n");
  let currentDate = null;
  let pendingCount = 0;
  let oldestDate = null;

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(\d{4}-\d{2}-\d{2})/);
    if (headingMatch) {
      currentDate = headingMatch[1];
      continue;
    }
    if (/^- \[ \] 投稿済み/.test(line)) {
      pendingCount += 1;
      if (currentDate && (!oldestDate || currentDate < oldestDate)) {
        oldestDate = currentDate;
      }
    }
  }

  return { pendingCount, oldestDate };
}

async function checkDailyPostStatus(relPath) {
  const data = await readJsonSafe(relPath, { posts: [] });
  const posts = data.posts ?? [];
  const today = todayIso();

  const postedToday = posts.some(
    (p) => p.date === today && p.status === "posted",
  );
  const lastPosted = posts
    .filter((p) => p.status === "posted")
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];

  return {
    postedToday,
    lastPostedDate: lastPosted?.date ?? null,
  };
}

async function checkRacerNewsPending() {
  const data = await readJsonSafe(
    "data/analysis/racer-news-pending-review/pending.json",
    { items: [] },
  );
  const items = data.items ?? [];
  const pending = items.filter((item) => item.status === "pending");
  return { pendingCount: pending.length };
}

async function latestReportAgeDays(dirRelPath) {
  const dirAbsPath = path.join(REPO_ROOT, dirRelPath);
  let entries;
  try {
    entries = await fs.readdir(dirAbsPath);
  } catch {
    return { latestDate: null, ageDays: null };
  }
  const dates = entries
    .map((name) => name.match(/report-(\d{4}-\d{2}-\d{2})\.json/))
    .filter(Boolean)
    .map((m) => m[1]);
  if (dates.length === 0) return { latestDate: null, ageDays: null };

  const latestDate = dates.sort().at(-1);
  const ageDays = Math.floor(
    (Date.now() - new Date(latestDate).getTime()) / (1000 * 60 * 60 * 24),
  );
  return { latestDate, ageDays };
}

async function checkGrowthSkillsFreshness() {
  const [xGrowth, tiktokGrowth] = await Promise.all([
    latestReportAgeDays("data/analysis/x-growth"),
    latestReportAgeDays("data/analysis/tiktok-growth"),
  ]);
  return {
    xGrowth,
    tiktokGrowth,
  };
}

async function main() {
  const [
    tweetDrafts,
    xVideo,
    tiktok,
    racerNews,
    growthSkills,
    contentIndexCoverage,
    visualAssetAge,
    qualityBacklog,
    recentFlowAContent,
    deprecatedTerms,
    missingContentIndex,
    contentQualityAudit,
  ] = await Promise.all([
    checkTweetDrafts(),
    checkDailyPostStatus("data/analysis/x-posts/history.json"),
    checkDailyPostStatus("data/analysis/tiktok-posts/history.json"),
    checkRacerNewsPending(),
    checkGrowthSkillsFreshness(),
    checkContentIndexCoverage(),
    checkVisualAssetAge(),
    checkQualityBacklog().catch((error) => ({
      openCount: 0,
      surfaceCount: 0,
      items: [],
      error: error.message,
    })),
    checkRecentFlowAContent(),
    checkDeprecatedTerms(),
    checkMissingContentIndex().catch((error) => ({
      missingRoutes: [],
      error: error.message,
    })),
    checkContentQualityAudit().catch((error) => ({
      targets: [],
      recentCount: 0,
      error: error.message,
    })),
  ]);

  const staleVisualAssets = visualAssetAge.assets.filter(
    (a) => (a.ageDays ?? 0) >= VISUAL_ASSET_STALE_DAYS,
  );

  const result = {
    tweetDrafts,
    xVideo,
    tiktok,
    racerNews,
    growthSkills,
    contentIndexCoverage: {
      invalidFiles: contentIndexCoverage.invalidFiles,
    },
    visualAssetAge: {
      staleCount: staleVisualAssets.length,
      staleThresholdDays: VISUAL_ASSET_STALE_DAYS,
      oldest: visualAssetAge.assets.slice(0, 5),
    },
    qualityBacklog,
    recentFlowAContent,
    missingContentIndex,
    contentQualityAudit,
    deprecatedTerms: {
      hitCount: deprecatedTerms.hits.length,
      affectedFileCount: new Set(deprecatedTerms.hits.map((h) => h.file)).size,
      note:
        deprecatedTerms.hits.length > 0
          ? "詳細は `node scripts/maintenance/check-deprecated-terms.js` を実行"
          : undefined,
    },
  };

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(JSON.stringify(result, null, 2));
    console.log(
      "\n(このJSONを読み、報告が必要な項目をユーザーに提示する。詳細ロジックは session-start-check.js 冒頭のコメント参照)",
    );
  }
}

main().catch((error) => {
  console.error("❌ session-start-check 実行中にエラー:", error.message);
  process.exit(1);
});
