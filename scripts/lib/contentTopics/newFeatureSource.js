/**
 * ネタ供給モジュール: 新機能・既存機能の使い方紹介。
 *
 * 2種類の候補を返す:
 * 1. missingContentIndex検知（scripts/maintenance/content-ops-checks/）の結果。
 *    真に新しい機能ルートが対象で、機会ベースのため履歴管理は不要
 *    （検知されなくなる＝content-index.jsonが作られた時点で自然に対象から外れる）。
 *    成績・確率に関わる可能性があるため`isGamblingRelevant: true`（既定・安全側）
 * 2. 既存機能の使い方紹介（EXISTING_FEATURE_LIFEHACKS、2026-09-02追加）。
 *    `docs/proposal/tiktok-non-gambling-content-ideas.md`案4「使い方ライフハック型」
 *    を吸収したもの。成績・確率と無関係と選定済みの機能のみを対象にしているため
 *    `isGamblingRelevant: false`（TikTok展開可）を明示する。使用履歴は
 *    data/analysis/content-topics/new-feature-lifehack-history.json で管理する
 */

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkMissingContentIndex } from "../../maintenance/content-ops-checks/check-missing-content-index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIFEHACK_HISTORY_PATH = path.join(
  __dirname,
  "../../../data/analysis/content-topics/new-feature-lifehack-history.json",
);

export const id = "new-feature";

// 成績・確率と無関係と判定済みの既存機能のみ。AI予想・展開予測・出目分布・
// 回収率分析等、成績・確率に関わる分析ツールタブは対象外にすること
// （docs/proposal/tiktok-non-gambling-content-ideas.md案4の判断基準を継承）
const EXISTING_FEATURE_LIFEHACKS = [
  {
    featureKey: "language-switcher",
    route: "/",
    label: "言語切替（4言語対応）",
  },
  {
    featureKey: "race-navigation",
    route: "/venue/:venueCode",
    label: "レース間・会場間ナビゲーション",
  },
  {
    featureKey: "racer-news",
    route: "/racer/:racerId",
    label: "選手個人ニュース・選手ページ",
  },
  {
    featureKey: "venue-guide",
    route: "/venues/:slug",
    label: "会場ガイド（アクセス・観光情報）",
  },
];

async function readLifehackHistory() {
  try {
    const raw = await fs.readFile(LIFEHACK_HISTORY_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { category: `${id}-lifehack`, entries: [] };
  }
}

async function getLifehackCandidates() {
  const history = await readLifehackHistory();
  const usedAt = new Map(history.entries.map((e) => [e.featureKey, e.usedAt]));

  const candidates = EXISTING_FEATURE_LIFEHACKS.map((f) => ({
    sourceId: id,
    topicKey: `lifehack:${f.featureKey}`,
    route: f.route,
    label: f.label,
    isGamblingRelevant: false,
    lastUsedAt: usedAt.get(f.featureKey) ?? null,
  }));

  // 未使用（lastUsedAt=null）を優先、次に最も古く使われたもの順
  candidates.sort((a, b) => {
    if (a.lastUsedAt === null && b.lastUsedAt !== null) return -1;
    if (a.lastUsedAt !== null && b.lastUsedAt === null) return 1;
    if (a.lastUsedAt === null && b.lastUsedAt === null) return 0;
    return new Date(a.lastUsedAt) - new Date(b.lastUsedAt);
  });

  return candidates;
}

export async function getCandidates() {
  const { missingRoutes } = await checkMissingContentIndex();
  const newFeatureCandidates = missingRoutes.map((r) => ({
    sourceId: id,
    topicKey: r.route,
    route: r.route,
    addedDate: r.addedDate,
    isGamblingRelevant: true,
  }));

  const lifehackCandidates = await getLifehackCandidates();

  return [...newFeatureCandidates, ...lifehackCandidates];
}

export async function recordLifehackUsage(featureKey, usedAt) {
  const history = await readLifehackHistory();
  history.entries.push({ featureKey, usedAt });
  await fs.mkdir(path.dirname(LIFEHACK_HISTORY_PATH), { recursive: true });
  await fs.writeFile(
    LIFEHACK_HISTORY_PATH,
    JSON.stringify(history, null, 2) + "\n",
  );
}
