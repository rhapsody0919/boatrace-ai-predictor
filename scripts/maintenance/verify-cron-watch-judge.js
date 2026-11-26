#!/usr/bin/env node
/**
 * cron-watch-judge.js（Vercel Cron の失敗の判定）を固定した時計で確かめる: 出荷の cron が両方落ちたら high・
 * 拾い直しで戻れば鳴らさない・戻らなければ mid・401 の単発は鳴らさない・失敗の割合・
 * 24時間の沈黙は測りが24時間ある時だけ・key の日は最初に落ちた時間の JST。通信・Keychain・ファイルには触らない。
 */
import { judge } from "./cron-watch-judge.js";

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

if (failures > 0) {
  console.error(`verify-cron-watch-judge: ${failures} 件の失敗`);
  process.exit(1);
}
console.log("verify-cron-watch-judge: すべて通った");
