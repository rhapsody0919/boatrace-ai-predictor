#!/usr/bin/env node
/**
 * actions-fresh.js（Actions の「最後の起動が古い」の検知）を、固定した時計と偽の取得・webhook で確かめる:
 * 線より古い・1回も無いを high にする（線の内側は出さない・event ごとに別の鍵）、問い合わせの絞り込み（success・event・any）、
 * 新しい警報だけ1回 Slack に出す・出せなければ覚えない・直ったら鍵を忘れて次に止まればまた出す、
 * 取得の失敗は連続2回で mid（応答の本文を文に入れない）、webhook を戻り値・state・標準出力の行に入れない。
 * 通信・Keychain・ファイルには触らない。
 */
import {
  ERR_STREAK,
  LINES,
  runFresh,
  runsUrl,
  staleAlerts,
} from "./actions-fresh.js";

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(
    `${ok ? "OK" : "NG"} ${label}${ok || !detail ? "" : `\n   ${detail}`}`,
  );
  if (!ok) failures++;
};

const now = new Date("2026-11-26T12:00:00Z");
const ago = (h) => new Date(now.getTime() - h * 3600 * 1000).toISOString();
const HOOK = "https://hooks.example/SECRET_HOOK";
const keys = (a) => a.map((x) => x.key).join(",");

// 並びは LINES: DB dispatch 3h・DB any 8h・Job Watch success 3h・Job Watch schedule 12h
check(
  staleAlerts(LINES, [ago(1), ago(1), ago(1), ago(1)], now).length === 0,
  "全部線の内側なら出さない",
);
check(
  keys(staleAlerts(LINES, [ago(4), ago(1), ago(1), ago(1)], now)) ===
    "actions_stale:DBApplyproduction:workflow_dispatch",
  "線より古い線だけ出す（event ごとに別の鍵）",
);
check(
  keys(staleAlerts(LINES, [ago(1), ago(1), ago(1), ago(13)], now)) ===
    "actions_stale:JobWatch:schedule",
  "Job Watch の schedule は12時間が線",
);
const none = staleAlerts(LINES, [ago(1), ago(1), null, ago(1)], now);
check(
  none.length === 1 &&
    none[0].level === "high" &&
    none[0].text.includes("見つからず"),
  "1回も無ければ high",
);
check(
  staleAlerts(LINES, [ago(3), ago(1), ago(1), ago(1)], now).length === 0,
  "線ちょうどは出さない",
);

const q = (line) => new URL(runsUrl(line)).searchParams;
check(
  q(LINES[2]).get("status") === "success" && !q(LINES[2]).has("event"),
  "success は結論で絞り event を問わない",
);
check(
  q(LINES[0]).get("event") === "workflow_dispatch" &&
    !q(LINES[0]).has("status"),
  "event は event で絞る",
);
check(
  !q(LINES[1]).has("event") &&
    !q(LINES[1]).has("status") &&
    q(LINES[1]).get("per_page") === "1",
  "any は絞らず最新の1件",
);
check(
  runsUrl(LINES[0]).includes("/workflows/db-apply.yml/runs"),
  "workflow のファイルで引く",
);

const posts = [];
const api = (lasts) => async (url, init) => {
  if (url === HOOK) {
    posts.push(JSON.parse(init.body).text);
    return { ok: true, status: 200 };
  }
  const i = LINES.findIndex((l) => runsUrl(l) === url);
  return {
    ok: true,
    status: 200,
    json: async () => ({
      workflow_runs: lasts[i] ? [{ created_at: lasts[i] }] : [],
    }),
  };
};
const base = { now, readWebhook: () => HOOK };
const stale = [ago(1), ago(9), ago(1), ago(1)]; // DB any だけ古い
const good = [ago(1), ago(1), ago(1), ago(1)];
const noLeak = (s) => !s.includes(HOOK);

const r1 = await runFresh({ ...base, state: null, fetchImpl: api(stale) });
check(
  r1.ok && posts.length === 1 && posts[0].includes("[high]"),
  "新しい警報を Slack に1回出す",
  r1.line,
);
check(
  r1.state.notified?.["actions_stale:DBApplyproduction:any"] === "2026-11-26",
  "出した鍵と日を覚える",
  JSON.stringify(r1.state),
);
check(
  noLeak(r1.line) && noLeak(JSON.stringify(r1.state)),
  "行と state に webhook を入れない",
);
const r2 = await runFresh({ ...base, state: r1.state, fetchImpl: api(stale) });
check(
  r2.ok && posts.length === 1 && r2.line.includes("新しい警報なし"),
  "続いている警報は2回出さない",
);
const r3 = await runFresh({ ...base, state: r2.state, fetchImpl: api(good) });
check(
  r3.ok && Object.keys(r3.state.notified).length === 0,
  "直ったら鍵を忘れる",
);
const r4 = await runFresh({ ...base, state: r3.state, fetchImpl: api(stale) });
check(posts.length === 2 && r4.ok, "直った後にまた止まれば出す");

const down = (inner) => async (url, init) =>
  url === HOOK ? { ok: false, status: 500 } : inner(url, init);
const r5 = await runFresh({
  ...base,
  state: null,
  fetchImpl: down(api(stale)),
});
check(
  !r5.ok &&
    Object.keys(r5.state.notified).length === 0 &&
    r5.line.includes("次の回"),
  "Slack に出せなければ覚えない",
);
const r6 = await runFresh({
  ...base,
  state: null,
  readWebhook: () => null,
  fetchImpl: api(stale),
});
check(
  !r6.ok && r6.line.includes("actions_stale:DBApplyproduction:any"),
  "webhook が無ければ出さず鍵だけ知らせる",
);

const err = async () => ({
  ok: false,
  status: 403,
  json: async () => ({ message: `rate limit ${HOOK}` }),
});
const e1 = await runFresh({ ...base, state: null, fetchImpl: err });
check(
  !e1.ok && e1.state.err_streak === 1 && posts.length === 2,
  "取得の失敗は1回では知らせない",
);
check(
  e1.line.includes("HTTP 403") && noLeak(e1.line + JSON.stringify(e1.state)),
  "失敗の文は状態だけ（応答の本文を入れない）",
);
const e2 = await runFresh({
  ...base,
  state: e1.state,
  fetchImpl: async (u, i) => (u === HOOK ? api(good)(u, i) : err()),
});
check(
  ERR_STREAK === 2 && posts.length === 3 && posts[2].includes("[mid]"),
  "連続2回で mid を出す",
  posts[2],
);
const thrown = await runFresh({
  ...base,
  state: null,
  fetchImpl: async () => {
    throw new TypeError(`fetch failed ${HOOK}`);
  },
});
check(
  !thrown.ok && noLeak(thrown.line) && thrown.line.includes("TypeError"),
  "通信の例外の文に本文を入れない",
  thrown.line,
);
const e3 = await runFresh({ ...base, state: e2.state, fetchImpl: api(good) });
check(
  e3.ok &&
    e3.state.err_streak === 0 &&
    Object.keys(e3.state.notified).length === 0,
  "取れたら連続の失敗を戻し mid の鍵を忘れる",
);

if (failures > 0) {
  console.error(`verify-actions-fresh: ${failures} 件の失敗`);
  process.exit(1);
}
console.log("verify-actions-fresh: すべて通った");
