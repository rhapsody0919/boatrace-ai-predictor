#!/usr/bin/env node
/**
 * cost-alerts-other.js（費用の警報のうち前払い・急増・取得・期限）を固定の台帳・設定・日付で確かめる。通信・ファイルには触らない。
 */
import { otherAlerts } from "./cost-alerts-other.js";

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(
    `${ok ? "OK" : "NG"} ${label}${ok || !detail ? "" : `\n   ${detail}`}`,
  );
  if (!ok) failures++;
};

const cfg = {
  alert: {
    spike_ratio: 2,
    spike_min_usd: 10,
    spike_days: 7,
    fetch_fail_days: 2,
    domain_mid_days: 30,
    token_mid_days: 14,
  },
  vercel: { fixed_services: ["Pro"], token_expires: "2027-01-18" },
  prepaid: {
    $comment: "x",
    openai_api: { balance_usd: 30, as_of: "2026-10-21", warn_left_pct: 30 },
  },
  domains: [{ name: "x.jp", expires: "2027-12-31" }],
};
const daily = (n, v) =>
  Array.from({ length: n }, (_, i) => ({
    date: `2026-11-${String(i + 1).padStart(2, "0")}`,
    service: "Fn",
    usd: v,
    source: "vercel",
  }));
const ok = { last_attempt: "2026-11-21", fail_dates: [] };
const keys = (rows, st = ok, today = "2026-11-21", c = cfg) =>
  otherAlerts(c, rows, st, today).map((a) => a.key);

check(
  keys(daily(20, 4)).length === 0,
  "平らな台帳・今日の取得・遠い期限なら何も出さない",
  JSON.stringify(keys(daily(20, 4))),
);
check(
  keys([
    ...daily(20, 4),
    { date: "2026-11-21", service: "Fn", usd: 12, source: "vercel" },
  ]).includes("cost_spike:2026-11-21"),
  "前日の2倍以上かつ $10 以上の日は急増",
);
check(
  !keys([
    ...daily(20, 4),
    { date: "2026-11-21", service: "Fn", usd: 9, source: "vercel" },
  ]).some((k) => k.startsWith("cost_spike")),
  "$10 未満は急増にしない",
);
check(
  !keys([
    ...daily(20, 4),
    { date: "2026-11-21", service: "Pro", usd: 50, source: "vercel" },
  ]).some((k) => k.startsWith("cost_spike")),
  "定額と重なる行は急増に数えない",
);
check(
  keys([
    ...daily(3, 1),
    { date: "2026-10-25", service: "gpt", usd: 25, source: "openai_api" },
  ]).includes("cost_prepaid_low:openai_api:2026-10-21"),
  "前払いの残りが30%以下",
);
check(
  !keys([
    ...daily(3, 1),
    { date: "2026-10-20", service: "gpt", usd: 25, source: "openai_api" },
  ]).some((k) => k.startsWith("cost_prepaid")),
  "入れた日より前の使用は数えない",
);
check(
  keys(daily(3, 1), {
    last_attempt: "2026-11-21",
    fail_dates: ["2026-11-20", "2026-11-21"],
    error: "HTTP 403",
  }).includes("cost_fetch_fail:2026-11"),
  "取得の失敗が2日続く",
);
check(
  keys(daily(3, 1), { last_attempt: "2026-11-19", fail_dates: [] }).includes(
    "cost_fetch_stale:2026-11",
  ),
  "取得が2日動いていない",
);
check(
  keys(daily(3, 1), null).length === 0,
  "取得の記録が無ければ取得の警報は出さない",
);
check(
  keys(daily(3, 1), ok, "2027-01-04").includes("cost_token:vercel:2027-01"),
  "トークンの期限の14日前に出す",
);
check(
  !keys(daily(3, 1), ok, "2027-01-03").some((k) => k.startsWith("cost_token")),
  "15日前は出さない",
);
check(
  keys(daily(3, 1), ok, "2027-12-10").includes("cost_domain:x.jp:2027-12"),
  "ドメインの期限の30日前に出す",
);

if (failures > 0) {
  console.error(`verify-cost-alerts-other: ${failures} 件の失敗`);
  process.exit(1);
}
console.log("verify-cost-alerts-other: すべて通った");
