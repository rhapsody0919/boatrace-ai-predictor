/**
 * verify-gha-skip-gate.js の後半の場面（6/6）。verify ではない。
 * 判定と期待値は分ける前の verify-gha-skip-gate.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

let show, mod, record;

/** 元の verify の1つの塊 { } を割った 1/2 */
async function gsg6Scene1() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return { ok: true, status: 200, json: async () => [{ job: "odds" }] };
  };
  const client = mod.createRestJobStateClient({
    url: "https://example.supabase.co",
    key: "SERVICE_KEY",
    fetchImpl,
    timeoutMs: 1000,
  });
  const rows = await client.readJobStates(["odds", "host:boatrace.jp"]);
  const u = new URL(calls[0].url);
  record(
    "RESTクライアント: scrape_job_state から、指定したジョブの行だけを、service_role のキーで読む（select は必要な列のみ）",
    show(rows) === show([{ job: "odds" }]) &&
      u.origin === "https://example.supabase.co" &&
      u.pathname === "/rest/v1/scrape_job_state" &&
      u.searchParams.get("job") === 'in.("odds","host:boatrace.jp")' &&
      u.searchParams.get("select") ===
        "job,mode,last_tick_at,last_success_at,consecutive_failures,last_target_date,breaker_open_until,fetch_stop,last_error,updated_at" &&
      calls[0].init.headers.apikey === "SERVICE_KEY" &&
      calls[0].init.headers.Authorization === "Bearer SERVICE_KEY" &&
      calls[0].init.signal instanceof AbortSignal &&
      !("method" in calls[0].init && calls[0].init.method !== "GET"),
    show({ url: calls[0].url, headers: Object.keys(calls[0].init.headers) }),
  );
  let threw = "";
  try {
    await mod
      .createRestJobStateClient({
        url: "https://x.supabase.co",
        key: "k",
        fetchImpl: async () => ({
          ok: false,
          status: 503,
          json: async () => ({}),
        }),
      })
      .readJobStates(["odds"]);
  } catch (e) {
    threw = e.message;
  }
  let threw2 = "";
  try {
    await mod
      .createRestJobStateClient({
        url: "https://x.supabase.co",
        key: "k",
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({ message: "x" }),
        }),
      })
      .readJobStates(["odds"]);
  } catch (e) {
    threw2 = e.message;
  }
  record(
    "RESTクライアント: HTTPエラー・配列でない応答は、例外（判定側が「スキップ」にする）",
    /503/.test(threw) && /配列/.test(threw2),
    show({ threw, threw2 }),
  );
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function gsg6Scene2() {
  const d = await mod.shouldSkipOnGha({
    varName: "SKIP_ODDS_ON_GHA",
    env: {
      SKIP_ODDS_ON_GHA: "true",
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SERVICE_KEY: "k",
    },
    now: new Date(),
    logger: null,
    client: mod.createRestJobStateClient({
      url: "https://x.supabase.co",
      key: "k",
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    }),
  });
  record(
    "RESTクライアント経由でネットワーク失敗（fetch failed） → スキップ",
    d.skip === true && d.reason === "read_failed",
    show(d),
  );
  record(
    "jobKeysFor: 対象ジョブと、その取得先ホストのブレーカー行だけ（ホストの無いジョブは、ジョブの行のみ）",
    show(mod.jobKeysFor("SKIP_ODDS_ON_GHA")) ===
      show(["odds", "host:boatrace.jp"]) &&
      show(mod.jobKeysFor("SKIP_KFILE_ON_GHA")) ===
        show(["kfile_sync", "host:mbrace.or.jp"]) &&
      show(mod.jobKeysFor("SKIP_ENTRY_COURSE_ON_GHA")) ===
        show(["entry_course_stats"]) &&
      show(mod.jobKeysFor("UNKNOWN")) === show([]),
  );
}

async function gsg6Scene3() {
  {
    await gsg6Scene1();
    await gsg6Scene2();
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（show・mod・record） */
export async function runGhaSkipGateScenes7(env) {
  ({ show, mod, record } = env);
  await gsg6Scene3();
}
