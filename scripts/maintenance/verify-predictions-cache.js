#!/usr/bin/env node
/**
 * /api/predictions/{date} の CDN キャッシュの長さ（api/_lib/predictionsCache.js）を検証する。
 *
 * 守るもの: JST の今日・未来は s-maxage=300、JST の今日より前だけ s-maxage=86400。
 * とくに JST 0:00〜8:59（UTC ではまだ前日）に当日を「過去」と判定して1日キャッシュにしないこと（以前の UTC 判定の不具合）。
 * api/predictions/[date].js がこの関数を使い、UTC の日付（toISOString の直比較）で判定していないこと。
 */
process.env.TZ = "UTC";

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  jstDate,
  predictionsCacheControl,
} from "../../api/_lib/predictionsCache.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

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

// 関数のファイルが同じ判定を使う
const src = readFileSync(
  path.join(repoRoot, "api/predictions/[date].js"),
  "utf8",
);
check(
  "api/predictions/[date].js が predictionsCacheControl を使う",
  /predictionsCacheControl\(date, Date\.now\(\)\)/.test(src),
  true,
);
check(
  "api/predictions/[date].js に UTC の日付での当日判定が残っていない",
  /new Date\(\)\.toISOString\(\)\.split\(['"]T['"]\)\[0\]/.test(src),
  false,
);

if (failures.length > 0) {
  console.error(
    `❌ verify-predictions-cache: ${failures.length}件の失敗（${checked}件中）`,
  );
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✅ verify-predictions-cache: ${checked}件すべて通過`);
