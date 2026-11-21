/**
 * アナロジー・ファインダー v16 の読み書きの共通部品（BOA-271 tasks T5-1・T4-3。plan「API」「展示後の段」）。
 *
 * snapshot（analogy_v16_snapshots）からその時点の run_id を引き、Storage の非公開のバケット analogy-v16 の
 * `{日付}/{run_id}/{種類}/{名前}.json.gz` を service key で読む。facts・similar・scenario・layer の4本の API と、
 * 展示後の段の Cron（scripts/lib/analogyV16Exhibition.js）が使う。fetch と DecompressionStream だけを使うので、
 * Edge・Node のどちらでも動く。
 *
 * api/_lib/analogyV16.js から Storage・PostgREST の部品を字のまま下ろした物（scripts/lib から api/ を読まない、lib-no-entry）。
 * api/_lib/analogyV16.js が同じ名で再 export する。
 */

export const BUCKET = "analogy-v16";

export class UpstreamError extends Error {}

function env() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key)
    throw new UpstreamError("SUPABASE_URL・SUPABASE_SERVICE_KEY が未設定");
  return { url: url.replace(/\/$/, ""), key };
}

const authHeaders = (key) => ({ apikey: key, Authorization: `Bearer ${key}` });

/** PostgREST（service key）。失敗は UpstreamError */
export async function rest(path, { method = "GET", body, prefer } = {}) {
  const { url, key } = env();
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      ...authHeaders(key),
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok)
    throw new UpstreamError(
      `${method} ${path.split("?")[0]}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`,
    );
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** `{日付}/{run_id}/{種類}/{名前}.json.gz` */
export function objectPath(raceId, runId, kind, name) {
  return `${raceId.slice(0, 10)}/${runId}/${kind}/${name}.json.gz`;
}

async function gunzipJson(res) {
  const stream = res.body.pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text());
}

// 過去の日付の物は不変（パスに実行ID が入り上書きしない、ADR-0085 決定3）なので、関数のメモリに置いて
// Storage の読み（Egress）を減らす。当日・未来の日付と日付で始まらないパスは置かない。無い（null）も置かない
const MEMORY_MAX = 48;
const memory = new Map();

/** 今日（JST）の日付 YYYY-MM-DD */
const jstDate = (nowMs) =>
  new Date(nowMs + 9 * 3600_000).toISOString().slice(0, 10);

/** パスが過去の日付（JST の今日より前）で始まるか。不変とみなしてよい物 */
export function isPastPath(path, nowMs = Date.now()) {
  const m = /^(\d{4}-\d{2}-\d{2})\//.exec(path);
  return m !== null && m[1] < jstDate(nowMs);
}

/** Storage の gzip の JSON。無ければ null（404・400 は Storage の「無い」）。過去の日付の物は関数のメモリに置く */
export async function readObject(path) {
  const cacheable = isPastPath(path);
  if (cacheable && memory.has(path)) {
    const hit = memory.get(path);
    memory.delete(path);
    memory.set(path, hit); // 新しい順に並べ直す（LRU）
    return hit;
  }
  const obj = await fetchObject(path);
  if (cacheable && obj !== null) {
    memory.set(path, obj);
    if (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value);
  }
  return obj;
}

/** 試験用: 関数のメモリを空にする */
export function clearObjectMemory() {
  memory.clear();
}

async function fetchObject(path) {
  const { url, key } = env();
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, {
    headers: authHeaders(key),
  });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new UpstreamError(`storage ${path}: HTTP ${res.status}`);
  return gunzipJson(res);
}

/** Storage に gzip の JSON を置く。既定は上書きしない（同じパスがあれば失敗）。upsert は夜の確認の容量の控えだけ */
export async function writeObject(path, obj, { upsert = false } = {}) {
  const { url, key } = env();
  const gz = await new Response(
    new Blob([JSON.stringify(obj)])
      .stream()
      .pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer();
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      ...authHeaders(key),
      "Content-Type": "application/gzip",
      "x-upsert": String(upsert),
    },
    body: gz,
  });
  if (!res.ok)
    throw new UpstreamError(
      `storage 書き込み ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`,
    );
}

/** 締切（races.start_time は出走表の締切予定時刻、JST）。無ければ null */
export function deadlineOf(race) {
  if (!race?.start_time || !race?.race_date) return null;
  return new Date(`${race.race_date}T${race.start_time}+09:00`);
}

/** Storage の prefix の直下（フォルダは id が null の行）。bucket は夜の確認が全バケットの容量を数えるときだけ渡す */
export async function listObjects(prefix, bucket = BUCKET) {
  const { url, key } = env();
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers: { ...authHeaders(key), "Content-Type": "application/json" },
      body: JSON.stringify({ prefix, limit: 1000, offset }),
    });
    if (!res.ok)
      throw new UpstreamError(`storage list ${prefix}: HTTP ${res.status}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

/** Storage のバケットの id の一覧（夜の確認が容量を数える） */
export async function listBuckets() {
  const { url, key } = env();
  const res = await fetch(`${url}/storage/v1/bucket`, {
    headers: authHeaders(key),
  });
  if (!res.ok)
    throw new UpstreamError(`storage bucket 一覧: HTTP ${res.status}`);
  return (await res.json()).map((b) => b.id);
}

/** Storage のファイルを消す（パスの配列） */
export async function deleteObjects(paths) {
  if (paths.length === 0) return;
  const { url, key } = env();
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}`, {
    method: "DELETE",
    headers: { ...authHeaders(key), "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: paths }),
  });
  if (!res.ok) throw new UpstreamError(`storage delete: HTTP ${res.status}`);
}
