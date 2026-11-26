/**
 * API で取れない請求（Supabase）を毎月の初めに1回だけ知らせることを守る（cost-alerts-monthly.js）。
 */
import { costAlerts } from "./cost-alerts.js";
import { MONTHLY_CHECKS, monthlyChecks } from "./cost-alerts-monthly.js";

const failures = [];
let checked = 0;
const check = (name, actual, expected) => {
  checked += 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(
      `${name}: 期待 ${JSON.stringify(expected)} 実際 ${JSON.stringify(actual)}`,
    );
  }
};

check(
  "1日に出す",
  monthlyChecks("2026-12-01").map((a) => a.key),
  ["monthly_check:supabase_billing:2026-12"],
);
check(
  "5日まで出す（1日に Mac が眠っていても拾う）",
  monthlyChecks("2026-12-05").length,
  1,
);
check("6日からは出さない", monthlyChecks("2026-12-06"), []);
check("月の途中は出さない", monthlyChecks("2026-11-21"), []);
check(
  "鍵は月ごと（同じ月は cost-alerts.js が2回出さない）",
  monthlyChecks("2027-01-03")[0].key,
  "monthly_check:supabase_billing:2027-01",
);
check(
  "Supabase の請求の画面の URL を書く",
  MONTHLY_CHECKS[0].text.includes("supabase.com/dashboard"),
  true,
);
const cfg = {
  alert: {
    soft_pct: 100,
    hard_warn_pct: 80,
    projection_recent_days: 7,
    spike_ratio: 2,
    spike_min_usd: 10,
    spike_days: 7,
    fetch_fail_days: 2,
    domain_mid_days: 30,
    token_mid_days: 14,
  },
  usd_jpy: { value: 100 },
  fixed: {},
  monthly_soft_max: 20000,
  monthly_hard_max: 100000,
  per_service: {},
  vercel: { fixed_services: [], token_expires: "2030-01-01" },
};
check(
  "費用の警報の束に入る",
  costAlerts(
    cfg,
    [],
    { last_attempt: "2026-12-01", fail_dates: [] },
    "2026-12-01",
  ).some((a) => a.key === "monthly_check:supabase_billing:2026-12"),
  true,
);

if (failures.length > 0) {
  console.error("NG: 毎月の初めの知らせ");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`OK: 毎月の初めの知らせ ${checked}件`);
