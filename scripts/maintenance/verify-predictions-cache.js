#!/usr/bin/env node
/**
 * /api/predictions/{date} の CDN キャッシュの長さ（api/_lib/predictionsCache.js）を検証する。
 *
 * 守るもの: JST の今日・未来は s-maxage=300、JST の今日より前だけ s-maxage=86400。
 * とくに JST 0:00〜8:59（UTC ではまだ前日）に当日を「過去」と判定して1日キャッシュにしないこと（以前の UTC 判定の不具合）。
 * api/predictions/[date].js がこの関数を使い、UTC の日付（toISOString の直比較）で判定していないこと。
 * 後者は関数のファイルの本文を読まず、default export の handler を偽の fetch・時計で呼び、応答の Cache-Control で見る。
 */
process.env.TZ = "UTC";

import handler from "../../api/predictions/[date].js";
import {
  jstDate,
  predictionsCacheControl,
} from "../../api/_lib/predictionsCache.js";

const failures = [];
let checked = 0;
function check(label, actual, expected) {
  checked += 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(
      `${label}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`,
    );
  }
}

const SHORT = "s-maxage=300, stale-while-revalidate=60";
const LONG = "s-maxage=86400, stale-while-revalidate=3600";

// 2026-10-12 06:00 JST（UTC では 10/11 21:00）。以前の UTC 判定では 10/12 を過去として LONG にしていた
const MORNING = Date.parse("2026-10-11T21:00:00Z");
check("JST 6時の JST の今日", jstDate(MORNING), "2026-10-12");
check(
  "JST 6時: 当日は5分",
  predictionsCacheControl("2026-10-12", MORNING),
  SHORT,
);
check(
  "JST 6時: 前日は1日",
  predictionsCacheControl("2026-10-11", MORNING),
  LONG,
);
check(
  "JST 6時: 翌日は5分",
  predictionsCacheControl("2026-10-13", MORNING),
  SHORT,
);

// 境目: JST 0:00 ちょうど（UTC 15:00）と、その1分前
const MIDNIGHT = Date.parse("2026-10-12T15:00:00Z");
check("JST 0:00 の今日", jstDate(MIDNIGHT), "2026-10-13");
check(
  "JST 0:00: 新しい当日は5分",
  predictionsCacheControl("2026-10-13", MIDNIGHT),
  SHORT,
);
check(
  "JST 0:00: 前日になった日は1日",
  predictionsCacheControl("2026-10-12", MIDNIGHT),
  LONG,
);
check("JST 23:59 の今日", jstDate(MIDNIGHT - 60_000), "2026-10-12");
check(
  "JST 23:59: 当日は5分",
  predictionsCacheControl("2026-10-12", MIDNIGHT - 60_000),
  SHORT,
);

// 昼（UTC と日付が同じ時間帯）は以前と同じ
const NOON = Date.parse("2026-10-12T03:00:00Z");
check(
  "JST 12時: 当日は5分",
  predictionsCacheControl("2026-10-12", NOON),
  SHORT,
);
check("JST 12時: 過去は1日", predictionsCacheControl("2025-12-02", NOON), LONG);

// 関数のファイルが同じ判定を使う: handler を偽の fetch（Supabase の RPC の代わり）と時計で呼び、応答の Cache-Control を見る。
// JST 6時（UTC ではまだ前日）に JST の前日を1日・当日を5分にする。UTC の日付で比べると前日を当日とみなして5分になる
async function cacheControlOf(date, nowMs) {
  const realNow = Date.now;
  const realFetch = globalThis.fetch;
  const calls = [];
  Date.now = () => nowMs;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ races: [] }), { status: 200 });
  };
  try {
    const res = await handler(
      new Request(`https://www.boat-ai.jp/api/predictions/${date}`),
    );
    return {
      status: res.status,
      cacheControl: res.headers.get("Cache-Control"),
      rpc: calls.map((u) => u.split("/rpc/")[1] ?? u),
    };
  } finally {
    Date.now = realNow;
    globalThis.fetch = realFetch;
  }
}
for (const [label, date, nowMs, cacheControl] of [
  ["JST 6時の当日", "2026-10-12", MORNING, SHORT],
  ["JST 6時の前日（UTC では当日）", "2026-10-11", MORNING, LONG],
  ["JST 23:59 の当日", "2026-10-12", MIDNIGHT - 60_000, SHORT],
  ["JST 0:00 に前日になった日", "2026-10-12", MIDNIGHT, LONG],
  ["JST 12時の過去", "2025-12-02", NOON, LONG],
]) {
  check(
    `api/predictions/[date].js の応答: ${label}`,
    await cacheControlOf(date, nowMs),
    { status: 200, cacheControl, rpc: ["get_predictions_by_date"] },
  );
}

if (failures.length > 0) {
  console.error(
    `❌ verify-predictions-cache: ${failures.length}件の失敗（${checked}件中）`,
  );
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✅ verify-predictions-cache: ${checked}件すべて通過`);
