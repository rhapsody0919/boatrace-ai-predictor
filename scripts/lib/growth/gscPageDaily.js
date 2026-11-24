/**
 * Search Console の date × page だけの取得（匿名化された語も入るページの合計）と、補充（バックフィル）の道具
 * （SEO データの輪 PR2。設計: docs/design/seo-data-loop/db-draft.md）。
 *
 * growth_gsc_daily（date × query × page）は匿名化された語が返らず、ページの合計がサイトの実際より小さくなる。
 * query を付けない date × page は匿名の語も含むので、記事の効き（ページの総クリック・表示）の物差しはこちらで取る。
 * 公開のリポジトリの Actions・窓口の端末で動くので、数字（クリック・表示・順位）をログに出さない。
 */
import { PAGE_SIZE, canPrune, chunk, safeError } from "./gscDaily.js";

export const PAGE_TABLE = "growth_gsc_page_daily";
// GSC の検索の保持の起点（設計 2026-11-24。「16か月」は誤りで、この日から取れる）
export const BACKFILL_START = "2025-12-21";

const DAY_MS = 24 * 60 * 60 * 1000;
const UPSERT_CHUNK = 1000;

/** 1日分の date × page を全部取る（query を付けないので匿名の語も合計に入る） */
export async function fetchPageDay(searchconsole, siteUrl, date) {
  const rows = [];
  for (;;) {
    const res = await searchconsole.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate: date,
        endDate: date,
        dimensions: ["date", "page"],
        type: "web",
        dataState: "all",
        rowLimit: PAGE_SIZE,
        startRow: rows.length,
      },
    });
    const batch = res.data.rows ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
}

/** API の行（keys は [date, page]）を表の行にする。列の集合は全行で同じ（NULL で上書きされない） */
export function toPageRows(apiRows, fetchedAt) {
  return apiRows.map((r) => {
    if (!Array.isArray(r.keys) || r.keys.length !== 2) {
      throw new Error("Search Console の行の keys が [date, page] でない");
    }
    const [date, page] = r.keys;
    return {
      date,
      page,
      clicks: Math.round(r.clicks ?? 0),
      impressions: Math.round(r.impressions ?? 0),
      position: Number(r.position ?? 0),
      fetched_at: fetchedAt,
    };
  });
}

/** 表が無いときの PostgREST・Postgres のコード（PGRST205 = schema cache に無い、42P01 = relation が無い） */
export function isMissingTable(err) {
  return err?.code === "PGRST205" || err?.code === "42P01";
}

/** 表が無い間は、何を適用するかを書いて止まる（既存の取得は別の経路なので巻き込まない） */
export function missingTableMessage() {
  return (
    `${PAGE_TABLE} が無い。docs/design/seo-data-loop/db-draft.md の SQL をオーナーの db-apply で適用してから回す` +
    "（それまで date × page は書かない。growth_gsc_daily の取得は影響を受けない）"
  );
}

/** 表があるか確かめる（0行を読むだけ）。他の失敗は握りつぶさず投げる */
export async function assertPageTableExists(db) {
  const { error } = await db.from(PAGE_TABLE).select("date").limit(1);
  if (!error) return;
  if (isMissingTable(error)) throw new Error(missingTableMessage());
  throw new Error(`${PAGE_TABLE} の確認の失敗: ${safeError(error)}`);
}

/**
 * 1日分の date × page を書く。upsert で再実行しても二重にならない。
 * 全部を取り切れた日だけ、今回より古い fetched_at の行（今回の取得に無いページ）を消す
 */
export async function writePageDay(db, date, rows, fetchedAt) {
  for (const part of chunk(rows, UPSERT_CHUNK)) {
    const { error } = await db.from(PAGE_TABLE).upsert(part, { onConflict: "date,page" });
    if (error) {
      if (isMissingTable(error)) throw new Error(missingTableMessage());
      throw new Error(`upsert の失敗（${date}）: ${safeError(error)}`);
    }
  }
  if (!canPrune(rows.length)) return false;
  const { error } = await db.from(PAGE_TABLE).delete().eq("date", date).lt("fetched_at", fetchedAt);
  if (error) throw new Error(`古い行の削除の失敗（${date}）: ${safeError(error)}`);
  return true;
}

/** from〜to（両端を含む。YYYY-MM-DD）の日付を古い順に。from が to より後なら空 */
export function dateRange(from, to) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error(`日付は YYYY-MM-DD で指定する（from=${from}・to=${to}）`);
  }
  const out = [];
  for (let t = start; t <= end; t += DAY_MS) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/**
 * 補充の引数。--from（既定 BACKFILL_START）・--to（既定は呼び出し側が PT の昨日を渡す）・
 * --tables query,page（既定は両方）・--dry-run（取るだけで DB に触れない）
 */
export function parseBackfillArgs(argv, defaultTo) {
  const opts = { from: BACKFILL_START, to: defaultTo, tables: ["query", "page"], dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--from" || a === "--to" || a === "--tables") {
      const v = argv[++i];
      if (!v) throw new Error(`${a} の値が無い`);
      if (a === "--tables") opts.tables = v.split(",");
      else opts[a.slice(2)] = v;
    } else throw new Error(`知らない引数: ${a}（--from・--to・--tables query,page・--dry-run）`);
  }
  const bad = opts.tables.filter((t) => !["query", "page"].includes(t));
  if (bad.length > 0 || opts.tables.length === 0) {
    throw new Error(`--tables は query・page のコンマ区切り（${bad.join("・") || "空"}）`);
  }
  if (opts.from < BACKFILL_START) {
    throw new Error(`--from は ${BACKFILL_START} 以降（Search Console が持つ範囲）`);
  }
  return opts;
}

/** 取った全日が0行か（取れた日が1日も無いときは false。鍵・プロパティの誤りの検出） */
export function allDaysEmpty(counts) {
  return counts.length > 0 && counts.every((n) => n === 0);
}

