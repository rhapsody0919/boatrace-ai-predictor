/**
 * 定期の job の見張り（.github/workflows/job-watch.yml、ADR-0097 の追記「定期の job の見張り」）の純粋関数。
 * 事実（GitHub の run・ログ・Issue）の取得は scripts/watch/job-watch.js が行い、ここは分類と判定だけをする。
 * 分類は規則で行う（LLM は使わない）。
 */

/**
 * 失敗のログを分類する
 * - config: 鍵・設定の誤り。rerun しても直らない。鍵の Issue に集める
 * - external-block: 公式サイト等の外部が 403・429・503 を返した。ADR-0067 で取得を止める決まりなので rerun しない
 * - transient: Supabase・GitHub 等の 5xx・時間切れ・通信の失敗。許可の一覧の workflow だけ1回 rerun する
 * - other: 上のどれでもない（コードの誤り等）。rerun しない
 *
 * @param {string} text 失敗した job のログ（末尾の一部でよい）
 * @returns {"config" | "external-block" | "transient" | "other"}
 */
export function classifyLog(text) {
  const t = String(text ?? "");
  if (
    /Invalid API key|invalid_api_key|Bad credentials|JWT (?:expired|malformed)|invalid JWT|No API key found|supabase(?:Key|Url) is required|HTTP 401\b|status(?: code)?:? 401\b|\b401 Unauthorized|が無い（Environment|secret .{0,40}(?:not set|未設定)/i.test(
      t,
    )
  ) {
    return "config";
  }
  if (
    /(?:boatrace\.jp|kyoteibiyori|official).{0,200}\b(?:403|429|503)\b|\b(?:403|429|503)\b.{0,200}(?:boatrace\.jp|kyoteibiyori)/is.test(
      t,
    )
  ) {
    return "external-block";
  }
  if (
    /\b403 Forbidden\b|HTTP 403\b|permission denied for (?:table|schema|relation)/i.test(
      t,
    )
  ) {
    return "config";
  }
  if (
    /(?:supabase|github|vercel|linear)[^\n]{0,40}\b50[0234]\b|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|socket hang up|fetch failed|upstream connect error|\b50[0234]\b.{0,80}(?:supabase|github|vercel|Bad Gateway|Service Unavailable|Gateway Time-?out|Internal Server Error)|(?:Bad Gateway|Service Unavailable|Gateway Time-?out)|exceeded the maximum execution time|canceling statement due to statement timeout|The operation was canceled/i.test(
      t,
    )
  ) {
    return "transient";
  }
  return "other";
}

/** JST の日付（YYYY-MM-DD） */
export const jstDate = (iso) =>
  new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 10);

/**
 * 1本の失敗した run をどう扱うかを決める
 *
 * @param {{ id: number, path: string, attempt: number, createdAt: string, category: string,
 *           newerRun: boolean }} run newerRun は、同じ workflow の後の run が成功済みか動いているか
 * @param {{ rerunAllowed: Set<string>, now: Date }} ctx
 * @returns {{ action: "rerun" | "key-issue" | "failure-issue", reason: string }}
 */
export function decideRun(run, { rerunAllowed, now }) {
  if (run.category === "config")
    return { action: "key-issue", reason: "鍵・設定の誤り" };
  const why = rerunBlockers(run, { rerunAllowed, now });
  if (run.category === "transient" && why.length === 0) {
    return { action: "rerun", reason: "一時的な失敗（1回だけ rerun）" };
  }
  const label =
    {
      transient: "一時的な失敗",
      "external-block": "外部が 403・429・503（ADR-0067、rerun しない）",
      other: "コード・その他の失敗",
    }[run.category] ?? run.category;
  return {
    action: "failure-issue",
    reason:
      why.length > 0 && run.category === "transient"
        ? `${label}。rerun しない: ${why.join("・")}`
        : label,
  };
}

/** rerun してはいけない理由（空なら rerun してよい） */
export function rerunBlockers(run, { rerunAllowed, now }) {
  const why = [];
  if (!rerunAllowed.has(run.path)) why.push("許可の一覧に無い");
  if (run.attempt !== 1)
    why.push(`${run.attempt}回目の実行（rerun は1回まで）`);
  // 日付を実行時に決める job は、日をまたいで rerun すると別の日を処理する（rerun は元の SHA のまま動く）
  if (jstDate(run.createdAt) !== jstDate(now.toISOString()))
    why.push("日をまたいだ");
  if (run.newerRun) why.push("同じ workflow の後の run が成功済みか動いている");
  return why;
}

/**
 * 鍵が直ったとき（開いた鍵の Issue より後のカナリアが成功）、鍵の誤りで落ちた run のうち rerun してよいもの
 * @param {{ id: number, path: string, attempt: number, createdAt: string, category: string, newerRun: boolean }[]} runs
 */
export function recoveryReruns(runs, { rerunAllowed, now }) {
  return runs.filter(
    (r) =>
      r.category === "config" &&
      rerunBlockers(r, { rerunAllowed, now }).length === 0,
  );
}

/** Issue のコメントに入れる、同じ run を2回書かないための印 */
export const runMarker = (runId, attempt, kind) =>
  `<!-- job-watch:${kind}:${runId}:${attempt} -->`;

/** Issue の本文・コメントから、既に書いた印を集める */
export function handledMarkers(texts) {
  const set = new Set();
  for (const t of texts) {
    for (const m of String(t ?? "").matchAll(
      /<!-- job-watch:[a-z-]+:\d+:\d+ -->/g,
    ))
      set.add(m[0]);
  }
  return set;
}
