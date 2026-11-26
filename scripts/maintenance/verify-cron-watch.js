#!/usr/bin/env node
/**
 * cron-watch.js（Vercel Cron の失敗の見張り）を、固定した時計と偽の取得・webhook で確かめる:
 * 判定（出荷の cron が両方落ちたら high・拾い直しで戻れば鳴らさない・戻らなければ mid・401 の単発は鳴らさない・
 * 失敗の割合・24時間の沈黙は測りが24時間ある時だけ・key の日は最初に落ちた時間の JST）、
 * 窓と数の取り込み（同じ時間は置き換え・古い時間は捨てる）、取れない回の扱い（前の数を消さず連続で mid）、
 * 新しい警報だけ1回 Slack に出す・出せなければ覚えない、トークンと webhook を戻り値・state・標準出力の行・Slack の文に入れない。
 * 通信・Keychain・ファイルには触らない。
 */
import { judge } from "./cron-watch-judge.js";
import {
  alerts,
  mergeCounts,
  queryBody,
  queryWindow,
  runWatch,
  step,
} from "./cron-watch.js";

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(
    `${ok ? "OK" : "NG"} ${label}${ok || !detail ? "" : `\n   ${detail}`}`,
  );
  if (!ok) failures++;
};

const now = new Date("2026-11-26T03:00:00Z"); // JST 12:00
const REL = "/api/cron/release-dispatch";
const keys = (a) => a.map((x) => `${x.level}:${x.key}`).join(" | ");
const J = (counts, covered = null) => judge(counts, now, covered);

// ---- 判定 ----
check(
  keys(
    J({
      "2026-11-25T20": { [REL]: { 500: 1 } },
      "2026-11-25T21": { [REL]: { 500: 1 } },
    }),
  ) === `high:cron_down:${REL}:2026-11-26`,
  "出荷の cron が 5xx 2回・成功0は high（key の日は最初に落ちた時間の JST）",
);
check(
  J({ "2026-11-25T20": { [REL]: { 500: 2, 200: 1 } } }).length === 0,
  "成功が1回でもあれば high にしない（拾い直しで戻った）",
);
check(
  J({
    "2026-11-25T20": { [REL]: { 500: 1 } },
    "2026-11-25T21": { [REL]: { 200: 1 } },
  }).length === 0,
  "dispatch が 5xx の後に成功したら鳴らさない",
);
check(
  keys(J({ "2026-11-25T20": { [REL]: { 500: 1 } } })) ===
    `mid:cron_fail:${REL}:2026-11-26`,
  "dispatch が 5xx の後に成功が無ければ mid",
);
check(
  J({
    "2026-11-25T22": { [REL]: { 200: 1 } },
    "2026-11-26T02": { [REL]: { 500: 1 } },
  }).length === 0,
  "直前の1時間の失敗は拾い直しを待って鳴らさない",
);
check(
  keys(
    J({
      "2026-11-25T10": { [REL]: { 200: 1 } },
      "2026-11-25T20": { [REL]: { 500: 1 } },
    }),
  ) === `mid:cron_fail:${REL}:2026-11-26`,
  "前に成功があっても、最後の失敗の後に成功が無ければ mid",
);
check(
  J({ "2026-11-25T20": { [REL]: { 401: 1, 200: 1 } } }).length === 0 &&
    J({ "2026-11-25T20": { [REL]: { 404: 1 } } }).length === 0,
  "401・404 の単発は鳴らさない",
);
check(
  keys(J({ "2026-11-25T20": { "/api/cron/result": { 500: 1 } } })) ===
    "mid:cron_fail:/api/cron/result:2026-11-26",
  "その他の cron は成功0で 5xx 1回なら mid",
);
check(
  J({ "2026-11-25T20": { "/api/cron/result": { 500: 1, 200: 5 } } }).length ===
    0,
  "その他の cron は成功が多ければ 5xx 1回で鳴らさない",
);
check(
  J({ "2026-11-25T20": { "/api/cron/result": { 500: 3, 200: 3 } } }).length ===
    1,
  "失敗3回以上かつ半分以上は mid",
);
check(
  J({ "2026-11-24T00": { [REL]: { 500: 9 } } }).length === 0,
  "24時間より前の数は見ない",
);
const ok = {
  "2026-11-25T20": {
    [REL]: { 200: 1 },
    "/api/cron/db-apply-dispatch": { 200: 1 },
  },
};
check(J(ok, "2026-11-24T00:00:00.000Z").length === 0, "全部成功なら出さない");
check(
  keys(
    J({ "2026-11-25T20": { [REL]: { 200: 1 } } }, "2026-11-24T00:00:00.000Z"),
  ) === "mid:cron_silent:/api/cron/db-apply-dispatch:2026-11-26",
  "出荷の cron が24時間呼ばれていなければ mid",
);
check(
  judge(
    { "2026-11-25T20": { [REL]: { 200: 1 } } },
    now,
    "2026-11-25T20:00:00.000Z",
  ).length === 0,
  "測りが24時間に満たないうちは沈黙を鳴らさない",
);

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

// ---- 取得と通知 ----
const TOKEN = "vcp_SECRET_TOKEN_VALUE";
const HOOK = "https://hooks.example/SECRET_HOOK";
const ids = {
  team_id: "team_x",
  project_id: "prj_x",
  keychain_service: "s",
  keychain_account: "a",
};
const rowsFor = (rows) => async (url) =>
  url === HOOK
    ? { ok: true, status: 200 }
    : { ok: true, status: 200, json: async () => ({ data: rows }) };
const fail500 = {
  ok: false,
  status: 500,
  json: async () => ({ error: { message: `bad ${TOKEN}` } }),
};
const posts = [];
const slack =
  (inner, okSlack = true) =>
  async (url, init) => {
    if (url === HOOK) {
      posts.push(JSON.parse(init.body).text);
      return okSlack ? { ok: true, status: 200 } : { ok: false, status: 500 };
    }
    return inner(url, init);
  };
const base = { now, ids, readToken: () => TOKEN, readWebhook: () => HOOK };
const bad = [
  {
    timestamp: "2026-11-25T20:00:00Z",
    request_path: REL,
    http_status: 500,
    vercel_request_count_sum: 1,
  },
  {
    timestamp: "2026-11-25T21:00:00Z",
    request_path: REL,
    http_status: 500,
    vercel_request_count_sum: 1,
  },
];
const noLeak = (s) => !s.includes(TOKEN) && !s.includes(HOOK);

const r1 = await runWatch({
  ...base,
  state: {},
  fetchImpl: slack(rowsFor(bad)),
});
check(
  r1.ok && posts.length === 1 && posts[0].includes("[high]"),
  "新しい警報を Slack に1回出す",
  r1.line,
);
check(
  r1.state.notified?.[`cron_down:${REL}:2026-11-26`] === "2026-11-26",
  "出した鍵と日を覚える",
  JSON.stringify(r1.state.notified),
);
check(
  noLeak(r1.line) && noLeak(JSON.stringify(r1.state)) && noLeak(posts[0]),
  "行・state・Slack の文にトークンと webhook を入れない",
);
const r2 = await runWatch({
  ...base,
  state: r1.state,
  fetchImpl: slack(rowsFor(bad)),
});
check(
  r2.ok && posts.length === 1 && r2.line.includes("新しい警報なし"),
  "同じ警報は2回出さない",
  r2.line,
);

const r3 = await runWatch({
  ...base,
  state: {},
  fetchImpl: slack(rowsFor(bad), false),
});
check(
  !r3.ok && !r3.state.notified && r3.line.includes("次の回"),
  "Slack に出せなければ覚えない（数は残す）",
);
check(Object.keys(r3.state.counts).length === 2, "出せなくても取れた数は残す");
const r4 = await runWatch({
  ...base,
  state: {},
  readWebhook: () => null,
  fetchImpl: slack(rowsFor(bad)),
});
check(
  !r4.ok && !r4.state.notified && r4.line.includes(`cron_down:${REL}`),
  "webhook が無ければ出さず鍵だけ知らせる",
);

const e1 = await step({
  state: r1.state,
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
  JSON.stringify(e1.counts) === JSON.stringify(r1.state.counts) &&
    e1.queried_to === r1.state.queried_to,
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
check(
  alerts(e1, now).every((a) => a.key !== "cron_watch_error"),
  "1回の失敗では知らせない",
);
const e4 = await step({
  state: e1,
  now,
  ids,
  readToken: () => TOKEN,
  fetchImpl: async () => fail500,
});
check(
  keys(alerts(e4, now)).includes("mid:cron_watch_error") && e4.err_streak === 2,
  "連続で取れなければ mid（見えていないことを知らせる）",
);
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
  console.error(`verify-cron-watch: ${failures} 件の失敗`);
  process.exit(1);
}
console.log("verify-cron-watch: すべて通った");
