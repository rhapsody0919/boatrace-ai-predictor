/**
 * アナロジー・ファインダー v16 の読み書きの共通部品（BOA-271 tasks T5-1・T4-3。plan「API」「展示後の段」）。
 *
 * snapshot（analogy_v16_snapshots）からその時点の run_id を引き、Storage の非公開のバケット analogy-v16 の
 * `{日付}/{run_id}/{種類}/{名前}.json.gz` を service key で読む。facts・similar・scenario・layer の4本の API と、
 * 展示後の段の Cron（scripts/lib/analogyV16Exhibition.js）が使う。fetch と DecompressionStream だけを使うので、
 * Edge・Node のどちらでも動く。
 */

import { rest, isPastPath, deadlineOf } from "../../scripts/lib/analogyV16Store.js";

export const STAGES = ["racecard", "exhibition"];
const RACE_ID = /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/;

export function isRaceId(v) {
  return typeof v === "string" && RACE_ID.test(v);
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

/**
 * キャッシュ: 締切前 60秒、締切後 1日、過去の日付（JST の今日より前）7日。not_saved とエラーはキャッシュしない。
 * 過去の日付の作り直し（CLI）は最大7日で反映される。raceId を渡さなければ従来どおり
 */
export function cacheControl(
  status,
  deadlinePassed,
  raceId,
  nowMs = Date.now(),
) {
  if (status === "not_saved") return "no-store";
  if (
    raceId &&
    isRaceId(raceId) &&
    isPastPath(`${raceId.slice(0, 10)}/`, nowMs)
  )
    return "public, s-maxage=604800, stale-while-revalidate=86400";
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
    },
  });
}

/** URL の末尾の race_id と stage。不正なら RangeError */
// パスの末尾の raceId を取り、日付・会場・レースを確かめる（parts は raceId を除いた残り）
function parseRacePath(url) {
  const parts = url.pathname.split("/");
  const raceId = parts.pop();
  if (!isRaceId(raceId)) throw new RangeError("raceId は YYYY-MM-DD-VV-RR");
  const date = raceId.slice(0, 10);
  const calendar = new Date(`${date}T00:00:00Z`);
  const venue = Number(raceId.slice(11, 13));
  const race = Number(raceId.slice(14, 16));
  if (
    !Number.isFinite(calendar.getTime()) ||
    calendar.toISOString().slice(0, 10) !== date ||
    venue < 1 ||
    venue > 24 ||
    race < 1 ||
    race > 12
  )
    throw new RangeError("raceId の日付・会場・レースが不正です");
  return { parts, raceId };
}

const QUERY_RULES = {
  stage: (v) => STAGES.includes(v),
  include: (v) => v === "racers",
  races: (v) => v === "1",
  boats: (v) => v === "1",
  scope: (v) => /^(VC|NC|NCR|VA|VG|NA)(:[0-9A-Za-z:-]+)?$/.test(v),
  boat: (v) => /^[2-6]$/.test(v),
};

const QUERY_KEYS = {
  facts: ["stage", "include"],
  similar: ["stage"],
  layer: ["stage"],
  scenario: ["stage", "races", "boats", "scope", "boat"],
};

// Vercel が足す動的ルートの組は、パスと同じ表記の1組だけ除く。
function queryWithoutRoute(url, raceId) {
  if (url.search && url.search.slice(1).split("&").includes(""))
    throw new RangeError("クエリに空の組があります");
  let routeSeen = false;
  return url.search
    .slice(1)
    .split("&")
    .filter((pair) => {
      if (pair !== `raceId=${raceId}`) return true;
      if (routeSeen) throw new RangeError("raceId が重複しています");
      routeSeen = true;
      return false;
    })
    .join("&");
}

function canonicalQuery(url, keys) {
  const canonical = [];
  for (const key of keys) {
    if (!url.searchParams.has(key)) continue;
    const value = url.searchParams.get(key);
    if (!QUERY_RULES[key](value)) throw new RangeError(`${key} の値が不正です`);
    canonical.push(`${key}=${encodeURIComponent(value)}`);
  }
  return canonical.join("&");
}

export function parseRequest(req) {
  const url = new URL(req.url);
  const { parts, raceId } = parseRacePath(url);
  const keys = QUERY_KEYS[parts.pop()];
  if (!keys) throw new RangeError("API のパスが不正です");
  const raw = queryWithoutRoute(url, raceId);
  if (raw !== canonicalQuery(url, keys))
    throw new RangeError("クエリの表記が不正です");
  const stage = url.searchParams.get("stage") ?? "racecard";
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
        cacheControl(status, deadlinePassed, parsed.raceId),
      );
    } catch (e) {
      if (e instanceof RangeError)
        return json({ error: e.message }, 400, "no-store");
      console.error("analogy v16:", e);
      return json({ error: "upstream" }, 502, "no-store");
    }
  };
}

export {
  BUCKET,
  UpstreamError,
  rest,
  objectPath,
  isPastPath,
  readObject,
  clearObjectMemory,
  writeObject,
  deadlineOf,
  listObjects,
  listBuckets,
  deleteObjects,
} from "../../scripts/lib/analogyV16Store.js";
