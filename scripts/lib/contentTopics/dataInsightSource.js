/**
 * ネタ供給モジュール: データ知見。
 * 分析ツール（/winning-technique）の既存タブを型ライブラリとして使う。
 * タブIDは src/pages/WinningTechniqueAnalysis.jsx の activeTab 判定文字列と
 * 一致させること（2026-09-01時点で17種）。直近使用した型と重複しないよう
 * ローテーションする。使用履歴は
 * data/analysis/content-topics/data-insight-history.json で管理する（ADR 0033）。
 */

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_PATH = path.join(
  __dirname,
  "../../../data/analysis/content-topics/data-insight-history.json",
);

export const id = "data-insight";

// src/pages/WinningTechniqueAnalysis.jsx の activeTab 文字列と対応させる
// （新しいタブが追加されたら、このリストにも追記すること）
const ANALYSIS_TABS = [
  "outcome", // 出目分布
  "technique", // 決まり手
  "motor", // モーター調子
  "racer", // 選手調子
  "st", // STのズレ
  "topstart", // トップスタート
  "losing", // 負け決まり手
  "nige", // 逃げ成功時分布
  "extime", // 展示タイム
  "extrend", // 展示タイム推移
  "techprofile", // 選手別決まり手傾向
  "formranking", // 好調・不調選手ランキング
  "returnrate", // 回収率分析
  "attackdefense", // 超展開データ
  "racecard", // 出走表データ
  "venueranking", // 会場ランキング
  "volatility", // イン崩れ指数の実績
];

async function readHistory() {
  try {
    const raw = await fs.readFile(HISTORY_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { category: id, entries: [] };
  }
}

const REPEAT_AVOID_WINDOW = 3; // 直近何回分と重複させないか

export async function getCandidates() {
  const history = await readHistory();
  const recentTabIds = history.entries
    .slice(-REPEAT_AVOID_WINDOW)
    .map((e) => e.tabId);

  const lastUsedByTab = new Map(
    history.entries.map((e) => [e.tabId, e.usedAt]),
  );

  return ANALYSIS_TABS.filter((tabId) => !recentTabIds.includes(tabId))
    .map((tabId) => ({
      sourceId: id,
      topicKey: tabId,
      tabId,
      lastUsedAt: lastUsedByTab.get(tabId) ?? null,
    }))
    .sort((a, b) => {
      if (a.lastUsedAt === null && b.lastUsedAt !== null) return -1;
      if (a.lastUsedAt !== null && b.lastUsedAt === null) return 1;
      if (a.lastUsedAt === null && b.lastUsedAt === null) return 0;
      return new Date(a.lastUsedAt) - new Date(b.lastUsedAt);
    });
}

export async function recordUsage(tabId, usedAt) {
  const history = await readHistory();
  history.entries.push({ tabId, usedAt });
  await fs.mkdir(path.dirname(HISTORY_PATH), { recursive: true });
  await fs.writeFile(HISTORY_PATH, JSON.stringify(history, null, 2) + "\n");
}
