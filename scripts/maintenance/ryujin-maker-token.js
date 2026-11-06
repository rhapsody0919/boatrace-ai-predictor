#!/usr/bin/env node
/**
 * ryujin-maker-token.js - 作成の App（ryujin-maker、ADR-0097）の秘密鍵から、このリポジトリだけに効く
 * 1時間のインストールのトークンを作り、gh・git に GH_TOKEN で渡す。Claude のセッションの push・PR 作成・
 * マージを ryujin-maker の名義にするため（オーナー決定 2026-11-06。admin の bypass を外す前提）。
 *
 * 使い方:
 *   node scripts/maintenance/ryujin-maker-token.js -- gh pr create --base master --fill
 *   node scripts/maintenance/ryujin-maker-token.js -- git push -u origin HEAD
 *   node scripts/maintenance/ryujin-maker-token.js -- gh pr merge 1234 --squash
 *     `--` の後の gh・git を、トークンを環境変数 GH_TOKEN に入れて動かす（トークンは画面にもファイルにも出ない）。
 *     git push は ~/.gitconfig の `credential.https://github.com.helper=!gh auth git-credential` が GH_TOKEN を
 *     x-access-token として渡す（2026-11-06 に `git credential fill` で確かめた）
 *   GH_TOKEN=$(node scripts/maintenance/ryujin-maker-token.js --print) gh ...
 *     トークンを標準出力に出す。`$(...)` の中で受けるときだけ使う。引数なしでは出さない（付け忘れて会話の記録に残さない）
 *
 * 置き場（既定。環境変数で変えられる）:
 *   秘密鍵   ~/.config/ryujin/ryujin-maker.pem（RYUJIN_MAKER_KEY_FILE）。オーナーが置く。権限は 600（持ち主だけ）しか受けない
 *   App ID   5377197（RYUJIN_MAKER_APP_ID）。秘密ではない（JWT の iss に入る値。hq の config/github-apps.json と同じ）
 *   Installation ID は置かない。JWT で GET /repos/{repo}/installation を引いて決める（hq の scripts/app-token.sh と同じ）
 *
 * 守ること: 鍵の中身・トークン・JWT を標準エラー・例外の文に出さない。外部の依存は使わない（Node の組み込みの crypto と fetch）。
 * 検証: scripts/maintenance/verify-ryujin-maker-token.js（使い捨ての鍵で試す。本物の鍵は読まない）
 */
import { spawnSync } from "node:child_process";
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = "rhapsody0919/boatrace-ai-predictor";
export const DEFAULT_APP_ID = "5377197";
export const DEFAULT_KEY_FILE = path.join(
  os.homedir(),
  ".config",
  "ryujin",
  "ryujin-maker.pem",
);
/** `--` の後に置ける命令。トークンを渡す相手を gh と git に限る */
export const ALLOWED_COMMANDS = new Set(["gh", "git"]);
const API = "https://api.github.com";
const TIMEOUT_MS = 20_000;
const USAGE =
  "使い方: node scripts/maintenance/ryujin-maker-token.js -- gh <引数> | -- git <引数> | --print（$(...) の中だけ）";

const b64url = (buf) => Buffer.from(buf).toString("base64url");

/** App の JWT（RS256）。iat は時計のずれに備えて60秒前、exp は GitHub の上限10分の内側の9分後 */
export function buildJwt({ appId, privateKey, nowSec }) {
  if (!/^\d+$/.test(String(appId)))
    throw new Error(`App ID が数字でない: ${appId}`);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ iat: nowSec - 60, exp: nowSec + 540, iss: String(appId) }),
  );
  const signature = b64url(
    sign("sha256", Buffer.from(`${header}.${payload}`), privateKey),
  );
  return `${header}.${payload}.${signature}`;
}

/**
 * 秘密鍵を読む。持ち主以外が読める・書ける権限（group・other のどれか）なら読まずに止める。
 * 失敗の文には鍵のパスだけを書き、中身も Node の例外の文も出さない。
 */
export function loadPrivateKey(keyFile) {
  let st;
  try {
    st = statSync(keyFile);
  } catch {
    throw new Error(
      `秘密鍵が無い: ${keyFile}（オーナーが置く。docs/operation/identity-separation-owner-steps.md の 9）`,
    );
  }
  if (!st.isFile()) throw new Error(`秘密鍵がファイルでない: ${keyFile}`);
  if ((st.mode & 0o077) !== 0) {
    throw new Error(
      `秘密鍵の権限が広い（${(st.mode & 0o777).toString(8)}）: ${keyFile}。オーナーが chmod 600 にする`,
    );
  }
  try {
    return createPrivateKey(readFileSync(keyFile));
  } catch {
    throw new Error(`秘密鍵が読めない（PEM の秘密鍵か確かめる）: ${keyFile}`);
  }
}

/** GitHub の API を1回呼ぶ。失敗の文は状態の番号と GitHub の message だけ（トークン・JWT は入れない） */
async function callGitHub(fetchImpl, method, url, jwt, body) {
  const res = await fetchImpl(url, {
    method,
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      typeof json?.message === "string"
        ? `: ${json.message.slice(0, 200)}`
        : "";
    throw new Error(
      `${method} ${new URL(url).pathname} が ${res.status} を返した${message}`,
    );
  }
  return json;
}

/** インストールのトークンを作る。トークンはこのリポジトリだけに絞る（App の他のインストール先には効かない） */
export async function mintInstallationToken({
  appId,
  privateKey,
  repo = REPO,
  fetchImpl = fetch,
  nowSec,
}) {
  const jwt = buildJwt({
    appId,
    privateKey,
    nowSec: nowSec ?? Math.floor(Date.now() / 1000),
  });
  const installation = await callGitHub(
    fetchImpl,
    "GET",
    `${API}/repos/${repo}/installation`,
    jwt,
  );
  if (!Number.isInteger(installation?.id)) {
    throw new Error(
      `ryujin-maker が ${repo} に入っていない（App の Install の対象を確かめる）`,
    );
  }
  const created = await callGitHub(
    fetchImpl,
    "POST",
    `${API}/app/installations/${installation.id}/access_tokens`,
    jwt,
    {
      repositories: [repo.split("/")[1]],
    },
  );
  if (typeof created?.token !== "string" || created.token === "") {
    throw new Error("インストールのトークンが返事に無い");
  }
  return created.token;
}

/** 引数を読む。{ mode: "print" } か { mode: "exec", command, args }。それ以外は例外 */
export function parseArgs(argv) {
  if (argv.length === 1 && argv[0] === "--print") return { mode: "print" };
  if (argv[0] === "--" && ALLOWED_COMMANDS.has(argv[1])) {
    return { mode: "exec", command: argv[1], args: argv.slice(2) };
  }
  throw new Error(USAGE);
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const keyFile = process.env.RYUJIN_MAKER_KEY_FILE || DEFAULT_KEY_FILE;
  const appId = process.env.RYUJIN_MAKER_APP_ID || DEFAULT_APP_ID;
  const token = await mintInstallationToken({
    appId,
    privateKey: loadPrivateKey(keyFile),
  });
  if (parsed.mode === "print") {
    if (process.stdout.isTTY)
      throw new Error(
        "標準出力が端末なのでトークンを出さない（$(...) の中で使う）",
      );
    process.stdout.write(token);
    return 0;
  }
  const child = spawnSync(parsed.command, parsed.args, {
    stdio: "inherit",
    env: { ...process.env, GH_TOKEN: token },
  });
  if (child.error)
    throw new Error(`${parsed.command} を起動できない: ${child.error.message}`);
  return child.status ?? 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(
        `ryujin-maker-token: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    },
  );
}
