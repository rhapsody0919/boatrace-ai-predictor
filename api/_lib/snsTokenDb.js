/**
 * snsTokenStore.js から移した、sns_oauth_tokens（provider='x'）の PostgREST の読み書き。暗号・トークンの取得の順には触れない。
 * 外へは snsTokenStore.js が同じ名（createPostgrestTokenDb）で再 export する。
 */
import { SUPABASE_URL, SUPABASE_SERVICE_KEY } from "./snsHubHelpers.js";

/** sns_oauth_tokens（provider='x'）の PostgREST の読み書き。条件付き UPDATE で行ロックの代わりにする */
export function createPostgrestTokenDb({
  url = SUPABASE_URL,
  key = SUPABASE_SERVICE_KEY,
  fetchImpl = fetch,
} = {}) {
  async function call(path, options = {}) {
    const response = await fetchImpl(`${url}/rest/v1/${path}`, {
      ...options,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...options.headers,
      },
    });
    if (!response.ok)
      throw new Error(
        `X のトークンの DB 操作に失敗しました: HTTP ${response.status}`,
      );
    return response.json();
  }
  const base = "sns_oauth_tokens?provider=eq.x";
  return {
    async read() {
      return (await call(`${base}&select=*`))[0] ?? null;
    },
    async upsert(row) {
      await call("sns_oauth_tokens?on_conflict=provider", {
        method: "POST",
        headers: {
          Prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify({
          provider: "x",
          ...row,
          lock_until: null,
          locked_by: null,
        }),
      });
    },
    async tryLock(lockId, now, until) {
      const free = encodeURIComponent(
        `(lock_until.is.null,lock_until.lt.${now.toISOString()})`,
      );
      return (
        (
          await call(`${base}&or=${free}`, {
            method: "PATCH",
            body: JSON.stringify({
              lock_until: until.toISOString(),
              locked_by: lockId,
            }),
          })
        ).length === 1
      );
    },
    async saveLocked(lockId, row) {
      return (
        (
          await call(`${base}&locked_by=eq.${lockId}`, {
            method: "PATCH",
            body: JSON.stringify({ ...row, lock_until: null, locked_by: null }),
          })
        ).length === 1
      );
    },
    async release(lockId) {
      await call(`${base}&locked_by=eq.${lockId}`, {
        method: "PATCH",
        body: JSON.stringify({ lock_until: null, locked_by: null }),
      });
    },
  };
}
