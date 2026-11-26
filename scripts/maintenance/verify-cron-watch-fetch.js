#!/usr/bin/env node
/**
 * cron-watch-fetch.js（Vercel Cron の見張りの取得の部品）を、固定した時計と偽の取得で確かめる:
 * 窓（初回は26時間前・次は前回の終わりの1時間前・26時間より前には戻らない）、数の取り込み（同じ時間は置き換え・古い時間は捨てる・0件は入れない）、
 * 取れた回と取れない回の扱い（前の数を消さず連続で数える・トークンと応答の本文を state に入れない・Keychain に無ければそう残す）。
 * 通信・Keychain・ファイルには触らない。
 */
import {
  mergeCounts,
  queryBody,
  queryWindow,
  step,
} from "./cron-watch-fetch.js";

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(
    `${ok ? "OK" : "NG"} ${label}${ok || !detail ? "" : `\n   ${detail}`}`,
  );
  if (!ok) failures++;
};

const now = new Date("2026-11-26T03:00:00Z"); // JST 12:00
const REL = "/api/cron/release-dispatch";

// ---- 窓・数の取り込み ----
const [s0] = queryWindow(null, now);
check(
  s0.toISOString() === "2026-11-25T01:00:00.000Z",
  "初回の窓は26時間前の時間の頭から",
  s0.toISOString(),
);
const [s1] = queryWindow("2026-11-26T02:30:00.000Z", now);
check(
  s1.toISOString() === "2026-11-26T01:00:00.000Z",
  "次の回は前回の終わりの1時間前の頭から",
  s1.toISOString(),
);
const [s2] = queryWindow("2026-11-20T00:00:00.000Z", now);
check(s2.toISOString() === s0.toISOString(), "26時間より前には戻らない");
check(
  queryBody("prj", "team", s1, now).filter ===
    "startswith(request_path,'/api/cron/')" &&
    queryBody("prj", "team", s1, now).startTime === "2026-11-26T01:00:00Z",
  "問い合わせは /api/cron/ だけ・時刻は秒まで",
);
const merged = mergeCounts(
  {
    "2026-11-24T00": { a: { 200: 1 } },
    "2026-11-26T01": { a: { 500: 9 } },
    "2026-11-25T05": { a: { 200: 2 } },
  },
  [
    {
      timestamp: "2026-11-26T01:00:00Z",
      request_path: "a",
      http_status: 200,
      vercel_request_count_sum: 4,
    },
    {
      timestamp: "2026-11-26T02:00:00Z",
      request_path: "b",
      http_status: 500,
      vercel_request_count_sum: 0,
    },
  ],
  s1,
  now,
);
check(
  JSON.stringify(merged) ===
    JSON.stringify({
      "2026-11-25T05": { a: { 200: 2 } },
      "2026-11-26T01": { a: { 200: 4 } },
    }),
  "窓の中の時間は置き換え・古い時間は捨て・0件は入れない",
  JSON.stringify(merged),
);

// ---- 取得 ----
const TOKEN = "vcp_SECRET_TOKEN_VALUE";
const ids = {
  team_id: "team_x",
  project_id: "prj_x",
  keychain_service: "s",
  keychain_account: "a",
};
const rowsFor = (rows) => async () => ({
  ok: true,
  status: 200,
  json: async () => ({ data: rows }),
});
const fail500 = {
  ok: false,
  status: 500,
  json: async () => ({ error: { message: `bad ${TOKEN}` } }),
};
const hit = (hour) => ({
  timestamp: `2026-11-25T${hour}:00:00Z`,
  request_path: REL,
  http_status: 500,
  vercel_request_count_sum: 1,
});
const noLeak = (s) => !s.includes(TOKEN);
const run = (state, readToken, fetchImpl) =>
  step({ state, now, ids, readToken, fetchImpl });

const s = await run({}, () => TOKEN, rowsFor([hit("20"), hit("21")]));
check(
  s.err_streak === 0 &&
    Object.keys(s.counts).length === 2 &&
    s.queried_to === now.toISOString() &&
    s.covered_from === "2026-11-25T01:00:00.000Z" &&
    noLeak(JSON.stringify(s)),
  "取れたら数・取れた所・測り始めを残し、トークンを入れない",
  JSON.stringify(s),
);
const e1 = await step({
  state: s,
  now,
  ids,
  readToken: () => TOKEN,
  fetchImpl: async () => fail500,
});
check(
  e1.err_streak === 1 &&
    e1.last_error === "Observability の問い合わせが HTTP 500" &&
    noLeak(JSON.stringify(e1)),
  "取れない回は HTTP の状態だけを残し、応答の本文（トークンの echo）を入れない",
  e1.last_error,
);
check(
  JSON.stringify(e1.counts) === JSON.stringify(s.counts) &&
    e1.queried_to === s.queried_to,
  "取れない回は前の数と取れた所を消さない",
);
const e2 = await step({
  state: {},
  now,
  ids,
  readToken: () => null,
  fetchImpl: async () => fail500,
});
check(
  e2.last_error === "Keychain に Vercel のトークンが無い" &&
    e2.err_streak === 1,
  "Keychain にトークンが無ければそう残す",
);
const e3 = await step({
  state: {},
  now,
  ids,
  readToken: () => TOKEN,
  fetchImpl: async () => {
    throw new TypeError(`fetch failed ${TOKEN}`);
  },
});
check(
  noLeak(JSON.stringify(e3)) && e3.last_error.includes("TypeError"),
  "通信の例外の文にトークンを入れない",
  e3.last_error,
);
const e4 = await step({
  state: e1,
  now,
  ids,
  readToken: () => TOKEN,
  fetchImpl: async () => fail500,
});
check(e4.err_streak === 2, "連続の失敗を数える");
const e5 = await step({
  state: e4,
  now,
  ids,
  readToken: () => TOKEN,
  fetchImpl: rowsFor([]),
});
check(
  e5.err_streak === 0 && e5.last_error === null,
  "取れたら連続の失敗を戻す",
);

if (failures > 0) {
  console.error(`verify-cron-watch-fetch: ${failures} 件の失敗`);
  process.exit(1);
}
console.log("verify-cron-watch-fetch: すべて通った");
