/**
 * URL Inspection（索引の状態）の取得の部品（SEO データの輪 PR5。設計 seo-data-loop-design §3.1・§5）。
 * 新記事の段「索引された → 表示 → クリック」の最初の段を、公開の D+1・D+3・D+7 に確かめる。
 * Google が選んだ canonical は、察知の判定木（decideAction の canonicalOk）の入力にもなる。
 * 公開のリポジトリの出力には、URL・日付・状態の名前だけを出す（数字の値は無い）。
 *
 * API の仕様（urlInspection.index.inspect の応答の形・1日2,000件・毎分600件の上限）は記憶による（未検証）。
 * 実装票の最初に公式文書で確かめる。上限は INSPECTION_LIMITS に置いた目安。
 */
import { safeError } from "./gscDaily.js";
import { isMissingTable } from "./gscPageDaily.js";
import { normalizePage } from "./seoDetect.js";

export const INSPECTION_TABLE = "growth_url_inspection";
export const CHECKPOINT_DAYS = Object.freeze([1, 3, 7]);
// 上限（記憶・未検証）。1回の実行の既定の件数はこれより十分小さくする（目安・根拠なし）
export const INSPECTION_LIMITS = Object.freeze({ perDay: 2000, perMinute: 600, defaultMax: 100 });

const DAY = 86400000;
const dayMs = (d) => Date.parse(`${d}T00:00:00Z`);

/** 今日までに来た確認の日のうち最後の物（例: 公開から5日 → "D+3"）。1つも来ていなければ null */
export function latestDueCheckpoint(publishDate, today) {
  const age = Math.round((dayMs(today) - dayMs(publishDate)) / DAY);
  const due = CHECKPOINT_DAYS.filter((d) => age >= d);
  return due.length > 0 ? `D+${due.at(-1)}` : null;
}

/**
 * これから確かめる (url, checkpoint)。遅れて来たときは、来ている確認のうち最後の1つだけ確かめる（古い確認を後追いしない）。
 * articles: [{ url, publishDate }]、done: 済みの [{ url, checkpoint }]
 */
export function pendingInspections(articles, done, today) {
  const doneKeys = new Set(done.map((d) => `${d.url} ${d.checkpoint}`));
  const out = [];
  for (const a of articles) {
    const checkpoint = latestDueCheckpoint(a.publishDate, today);
    if (checkpoint && !doneKeys.has(`${a.url} ${checkpoint}`)) out.push({ url: a.url, checkpoint });
  }
  return out;
}

/**
 * Google が選んだ canonical が、その URL 自身か。応答に googleCanonical が無ければ null（未確認。判定木は誤りとして扱わない）。
 * www と無印・末尾の / は同じとみなす（normalizePage）
 */
export function canonicalOk(url, googleCanonical) {
  if (!googleCanonical) return null;
  return normalizePage(googleCanonical) === normalizePage(url);
}

/** 応答（inspectionResult）を表の行にする。列の集合は全行で同じ（欠けた値は null） */
export function toInspectionRow({ url, checkpoint, inspectedOn, result, fetchedAt }) {
  const s = result?.indexStatusResult ?? {};
  return {
    url,
    inspected_on: inspectedOn,
    checkpoint,
    verdict: s.verdict ?? null,
    coverage_state: s.coverageState ?? null,
    indexing_state: s.indexingState ?? null,
    page_fetch_state: s.pageFetchState ?? null,
    robots_txt_state: s.robotsTxtState ?? null,
    google_canonical: s.googleCanonical ?? null,
    user_canonical: s.userCanonical ?? null,
    canonical_ok: canonicalOk(url, s.googleCanonical),
    last_crawl_time: s.lastCrawlTime ?? null,
    fetched_at: fetchedAt,
  };
}

/** 索引の状態を newArticleStage の indexStatus（"indexed"・"not_indexed"・"unknown"）にする。verdict が PASS なら索引済み */
export function indexStatusOf(row) {
  if (!row || !row.verdict || row.verdict === "VERDICT_UNSPECIFIED") return "unknown";
  return row.verdict === "PASS" ? "indexed" : "not_indexed";
}

/** 1 URL を検査する（読み取りの API。searchconsole は googleapis の client） */
export async function inspectUrl(searchconsole, siteUrl, url) {
  const res = await searchconsole.urlInspection.index.inspect({
    requestBody: { inspectionUrl: url, siteUrl, languageCode: "ja" },
  });
  return res.data.inspectionResult;
}

export function missingTableMessage() {
  return (
    `${INSPECTION_TABLE} が無い。docs/design/seo-data-loop/db-draft-url-inspection.md の SQL をオーナーの db-apply で適用してから回す` +
    "（それまで検査の結果は書かない）"
  );
}

/** 表があるか確かめる。他の失敗は握りつぶさず投げる */
export async function assertInspectionTableExists(db) {
  const { error } = await db.from(INSPECTION_TABLE).select("url").limit(1);
  if (!error) return;
  if (isMissingTable(error)) throw new Error(missingTableMessage());
  throw new Error(`${INSPECTION_TABLE} の確認の失敗: ${safeError(error)}`);
}

/** 行を書く。主キー (url, inspected_on) の upsert なので、同じ日に回し直しても二重にならない */
export async function writeInspections(db, rows) {
  if (rows.length === 0) return;
  const { error } = await db.from(INSPECTION_TABLE).upsert(rows, { onConflict: "url,inspected_on" });
  if (!error) return;
  if (isMissingTable(error)) throw new Error(missingTableMessage());
  throw new Error(`${INSPECTION_TABLE} の upsert の失敗: ${safeError(error)}`);
}

/** 済みの確認（url, checkpoint）を読む。1000行で切れないよう URL を分けて読む */
export async function readDoneInspections(db, urls) {
  const out = [];
  for (let i = 0; i < urls.length; i += 100) {
    const { data, error } = await db.from(INSPECTION_TABLE).select("url,checkpoint").in("url", urls.slice(i, i + 100));
    if (error) throw new Error(`${INSPECTION_TABLE} の読みの失敗: ${safeError(error)}`);
    out.push(...data);
  }
  return out;
}
