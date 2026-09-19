/**
 * verify-racer-profile-sync.js - 選手プロフィール・期別成績ジョブ
 * （scripts/lib/racerProfileSync.js）の回帰テスト。
 *
 * 本番DB・公式サイトには一切接続しない。実際の @supabase/supabase-js クライアントに
 * モックfetchを注入し、送信されるHTTPリクエスト（メソッド・URL・ボディ）を検証する。
 *   - 期別成績が upsert(POST) ではなく PATCH /rest/v1/racer_profiles?racer_id=eq.<id> になること
 *     （INSERT側のNOT NULL検査（name・birth_date）を通らない）
 *   - ボディが期別成績の6列だけで、氏名・級別・支部・生年月日を含まないこと
 *   - 値が変わっていない行は書かないこと
 *   - 失敗・0件書き込み・時間予算での中断が verdict.ok=false（＝終了コード1）になること
 *
 * 使用方法: node scripts/maintenance/verify-racer-profile-sync.js
 */

import { createClient } from "@supabase/supabase-js";
import {
  parseArgs,
  buildPopulation,
  isSeasonRowUnchanged,
  toSeasonStatsRow,
  fetchHtmlWithRetry,
  evaluateRun,
  runRacerProfileSync,
  SEASON_COLUMNS,
  ABORT_AFTER_CONSECUTIVE_FAILURES,
} from "../lib/racerProfileSync.js";

let failures = 0;
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) {
    failures++;
    console.error(
      `NG ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  } else {
    console.log(`OK ${label}`);
  }
}
function checkThrows(label, fn, messagePart) {
  try {
    fn();
    failures++;
    console.error(`NG ${label}: 例外が投げられなかった`);
  } catch (err) {
    const pass = err.message.includes(messagePart);
    if (!pass) failures++;
    console[pass ? "log" : "error"](
      `${pass ? "OK" : "NG"} ${label}: ${err.message}`,
    );
  }
}

const silent = { log: () => {}, logError: () => {} };

// ---------------------------------------------------------------------------
// フィクスチャ: 公式ページのHTML（パーサーが読む構造だけを再現）
// ---------------------------------------------------------------------------

function seasonHtml({
  winRate = "6.87",
  ability = "56",
  flying = "0",
  withData = true,
} = {}) {
  const v = (x) => (withData ? x : "-");
  const rows = [
    ["勝率", v(winRate)],
    ["2連対率", v("54.30%")],
    ["3連対率", v("70.10%")],
    ["出走回数", v("116回")],
    ["優出回数", v("2回")],
    ["優勝回数", v("1回")],
    ["平均スタートタイミング", v("0.16")],
    ["フライング回数", v(`${flying}回`)],
    ["出遅れ回数（選手責任）", v("0回")],
    ["能力指数", v(ability)],
  ];
  const tbody = rows
    .map(([k, val]) => `<tbody><tr><th>${k}</th><td>${val}</td></tr></tbody>`)
    .join("");
  return `<div class="text"><p class="h-alignR">集計期間：2025/11/01-2026/04/30</p></div><div class="table1"><table>${tbody}</table></div>`;
}

function profileHtml(name) {
  return `<div class="racer1_bodyName">${name}</div><div class="racer1_bodyKana">カナ</div>
<dl class="list3"><dt>生年月日</dt><dd>1990/01/02</dd><dt>身長</dt><dd>170cm</dd><dt>体重</dt><dd>52kg</dd>
<dt>血液型</dt><dd>A型</dd><dt>支部</dt><dd>東京</dd><dt>出身地</dt><dd>東京都</dd><dt>登録期</dt><dd>130期</dd><dt>級別</dt><dd>B1級</dd></dl>`;
}

// ---------------------------------------------------------------------------
// モック: Supabase(PostgREST) と 公式サイト
// ---------------------------------------------------------------------------

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * @param {{profiles: Object[], recentRacerIds?: number[], patchFails?: boolean, patchMissesRows?: boolean}} config
 */
function createMockSupabase({
  profiles,
  recentRacerIds = [],
  patchFails = false,
  patchMissesRows = false,
}) {
  const rows = new Map(profiles.map((p) => [p.racer_id, { ...p }]));
  const requests = [];
  const mockFetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({
      method,
      table: url.pathname.split("/").pop(),
      search: url.search,
      body,
    });
    const table = url.pathname.split("/").pop();

    if (table === "race_entries" && method === "GET") {
      return jsonResponse(recentRacerIds.map((racer_id) => ({ racer_id })));
    }
    if (table === "racer_profiles" && method === "GET") {
      const inMatch = url.searchParams.get("racer_id")?.match(/^in\.\((.*)\)$/);
      const ids = inMatch ? inMatch[1].split(",").map(Number) : null;
      const result = [...rows.values()]
        .filter((r) => !ids || ids.includes(r.racer_id))
        .sort((a, b) => a.racer_id - b.racer_id);
      return jsonResponse(result);
    }
    if (table === "racer_profiles" && method === "PATCH") {
      if (patchFails)
        return jsonResponse(
          { code: "XX000", message: "simulated failure" },
          500,
        );
      const idMatch = url.searchParams.get("racer_id")?.match(/^eq\.(\d+)$/);
      const target = idMatch ? rows.get(Number(idMatch[1])) : null;
      if (!target || patchMissesRows) return jsonResponse([]);
      Object.assign(target, body);
      return jsonResponse([{ racer_id: target.racer_id }]);
    }
    if (table === "racer_profiles" && method === "POST") {
      const list = Array.isArray(body) ? body : [body];
      for (const r of list)
        rows.set(r.racer_id, { ...rows.get(r.racer_id), ...r });
      return new Response(null, { status: 201 });
    }
    return jsonResponse({ message: `unexpected ${method} ${url}` }, 500);
  };
  const client = createClient("http://mock.supabase.local", "mock-key", {
    global: { fetch: mockFetch },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { client, requests, rows };
}

// pages: { [racerId]: { profile?: html | number(status), season?: html | number(status) } }
function createMockSite(pages) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const match = url.match(/(profile|season)\?toban=(\d+)/);
    const page = match && pages[match[2]]?.[match[1]];
    if (page === undefined) return new Response("not found", { status: 404 });
    if (typeof page === "number") return new Response("err", { status: page });
    return new Response(page, { status: 200 });
  };
  return { fetchImpl, calls };
}

const noSleep = async () => {};

// ---------------------------------------------------------------------------
// 1. 引数
// ---------------------------------------------------------------------------
{
  const o = parseArgs([
    "--dry-run",
    "--racer-ids=3159, 4444",
    "--limit=5",
    "--offset=10",
    "--max-minutes=300",
    "--delay-ms=1000",
    "-v",
  ]);
  check(
    "parseArgs: 全オプション",
    [
      o.dryRun,
      o.verbose,
      o.racerIds,
      o.limit,
      o.offset,
      o.maxMinutes,
      o.delayMs,
    ],
    [true, true, [3159, 4444], 5, 10, 300, 1000],
  );
  const empty = parseArgs(["--racer-ids=", "--limit=", "--offset="]);
  check(
    "parseArgs: 空値（workflow_dispatch未入力）は未指定",
    [empty.racerIds, empty.limit, empty.offset],
    [null, null, 0],
  );
  checkThrows(
    "parseArgs: 不明な引数はエラー（打ち間違いで全件実行しない）",
    () => parseArgs(["--racer-id=1"]),
    "不明な引数",
  );
  checkThrows(
    "parseArgs: racer-idsに非数値",
    () => parseArgs(["--racer-ids=12,ab"]),
    "--racer-ids",
  );
  checkThrows("parseArgs: limit=0", () => parseArgs(["--limit=0"]), "--limit");
}

// ---------------------------------------------------------------------------
// 2. 対象選手の決定
// ---------------------------------------------------------------------------
{
  const registered = new Map([
    [3000, {}],
    [1000, {}],
    [2000, {}],
  ]);
  const recentIds = new Set([2000, 5000]);
  const base = {
    registered,
    recentIds,
    racerIds: null,
    limit: null,
    offset: 0,
  };
  check(
    "buildPopulation: 登録済み∪直近出走の昇順",
    buildPopulation(base),
    [1000, 2000, 3000, 5000],
  );
  check(
    "buildPopulation: offset+limit（再開）",
    buildPopulation({ ...base, offset: 1, limit: 2 }),
    [2000, 3000],
  );
  check(
    "buildPopulation: racerIds指定はそれだけ",
    buildPopulation({ ...base, racerIds: [5000, 1000, 5000] }),
    [1000, 5000],
  );
}

// ---------------------------------------------------------------------------
// 3. 変更なし判定
// ---------------------------------------------------------------------------
{
  const stats = {
    abilityIndex: 56,
    flyingCount: 0,
    falseStartCount: 0,
    periodLabel: "2026-second",
    winRate: 6.87,
  };
  const row = toSeasonStatsRow(stats, "2026-09-19T00:00:00.000Z");
  const existing = {
    racer_id: 1,
    ability_index: 56,
    flying_count_period: 0,
    false_start_count_period: 0,
    period_label: "2026-second",
    official_win_rate_period: 6.87,
  };
  check(
    "toSeasonStatsRow: 列は期別成績の5列＋official_updated_atのみ（racer_id・name・birth_dateを含まない）",
    Object.keys(row),
    [...SEASON_COLUMNS, "official_updated_at"],
  );
  check(
    "isSeasonRowUnchanged: 同じ値",
    isSeasonRowUnchanged(existing, row),
    true,
  );
  check(
    "isSeasonRowUnchanged: 既存行なし=変更あり",
    isSeasonRowUnchanged(undefined, row),
    false,
  );
  check(
    "isSeasonRowUnchanged: 能力指数が違う",
    isSeasonRowUnchanged({ ...existing, ability_index: 57 }, row),
    false,
  );
  check(
    "isSeasonRowUnchanged: F回数が違う",
    isSeasonRowUnchanged({ ...existing, flying_count_period: 1 }, row),
    false,
  );
  check(
    "isSeasonRowUnchanged: 既存がnull（初回）=変更あり",
    isSeasonRowUnchanged({ ...existing, ability_index: null }, row),
    false,
  );
  check(
    "isSeasonRowUnchanged: numeric(5,2)の丸め（6.875→6.88）",
    isSeasonRowUnchanged(
      { ...existing, official_win_rate_period: 6.88 },
      { ...row, official_win_rate_period: 6.875 },
    ),
    true,
  );
}

// ---------------------------------------------------------------------------
// 4. 取得のタイムアウト・リトライ
// ---------------------------------------------------------------------------
{
  let n = 0;
  const sleeps = [];
  const flaky = async () =>
    ++n < 3
      ? new Response("", { status: 503 })
      : new Response("<html>ok</html>", { status: 200 });
  const html = await fetchHtmlWithRetry("http://x", {
    fetchImpl: flaky,
    sleep: async (ms) => sleeps.push(ms),
  });
  check(
    "fetchHtmlWithRetry: 503x2→3回目で成功",
    [html, n, sleeps],
    ["<html>ok</html>", 3, [2000, 4000]],
  );

  n = 0;
  const notFound = async () => (n++, new Response("", { status: 404 }));
  check(
    "fetchHtmlWithRetry: 404はリトライせずnull",
    [
      await fetchHtmlWithRetry("http://x", {
        fetchImpl: notFound,
        sleep: noSleep,
      }),
      n,
    ],
    [null, 1],
  );

  n = 0;
  const alwaysDown = async () => (n++, new Response("", { status: 500 }));
  let message = "";
  await fetchHtmlWithRetry("http://x", {
    fetchImpl: alwaysDown,
    sleep: noSleep,
  }).catch((e) => (message = e.message));
  check(
    "fetchHtmlWithRetry: 500が続けば3回試行後に例外",
    [n, message.includes("3回試行")],
    [3, true],
  );

  n = 0;
  const hangs = (url, init) =>
    new Promise((_, reject) => {
      n++;
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
    });
  message = "";
  // AbortSignal.timeout のタイマーはunrefされるため、実際のfetch（ソケット）の代わりに
  // イベントループを保持しておく
  const keepAlive = setInterval(() => {}, 50);
  await fetchHtmlWithRetry("http://x", {
    fetchImpl: hangs,
    sleep: noSleep,
    timeoutMs: 20,
  }).catch((e) => (message = e.message));
  clearInterval(keepAlive);
  check(
    "fetchHtmlWithRetry: 応答が無ければタイムアウトして3回試行後に例外",
    [n, message.includes("3回試行")],
    [3, true],
  );
}

// ---------------------------------------------------------------------------
// 5. 結果の判定（終了コード）
// ---------------------------------------------------------------------------
{
  const ok = {
    targetCount: 100,
    stoppedEarly: false,
    aborted: false,
    nextOffset: null,
    profile: { successCount: 0, failCount: 0, saveErrorCount: 0 },
    season: {
      successCount: 5,
      unchangedCount: 90,
      noDataCount: 3,
      failCount: 2,
    },
  };
  check("evaluateRun: 失敗2%は成功", evaluateRun(ok).ok, true);
  check(
    "evaluateRun: 新規選手のプロフィール取得が1〜2件失敗（引退済み等）だけなら成功",
    evaluateRun({
      ...ok,
      profile: { successCount: 0, failCount: 2, saveErrorCount: 0 },
    }).ok,
    true,
  );
  check(
    "evaluateRun: 新規選手のプロフィール取得が3件すべて失敗は失敗",
    evaluateRun({
      ...ok,
      profile: { successCount: 0, failCount: 3, saveErrorCount: 0 },
    }).ok,
    false,
  );
  check(
    "evaluateRun: 新規選手のプロフィール保存でDBエラーが1件でもあれば失敗",
    evaluateRun({
      ...ok,
      profile: { successCount: 4, failCount: 1, saveErrorCount: 1 },
    }).ok,
    false,
  );
  check(
    "evaluateRun: 全件が変更なし（書き込み0）でも成功",
    evaluateRun({
      ...ok,
      season: { ...ok.season, successCount: 0, unchangedCount: 98 },
    }).ok,
    true,
  );
  check(
    "evaluateRun: 全件失敗（書き込み0・確認0）は失敗",
    evaluateRun({
      ...ok,
      season: {
        successCount: 0,
        unchangedCount: 0,
        noDataCount: 0,
        failCount: 100,
      },
    }).ok,
    false,
  );
  check(
    "evaluateRun: 失敗率6%は失敗",
    evaluateRun({ ...ok, season: { ...ok.season, failCount: 6 } }).ok,
    false,
  );
  check(
    "evaluateRun: 失敗率5%ちょうどは成功",
    evaluateRun({ ...ok, season: { ...ok.season, failCount: 5 } }).ok,
    true,
  );
  check(
    "evaluateRun: 対象0件は失敗",
    evaluateRun({ ...ok, targetCount: 0 }).ok,
    false,
  );
  check(
    "evaluateRun: 時間予算で中断は失敗",
    evaluateRun({ ...ok, stoppedEarly: true, nextOffset: 800 }).ok,
    false,
  );
  check(
    "evaluateRun: 中断（連続失敗）は失敗",
    evaluateRun({ ...ok, aborted: true }).ok,
    false,
  );
}

// ---------------------------------------------------------------------------
// 6. 統合: 実クライアント＋モックfetchで、送信されるリクエストを検証
// ---------------------------------------------------------------------------
const existingRow = (id, extra = {}) => ({
  racer_id: id,
  name: `選手${id}`,
  birth_date: "1980-01-01",
  branch: "東京",
  grade_at_scrape: "A1級",
  ability_index: null,
  flying_count_period: null,
  false_start_count_period: null,
  period_label: null,
  official_win_rate_period: null,
  ...extra,
});
const runWith = (mock, site, argv, deps = {}) =>
  runRacerProfileSync({
    client: mock.client,
    options: parseArgs(argv),
    deps: { fetchImpl: site.fetchImpl, sleep: noSleep, ...silent, ...deps },
  });

{
  // 1001: 初回（期別成績が未取得）→更新 / 1002: 取得済みで同値→スキップ / 1003: 新規選手（未登録）
  // 1004: 期別成績ページが常に500 / 1005: 新人（集計期間内データ無し）
  const mock = createMockSupabase({
    profiles: [
      existingRow(1001),
      existingRow(1002, {
        ability_index: 56,
        flying_count_period: 0,
        false_start_count_period: 0,
        period_label: "2026-second",
        official_win_rate_period: 6.87,
      }),
      existingRow(1004),
      existingRow(1005),
    ],
    recentRacerIds: [1001, 1003],
  });
  const site = createMockSite({
    1001: { season: seasonHtml({ flying: "1" }) },
    1002: { season: seasonHtml() },
    1003: { profile: profileHtml("新規 太郎"), season: seasonHtml() },
    1004: { season: 500 },
    1005: { season: seasonHtml({ withData: false }) },
  });
  const { summary, verdict } = await runWith(mock, site, []);

  const writes = mock.requests.filter((r) => r.method !== "GET");
  const patch1001 = writes.find(
    (r) => r.method === "PATCH" && r.search.includes("racer_id=eq.1001"),
  );
  check(
    "統合: 期別成績はPATCH（upsertのPOSTではない）で、URLが racer_id=eq.<id>&select=racer_id",
    patch1001?.search,
    "?racer_id=eq.1001&select=racer_id",
  );
  check(
    "統合: PATCHのボディは期別成績5列＋official_updated_atだけ（name・birth_date・branch・grade_at_scrapeを含まない）",
    Object.keys(patch1001?.body ?? {}).sort(),
    [...SEASON_COLUMNS, "official_updated_at"].sort(),
  );
  check(
    "統合: 1001のF回数が更新される",
    mock.rows.get(1001).flying_count_period,
    1,
  );
  check(
    "統合: 既存の氏名・生年月日・支部・級別が上書きされない",
    [
      mock.rows.get(1001).name,
      mock.rows.get(1001).birth_date,
      mock.rows.get(1001).branch,
      mock.rows.get(1001).grade_at_scrape,
    ],
    ["選手1001", "1980-01-01", "東京", "A1級"],
  );
  check(
    "統合: 変更のない1002は書かない",
    writes.some((r) => r.search.includes("1002")),
    false,
  );
  const post1003 = writes.find((r) => r.method === "POST");
  check(
    "統合: 新規選手はPOST(upsert)で全列（name・birth_date含む）を送る",
    [post1003?.body?.name, post1003?.body?.birth_date],
    ["新規 太郎", "1990-01-02"],
  );
  check(
    "統合: 新規選手の期別成績はプロフィール登録後にPATCHで書く",
    writes.some(
      (r) => r.method === "PATCH" && r.search.includes("racer_id=eq.1003"),
    ),
    true,
  );
  check(
    "統合: 書き込みはPATCH2件(1001,1003)＋POST1件のみ",
    writes
      .map((r) => `${r.method}${r.search.match(/eq\.(\d+)/)?.[1] ?? ""}`)
      .sort(),
    ["PATCH1001", "PATCH1003", "POST"],
  );
  check(
    "統合: 直近出走の窓は race_id>=日付 の範囲指定",
    mock.requests
      .find((r) => r.table === "race_entries")
      ?.search.includes("race_id=gte.20"),
    true,
  );
  check(
    "統合: 件数の集計",
    [
      summary.season.successCount,
      summary.season.unchangedCount,
      summary.season.noDataCount,
      summary.season.failCount,
      summary.season.failedRacerIds,
      summary.profile.successCount,
    ],
    [2, 1, 1, 1, [1004], 1],
  );
  check(
    "統合: 500を返す選手は3回試行してから失敗として記録される",
    site.calls.filter((u) => u.includes("season?toban=1004")).length,
    3,
  );
  check(
    "統合: 失敗1/5=20%なので実行全体は失敗（終了コード1）",
    verdict.ok,
    false,
  );
}

{
  // 失敗なし・全件変更なしの実行は成功
  const same = {
    ability_index: 56,
    flying_count_period: 0,
    false_start_count_period: 0,
    period_label: "2026-second",
    official_win_rate_period: 6.87,
  };
  const mock = createMockSupabase({
    profiles: [existingRow(1, same), existingRow(2, same)],
  });
  const site = createMockSite({
    1: { season: seasonHtml() },
    2: { season: seasonHtml() },
  });
  const { summary, verdict } = await runWith(mock, site, []);
  check(
    "統合: 全件変更なしなら書き込み0件でも成功、書き込みリクエストも0",
    [
      verdict.ok,
      summary.season.unchangedCount,
      mock.requests.filter((r) => r.method !== "GET").length,
    ],
    [true, 2, 0],
  );
}

{
  // --racer-ids: race_entriesを読まず、racer_profilesもその選手だけを読む
  const mock = createMockSupabase({
    profiles: [existingRow(1), existingRow(2)],
  });
  const site = createMockSite({
    1: { season: seasonHtml() },
    2: { season: seasonHtml() },
  });
  const { summary } = await runWith(mock, site, ["--racer-ids=2", "--dry-run"]);
  check(
    "統合: --racer-ids は対象だけ取得し、race_entriesを読まない",
    [summary.targetCount, mock.requests.map((r) => r.table)],
    [1, ["racer_profiles"]],
  );
  check(
    "統合: dry-runは書き込みリクエストを送らない",
    mock.requests.filter((r) => r.method !== "GET").length,
    0,
  );
}

{
  // update が0行を返す（対象行なし）→失敗として記録され、成功扱いにしない
  const mock = createMockSupabase({
    profiles: [existingRow(1)],
    patchMissesRows: true,
  });
  const site = createMockSite({ 1: { season: seasonHtml() } });
  const { summary, verdict } = await runWith(mock, site, []);
  check(
    "統合: PATCHの更新が0行なら失敗として記録し、実行は失敗",
    [summary.season.successCount, summary.season.failCount, verdict.ok],
    [0, 1, false],
  );
}

{
  // 書き込みが全件失敗する場合、20件で中断する（4時間かけて全件巡回しない）
  const profiles = Array.from({ length: 60 }, (_, i) => existingRow(1000 + i));
  const mock = createMockSupabase({ profiles, patchFails: true });
  const pages = Object.fromEntries(
    profiles.map((p) => [p.racer_id, { season: seasonHtml() }]),
  );
  const site = createMockSite(pages);
  const { summary, verdict } = await runWith(mock, site, []);
  check(
    `統合: 書き込みが全件失敗なら${ABORT_AFTER_CONSECUTIVE_FAILURES}件で中断し、公式サイトへのリクエストも止める`,
    [summary.aborted, summary.season.failCount, site.calls.length, verdict.ok],
    [
      true,
      ABORT_AFTER_CONSECUTIVE_FAILURES,
      ABORT_AFTER_CONSECUTIVE_FAILURES,
      false,
    ],
  );
}

{
  // 途中まで成功していても、失敗が連続したら中断する（公式サイトが途中で落ちた場合）
  const profiles = Array.from({ length: 80 }, (_, i) => existingRow(1000 + i));
  const mock = createMockSupabase({ profiles });
  const pages = Object.fromEntries(
    profiles.map((p, i) => [
      p.racer_id,
      { season: i < 5 ? seasonHtml() : 503 }, // 最初の5人は成功、以降は503
    ]),
  );
  const site = createMockSite(pages);
  const { summary, verdict } = await runWith(mock, site, []);
  check(
    "統合: 5人成功のあと503が続けば、連続20件の失敗で中断する（80人全員には当たらない）",
    [
      summary.aborted,
      summary.season.successCount,
      summary.season.failCount,
      summary.nextOffset,
      verdict.ok,
    ],
    [true, 5, ABORT_AFTER_CONSECUTIVE_FAILURES, 25, false],
  );
}

{
  // 失敗の合間に成功が挟まれば連続とはみなさない（5%以内の散発的な失敗では中断しない）
  const profiles = Array.from({ length: 100 }, (_, i) => existingRow(1000 + i));
  const mock = createMockSupabase({ profiles });
  const pages = Object.fromEntries(
    profiles.map((p, i) => [
      p.racer_id,
      { season: i % 25 === 24 ? 503 : seasonHtml() }, // 25人に1人が失敗（4件=4%）
    ]),
  );
  const site = createMockSite(pages);
  const { summary, verdict } = await runWith(mock, site, []);
  check(
    "統合: 散発的な失敗（4%）は中断せず全件処理し、成功扱い",
    [
      summary.aborted,
      summary.season.failCount,
      summary.season.successCount,
      verdict.ok,
    ],
    [false, 4, 96, true],
  );
}

{
  // 時間予算: 経過時間が上限を超えたら中断し、再開用のoffsetを返す
  const profiles = Array.from({ length: 10 }, (_, i) => existingRow(1000 + i));
  const mock = createMockSupabase({ profiles });
  const pages = Object.fromEntries(
    profiles.map((p) => [p.racer_id, { season: seasonHtml() }]),
  );
  const site = createMockSite(pages);
  let clock = 0;
  const { summary, verdict } = await runWith(
    mock,
    site,
    ["--max-minutes=1", "--offset=0"],
    {
      now: () => clock,
      sleep: async () => {
        clock += 30_000;
      }, // 1選手ごとに30秒経過したことにする
    },
  );
  check(
    // 経過0秒・30秒・60秒（上限ちょうどは超過ではない）の3人を処理し、90秒で中断する
    "統合: 時間予算で中断し、再開用offsetを記録して失敗扱い",
    [summary.stoppedEarly, summary.nextOffset, verdict.ok],
    [true, 3, false],
  );
}

if (failures > 0) {
  console.error(`\n${failures}件の検証が失敗しました`);
  process.exit(1);
}
console.log("\n全ての検証に成功しました");
