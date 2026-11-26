/**
 * Vercel Cron の失敗の見張りの取得の部品（hq の scripts/cron_watch.py の window・body・merge_counts・fetch・step の移し、2026-11-26 窓口の依頼）。
 * Observability（POST /v2/observability/query）の経路×状態の数を時間ごとに取り込む。判定は cron-watch-judge.js。
 * 警報・Slack・main（CLI）は別の PR。ここは純関数と、取得を受け取って回す step だけで、Keychain・Slack・ファイルには触らない。
 *
 * - 窓: 前回取れた終わりの1時間前（取り込みの遅れを拾い直す）から今まで、上限26時間。同じ時間は上書き（二重に数えない）
 * - 取れない回は前の数と取れた所を消さず、連続の失敗の数と理由だけを残す。理由の文にトークン・応答の本文を入れない
 *
 * 検証: scripts/maintenance/verify-cron-watch-fetch.js（時計と取得を固定）
 */
export const API = "https://api.vercel.com/v2/observability/query";
export const PROJECT_ID = "prj_9dVpwxadeVy5g1Q5mg3fwUuHyiiP"; // 龍神の Vercel project（識別子で秘密ではない）
export const KEEP_H = 26; // 時間ごとの数を持つ長さ（判定の24時間＋取り込みの遅れ）
export const RELAG_H = 1; // 前回の終わりのこの時間前から取り直す（取り込みの遅れ、未検証）
const HOUR = 3600 * 1000;
const hourOf = (d) => d.toISOString().slice(0, 13);

/** 取れなかった理由をそのまま state・標準出力に出してよい文（トークンを含まない）にする例外 */
export class WatchError extends Error {}

/** 問い合わせの窓 [開始, 終わり]（開始は時間の頭。KEEP_H より前には戻らない） */
export function queryWindow(queriedTo, now) {
  const floor = now.getTime() - KEEP_H * HOUR;
  const from = queriedTo
    ? Math.max(floor, Date.parse(queriedTo) - RELAG_H * HOUR)
    : floor;
  return [new Date(Math.floor(from / HOUR) * HOUR), now];
}

export const queryBody = (project, team, start, end) => ({
  metric: "vercel.request.count",
  scope: { type: "project", ownerId: team, projectIds: [project] },
  groupBy: ["request_path", "http_status"],
  limit: 500,
  granularity: { hours: 1 },
  startTime: `${start.toISOString().slice(0, 19)}Z`,
  endTime: `${end.toISOString().slice(0, 19)}Z`,
  filter: "startswith(request_path,'/api/cron/')",
});

/** { 時間: { 経路: { 状態: 数 } } }。窓の中の時間は今回の答えで置き換え、KEEP_H より古い時間は捨てる */
export function mergeCounts(old, rows, start, now) {
  const sKey = hourOf(start);
  const cut = hourOf(new Date(now.getTime() - KEEP_H * HOUR));
  const out = Object.fromEntries(
    Object.entries(old).filter(([h]) => h < sKey && h >= cut),
  );
  for (const r of rows) {
    const n = Number(r.vercel_request_count_sum);
    const h = hourOf(new Date(r.timestamp));
    if (!n || h < cut) continue;
    ((out[h] ??= {})[String(r.request_path)] ??= {})[String(r.http_status)] = n;
  }
  return out;
}

/** Observability に問い合わせて行を返す。失敗の文は HTTP の状態だけ（応答の本文・トークンは入れない） */
export async function queryRows({
  token,
  team,
  project,
  start,
  end,
  fetchImpl,
}) {
  const res = await fetchImpl(`${API}?teamId=${encodeURIComponent(team)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(queryBody(project, team, start, end)),
    signal: AbortSignal.timeout(30000),
  }).catch((e) => {
    throw new WatchError(`Observability に繋がらない（${e?.name ?? "Error"}）`);
  });
  if (!res.ok)
    throw new WatchError(`Observability の問い合わせが HTTP ${res.status}`);
  const json = await res.json().catch(() => null);
  if (!Array.isArray(json?.data))
    throw new WatchError("Observability の応答に data が無い");
  return json.data;
}

/** 1回分の取得。取れなければ数は残し err_streak を上げる（state を返す） */
export async function step({ state, now, ids, readToken, fetchImpl }) {
  const st = { ...(state ?? {}), at: now.toISOString() };
  const [start, end] = queryWindow(st.queried_to, now);
  try {
    const token = readToken(ids.keychain_service, ids.keychain_account);
    if (!token) throw new WatchError("Keychain に Vercel のトークンが無い");
    const rows = await queryRows({
      token,
      team: ids.team_id,
      project: ids.project_id,
      start,
      end,
      fetchImpl,
    });
    return {
      ...st,
      counts: mergeCounts(st.counts ?? {}, rows, start, now),
      queried_to: end.toISOString(),
      covered_from: st.covered_from ?? start.toISOString(),
      err_streak: 0,
      last_error: null,
    };
  } catch (e) {
    return {
      ...st,
      err_streak: (st.err_streak ?? 0) + 1,
      last_error: e instanceof WatchError ? e.message : (e?.name ?? "Error"),
    };
  }
}
