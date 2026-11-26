#!/usr/bin/env node
/**
 * actions-fresh-judge.js（Actions の「最後の起動が古い」の判定）を固定した時計で確かめる:
 * 線より古い・1回も無いを high にする（線の内側は出さない・event ごとに別の鍵・線ちょうどは出さない）、
 * 問い合わせの絞り込み（success は結論・event は event・any は絞らず最新の1件・workflow のファイルで引く）。
 * 通信・Keychain・ファイルには触らない。
 */
import { LINES, runsUrl, staleAlerts } from "./actions-fresh-judge.js";

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(
    `${ok ? "OK" : "NG"} ${label}${ok || !detail ? "" : `\n   ${detail}`}`,
  );
  if (!ok) failures++;
};

const now = new Date("2026-11-26T12:00:00Z");
const ago = (h) => new Date(now.getTime() - h * 3600 * 1000).toISOString();
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

if (failures > 0) {
  console.error(`verify-actions-fresh-judge: ${failures} 件の失敗`);
  process.exit(1);
}
console.log("verify-actions-fresh-judge: すべて通った");
