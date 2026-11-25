/**
 * sitemap.xml から URL Inspection の検査の一覧を作る純関数（コアアップデートからの回復 打ち手 D、索引の数を毎日測る）。
 * - レース詳細（/race/YYYY-MM-DD-会場2桁-R2桁）は標本: 各会場の 1R・6R・12R だけ。公開日は race_id の日付で、D+1・D+3・D+7 を見る。
 *   標本の根拠（目安・根拠なし）: 1日の呼び数を API の上限（INSPECTION_LIMITS.perDay＝2,000）の1割強に抑える。新しい標本は1日に最大24会場×3＝72件
 * - それ以外の ja のページ（/en/・/ko/・/zh-TW/ 以外）は週1回の 'weekly'。直近7日に weekly の行が無い URL だけ（曜日に依らない）
 * - 1日の上限の中では、レース詳細を先、weekly を後（weekly は一度も見ていない URL → 最後の確認が古い順）
 * 時計は引数の today（YYYY-MM-DD）で受け取り、壁の時計に触れない。
 */
import { INSPECTION_TABLE, pendingInspections } from "./urlInspection.js";

export const SAMPLE_RACE_NUMBERS = Object.freeze([1, 6, 12]);
export const WEEKLY_INTERVAL_DAYS = 7;
export const WEEKLY_CHECKPOINT = "weekly";
const NON_JA_PREFIX = /^\/(en|ko|zh-TW)(\/|$)/;
const RACE_PATH = /^\/race\/(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})$/;
const DAY = 86400000;
const dayMs = (d) => Date.parse(`${d}T00:00:00Z`);
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** sitemap.xml の本文から <loc> を重複なく、現れる順に取る */
export function parseSitemapLocs(xml) {
  return [...new Set([...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]))];
}

/** 検査の対象を {races:[{url,publishDate}], weekly:[url]} に分ける。レースは標本だけ。ja 以外は除く */
export function buildInspectionTargets(xml) {
  const races = [];
  const weekly = [];
  for (const url of parseSitemapLocs(xml)) {
    const path = new URL(url).pathname;
    if (NON_JA_PREFIX.test(path)) continue;
    const m = RACE_PATH.exec(path);
    if (m) {
      if (SAMPLE_RACE_NUMBERS.includes(Number(m[3]))) races.push({ url, publishDate: m[1] });
    } else if (!path.startsWith("/race/")) {
      weekly.push(url);
    }
  }
  return { races, weekly };
}

/**
 * weekly の対象のうち、最後の weekly から7日以上（または一度も無い）URL。一度も無い物が先、次に古い順、同じなら URL 順。
 * lastWeekly: [{ url, inspected_on }]（同じ URL の行が複数あれば最新を使う）
 */
export function dueWeekly(urls, lastWeekly, today) {
  const last = new Map();
  for (const r of lastWeekly) if (!last.has(r.url) || r.inspected_on > last.get(r.url)) last.set(r.url, r.inspected_on);
  const age = (u) => (last.has(u) ? Math.round((dayMs(today) - dayMs(last.get(u))) / DAY) : Infinity);
  return urls.filter((u) => age(u) >= WEEKLY_INTERVAL_DAYS).sort((a, b) => age(b) - age(a) || byText(a, b));
}

/** 今日の検査の一覧。レース詳細（公開日の新しい順）→ weekly の順に並べ、max で切る */
export function planSitemapInspections({ xml, done, lastWeekly, today, max }) {
  const { races, weekly } = buildInspectionTargets(xml);
  const dateOf = new Map(races.map((r) => [r.url, r.publishDate]));
  const raceTodo = pendingInspections(races, done, today).sort(
    (a, b) => byText(dateOf.get(b.url), dateOf.get(a.url)) || byText(a.url, b.url),
  );
  const weeklyTodo = dueWeekly(weekly, lastWeekly, today).map((url) => ({ url, checkpoint: WEEKLY_CHECKPOINT }));
  return [...raceTodo, ...weeklyTodo].slice(0, max);
}

/** 直近の weekly の行を読む。直近7日（today を含む）だけ読めば足りる＝100 URL ごとに最大700行で、1000行の上限に当たらない */
export async function readRecentWeekly(db, urls, today) {
  const since = new Date(dayMs(today) - (WEEKLY_INTERVAL_DAYS - 1) * DAY).toISOString().slice(0, 10);
  const out = [];
  for (let i = 0; i < urls.length; i += 100) {
    const { data, error } = await db
      .from(INSPECTION_TABLE)
      .select("url,inspected_on")
      .eq("checkpoint", WEEKLY_CHECKPOINT)
      .gte("inspected_on", since)
      .in("url", urls.slice(i, i + 100));
    if (error) throw new Error(`${INSPECTION_TABLE} の weekly の読みの失敗: ${error.message ?? "unknown"}`);
    out.push(...data);
  }
  return out;
}

export const WRITE_BATCH_SIZE = 50;

/**
 * todo を順に検査し、成功の行を size 件たまるごとに write する（途中で切れても済んだ分は残り、翌日の回は済みを飛ばす）。
 * inspectOne(t) は行を返す。1件が落ちても他は続け、落ちた URL を返す。write の失敗は握りつぶさず投げる
 */
export async function inspectInBatches(todo, inspectOne, write, size = WRITE_BATCH_SIZE, onError = () => {}) {
  let rows = [];
  const failed = [];
  for (const t of todo) {
    try {
      rows.push(await inspectOne(t));
    } catch (err) {
      failed.push(t.url);
      onError(t, err);
    }
    if (rows.length >= size) {
      await write(rows);
      rows = [];
    }
  }
  if (rows.length > 0) await write(rows);
  return { failed };
}
