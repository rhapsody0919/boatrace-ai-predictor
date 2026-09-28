/**
 * テストごとに録画した HAR を1本に束ねる（純関数。global-teardown から使う）。
 *
 * - routeFromHAR は「メソッド + URL（+ POST本文）」で応答を引くので、その組を
 *   キーに重複を落とす。同じキーが複数あれば最も早く録画されたものを残す
 *   （録画中にデータが更新されても、録画時刻に近い方を正とする）。
 *   ただし5xxより成功した応答を、本文が欠けたものより完全なものを優先する
 * - ローカルdevサーバーのポートはworktreeごとに変わる（playwright.config.js）ため、
 *   URLの `http://localhost:NNNN` を LOCAL_ORIGIN_PLACEHOLDER に置き換えて保存し、
 *   再生時に実際の baseURL へ戻す
 * - リクエストヘッダー（apikey・Authorization を含む）は保存しない。routeFromHAR は
 *   ヘッダーを同点時の優先度にしか使わず、重複を落とした後は判定に使われない
 * - エントリはキー順に並べ、撮り直したときの差分を読めるようにする
 */

export const LOCAL_ORIGIN_PLACEHOLDER = "http://localhost:0";

const LOCAL_ORIGIN = /^http:\/\/localhost:\d+/;
// 本文は展開済みで保存されるため、圧縮・長さのヘッダーは実体と食い違う
export const DROP_RESPONSE_HEADERS = new Set([
  "set-cookie",
  "date",
  "cf-ray",
  "age",
  "content-encoding",
  "content-length",
  "transfer-encoding",
  // 撮り直すたびに変わるだけで再生に意味の無いもの（差分を読めるように落とす）
  "x-vercel-id",
  "x-vercel-cache",
  "sb-request-id",
  "x-envoy-upstream-service-time",
  "x-envoy-attempt-count",
  "cf-cache-status",
  "alt-svc",
  "connection",
]);

const IN_LIST = /^(not\.)?in\.\((.*)\)$/;

/**
 * PostgREST の `in.(a,b,c)` の並びを揃えた URL を返す（変わらなければ元の文字列のまま）。
 *
 * フロントは race_id の一覧を、非同期に返ってきた応答の順で組み立てる箇所があり、
 * 同じ画面でも実行ごとに並びが変わる（実測: race_entries の global_2rate 取得）。
 * 並びは結果の集合に影響しない（順序は order= が決める）ので、録画・再生の両側で
 * 並べ替えてから突き合わせる。値に引用符を含むもの（カンマを含みうる）は触らない
 */
export function canonicalUrl(url) {
  const parsed = new URL(url);
  let changed = false;
  for (const [name, value] of [...parsed.searchParams.entries()]) {
    const m = value.match(IN_LIST);
    if (!m || m[2].includes('"')) continue;
    const sorted = `${m[1] ?? ""}in.(${m[2].split(",").sort().join(",")})`;
    if (sorted !== value) {
      // 同名パラメータが複数あっても、並べ替えるのは該当の値だけ
      const all = parsed.searchParams.getAll(name);
      parsed.searchParams.delete(name);
      for (const v of all)
        parsed.searchParams.append(name, v === value ? sorted : v);
      changed = true;
    }
  }
  return changed ? parsed.href : url;
}

/** routeFromHAR が応答を引く組（メソッド + URL + POST本文） */
export const harKey = (method, url, postData) =>
  `${method} ${url} ${postData ?? ""}`;

const NO_BODY_STATUS = new Set([204, 205, 304]);
const hasBody = (e) =>
  e.response.content?.text !== undefined ||
  e.request.method === "HEAD" ||
  NO_BODY_STATUS.has(e.response.status);

const entryKey = (e) =>
  harKey(e.request.method, e.request.url, e.request.postData?.text);

export function mergeHarLogs(logs) {
  const all = logs
    .flatMap((log) => log.entries ?? [])
    .map((e) => ({
      ...e,
      request: {
        ...e.request,
        url: canonicalUrl(
          e.request.url.replace(LOCAL_ORIGIN, LOCAL_ORIGIN_PLACEHOLDER),
        ),
      },
    }))
    .sort((a, b) =>
      String(a.startedDateTime).localeCompare(String(b.startedDateTime)),
    );

  const byKey = new Map();
  let duplicates = 0;
  let skippedFailed = 0;
  for (const e of all) {
    // 録画中に失敗した応答（中断・ネットワークエラー）と、本文を取り切る前に
    // テストが終わって context が閉じた応答（本文が空で残る。実測で26件）は残さない。
    // 同じキーの別の録画に完全なものがあればそれを使い、無ければ録画に無い扱い
    // （再生時は abort ＝録画時と同じく応答が来ない）になる
    if (!e.response || e.response.status <= 0 || !hasBody(e)) {
      skippedFailed++;
      continue;
    }
    const key = entryKey(e);
    const kept = byKey.get(key);
    if (kept) {
      duplicates++;
      // 本番DBの一時的な失敗（statement timeout の500等）を録画に固定しない。
      // 同じキーに成功した応答があれば、そちらを正とする
      if (kept.response.status >= 500 && e.response.status < 500) {
        byKey.set(key, normalizeEntry(e));
      }
      continue;
    }
    byKey.set(key, normalizeEntry(e));
  }

  const entries = [...byKey.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, e]) => e);

  const supabaseOrigin =
    entries
      .map((e) => new URL(e.request.url))
      .find((u) => u.hostname.endsWith(".supabase.co"))?.origin ?? null;

  const creator = logs.find((l) => l.creator)?.creator ?? {
    name: "boatai-e2e",
    version: "1",
  };

  return {
    har: { log: { version: "1.2", creator, entries } },
    supabaseOrigin,
    stats: { unique: entries.length, duplicates, skippedFailed },
  };
}

function normalizeEntry(e) {
  const request = {
    method: e.request.method,
    url: e.request.url,
    httpVersion: e.request.httpVersion ?? "HTTP/1.1",
    cookies: [],
    headers: [],
    queryString: [],
    headersSize: -1,
    bodySize: -1,
  };
  if (e.request.postData) request.postData = e.request.postData;

  const response = {
    ...e.response,
    cookies: [],
    headers: (e.response.headers ?? [])
      .filter((h) => !DROP_RESPONSE_HEADERS.has(h.name.toLowerCase()))
      .map((h) =>
        // 録画したオリジン（localhost:ポート）がそのまま残るとCORSで弾かれる
        h.name.toLowerCase() === "access-control-allow-origin"
          ? { ...h, value: "*" }
          : h,
      ),
  };

  return {
    startedDateTime: e.startedDateTime,
    time: 0,
    request,
    response,
    cache: {},
    timings: { send: -1, wait: -1, receive: -1 },
  };
}
