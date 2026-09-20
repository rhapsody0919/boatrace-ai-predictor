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

// ---------------------------------------------------------------------------
// 保存先の抽象（ストア）。上の関数は、従来のファイル（pending.json）用で、同期のまま残す
// （GitHub Actions の collect-racer-news.yml が、移行が終わるまで使う）。
// Vercel Function（scripts/lib/racerNewsJob.js）は、ファイルシステム・git push に頼れないため、
// DBの表 racer_news_pending（docs/db-migration/080_racer_news_pending.sql）のストアを使う（T4b-15）。
// どちらのストアも、同じインターフェース（全て非同期）:
//   listPending() / listAll() / hasItemForSourceUrl(sourceUrl) / addPendingItem(item) / updateStatus(id, status)
// ---------------------------------------------------------------------------

/** 従来のファイル（pending.json）のストア */
export function createFilePendingStore() {
  return {
    listPending: async () => listPending(),
    listAll: async () => listAll(),
    hasItemForSourceUrl: async (sourceUrl) => hasItemForSourceUrl(sourceUrl),
    addPendingItem: async (item) => addPendingItem(item),
    updateStatus: async (id, status) => updateStatus(id, status),
  };
}

const TABLE = "racer_news_pending";

const rowToItem = (row) => ({
  id: row.id,
  source: row.source,
  reason: row.reason,
  candidate: row.candidate,
  sourceUrl: row.source_url,
  sourceName: row.source_name ?? undefined,
  detectedAt: row.detected_at,
  status: row.status,
});

/**
 * DBの表 racer_news_pending のストア
 * @param {import("@supabase/supabase-js").SupabaseClient} client service_role のクライアント
 */
export function createDbPendingStore(client) {
  const fail = (what, error) => {
    throw new Error(
      `要確認リスト（${TABLE}）の${what}に失敗しました: ${error.message}`,
    );
  };
  const listWhere = async (status) => {
    let query = client
      .from(TABLE)
      .select("*")
      .order("detected_at", { ascending: true })
      .order("id", { ascending: true });
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) fail("取得", error);
    return (data ?? []).map(rowToItem);
  };
  return {
    listAll: () => listWhere(null),
    listPending: () => listWhere("pending"),
    async hasItemForSourceUrl(sourceUrl) {
      const { data, error } = await client
        .from(TABLE)
        .select("id")
        .eq("source_url", sourceUrl)
        .limit(1);
      if (error) fail("重複の確認", error);
      return (data ?? []).length > 0;
    },
    async addPendingItem(item) {
      // 同じ id が既にあれば何もしない（従来は例外。DBでは、二重の起動（補足の起動・並走）で壊れないよう冪等にする）
      const { error } = await client.from(TABLE).upsert(
        {
          id: item.id,
          source: item.source,
          reason: item.reason,
          candidate: item.candidate,
          source_url: item.sourceUrl,
          source_name: item.sourceName ?? null,
          detected_at: item.detectedAt,
          status: "pending",
        },
        { onConflict: "id", ignoreDuplicates: true },
      );
      if (error) fail("追加", error);
    },
    async updateStatus(id, status) {
      const { data, error } = await client
        .from(TABLE)
        .update({ status, resolved_at: new Date().toISOString() })
        .eq("id", id)
        .select("id");
      if (error) fail("更新", error);
      if (!data || data.length === 0) {
        throw new Error(`要確認リストにid=${id}の項目が見つかりません`);
      }
    },
  };
}

/**
 * 複数のストアの一覧を、id で統合する（先のリストが優先）。移行期間の、DB（Vercel）と pending.json
 * （GitHub Actions）の両方の未確認を、二重に数えずに読むために使う（session-start-check.js）。
 * @param {...Array<{id: string, status: string}>} lists 優先度の高い順
 */
export function mergePendingLists(...lists) {
  const byId = new Map();
  for (const list of lists) {
    for (const item of list) if (!byId.has(item.id)) byId.set(item.id, item);
  }
  return [...byId.values()];
}
