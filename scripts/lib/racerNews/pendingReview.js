// 選手ニュース自動収集の要確認リスト（保留中候補）の読み書き
// docs/design/racer-news-auto-collect/plan.md 1.3 / docs/adr/0024-racer-news-auto-publish-safety-net.md 参照
//
// 安全弁（一意性・整合性チェック）を通過しなかった候補はここに記録し、
// セッション開始時にユーザーへ提示して投入可否を確認する運用にする。

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PENDING_PATH = path.join(
  __dirname,
  "../../../data/analysis/racer-news-pending-review/pending.json",
);

function readAll() {
  if (!fs.existsSync(PENDING_PATH)) {
    return { items: [] };
  }
  const raw = fs.readFileSync(PENDING_PATH, "utf-8");
  if (!raw.trim()) return { items: [] };
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `${PENDING_PATH} の読み込みに失敗しました（JSON破損の可能性）: ${err.message}`,
    );
  }
}

function writeAll(data) {
  fs.mkdirSync(path.dirname(PENDING_PATH), { recursive: true });
  const tmpPath = `${PENDING_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmpPath, PENDING_PATH);
}

/**
 * 保留中（status: "pending"）の候補一覧を返す
 * @returns {Array<object>}
 */
export function listPending() {
  return readAll().items.filter((item) => item.status === "pending");
}

/**
 * 全候補（履歴含む）を返す
 * @returns {Array<object>}
 */
export function listAll() {
  return readAll().items;
}

/**
 * 同一sourceUrlの候補が既に記録済みか（statusを問わず）
 * @param {string} sourceUrl
 * @returns {boolean}
 */
export function hasItemForSourceUrl(sourceUrl) {
  return readAll().items.some((item) => item.sourceUrl === sourceUrl);
}

/**
 * 保留中候補を1件追加する
 * @param {{ id: string, source: "grade-announcement",
 *   reason: string, candidate: object, sourceUrl: string, sourceName?: string,
 *   detectedAt: string }} item
 */
export function addPendingItem(item) {
  const data = readAll();
  if (data.items.some((existing) => existing.id === item.id)) {
    throw new Error(`要確認リストに同一id=${item.id}が既に存在します`);
  }
  data.items.push({ ...item, status: "pending" });
  writeAll(data);
}

/**
 * 候補のstatusを更新する（承認/却下の反映）
 * @param {string} id
 * @param {"approved"|"rejected"} status
 */
export function updateStatus(id, status) {
  const data = readAll();
  const item = data.items.find((i) => i.id === id);
  if (!item) {
    throw new Error(`要確認リストにid=${id}の項目が見つかりません`);
  }
  item.status = status;
  writeAll(data);
}
