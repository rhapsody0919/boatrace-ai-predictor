#!/usr/bin/env node
/**
 * install-actionlint.js - verify-actionlint.js が使う actionlint と shellcheck を、
 * actionlint-tools.json の固定版で取得する（BOA-659）。
 *
 * 取得方法の判断:
 *   - GitHub Releases の配布物を直接取得し、リポジトリに固定した sha256 と照合する。
 *     照合できなければ展開せずに失敗する（配布物の差し替えを検知するため）
 *   - go install はビルドに数十秒かかり、Go の版にも左右される。Docker イメージは
 *     手元の verify:ci から使いにくい。どちらも採らない
 *   - shellcheck も同じ方法で固定する。ubuntu-latest に入っている shellcheck は
 *     ランナーイメージの更新で版が変わり、指摘の増減で台帳が突然壊れるため
 *
 * 取り直し: GitHub Releases は CI のランナーに一時的な 403・429・5xx や接続の切断を返すことがある
 * （2026-11-18 の master の Quality Gates が HTTP 403 の1回で落ち、定時の release が止まった）。
 * 一時的な失敗（shouldRetryFetch）だけ、間隔を広げながら FETCH_MAX_ATTEMPTS 回まで取り直す。
 * 404 や sha256 の不一致のような、取り直しても変わらない失敗は1回で失敗にする
 *
 * 置き場所: $XDG_CACHE_HOME（無ければ ~/.cache）/boatai-tools/<名前>-<版>/。
 * worktree をまたいで共有され、版を上げると別ディレクトリになる。
 *
 * 使い方:
 *   node scripts/maintenance/install-actionlint.js   # 未取得なら取得する（取得済みなら何もしない）
 *   npm run setup:actionlint                         # 同じ
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOLS_PATH = path.join(HERE, "actionlint-tools.json");

export const PLATFORM_KEY = `${process.platform}-${process.arch}`;

const cacheRoot = () =>
  path.join(
    process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"),
    "boatai-tools",
  );

export async function readTools() {
  return JSON.parse(await fs.readFile(TOOLS_PATH, "utf8"));
}

/**
 * 各ツールの固定版・置き場所を返す。このプラットフォームの配布物が
 * 台帳に無ければ asset は null
 */
export async function toolPaths() {
  const tools = await readTools();
  const describe = (name) => {
    const { version, assets } = tools[name];
    const asset = assets[PLATFORM_KEY] ?? null;
    const dir = path.join(cacheRoot(), `${name}-${version}`);
    return {
      name,
      version,
      asset,
      dir,
      bin: asset ? path.join(dir, asset.binary) : null,
    };
  };
  return {
    actionlint: describe("actionlint"),
    shellcheck: describe("shellcheck"),
  };
}

/** 取得を試す回数の上限（最初の1回を含む）。回数と間隔は目安で、実測の根拠は無い */
export const FETCH_MAX_ATTEMPTS = 4;
const RETRY_BASE_MS = 5000;
const RETRY_FACTOR = 3;
const RETRYABLE_STATUS = new Set([403, 429]);
// ECONNRESET・ETIMEDOUT に加え、Node の fetch（undici）が接続の時間切れ・名前解決の一時的な失敗で返す符号
const RETRYABLE_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "EAI_AGAIN",
]);

/**
 * 取得の失敗が一時的で、取り直す価値があるか。status は HTTP の応答の状態、
 * code は通信の例外の符号（どちらか一方）。純関数
 */
export function shouldRetryFetch({ status = null, code = null } = {}) {
  if (status !== null) {
    return RETRYABLE_STATUS.has(status) || (status >= 500 && status <= 599);
  }
  return code !== null && RETRYABLE_CODES.has(code);
}

/** failedAttempts 回目の失敗の後に待つ時間（5秒・15秒・45秒）。純関数 */
export function retryDelayMs(failedAttempts) {
  return RETRY_BASE_MS * RETRY_FACTOR ** (failedAttempts - 1);
}

/** fetch の例外から通信の符号を取り出す（Node の fetch は cause に入れる）。無ければ null */
export function errorCode(e) {
  return e?.cause?.code ?? e?.code ?? null;
}

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * url の本体を Buffer で返す。一時的な失敗は間隔を広げて取り直し、
 * それ以外と、回数を使い切ったときは理由つきで失敗する。
 * fetchImpl・sleep・log は検証（verify-install-actionlint.js）で差し替える
 */
export async function fetchWithRetry(
  name,
  url,
  { fetchImpl = fetch, sleep = realSleep, log = console.log } = {},
) {
  for (let attempt = 1; ; attempt++) {
    let failure;
    try {
      const res = await fetchImpl(url);
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      failure = { status: res.status, label: `HTTP ${res.status}` };
    } catch (e) {
      const code = errorCode(e);
      failure = { code, label: code ?? e.message };
    }
    const retryable = shouldRetryFetch(failure);
    if (!retryable || attempt >= FETCH_MAX_ATTEMPTS) {
      throw new Error(
        `${name}: 取得に失敗しました（${failure.label}: ${url}${retryable ? `、${attempt}回試行` : ""}）`,
      );
    }
    const waitMs = retryDelayMs(attempt);
    log(
      `⏳ ${name}: 取得が一時的に失敗（${failure.label}）。${waitMs / 1000}秒後に取り直します（${attempt}/${FETCH_MAX_ATTEMPTS}回目）`,
    );
    await sleep(waitMs);
  }
}

async function install(tool) {
  if (!tool.asset) {
    throw new Error(
      `${tool.name}: このプラットフォーム（${PLATFORM_KEY}）の配布物が actionlint-tools.json にありません。` +
        "url と sha256 を追記してください",
    );
  }
  if (existsSync(tool.bin)) {
    console.log(`✅ ${tool.name} ${tool.version}: 取得済み（${tool.bin}）`);
    return;
  }
  const body = await fetchWithRetry(tool.name, tool.asset.url);
  const actual = createHash("sha256").update(body).digest("hex");
  if (actual !== tool.asset.sha256) {
    throw new Error(
      `${tool.name}: sha256 が固定値と一致しません。展開せずに中止します\n` +
        `  期待: ${tool.asset.sha256}\n  実際: ${actual}\n  URL: ${tool.asset.url}`,
    );
  }
  // 途中で落ちても中途半端なディレクトリが「取得済み」と見なされないよう、
  // 一時ディレクトリに展開してから rename する
  await fs.mkdir(path.dirname(tool.dir), { recursive: true });
  const tmp = await fs.mkdtemp(
    path.join(path.dirname(tool.dir), `.${tool.name}-`),
  );
  try {
    const archive = path.join(tmp, "archive.tar.gz");
    await fs.writeFile(archive, body);
    execFileSync("tar", ["xzf", archive, "-C", tmp], { stdio: "inherit" });
    await fs.rm(archive);
    await fs.chmod(path.join(tmp, tool.asset.binary), 0o755);
    await fs.rm(tool.dir, { recursive: true, force: true });
    await fs.rename(tmp, tool.dir);
  } catch (e) {
    await fs.rm(tmp, { recursive: true, force: true });
    throw e;
  }
  console.log(
    `✅ ${tool.name} ${tool.version}: 取得して sha256 を照合しました（${tool.bin}）`,
  );
}

async function main() {
  const { actionlint, shellcheck } = await toolPaths();
  await install(actionlint);
  await install(shellcheck);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((e) => {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  });
}
