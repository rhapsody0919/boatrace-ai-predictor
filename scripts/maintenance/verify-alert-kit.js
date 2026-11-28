#!/usr/bin/env node
/**
 * alertKit.js（見張りの CLI が共有する Keychain の読み・新しい警報だけ・Slack への POST）の振る舞いを、偽の実行と偽の送信で確かめる:
 * 読めなければ null・値は前後の空白を落とす・新しい警報は鍵で絞る・POST は失敗を例外にせず状態を返し、本文と宛先を JSON で送る。
 */
import {
  SLACK_WEBHOOK_KEYCHAIN,
  freshAlerts,
  postSlack,
  readKeychain,
} from "../lib/alertKit.js";

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(
    `${ok ? "OK" : "NG"} ${label}${ok || !detail ? "" : `\n   ${detail}`}`,
  );
  if (!ok) failures++;
};

check(
  SLACK_WEBHOOK_KEYCHAIN.service === "hq-slack-webhook" &&
    SLACK_WEBHOOK_KEYCHAIN.account === "hq",
  "webhook の鍵名は hq-slack-webhook / hq",
);

// readKeychain
let seen = null;
const ok = (cmd, args, opts) => {
  seen = { cmd, args, opts };
  return "  secret-value\n";
};
check(
  readKeychain("svc", "acc", ok) === "secret-value",
  "値の前後の空白を落とす",
);
check(
  seen.cmd === "/usr/bin/security" &&
    seen.args.join(" ") === "find-generic-password -s svc -a acc -w" &&
    seen.opts.stdio[2] === "ignore",
  "security に -s -a -w で渡し、標準エラーを捨てる",
  JSON.stringify(seen),
);
check(
  readKeychain("s", "a", () => {
    throw new Error("not found");
  }) === null,
  "実行が失敗したら null（例外にしない）",
);
check(readKeychain("s", "a", () => " \n") === null, "空なら null");

// freshAlerts
const alerts = [{ key: "a" }, { key: "b" }, { key: "c" }];
check(
  freshAlerts(alerts, { notified: { b: "2026-11-28" } })
    .map((x) => x.key)
    .join() === "a,c",
  "出した鍵は除く",
);
check(freshAlerts(alerts, null).length === 3, "state が null なら全部");
check(freshAlerts(alerts, {}).length === 3, "notified が無ければ全部");

// postSlack
const calls = [];
const fake = (res) => async (url, init) => {
  calls.push({ url, init });
  if (res instanceof Error) throw res;
  return res;
};
const r1 = await postSlack(
  "https://hook.example/x",
  "こんにちは",
  fake({ ok: true, status: 200 }),
);
check(r1.ok === true && r1.status === 200, "成功は ok");
check(
  calls[0].url === "https://hook.example/x" &&
    calls[0].init.method === "POST" &&
    calls[0].init.headers["Content-Type"] === "application/json" &&
    JSON.parse(calls[0].init.body).text === "こんにちは" &&
    calls[0].init.signal instanceof AbortSignal,
  "JSON の text を POST し、打ち切りの signal を付ける",
);
const r2 = await postSlack(
  "https://hook.example/x",
  "t",
  fake({ ok: false, status: 500 }),
);
check(r2.ok === false && r2.status === 500, "HTTP の失敗は ok=false と status");
const err = new TypeError("fetch failed https://hook.example/secret");
const r3 = await postSlack("https://hook.example/secret", "t", fake(err));
check(
  r3.ok === false &&
    r3.status === "TypeError" &&
    !JSON.stringify(r3).includes("secret"),
  "通信の失敗は例外にせず、status はエラー名だけ（webhook を含まない）",
  JSON.stringify(r3),
);

if (failures > 0) {
  console.error(`${failures} 件失敗`);
  process.exit(1);
}
console.log("alert-kit: OK");
