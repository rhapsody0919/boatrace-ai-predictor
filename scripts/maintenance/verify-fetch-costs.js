#!/usr/bin/env node
/**
 * fetch-costs.js（Vercel の請求を日ごと・サービスごとに台帳へ）を、時計と取得を固定して確かめる: 取り直しの範囲・返ってきた日の置き換え・
 * 0 ドルを書かない・USD でない請求を弾く・鍵の値を戻り値と失敗の文に出さない・台帳が空のときだけ写す。通信・Keychain・ファイルには触らない。
 */
import {
  aggregate,
  chargesUrl,
  fetchCosts,
  importRows,
  merge,
  refetchRange,
} from "./fetch-costs.js";

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(
    `${ok ? "OK" : "NG"} ${label}${ok || !detail ? "" : `\n   ${detail}`}`,
  );
  if (!ok) failures++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const NOW = new Date("2026-11-25T22:30:00Z");
const range = refetchRange(NOW, 7);
check(
  same(range, { start: "2026-11-18", end: "2026-11-25" }),
  "取り直しの範囲は UTC の今日の前の7日（今日は含まない）",
  JSON.stringify(range),
);
const url = new URL(chargesUrl("team_x", range));
check(
  url.searchParams.get("from") === "2026-11-18T00:00:00.000Z" &&
    url.searchParams.get("to") === "2026-11-25T00:00:00.000Z" &&
    url.searchParams.get("teamId") === "team_x",
  "請求の URL の範囲と team",
);

const line = (day, svc, cost, cur) =>
  JSON.stringify({
    ChargePeriodStart: `${day}T00:00:00Z`,
    ServiceName: svc,
    BilledCost: cost,
    ...(cur ? { BillingCurrency: cur } : {}),
  });
const agg = aggregate(
  [
    line("2026-11-20", "A", 1.5),
    line("2026-11-20", "A", 0.25),
    line("2026-11-21", "B", 0),
    "",
    line("2026-11-24", "C", 2),
  ].join("\n"),
);
check(
  same(
    [...agg.entries()],
    [
      ["2026-11-20\tA", 1.75],
      ["2026-11-21\tB", 0],
      ["2026-11-24\tC", 2],
    ],
  ),
  "同じ日・サービスは足す",
  JSON.stringify([...agg]),
);
let threw = "";
try {
  aggregate(line("2026-11-20", "A", 1, "JPY"));
} catch (e) {
  threw = e.message;
}
check(threw.includes("通貨が JPY"), "USD でない請求は弾く", threw);

const old = [
  {
    date: "2026-11-10",
    service: "A",
    usd: 9,
    source: "vercel",
    fetched_at: "x",
  },
  {
    date: "2026-11-20",
    service: "A",
    usd: 9,
    source: "vercel",
    fetched_at: "x",
  },
  {
    date: "2026-11-20",
    service: "Z",
    usd: 9,
    source: "vercel",
    fetched_at: "x",
  },
  {
    date: "2026-11-22",
    service: "A",
    usd: 9,
    source: "vercel",
    fetched_at: "x",
  },
  {
    date: "2026-11-20",
    service: "gpt",
    usd: 1,
    source: "openai_api",
    fetched_at: "x",
  },
];
const merged = merge(old, agg, range, NOW.toISOString());
check(
  same(
    merged.map((r) => [r.date, r.source, r.service, r.usd]),
    [
      ["2026-11-10", "vercel", "A", 9],
      ["2026-11-20", "openai_api", "gpt", 1],
      ["2026-11-20", "vercel", "A", 1.75],
      ["2026-11-22", "vercel", "A", 9],
      ["2026-11-24", "vercel", "C", 2],
    ],
  ),
  "返ってきた日の Vercel の行は丸ごと置き換え（11/20 の Z は消える）、返ってこない日・範囲の外・他の出どころは残し、0 ドルは書かない",
  JSON.stringify(merged.map((r) => [r.date, r.source, r.service, r.usd])),
);

const SECRET = "tok_SECRET_value_123";
const config = {
  team_id: "team_x",
  keychain_service: "s",
  keychain_account: "a",
  refetch_days: 7,
};
const calls = [];
const ok = await fetchCosts({
  config,
  rows: old,
  now: NOW,
  readToken: () => SECRET,
  fetchImpl: async (u, init) => {
    calls.push({ u, auth: init.headers.Authorization });
    return {
      ok: true,
      status: 200,
      text: async () => line("2026-11-24", "C", 2),
    };
  },
});
check(
  ok.ok && ok.days === 1 && calls[0].auth === `Bearer ${SECRET}`,
  "鍵は Authorization にだけ渡す",
);
check(!JSON.stringify(ok).includes(SECRET), "成功の戻り値に鍵の値が無い");
const failCases = [
  await fetchCosts({
    config,
    rows: [],
    now: NOW,
    readToken: () => null,
    fetchImpl: async () => ({}),
  }),
  await fetchCosts({
    config,
    rows: [],
    now: NOW,
    readToken: () => SECRET,
    fetchImpl: async () => ({
      ok: false,
      status: 403,
      text: async () => SECRET,
    }),
  }),
  await fetchCosts({
    config,
    rows: [],
    now: NOW,
    readToken: () => SECRET,
    fetchImpl: async () => {
      throw new TypeError(`fetch failed: Authorization Bearer ${SECRET}`);
    },
  }),
  await fetchCosts({
    config,
    rows: [],
    now: NOW,
    readToken: () => SECRET,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => `{bad ${SECRET}`,
    }),
  }),
];
check(
  failCases.every(
    (r) => r.ok === false && r.error && !r.error.includes(SECRET),
  ),
  "鍵が無い・HTTP の失敗・例外・形の違いは失敗にし、失敗の文に鍵の値を入れない",
  JSON.stringify(failCases.map((r) => r.error)),
);
check(
  failCases[0].error.includes("Keychain") &&
    failCases[1].error.includes("HTTP 403"),
  "失敗の理由を出す",
);

check(
  importRows([], old) === old && importRows([old[0]], old) === null,
  "台帳が空のときだけ写す",
);

if (failures > 0) {
  console.error(`verify-fetch-costs: ${failures} 件の失敗`);
  process.exit(1);
}
console.log("verify-fetch-costs: すべて通った");
