/**
 * アナロジー・ファインダー v16 の読み書きの共通部品（BOA-271 tasks T5-1・T4-3。plan「API」「展示後の段」）。
 *
 * snapshot（analogy_v16_snapshots）からその時点の run_id を引き、Storage の非公開のバケット analogy-v16 の
 * `{日付}/{run_id}/{種類}/{名前}.json.gz` を service key で読む。facts・similar・scenario・layer の4本の API と、
 * 展示後の段の Cron（scripts/lib/analogyV16Exhibition.js）が使う。fetch と DecompressionStream だけを使うので、
 * Edge・Node のどちらでも動く。
 */

export const BUCKET = "analogy-v16";
export const STAGES = ["racecard", "exhibition"];
const RACE_ID = /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/;

export class UpstreamError extends Error {}

export function isRaceId(v) {
  return typeof v === "string" && RACE_ID.test(v);
}

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

/** Storage の gzip の JSON。無ければ null（404・400 は Storage の「無い」） */
export async function readObject(path) {
  const { url, key } = env();
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, {
    headers: authHeaders(key),
  });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new UpstreamError(`storage ${path}: HTTP ${res.status}`);
  return gunzipJson(res);
}

/** Storage に gzip の JSON を置く。上書きしない（同じパスがあれば失敗） */
export async function writeObject(path, obj) {
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
      "x-upsert": "false",
    },
    body: gz,
  });
  if (!res.ok)
    throw new UpstreamError(
      `storage 書き込み ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`,
    );
}

/** レースの snapshot（racecard・exhibition）と、状態の判定に要るレースの情報 */
export async function loadRaceState(raceId) {
  const id = encodeURIComponent(raceId);
  const [snaps, races, exh, entries] = await Promise.all([
    rest(
      `analogy_v16_snapshots?race_id=eq.${id}&select=stage,run_id,status,exact,n_layer,pool_cutoff,model_version,computed_at`,
    ),
    rest(`races?race_id=eq.${id}&select=race_date,start_time,venue_code`),
    rest(
      `exhibition_data?race_id=eq.${id}&select=boat_number,exhibition_time,is_absent`,
    ),
    rest(`race_entries?race_id=eq.${id}&select=boat_number,is_absent`),
  ]);
  const byStage = Object.fromEntries(snaps.map((s) => [s.stage, s]));
  const race = races[0] ?? null;
  return {
    racecard: byStage.racecard ?? null,
    exhibition: byStage.exhibition ?? null,
    race,
    exhibitionRows: exh,
    absent: exh.some((r) => r.is_absent) || entries.some((r) => r.is_absent),
    sixExhibition:
      exh.filter((r) => r.exhibition_time !== null && !r.is_absent).length ===
      6,
  };
}

/** 締切（races.start_time は出走表の締切予定時刻、JST）。無ければ null */
export function deadlineOf(race) {
  if (!race?.start_time || !race?.race_date) return null;
  return new Date(`${race.race_date}T${race.start_time}+09:00`);
}

/**
 * 欠場が分かったか（spec「時点」Q5）。展示後の段が absent を書いたレースに加え、展示後の段を ok で書いた後や、
 * 締切後（展示後の段が書かない）に欠場が分かったレースも含める（6艇の値・類似レースはそのままでは使えない）
 */
export const isAbsent = (s) => s.exhibition?.status === "absent" || !!s.absent;

/**
 * 画面の状態（plan「API」の status の表。画面は時刻で判定しない）
 * @param {{racecard: object|null, exhibition: object|null, sixExhibition: boolean, absent?: boolean}} s
 * @param {boolean} deadlinePassed
 */
export function resolveStatus(s, deadlinePassed) {
  if (isAbsent(s)) return "absent";
  if (!s.racecard) return "not_saved";
  if (s.exhibition) return "exhibition_ready";
  if (deadlinePassed) return "exhibition_missing";
  if (s.sixExhibition) return "exhibition_reflecting";
  return "before_exhibition";
}

/** キャッシュ: 締切前 60秒、締切後 1日。not_saved とエラーはキャッシュしない */
export function cacheControl(status, deadlinePassed) {
  if (status === "not_saved") return "no-store";
  return deadlinePassed
    ? "public, s-maxage=86400, stale-while-revalidate=3600"
    : "public, s-maxage=60, stale-while-revalidate=30";
}

export function json(body, status, cache) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": cache,
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/** URL の末尾の race_id と stage。不正なら RangeError */
export function parseRequest(req) {
  const url = new URL(req.url);
  const raceId = decodeURIComponent(url.pathname.split("/").pop());
  if (!isRaceId(raceId)) throw new RangeError("raceId は YYYY-MM-DD-VV-RR");
  const stage = url.searchParams.get("stage") || "racecard";
  if (!STAGES.includes(stage))
    throw new RangeError(`stage は ${STAGES.join("|")}`);
  return { raceId, stage, url };
}

/**
 * 4本の API の共通の流れ: 入力の検査 → 状態 → build（状態が読める段のファイルを読む）→ キャッシュ付きの応答。
 * 入力の誤りは 400、Storage・DB の失敗は 502（どちらも no-store）
 * @param {(ctx: {raceId:string, stage:string, url:URL, state:object, status:string,
 *   snapshot:object|null}) => Promise<object>} build
 */
export function createHandler(build) {
  return async function handler(req) {
    if (req.method === "OPTIONS") return json(null, 204, "no-store");
    let parsed;
    try {
      parsed = parseRequest(req);
    } catch (e) {
      return json({ error: e.message }, 400, "no-store");
    }
    try {
      const state = await loadRaceState(parsed.raceId);
      const deadline = deadlineOf(state.race);
      const deadlinePassed =
        deadline !== null && Date.now() > deadline.getTime();
      const status = resolveStatus(state, deadlinePassed);
      const snapshot =
        parsed.stage === "exhibition" ? state.exhibition : state.racecard;
      const body = await build({ ...parsed, state, status, snapshot });
      return json(
        { status, ...body },
        200,
        cacheControl(status, deadlinePassed),
      );
    } catch (e) {
      if (e instanceof RangeError)
        return json({ error: e.message }, 400, "no-store");
      console.error("analogy v16:", e);
      return json({ error: "upstream" }, 502, "no-store");
    }
  };
}

/** Storage の prefix の直下（フォルダは id が null の行） */
export async function listObjects(prefix) {
  const { url, key } = env();
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${url}/storage/v1/object/list/${BUCKET}`, {
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
