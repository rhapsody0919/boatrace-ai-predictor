/**
 * 公開 API の4本（accuracy・races/today・race-history/summary・outcome-distribution）が、画面の使うクエリ以外を
 * DB の読み出しの前に 400・no-store で拒むこと（api/_lib/strictQuery.js）。`?zz=乱数` で CDN のキャッシュを外して
 * 関数と DB まで届く穴を塞ぐ（docs/design/public-api-lockdown/plan.md）。全 fetch を差し替え、DB に接続しない。
 * 正規の入力（画面・ボット向け HTML・全貌動画の材料が送る形）は 200 のまま、キャッシュの設定も変えないことも固定する。
 */
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "http://supabase.test";
process.env.VITE_SUPABASE_URL = "http://supabase.test";
process.env.VITE_SUPABASE_ANON_KEY = "test-key";
delete process.env.SUPABASE_SERVICE_KEY;

let calls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  calls += 1;
  const url = String(input);
  const body = url.includes("outcome_distribution")
    ? [
        {
          first_boat: 1,
          second_boat: 2,
          third_boat: 3,
          count_90days: 5,
          probability: 0.1,
          avg_payout: 1000,
          total_races: 50,
          last_updated: "2026-10-27",
        },
      ]
    : url.includes("/rpc/get_today_races")
      ? { success: true, data: [] }
      : [{ data: { days: [] } }];
  return new Response(JSON.stringify(body), { status: 200 });
};

const handlers = {
  accuracy: (await import("../../api/accuracy/index.js")).default,
  "races/today": (await import("../../api/races/today.js")).default,
  "race-history/summary": (await import("../../api/race-history/summary.js"))
    .default,
  "outcome-distribution": (
    await import("../../api/outcome-distribution/index.js")
  ).default,
};

// 呼び出し元が実際に送る形（src/services/supabaseDataService.js・api/_lib/botPage.js・
// scripts/maintenance/verify-bot-html-parity.js・sns-video-studio/remotion/scripts/full-picture/fetch-materials.mjs）
const good = {
  accuracy: ["", "?"],
  "races/today": ["", "?"],
  "race-history/summary": ["?days=90", ""],
  "outcome-distribution": [
    "?venue_code=1",
    "?venue_code=24",
    "?venue_code=12",
    "?venue_code=01",
  ],
};
const cacheBusters = ["?zz=8231", "?_=1", "?t=1730000000000", "?x"];
const bad = {
  accuracy: [...cacheBusters, "?&", "?days=90"],
  "races/today": [...cacheBusters, "?date=2026-10-27"],
  "race-history/summary": [
    ...cacheBusters,
    "?days=90&zz=1",
    "?zz=1&days=90",
    "?days=30",
    "?days=090",
    "?days=",
    "?days=90&days=90",
    "?d%61ys=90",
    "?days=90&",
  ],
  "outcome-distribution": [
    ...cacheBusters,
    "?venue_code=1&zz=1",
    "?zz=1&venue_code=1",
    "?venue_code=1&venue_code=1",
    "?venue%5Fcode=1",
    "?venue_code=%31",
    "?venue_code=0",
    "?venue_code=25",
    "?venue_code=001",
    "?venue_code=1.0",
    "?venue_code=+1",
    "?venue_code=",
    "?venue_code=1&",
    "",
  ],
};

let failures = 0;
let checked = 0;
async function check(name, query, status) {
  calls = 0;
  const label = `/api/${name}${query}`;
  try {
    const res = await handlers[name](
      new Request(`http://localhost/api/${name}${query}`),
    );
    const body = await res.json();
    assert.equal(res.status, status, label);
    if (status === 400) {
      assert.equal(
        res.headers.get("Cache-Control"),
        "no-store",
        `${label}: 拒んだ応答は CDN に置かない`,
      );
      assert.equal(
        calls,
        0,
        `${label}: 拒む要求で DB を読んだ（fetch=${calls}）`,
      );
      assert.equal(body.success, false, label);
    } else {
      assert.ok(calls > 0, `${label}: 正規の要求で DB を読まなかった`);
      assert.match(
        res.headers.get("Cache-Control") ?? "",
        /s-maxage=\d+/,
        `${label}: 正規の応答のキャッシュが外れた`,
      );
    }
  } catch (error) {
    failures += 1;
    console.error(`NG ${error.message}`);
  }
  checked += 1;
}

try {
  for (const [name, queries] of Object.entries(good))
    for (const query of queries) await check(name, query, 200);
  for (const [name, queries] of Object.entries(bad))
    for (const query of queries) await check(name, query, 400);
  // OPTIONS（CORS の事前確認）はクエリの検査より前に返す
  for (const name of Object.keys(handlers)) {
    calls = 0;
    const res = await handlers[name](
      new Request(`http://localhost/api/${name}?zz=1`, { method: "OPTIONS" }),
    );
    try {
      assert.equal(res.status, 200, `OPTIONS /api/${name}`);
      assert.equal(calls, 0, `OPTIONS /api/${name}: DB を読んだ`);
    } catch (error) {
      failures += 1;
      console.error(`NG ${error.message}`);
    }
    checked += 1;
  }
} finally {
  globalThis.fetch = originalFetch;
}

if (failures > 0) {
  console.error(`verify-api-query-lockdown: ${failures}/${checked} 件 NG`);
  process.exit(1);
}
console.log(`verify-api-query-lockdown: ${checked} 件 OK`);
