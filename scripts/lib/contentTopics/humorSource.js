/**
 * ネタ供給モジュール: ゆるユーモア型。
 * 選手個人の成績データには一切触れない、競技ルール・観戦文化のあるあるネタ。
 * 動画フォーマット（Remotion）は3回設計し直した末、選手データを扱う演出が
 * 「煽り」「選手へのリスペクト欠如」に見えると判断されボツになった経緯があり
 * （2026-09-07）、文字投稿のみで運用する。日次・Xのみ。
 *
 * 2026-09-07（当初設計からの変更）: 固定の完成文をそのまま使い回す設計は
 * 「毎回同じネタになる」とユーザーに却下された。trivia型と同じく、ここでは
 * ネタの「題材（premise）」だけを供給し、実際の文面はRoutineが毎回新しく
 * 書く（docs/operation/sns-topic-proposer-daily-auto.md「2-D. ゆるユーモア
 * ネタの本文作成」のコピーライティング指針に従う）。同じ題材が短期間で
 * 何度も選ばれないようクールダウンで制御する（文面の使い回し防止ではなく
 * 題材の使い回し防止）。
 *
 * 使用履歴は data/analysis/content-topics/humor-history.json で管理する。
 */

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_PATH = path.join(
  __dirname,
  "../../../data/analysis/content-topics/humor-history.json",
);

export const id = "humor";

// 新しい題材を追加する場合はこのリストに追記する。premiseは文面ではなく
// 「Routineが本文を書く時に使う事実の材料」（データソース・裏付けの所在）。
// 選手個人の成績・属性データを扱わないこと（trivia型との切り分けの核心）
const ANGLES = [
  {
    key: "motor-lottery",
    premise:
      "ボートレースのモーターは選手が選べず、レース前の抽選会で全艇に支給品が割り振られる（公平性の根幹ルール）",
  },
  {
    key: "flying-rule",
    premise:
      "フライングは0.01秒単位で判定され、一発失格に加え一定期間の出走停止処分を受ける（他競技と比べて際立って厳格な判定基準）",
  },
  {
    key: "splash-spectator",
    premise:
      "ボートレース場の最前列は実際に水しぶきがかかる。テレビ観戦では伝わらない、現地観戦者だけが知る体感的なギャップ",
  },
  {
    key: "start-display",
    premise:
      "本番直前の「スタート展示」は、実際にはコース取りを競う本番さながらの時間だが、初見だと単なる練習に見える",
  },
  {
    key: "tide-venue",
    premise:
      "海水を使う会場（江戸川・鳴門等）は潮の満ち引きで水面コンディションが毎回変わる。淡水会場には無い環境要因",
  },
  {
    key: "weight-balancer",
    premise:
      "体重が軽い選手は、規定重量との差分をオモリ（鉛）で調整して積む公平化ルールがある",
  },
];

// 題材バンクが小さいため、trivia型（180日）より短いクールダウンにする。
// 消費ペースを見て枯渇しそうならバンクを拡張する（新しい題材の追加は
// ユーザー承認必須、このモジュールが自動生成することはしない）
const COOLDOWN_DAYS = 30;

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
  const lastUsedByKey = new Map(history.entries.map((e) => [e.key, e.usedAt]));

  return ANGLES.filter((angle) => {
    const lastUsedAt = lastUsedByKey.get(angle.key);
    if (!lastUsedAt) return true;
    const daysSinceUsed = (now - new Date(lastUsedAt)) / (1000 * 60 * 60 * 24);
    return daysSinceUsed >= COOLDOWN_DAYS;
  })
    .map((angle) => ({
      sourceId: id,
      topicKey: angle.key,
      key: angle.key,
      premise: angle.premise,
      lastUsedAt: lastUsedByKey.get(angle.key) ?? null,
    }))
    .sort((a, b) => {
      if (a.lastUsedAt === null && b.lastUsedAt !== null) return -1;
      if (a.lastUsedAt !== null && b.lastUsedAt === null) return 1;
      if (a.lastUsedAt === null && b.lastUsedAt === null) return 0;
      return new Date(a.lastUsedAt) - new Date(b.lastUsedAt);
    });
}

export async function recordUsage(key, usedAt) {
  const history = await readHistory();
  history.entries.push({ key, usedAt });
  await fs.mkdir(path.dirname(HISTORY_PATH), { recursive: true });
  await fs.writeFile(HISTORY_PATH, JSON.stringify(history, null, 2) + "\n");
}
