#!/usr/bin/env node
/**
 * cost-alerts.js（費用の警報を束ねて Slack に出す CLI）の runAlerts を、偽の webhook と fetch で確かめる: 新しい警報だけを1回出す・
 * 出した鍵を覚える・出せなければ覚えず次に出す・webhook が無ければ出さない・標準出力の行に金額と webhook を入れない。通信・Keychain・ファイルには触らない。
 */
import { costAlerts, freshAlerts, jstDay, runAlerts } from "./cost-alerts.js";

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(
    `${ok ? "OK" : "NG"} ${label}${ok || !detail ? "" : `\n   ${detail}`}`,
  );
  if (!ok) failures++;
};

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
  fixed: { a: { usd: 100 } },
  monthly_soft_max: 20000,
  monthly_hard_max: 100000,
  per_service: {},
  vercel: { fixed_services: [], token_expires: "2030-01-01" },
};
const rows = Array.from({ length: 20 }, (_, i) => ({
  date: `2026-11-${String(i + 1).padStart(2, "0")}`,
  service: "Fn",
  usd: 5,
  source: "vercel",
}));
const fetchState = { last_attempt: "2026-11-21", fail_dates: [] };
// 2026-11-21 12:00 JST（UTC 03:00）
const now = new Date("2026-11-21T03:00:00Z");
check(
  jstDay(new Date("2026-11-20T15:30:00Z")) === "2026-11-21",
  "日は JST で切る（UTC 15:30 は JST の翌日）",
);
check(
  costAlerts(cfg, rows, fetchState, "2026-11-21")
    .map((a) => a.key)
    .join() === "cost_soft:2026-11",
  "月の判定と他の判定を束ねる",
);

const HOOK = "https://hooks.example/SECRET_HOOK";
const posts = [];
const okFetch = async (url, init) => {
  posts.push({ url, body: JSON.parse(init.body) });
  return { ok: true, status: 200 };
};
const base = {
  cfg,
  rows,
  fetchState,
  now,
  readWebhook: () => HOOK,
  fetchImpl: okFetch,
};

const first = await runAlerts({ ...base, state: null });
check(
  first.ok && posts.length === 1 && posts[0].url === HOOK,
  "新しい警報を Slack に1回出す",
);
check(
  posts[0].body.text.includes("ソフト") && posts[0].body.text.includes("円"),
  "金額の文は Slack に出す",
);
check(
  first.state?.notified?.["cost_soft:2026-11"] === "2026-11-21",
  "出した鍵と日を覚える",
  JSON.stringify(first.state),
);
check(
  !first.line.includes("円") &&
    !first.line.includes("$") &&
    !first.line.includes(HOOK),
  "標準出力の行に金額と webhook を入れない",
  first.line,
);

const again = await runAlerts({ ...base, state: first.state });
check(
  again.ok &&
    again.state === null &&
    posts.length === 1 &&
    again.line.includes("新しい警報なし"),
  "同じ警報は2回出さない",
);

const down = await runAlerts({
  ...base,
  state: null,
  fetchImpl: async () => ({ ok: false, status: 500 }),
});
check(
  !down.ok && down.state === null && down.line.includes("次の回"),
  "Slack に出せなければ覚えない（次の回にまた出す）",
);
const thrown = await runAlerts({
  ...base,
  state: null,
  fetchImpl: async () => {
    throw new TypeError(`fetch failed ${HOOK}`);
  },
});
check(
  !thrown.ok && !thrown.line.includes(HOOK),
  "通信の例外の文に webhook を入れない",
  thrown.line,
);
const noHook = await runAlerts({
  ...base,
  state: null,
  readWebhook: () => null,
});
check(
  !noHook.ok &&
    noHook.state === null &&
    noHook.line.includes("cost_soft:2026-11"),
  "webhook が無ければ出さず、鍵だけ知らせる",
);

check(
  freshAlerts([{ key: "a" }, { key: "b" }], { notified: { a: "x" } })
    .map((a) => a.key)
    .join() === "b",
  "出した鍵は外す",
);

if (failures > 0) {
  console.error(`verify-cost-alerts: ${failures} 件の失敗`);
  process.exit(1);
}
console.log("verify-cost-alerts: すべて通った");
