/**
 * ネタ供給モジュール: 豆知識。
 * 選手の属性（級別・年代・体重・支部・経験年数）別に成績を比較する、
 * 会場にもツールタブにも紐づかない全国横断の「意外性」ネタ。
 * 直近使用した軸と重複しないようローテーションする。使用履歴は
 * data/analysis/content-topics/trivia-history.json で管理する（ADR 0033）。
 */

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_PATH = path.join(
  __dirname,
  "../../../data/analysis/content-topics/trivia-history.json",
);

export const id = "trivia";

// 新しい軸を追加する場合はこのリストに追記する。データ取得方法は
// docs/operation/sns-topic-proposer-weekly.md「2-C. 豆知識ネタの本文作成」参照
const ANGLES = [
  "grade-win-rate", // 級別（A1/A2/B1/B2）別平均勝率の格差
  "age-win-rate", // 年代別平均勝率
  "weight-win-rate", // 体重階級別の勝率傾向
  "branch-win-rate", // 支部（都道府県）別平均勝率ランキング
  "experience-win-rate", // 登録期（経験年数目安）別の勝率傾向
  "height-win-rate", // 身長と勝率の関係
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
  const recentAngles = history.entries
    .slice(-REPEAT_AVOID_WINDOW)
    .map((e) => e.angle);

  const lastUsedByAngle = new Map(
    history.entries.map((e) => [e.angle, e.usedAt]),
  );

  return ANGLES.filter((angle) => !recentAngles.includes(angle))
    .map((angle) => ({
      sourceId: id,
      topicKey: angle,
      angle,
      lastUsedAt: lastUsedByAngle.get(angle) ?? null,
    }))
    .sort((a, b) => {
      if (a.lastUsedAt === null && b.lastUsedAt !== null) return -1;
      if (a.lastUsedAt !== null && b.lastUsedAt === null) return 1;
      if (a.lastUsedAt === null && b.lastUsedAt === null) return 0;
      return new Date(a.lastUsedAt) - new Date(b.lastUsedAt);
    });
}

export async function recordUsage(angle, usedAt) {
  const history = await readHistory();
  history.entries.push({ angle, usedAt });
  await fs.mkdir(path.dirname(HISTORY_PATH), { recursive: true });
  await fs.writeFile(HISTORY_PATH, JSON.stringify(history, null, 2) + "\n");
}
