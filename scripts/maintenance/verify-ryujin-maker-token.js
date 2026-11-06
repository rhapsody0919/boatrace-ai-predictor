#!/usr/bin/env node
/**
 * verify-ryujin-maker-token.js - ryujin-maker-token.js（作成の App のトークンを作る）を、使い捨ての鍵と
 * 偽の fetch で確かめる。本物の鍵（~/.config/ryujin/ryujin-maker.pem）は読まない。ネットワークにも出ない。
 *
 * 確かめること:
 *   (a) JWT が RS256 で、使い捨ての鍵の公開鍵で検証でき、iss・iat・exp が決まりどおり
 *   (b) 鍵の権限が 600 より広いと読まずに止め、失敗の文に鍵の中身が出ない
 *   (c) 壊れた鍵の失敗の文に、ファイルの中身が出ない
 *   (d) GitHub への呼び出しの形（GET installation → POST access_tokens、このリポジトリだけに絞る）と、返すトークン
 *   (e) GitHub の失敗の文に JWT が出ない
 *   (f) 引数なしではトークンを出さない（--print か `-- gh`・`-- git` だけ受ける）。CLI も鍵を読む前に止まる
 */
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, verify } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildJwt,
  loadPrivateKey,
  mintInstallationToken,
  parseArgs,
} from "./ryujin-maker-token.js";

let failures = 0;
const check = (ok, label, detail = "") => {
  if (ok) {
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    console.error(`  NG  ${label}${detail ? ` — ${detail}` : ""}`);
  }
};
const errorOf = (fn) => {
  try {
    fn();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
};
const asyncErrorOf = async (fn) => {
  try {
    await fn();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
};
const decode = (part) =>
  JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

const dir = mkdtempSync(path.join(os.tmpdir(), "verify-ryujin-maker-"));
try {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const pem = privateKey.export({ type: "pkcs1", format: "pem" });
  const pemBody = pem.split("\n")[1];
  const keyFile = path.join(dir, "key.pem");
  writeFileSync(keyFile, pem, { mode: 0o600 });

  console.log("(a) JWT");
  const now = 1_800_000_000;
  const jwt = buildJwt({
    appId: "5377197",
    privateKey: loadPrivateKey(keyFile),
    nowSec: now,
  });
  const [h, p, s] = jwt.split(".");
  check(
    decode(h).alg === "RS256" && decode(h).typ === "JWT",
    "header は RS256・JWT",
    JSON.stringify(decode(h)),
  );
  const claims = decode(p);
  check(
    claims.iss === "5377197" &&
      claims.iat === now - 60 &&
      claims.exp === now + 540,
    "iss は App ID、iat は60秒前、exp は9分後（GitHub の上限10分の内側）",
    JSON.stringify(claims),
  );
  check(
    verify(
      "sha256",
      Buffer.from(`${h}.${p}`),
      publicKey,
      Buffer.from(s, "base64url"),
    ),
    "署名が使い捨ての鍵の公開鍵で検証できる",
  );
  check(
    errorOf(() => buildJwt({ appId: "abc", privateKey, nowSec: now })) !== null,
    "App ID が数字でなければ止める",
  );

  console.log("(b) 鍵の権限");
  const wide = path.join(dir, "wide.pem");
  writeFileSync(wide, pem);
  chmodSync(wide, 0o644);
  const wideErr = errorOf(() => loadPrivateKey(wide));
  check(
    wideErr?.includes("権限が広い") && wideErr.includes("644"),
    "644 の鍵は読まずに止める",
    wideErr ?? "止まらなかった",
  );
  check(!wideErr?.includes(pemBody), "失敗の文に鍵の中身が出ない");
  const missingErr = errorOf(() => loadPrivateKey(path.join(dir, "none.pem")));
  check(
    missingErr?.includes("秘密鍵が無い"),
    "鍵が無いときは置き場を言って止める",
    missingErr ?? "止まらなかった",
  );

  console.log("(c) 壊れた鍵");
  const marker = "MARKER-SHOULD-NOT-APPEAR-0123456789";
  const broken = path.join(dir, "broken.pem");
  writeFileSync(
    broken,
    `-----BEGIN RSA PRIVATE KEY-----\n${marker}\n-----END RSA PRIVATE KEY-----\n`,
    { mode: 0o600 },
  );
  const brokenErr = errorOf(() => loadPrivateKey(broken));
  check(
    brokenErr?.includes("読めない") && !brokenErr.includes(marker),
    "壊れた鍵は中身を出さずに止める",
    brokenErr ?? "止まらなかった",
  );

  console.log("(d) GitHub への呼び出し");
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({
      url,
      method: init.method,
      auth: init.headers.Authorization,
      body: init.body,
    });
    const body = url.endsWith("/installation")
      ? { id: 42 }
      : { token: "ghs_fake_for_test" };
    return { ok: true, status: 200, json: async () => body };
  };
  const token = await mintInstallationToken({
    appId: "5377197",
    privateKey: loadPrivateKey(keyFile),
    fetchImpl: fakeFetch,
    nowSec: now,
  });
  check(token === "ghs_fake_for_test", "返事のトークンを返す");
  check(
    calls.length === 2 &&
      calls[0].method === "GET" &&
      calls[0].url ===
        "https://api.github.com/repos/rhapsody0919/boatrace-ai-predictor/installation" &&
      calls[1].method === "POST" &&
      calls[1].url ===
        "https://api.github.com/app/installations/42/access_tokens",
    "GET installation → POST access_tokens の順",
    JSON.stringify(calls.map((c) => `${c.method} ${c.url}`)),
  );
  check(
    calls.every((c) => /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(c.auth)),
    "どちらも JWT を Bearer で送る",
  );
  check(
    calls[1].body ===
      JSON.stringify({ repositories: ["boatrace-ai-predictor"] }),
    "トークンをこのリポジトリだけに絞る",
    String(calls[1].body),
  );

  console.log("(e) GitHub の失敗");
  let sentJwt = "";
  const failingFetch = async (url, init) => {
    sentJwt = init.headers.Authorization.slice("Bearer ".length);
    return {
      ok: false,
      status: 401,
      json: async () => ({ message: "A JSON web token could not be decoded" }),
    };
  };
  const apiErr = await asyncErrorOf(() =>
    mintInstallationToken({
      appId: "5377197",
      privateKey: loadPrivateKey(keyFile),
      fetchImpl: failingFetch,
      nowSec: now,
    }),
  );
  check(
    apiErr?.includes("401") && apiErr.includes("could not be decoded"),
    "状態の番号と GitHub の message を出す",
    apiErr ?? "止まらなかった",
  );
  check(
    sentJwt !== "" && !apiErr?.includes(sentJwt),
    "失敗の文に JWT が出ない",
  );
  const noInstallErr = await asyncErrorOf(() =>
    mintInstallationToken({
      appId: "5377197",
      privateKey: loadPrivateKey(keyFile),
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({}),
      }),
      nowSec: now,
    }),
  );
  check(
    noInstallErr?.includes("入っていない"),
    "installation の id が無ければ止める",
    noInstallErr ?? "止まらなかった",
  );

  console.log("(f) 引数");
  check(parseArgs(["--print"]).mode === "print", "--print はトークンを出す形");
  const exec = parseArgs(["--", "gh", "pr", "view", "1"]);
  check(
    exec.mode === "exec" &&
      exec.command === "gh" &&
      exec.args.join(" ") === "pr view 1",
    "`-- gh ...` は gh を動かす形",
  );
  check(
    parseArgs(["--", "git", "push"]).command === "git",
    "`-- git ...` は git を動かす形",
  );
  for (const argv of [
    [],
    ["--", "sh", "-c", "env"],
    ["--print", "extra"],
    ["gh", "pr", "list"],
  ]) {
    check(
      errorOf(() => parseArgs(argv)) !== null,
      `受けない引数: ${JSON.stringify(argv)}`,
    );
  }
  const script = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "ryujin-maker-token.js",
  );
  const cli = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...process.env, RYUJIN_MAKER_KEY_FILE: keyFile },
  });
  check(
    cli.status === 1 && cli.stdout === "" && cli.stderr.includes("使い方"),
    "引数なしの CLI は何も出さずに使い方で止まる",
    JSON.stringify({ status: cli.status, stdout: cli.stdout }),
  );
  const cliWide = spawnSync(process.execPath, [script, "--print"], {
    encoding: "utf8",
    env: { ...process.env, RYUJIN_MAKER_KEY_FILE: wide },
  });
  check(
    cliWide.status === 1 &&
      cliWide.stdout === "" &&
      !cliWide.stderr.includes(pemBody),
    "権限の広い鍵では CLI がネットワークに出る前に止まり、中身を出さない",
    JSON.stringify({
      status: cliWide.status,
      stderr: cliWide.stderr.slice(0, 200),
    }),
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`verify-ryujin-maker-token: ${failures} 件失敗`);
  process.exit(1);
}
console.log("verify-ryujin-maker-token: OK");
