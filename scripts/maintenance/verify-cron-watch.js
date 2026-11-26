#!/usr/bin/env node
/**
 * cron-watch.js（Vercel Cron の見張り CLI）の警報と通知を、固定した時計と偽の取得・webhook で確かめる:
 * 新しい警報だけ1回 Slack に出す・出せなければ覚えない（取れた数は残す）・webhook が無ければ鍵だけ知らせる、
 * 連続2回の取得の失敗は mid（1回では知らせない）、トークンと webhook を戻り値・state・標準出力の行・Slack の文に入れない。
 * 取得は verify-cron-watch-fetch.js、判定は verify-cron-watch-judge.js。通信・Keychain・ファイルには触らない。
 */
import { alerts, runWatch } from "./cron-watch.js";

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(
    `${ok ? "OK" : "NG"} ${label}${ok || !detail ? "" : `\n   ${detail}`}`,
  );
  if (!ok) failures++;
};

const now = new Date("2026-11-26T03:00:00Z"); // JST 12:00
const REL = "/api/cron/release-dispatch";

// ---- 通知 ----
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

check(
  alerts({ err_streak: 1, last_error: "x" }, now).length === 0,
  "1回の失敗では知らせない",
);
const e2 = alerts(
  { err_streak: 2, last_error: "Keychain に Vercel のトークンが無い" },
  now,
);
check(
  e2.length === 1 && e2[0].level === "mid" && e2[0].key === "cron_watch_error",
  "連続2回の失敗は mid（見えていないことを知らせる）",
);
const e3 = await runWatch({
  ...base,
  state: {},
  fetchImpl: async () => {
    throw new TypeError(`fetch failed ${TOKEN} ${HOOK}`);
  },
});
check(
  !e3.ok &&
    noLeak(e3.line + JSON.stringify(e3.state)) &&
    e3.state.err_streak === 1,
  "通信の例外の文にトークンと webhook を入れない",
  e3.line,
);

if (failures > 0) {
  console.error(`verify-cron-watch: ${failures} 件の失敗`);
  process.exit(1);
}
console.log("verify-cron-watch: すべて通った");
