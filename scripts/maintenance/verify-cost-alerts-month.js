#!/usr/bin/env node
/**
 * cost-alerts-month.js（費用の警報のうち月の見込みとサービス別の上限）を固定の台帳・設定・日付で確かめる。通信・ファイルには触らない。
 */
import { monthAlerts, projectUsage } from "./cost-alerts-month.js";

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(
    `${ok ? "OK" : "NG"} ${label}${ok || !detail ? "" : `\n   ${detail}`}`,
  );
  if (!ok) failures++;
};
const keysOf = (cfg, rows, today = "2026-11-21") =>
  monthAlerts(cfg, rows, today).map((x) => x.key);

const base = {
  alert: { soft_pct: 100, hard_warn_pct: 80, projection_recent_days: 7 },
  usd_jpy: { value: 100 },
  fixed: { a: { usd: 100 } },
  monthly_soft_max: 50000,
  monthly_hard_max: 100000,
  per_service: { vercel: { usd: 150 } },
  vercel: { fixed_services: ["Pro"] },
};
// 11/1〜11/20 に毎日 $5（20日で $100）→ 今月の日平均・直近7日の日平均とも $150
const rows = Array.from({ length: 20 }, (_, i) => ({
  date: `2026-11-${String(i + 1).padStart(2, "0")}`,
  service: "Fn",
  usd: 5,
  source: "vercel",
}));
const p = projectUsage(
  Object.fromEntries(rows.map((r) => [r.date, r.usd])),
  "2026-11",
  30,
  7,
);
check(
  Math.abs(p.full - 150) < 1e-9 &&
    Math.abs(p.recent - 150) < 1e-9 &&
    p.last === "2026-11-20",
  "見込み2本（今月の日平均・直近7日）",
  JSON.stringify(p),
);
const early = projectUsage(
  { "2026-10-31": 0, "2026-11-01": 50, "2026-11-02": 0 },
  "2026-11",
  30,
  7,
);
check(
  early.full === early.recent,
  "月初で窓に満たない間は直近の見込みを使う（数日の跳ねで決めない）",
  JSON.stringify(early),
);

// 定額 $100＋見込み $150 = $250 → 25,000円。Pro は定額と重なるので数えない
const withPro = [
  ...rows,
  { date: "2026-11-20", service: "Pro", usd: 999, source: "vercel" },
];
check(
  keysOf(base, withPro).length === 0,
  "見込みが線の下・上限ちょうどなら出さない（定額と重なる Pro は数えない）",
  JSON.stringify(keysOf(base, withPro)),
);
check(
  keysOf({ ...base, monthly_soft_max: 20000 }, rows)[0] === "cost_soft:2026-11",
  "ソフトを超える見込み",
);
check(
  keysOf(
    { ...base, monthly_soft_max: 20000, monthly_hard_max: 30000 },
    rows,
  )[0] === "cost_hard_warn:2026-11",
  "ハードの80%を超える見込み（25,000円 > 24,000円）",
);
const hard = keysOf(
  { ...base, monthly_soft_max: 10000, monthly_hard_max: 20000 },
  rows,
);
check(
  hard[0] === "cost_hard:2026-11" &&
    !hard.some(
      (k) => k.startsWith("cost_soft") || k.startsWith("cost_hard_warn"),
    ),
  "ハードを超える見込みは一番重い1つだけ",
  JSON.stringify(hard),
);
check(
  keysOf({ ...base, per_service: { vercel: { usd: 120 } } }, rows).includes(
    "cost_service_cap_proj:2026-11:vercel",
  ),
  "サービスの見込みが上限を超える",
);
check(
  keysOf({ ...base, per_service: { vercel: { usd: 90 } } }, rows).includes(
    "cost_service_cap:2026-11:vercel",
  ),
  "サービスの今月の従量が上限を超えた",
);
check(
  keysOf({ ...base, per_service: { other: { usd: 1 } } }, rows).length === 0,
  "今月の行が無いサービスは判定しない",
);
check(
  keysOf({ ...base, monthly_soft_max: 20000 }, rows, "2026-12-02")[0] !==
    "cost_soft:2026-11",
  "月が変われば鍵の月も変わる",
);

if (failures > 0) {
  console.error(`verify-cost-alerts-month: ${failures} 件の失敗`);
  process.exit(1);
}
console.log("verify-cost-alerts-month: すべて通った");
