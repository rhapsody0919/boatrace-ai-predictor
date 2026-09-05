/**
 * ネタ供給モジュール: 会場特性。
 * 24会場をローテーションする。同じ会場でも切り口（ANGLES）を変えることで、
 * 1周した後も新規ネタとして扱える。使用履歴は
 * data/analysis/content-topics/venue-characteristic-history.json で管理する
 * （ADR 0033）。会場の表示名はここでは扱わない（i18nキー venues.* 側の責務、
 * .claude/CLAUDE.md「会場名はvenues.*キーを使う」ルールに従う）。
 */

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_PATH = path.join(
  __dirname,
  "../../../data/analysis/content-topics/venue-characteristic-history.json",
);

export const id = "venue-characteristic";

// 1〜24（.claude/CLAUDE.md 会場コード一覧と一致）
const VENUE_CODES = Array.from({ length: 24 }, (_, i) => i + 1);

const ANGLES = [
  "water-type", // 水面特性（海水・淡水・汽水、venues.avg_first_win_rate）
  "technique-tendency", // 決まり手傾向（1号艇の決まり手構成、winning_technique_stats）
  "outcome-distribution", // 出目傾向（outcome_distributionテーブル、90日集計）
  "top-start", // トップスタート傾向（top_start_statsテーブル、90日集計）
  "losing-technique", // 1号艇が負けた時の決まり手傾向（losing_technique_statsテーブル、90日集計）
  "nige-outcome", // 1号艇逃げ決着時の2-3着傾向（nige_outcome_distributionテーブル、90日集計）
  "exhibition-time-top", // 展示タイム最速艇の信頼度（exhibition_time_top_statsテーブル、90日集計）
  "seasonal", // 季節ごとの特徴（月別集計クエリ未実装のため現状は生成時にスキップされる、BOA-245参照）
];

async function readHistory() {
  try {
    const raw = await fs.readFile(HISTORY_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { category: id, entries: [] };
  }
}

// venueCode×angleの組み合わせで、まだ使っていない、または最も古く使われた順に候補を返す
export async function getCandidates() {
  const history = await readHistory();
  const usedAt = new Map(
    history.entries.map((e) => [`${e.venueCode}:${e.angle}`, e.usedAt]),
  );

  const combos = [];
  for (const venueCode of VENUE_CODES) {
    for (const angle of ANGLES) {
      const key = `${venueCode}:${angle}`;
      combos.push({
        sourceId: id,
        topicKey: key,
        venueCode,
        angle,
        lastUsedAt: usedAt.get(key) ?? null,
      });
    }
  }

  // 未使用（lastUsedAt=null）を優先、次に最も古く使われたもの順
  combos.sort((a, b) => {
    if (a.lastUsedAt === null && b.lastUsedAt !== null) return -1;
    if (a.lastUsedAt !== null && b.lastUsedAt === null) return 1;
    if (a.lastUsedAt === null && b.lastUsedAt === null) return 0;
    return new Date(a.lastUsedAt) - new Date(b.lastUsedAt);
  });

  return combos;
}

export async function recordUsage(venueCode, angle, usedAt) {
  const history = await readHistory();
  history.entries.push({ venueCode, angle, usedAt });
  await fs.mkdir(path.dirname(HISTORY_PATH), { recursive: true });
  await fs.writeFile(HISTORY_PATH, JSON.stringify(history, null, 2) + "\n");
}
