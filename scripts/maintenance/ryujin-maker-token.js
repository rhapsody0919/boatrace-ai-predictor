#!/usr/bin/env node
/**
 * ryujin-maker-token.js - 作成の App（ryujin-maker、ADR-0097）の秘密鍵から、このリポジトリだけに効く
 * 1時間のインストールのトークンを作り、gh・git に GH_TOKEN で渡して動かす。Claude のセッションの push・PR 作成・
 * マージを ryujin-maker の名義にするため（オーナー決定 2026-11-06。admin の bypass を外す前提）。
 *
 * 使い方:
 *   node scripts/maintenance/ryujin-maker-token.js -- gh pr create --base master --fill
 *   node scripts/maintenance/ryujin-maker-token.js -- git push -u origin HEAD
 *   node scripts/maintenance/ryujin-maker-token.js -- gh pr merge 1234 --squash --match-head-commit <sha>
 *   node scripts/maintenance/ryujin-maker-token.js --workflows -- git push -u origin HEAD
 *     `--` の後の gh・git を、トークンを環境変数 GH_TOKEN に入れて動かす。トークンは標準出力・ファイルに出さない
 *     （Claude の Bash の道具では標準出力が端末でないので、出す形を作ると会話の記録に残りうる。だから出す形を持たない）。
 *     git push は ~/.gitconfig の `credential.https://github.com.helper=!gh auth git-credential` が GH_TOKEN を
 *     x-access-token として渡す（2026-11-06 に `git credential fill` で確かめた）
 *     `--workflows` は .github/workflows を変える枝の push・マージのときだけ付ける（トークンに workflows: write を足す）
 *
 * トークンの権限（このリポジトリだけ）: contents・pull_requests は write、checks・statuses・actions は read。
 * workflows: write は `--workflows` のときだけ。
 *
 * 置き場（既定。環境変数で変えられる）:
 *   秘密鍵   ~/.config/ryujin/ryujin-maker.pem（RYUJIN_MAKER_KEY_FILE）。オーナーが置く。持ち主が自分で、権限が 600（持ち主だけ）のものしか受けない
 *   App ID   5377197（RYUJIN_MAKER_APP_ID）。秘密ではない（JWT の iss に入る値。hq の config/github-apps.json と同じ）
 *   Installation ID は置かない。JWT で GET /repos/{repo}/installation を引いて決める（hq の scripts/app-token.sh と同じ）
 *
 * 守ること: 鍵の中身・トークン・JWT を標準出力・標準エラー・例外の文に出さない。外部の依存は使わない（Node の組み込みの crypto と fetch）。
 * `-- git` は git のどの命令も動かせるので、gh と git に限ることは守りに数えない。
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
/** `--` の後に置ける命令 */
export const ALLOWED_COMMANDS = new Set(["gh", "git"]);
const API = "https://api.github.com";
const TIMEOUT_MS = 20_000;
const USAGE =
  "使い方: node scripts/maintenance/ryujin-maker-token.js [--workflows] -- gh <引数> | -- git <引数>";

const b64url = (buf) => Buffer.from(buf).toString("base64url");

/** トークンに付ける権限。App の権限の内側で、要るものだけ */
export function tokenPermissions({ workflows }) {
  return {
    contents: "write",
    pull_requests: "write",
    checks: "read",
    statuses: "read",
    actions: "read",
    ...(workflows ? { workflows: "write" } : {}),
  };
}

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
 * 秘密鍵を読む。持ち主が自分でない・持ち主以外が読める書ける権限（group・other のどれか）なら読まずに止める。
 * 失敗の文には鍵のパスだけを書き、中身も Node の例外の文も出さない。
 */
export function loadPrivateKey(keyFile, uid = process.getuid?.()) {
  let st;
  try {
    st = statSync(keyFile);
  } catch {
    throw new Error(
      `秘密鍵が無い: ${keyFile}（オーナーが置く。docs/operation/identity-separation-owner-steps.md の 9-2）`,
    );
  }
  if (!st.isFile()) throw new Error(`秘密鍵がファイルでない: ${keyFile}`);
  if (uid !== undefined && st.uid !== uid)
    throw new Error(`秘密鍵の持ち主が今のユーザーでない: ${keyFile}`);
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

/** インストールのトークンを作る。このリポジトリだけ・要る権限だけに絞る */
export async function mintInstallationToken({
  appId,
  privateKey,
  repo = REPO,
  workflows = false,
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
      permissions: tokenPermissions({ workflows }),
    },
  );
  if (typeof created?.token !== "string" || created.token === "") {
    throw new Error("インストールのトークンが返事に無い");
  }
  return created.token;
}

/** 引数を読む。{ workflows, command, args }。それ以外は例外（鍵を読む前に止める） */
export function parseArgs(argv) {
  const workflows = argv[0] === "--workflows";
  const rest = workflows ? argv.slice(1) : argv;
  if (rest[0] === "--" && ALLOWED_COMMANDS.has(rest[1])) {
    return { workflows, command: rest[1], args: rest.slice(2) };
  }
  throw new Error(USAGE);
}

async function main() {
  const { workflows, command, args } = parseArgs(process.argv.slice(2));
  const keyFile = process.env.RYUJIN_MAKER_KEY_FILE || DEFAULT_KEY_FILE;
  const appId = process.env.RYUJIN_MAKER_APP_ID || DEFAULT_APP_ID;
  const token = await mintInstallationToken({
    appId,
    privateKey: loadPrivateKey(keyFile),
    workflows,
  });
  const child = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, GH_TOKEN: token },
  });
  if (child.error)
    throw new Error(`${command} を起動できない: ${child.error.message}`);
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
