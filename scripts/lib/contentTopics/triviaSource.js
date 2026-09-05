/**
 * ネタ供給モジュール: 豆知識。
 * 選手の属性（級別・年代・体重・支部・経験年数・身長・出身地）や、
 * 級別と成績の関係（スタート・フライング率・コース配置）、地元開催時の
 * 勝率ギャップ、モーター運等を比較する、会場にもツールタブにも紐づかない
 * 全国横断の「意外性」ネタ。使用履歴は
 * data/analysis/content-topics/trivia-history.json で管理する（ADR 0033）。
 *
 * 2026-09-06、6軸→15軸に拡張し、再利用ルールを「直近3回を避ける」カウント
 * ベースの窓から「COOLDOWN_DAYS以内に使った軸を避ける」長期クールダウン方式に
 * 変更した（ユーザー指摘: 軸が6個のままだと十数週で同じ軸が一巡し「またこの
 * 話か」という繰り返し感が出る。理想は毎回別の軸、無理なら軸自体を増やす）。
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
  "hometown-win-rate", // 出身地（都道府県）別平均勝率ランキング。branchとは別の実データ列
  "start-timing-by-grade", // 級別の平均スタートタイミング（racer_aggregated_stats.avg_st）
  "flying-rate-by-grade", // 級別のフライング率（racer_aggregated_stats.flying_rate）
  "local-vs-national-gap", // 地元開催時の勝率（local_win_rate）と全国勝率（win_rate）のギャップ
  "course-assignment-by-grade", // 級別の1号艇（イン）配置率
  "age-by-grade", // 級別の平均年齢（age-win-rateとは異なる切り口）
  "branch-elite-ratio", // 支部別のA1級選手比率（branch-win-rateとは別metric）
  "motor-luck", // モーター2連率の当たり外れと実際の1着率の関係
  "flying-rate-by-experience", // 経験年数（登録期）別のフライング率
];

// この日数以内に使った軸は候補から除外する（長期クールダウン）。
// 15軸を大きく下回らない限り、実運用上は長期間同じ軸が再登場しない想定
const COOLDOWN_DAYS = 180;

async function readHistory() {
  try {
    const raw = await fs.readFile(HISTORY_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { category: id, entries: [] };
  }
}

export async function getCandidates(now = new Date()) {
  const history = await readHistory();
  const lastUsedByAngle = new Map(
    history.entries.map((e) => [e.angle, e.usedAt]),
  );

  return ANGLES.filter((angle) => {
    const lastUsedAt = lastUsedByAngle.get(angle);
    if (!lastUsedAt) return true;
    const daysSinceUsed = (now - new Date(lastUsedAt)) / (1000 * 60 * 60 * 24);
    return daysSinceUsed >= COOLDOWN_DAYS;
  })
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
