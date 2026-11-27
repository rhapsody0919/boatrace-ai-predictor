/**
 * URL 検査（索引の状態・Google が選んだ正規ページ）を手元の JSON に取る部品（google-detail-collect.js が使う。Supabase に繋がない）。
 * 対象は記事と主要ページ（sitemap のレース詳細以外の ja を週1回。選び方は sitemapInspection.js の dueWeekly）。
 * レース詳細の標本は growth-gsc-daily.yml（Supabase）が見る。手元で見ると1日に最大約216件（72件×D+1・D+3・D+7）で上限を食い、記事が回らない。
 * 済みの記録は Supabase でなく、前の日の url_inspection.json（URL ごとの最新の1行の写し）から作る。
 * 写しは日ごとに作り直し、各日の置き場だけで「今わかっている最新の状態」が読める（seo-morning-sheet --local-dir が読む）。
 * 割り当て（1日2,000件・記憶で未検証）は Actions の版（最大300）と分け合う。手元の既定は200（目安・根拠なし）。
 */
import fs from "node:fs";
import path from "node:path";
import { WEEKLY_CHECKPOINT, buildInspectionTargets, dueWeekly, inspectInBatches } from "./sitemapInspection.js";
import { normalizePage } from "./seoDetect.js";
import { inspectUrl, toInspectionRow } from "./urlInspection.js";

export const LOCAL_INSPECTION = Object.freeze({ defaultMax: 200, keepDays: 35, lookbackDays: 14 });

const DAY = 86400000;
const dayMs = (d) => Date.parse(`${d}T00:00:00Z`);

/** 今日の検査の一覧（sitemap.xml の本文・前の写し・今日・上限）。一度も見ていない URL → 最後の検査が古い順 */
export function planLocalInspections({ xml, prevRows, today, max = LOCAL_INSPECTION.defaultMax }) {
  const { weekly } = buildInspectionTargets(xml);
  return dueWeekly(weekly, prevRows, today)
    .slice(0, max)
    .map((url) => ({ url, checkpoint: WEEKLY_CHECKPOINT }));
}

/** 前の写しに今日の行を重ね、URL ごとに最新の1行を残す。keepDays より古い行は落とす。URL の順 */
export function mergeSnapshot(prevRows, newRows, today, keepDays = LOCAL_INSPECTION.keepDays) {
  const since = new Date(dayMs(today) - (keepDays - 1) * DAY).toISOString().slice(0, 10);
  const latest = new Map();
  for (const r of [...prevRows, ...newRows]) {
    const cur = latest.get(r.url);
    if (!cur || r.inspected_on >= cur.inspected_on) latest.set(r.url, r);
  }
  return [...latest.values()].filter((r) => r.inspected_on >= since).sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
}

/** 前の写しを探す日付（today の前の日から lookbackDays 日、新しい順） */
export function previousDates(today, lookbackDays = LOCAL_INSPECTION.lookbackDays) {
  return Array.from({ length: lookbackDays }, (_, i) => new Date(dayMs(today) - (i + 1) * DAY).toISOString().slice(0, 10));
}

/**
 * Google が選んだ正規ページが、指定した正規ページ（userCanonical。無ければその URL 自身）と違う行。
 * Search Console の「重複しています。Google により、ユーザーがマークしたページとは異なるページが正規ページとして選択されました」の型。
 * googleCanonical が無い行は未確認なので出さない
 */
export function canonicalMismatches(rows) {
  return rows
    .filter((r) => r.google_canonical && normalizePage(r.google_canonical) !== normalizePage(r.user_canonical ?? r.url))
    .map((r) => ({ url: r.url, googleCanonical: r.google_canonical, userCanonical: r.user_canonical, coverageState: r.coverage_state, inspectedOn: r.inspected_on }));
}

/** outDir の前の日の置き場から、いちばん新しい url_inspection.json の行。無ければ []（初回） */
export function readPreviousSnapshot(outDir, today) {
  for (const d of previousDates(today)) {
    const file = path.join(outDir, d, "url_inspection.json");
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")).rows;
  }
  return [];
}

/**
 * 今日の分を検査し、url_inspection.json の中身（{ meta, rows: 写し }）を返す。1件の失敗は数えて続ける（翌日に済みでない分を取り直す）。
 * 全部が落ちたら投げる（権限・割り当ての誤りを「検査なし」にしない）。xml は sitemap.xml の本文、prevRows は readPreviousSnapshot の行
 */
export async function collectInspections(sc, { siteUrl, xml, prevRows, max = LOCAL_INSPECTION.defaultMax }, today, now) {
  const todo = planLocalInspections({ xml, prevRows, today, max });
  const fresh = [];
  const errors = [];
  const { failed } = await inspectInBatches(
    todo,
    async (t) => toInspectionRow({ ...t, inspectedOn: today, result: await inspectUrl(sc, siteUrl, t.url), fetchedAt: new Date().toISOString() }),
    async (rows) => fresh.push(...rows),
    50,
    (t, err) => errors.push(err?.response?.status ?? err?.code ?? "unknown"),
  );
  if (todo.length > 0 && failed.length === todo.length) throw new Error(`URL 検査が全部落ちた（${todo.length}件、例 ${errors[0]}）`);
  const rows = mergeSnapshot(prevRows, fresh, today);
  const meta = { inspected_on: today, collected_at: now.toISOString(), site: siteUrl, planned: todo.length, inspected: fresh.length, failed: failed.length };
  return { meta, rows };
}
