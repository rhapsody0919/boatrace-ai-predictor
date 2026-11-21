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
  SEASON_COLUMNS,
} from "../lib/racerProfileSync.js";
import { runRacerProfileSyncScenes1 } from "./verifyData/racer-profile-sync-scenes-1.js";
import { runRacerProfileSyncScenes2 } from "./verifyData/racer-profile-sync-scenes-2.js";

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

// 公式サイトが「この登録番号は存在しない」ときに返す実ページの本文（BOA-376、実ページで確認済み。
// racer_id 3849・4519）。.table1 table を含まず、HTTP 200で返る
function notFoundHtml() {
  return `<div class="contentsFrame1_inner"><div class="title12"><h3 class="title12_title is-type1">※ データが存在しないのでページを表示できません。<br /><br /></h3></div></div>`;
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

// ---- 後半の場面（verifyData/racer-profile-sync-scenes-1.js・racer-profile-sync-scenes-2.js） ----
await runRacerProfileSyncScenes1({ check, silent, seasonHtml, notFoundHtml, profileHtml, createMockSupabase, createMockSite, noSleep });
await runRacerProfileSyncScenes2({ check, seasonHtml, createMockSupabase, createMockSite });

if (failures > 0) {
  console.error(`\n${failures}件の検証が失敗しました`);
  process.exit(1);
}
console.log("\n全ての検証に成功しました");
