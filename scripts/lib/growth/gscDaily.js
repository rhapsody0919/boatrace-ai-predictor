/**
 * Search Console の日別の明細（query × page × date）を growth_gsc_daily の行にする（BOA-1706、hq 閉鎖 R2）。
 *
 * 公開のリポジトリの Actions で動くので、数字（クリック・表示・順位）をログに出さない。
 * ログに出してよいのは日付・行数・上限に当たったかだけ（logLine）。
 * 取得の口（fetchDay）は searchanalytics.query を持つ client を受け取り、ここでは認証しない。
 */

// API の1回の上限。これより少なく返ったら最後のページ
export const PAGE_SIZE = 25000;
// API が1日・1検索タイプあたりに返す行の上限（公式ドキュメントの記載）。1日分を取るので確かな目安になる
export const API_ROW_CAP = 50000;
// 毎回取り直す日数（目安・根拠なし）。GSC は2〜3日遅れて届き、確定まで数日かかる
export const WINDOW_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 太平洋時間（Search Console の日付）の今日 YYYY-MM-DD */
export function ptToday(now) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** PT の今日を除く直近 days 日（古い順）。今日は途中の日なので取らない */
export function windowDates(now, days = WINDOW_DAYS) {
  const today = ptToday(now);
  const base = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) =>
    new Date(base - (days - i) * DAY_MS).toISOString().slice(0, 10),
  );
}

/**
 * API の行（keys は [date, query, page] の順）を表の行にする。
 * 列の集合を全行で同じにする（PostgREST のバルク upsert でキーの集合が違う行を混ぜると NULL で上書きされる）
 */
export function toRows(apiRows, fetchedAt) {
  return apiRows.map((r) => {
    if (!Array.isArray(r.keys) || r.keys.length !== 3) {
      throw new Error("Search Console の行の keys が [date, query, page] でない");
    }
    const [date, query, page] = r.keys;
    return {
      date,
      query,
      page,
      clicks: Math.round(r.clicks ?? 0),
      impressions: Math.round(r.impressions ?? 0),
      position: Number(r.position ?? 0),
      fetched_at: fetchedAt,
    };
  });
}

/** 配列を size ごとに切る */
export function chunk(rows, size) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** その日の古い行を消してよいか。全部を取り切れた日だけ（上限に当たった日は消さない） */
export function canPrune(rowCount) {
  return rowCount > 0 && rowCount < API_ROW_CAP;
}

/** ログの1行。数字の値は出さない */
export function logLine(date, rowCount, pruned) {
  const cap = rowCount >= API_ROW_CAP ? "・上限に当たった" : "";
  return `${date}: ${rowCount}行${cap}${pruned ? "・古い行を消した" : ""}`;
}

/** 失敗の文。DB の制約違反の文は行の値を含む（Failing row contains）ので、code と頭だけにする */
export function safeError(err) {
  const code = err?.code ?? err?.status ?? "unknown";
  const head = String(err?.message ?? "").split(/[\n(:]/)[0].slice(0, 80);
  return `code=${code} ${head}`;
}

/** 1日分の query × page を全部取る */
export async function fetchDay(searchconsole, siteUrl, date) {
  const rows = [];
  for (;;) {
    const res = await searchconsole.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate: date,
        endDate: date,
        dimensions: ["date", "query", "page"],
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
