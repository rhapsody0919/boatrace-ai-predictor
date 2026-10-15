/**
 * 素材の数値の照合（sns-pdca-loop tasks 9、spec A3、plan §2）。素材バンドル v1 の claims を、龍神の公開 API から新しく読み直して照合する。
 * Codex の自己申告（qa.json の pass・numeric_claims_match）だけでは通さない。
 *
 * - endpoint は許可リスト（アナロジーの4本の API、素材と同じレース、stage だけ）に無ければ不合格
 * - 同じ endpoint は1回だけ読む。読めない・path に値が無い・値が違うものは不合格
 * - 数値は桁まで完全一致、文字列は NFKC・前後の空白・連続する空白をそろえて一致、それ以外は JSON の一致
 * - source_revision は「照合した値」から決まる。承認の時（auto-plan）と送る直前（preflight の readCurrent）で同じ関数を使い、
 *   値が変わっていれば版が変わる（送る直前に source_changed で止まる）
 */
import { SITE_BASE_URL } from "./snsHubHelpers.js";
import {
  createTodayDigestSource,
  digestRevision,
  isTodayDraft,
} from "./snsTodayDigest.js";

const TIMEOUT_MS = 15000;
const RACE_ID = "\\d{4}-\\d{2}-\\d{2}-\\d{2}-\\d{2}";
const ENDPOINT = new RegExp(
  `^/api/analogy/(facts|similar|scenario|layer)/(${RACE_ID})(\\?stage=(racecard|exhibition))?$`,
);

/** 許可リストに合い、素材と同じレースの endpoint か */
export function allowedEndpoint(endpoint, raceId) {
  const m = ENDPOINT.exec(endpoint ?? "");
  return Boolean(m && m[2] === raceId);
}

const normalize = (s) => s.normalize("NFKC").trim().replace(/\s+/g, " ");
export function sameValue(expected, actual) {
  if (typeof expected === "number" || typeof actual === "number")
    return (
      typeof expected === "number" &&
      typeof actual === "number" &&
      Number.isFinite(actual) &&
      expected === actual
    );
  if (typeof expected === "string" || typeof actual === "string")
    return (
      typeof expected === "string" &&
      typeof actual === "string" &&
      normalize(expected) === normalize(actual)
    );
  return JSON.stringify(expected) === JSON.stringify(actual);
}

const valueAt = (body, path) =>
  path.reduce(
    (v, key) =>
      v !== null && typeof v === "object" && Object.hasOwn(v, key)
        ? v[key]
        : undefined,
    body,
  );

async function sha256Hex(text) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * @param {{claims: object[], raceId: string, fetchImpl?: typeof fetch, base?: string, now?: () => Date}} input
 * @returns {Promise<{ok: boolean, revision: string|null, observedAt: string, results: {id: string, ok: boolean, reason?: string}[]}>}
 */
export async function checkClaims({
  claims,
  raceId,
  fetchImpl = fetch,
  base = SITE_BASE_URL,
  now = () => new Date(),
}) {
  if (!Array.isArray(claims) || claims.length === 0)
    return {
      ok: false,
      revision: null,
      observedAt: now().toISOString(),
      results: [],
    };
  const bodies = new Map();
  const read = (endpoint) => {
    if (!bodies.has(endpoint))
      bodies.set(
        endpoint,
        fetchImpl(`${base}${endpoint}`, {
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }).then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        }),
      );
    return bodies.get(endpoint);
  };
  const results = [];
  const observed = [];
  for (const claim of claims) {
    const endpoint = claim?.source?.endpoint;
    if (!allowedEndpoint(endpoint, raceId)) {
      results.push({
        id: claim?.id,
        ok: false,
        reason: "endpoint_not_allowed",
      });
      continue;
    }
    let actual;
    try {
      actual = valueAt(await read(endpoint), claim.source.path);
    } catch (error) {
      results.push({
        id: claim.id,
        ok: false,
        reason: `fetch_failed: ${error.message}`,
      });
      continue;
    }
    if (actual === undefined) {
      results.push({ id: claim.id, ok: false, reason: "path_missing" });
      continue;
    }
    const ok = sameValue(claim.value, actual);
    results.push({
      id: claim.id,
      ok,
      ...(ok ? {} : { reason: "value_mismatch" }),
    });
    observed.push([claim.id, endpoint, claim.source.path, actual]);
  }
  const ok = results.every((r) => r.ok);
  observed.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return {
    ok,
    revision: ok
      ? (await sha256Hex(JSON.stringify(observed))).slice(0, 32)
      : null,
    observedAt: now().toISOString(),
    results,
  };
}

/** races の締切（発走の時刻、JST）を ISO にする。承認（auto-plan）と送る直前で同じ文字列になるよう、ここだけで作る */
export function deadlineIso(race) {
  if (!race?.race_date || !race?.start_time) return null;
  return new Date(`${race.race_date}T${race.start_time}+09:00`).toISOString();
}

/**
 * 送る直前の preflight（createDeadlinePreflight）に渡す readCurrent。
 * 返り値 {withdrawn, cancelled, deadline_at, source_revision}。素材 v1 でない下書き・照合の不合格は投げる（fail-closed）
 * /today の投稿（tasks 19b）は、その日の一覧を読み直して版を返す（レースではないので欠場・中止は無い。締切は下書きの値）
 * @param {{db: (path: string) => Promise<any[]>, fetchImpl?: typeof fetch, base?: string, getDigest?: (date: string) => Promise<object>}} deps db は PostgREST の読み取り
 */
export function createReadCurrent({
  db,
  fetchImpl = fetch,
  base = SITE_BASE_URL,
  // 送る直前は使い回さずに読み直す（ttlMs: 0）
  getDigest = createTodayDigestSource(),
}) {
  return async (draftId) => {
    const [draft] = await db(
      `sns_drafts?id=eq.${draftId}&select=bundle_import_id,source_data,sns_bundle_imports(schema_version,bundle)`,
    );
    if (isTodayDraft(draft))
      return {
        withdrawn: false,
        cancelled: false,
        deadline_at: draft.source_data.deadline_queue?.deadline_at ?? null,
        source_revision: await digestRevision(
          await getDigest(draft.source_data.digest.date),
        ),
      };
    const imported = draft?.sns_bundle_imports;
    if (imported?.schema_version !== "ryujin-preview/1")
      throw new Error("source_check_unsupported");
    const raceId = imported.bundle?.race_id;
    const id = encodeURIComponent(raceId ?? "");
    const [[race], entries, exhibition, claims] = await Promise.all([
      db(
        `races?race_id=eq.${id}&select=race_date,start_time,cancellation_status`,
      ),
      db(`race_entries?race_id=eq.${id}&select=is_absent`),
      db(`exhibition_data?race_id=eq.${id}&select=is_absent`),
      checkClaims({ claims: imported.bundle.claims, raceId, fetchImpl, base }),
    ]);
    if (!race) throw new Error("race_not_found");
    if (!claims.ok) throw new Error("claim_mismatch");
    return {
      withdrawn: [...entries, ...exhibition].some((r) => r.is_absent === true),
      cancelled: race.cancellation_status != null,
      deadline_at: deadlineIso(race),
      source_revision: claims.revision,
    };
  };
}
