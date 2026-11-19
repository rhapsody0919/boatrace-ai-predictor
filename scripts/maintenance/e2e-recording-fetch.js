/**
 * E2E の録画（e2e/recordings/）の取得の側（e2e-recording.js から分けた）。
 * ポインタ（e2e/recording.json）を読み、Release の zip を取り（一時の失敗だけ再試行）、
 * キャッシュ・sha256 照合のうえ e2e/recordings/ に展開する。
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const POINTER_PATH = path.join(repoRoot, "e2e", "recording.json");
export const RECORDINGS_DIR = path.join(repoRoot, "e2e", "recordings");
/** 展開済みの録画がどのポインタ（sha256）から来たかを書いておくファイル */
export const SOURCE_MARK = path.join(RECORDINGS_DIR, ".source-sha256");
export const ASSET_NAME = "e2e-recording.zip";
export const CACHE_DIR =
  process.env.E2E_RECORDING_CACHE ||
  path.join(repoRoot, "node_modules", ".cache", "boatai-e2e-recording");

export const sha256 = (buffer) =>
  createHash("sha256").update(buffer).digest("hex");

export function readPointer() {
  try {
    return JSON.parse(readFileSync(POINTER_PATH, "utf8"));
  } catch (error) {
    throw new Error(
      `${POINTER_PATH} を読めません（録画のポインタがありません）: ${error.message}`,
    );
  }
}

export function repoSlug() {
  if (process.env.E2E_RECORDING_REPO) return process.env.E2E_RECORDING_REPO;
  const url = execFileSync("git", ["remote", "get-url", "origin"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  const m = url.match(/github\.com[:/](.+?\/.+?)(?:\.git)?$/);
  if (!m)
    throw new Error(`origin の URL から owner/repo を求められません: ${url}`);
  return m[1];
}

/** 一時の失敗とみなす HTTP の状態（再試行する）。404 等の恒久の失敗は再試行せずそのまま返す */
export const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
/** 再試行の前の待ち（ms）。回数は長さ+1。最小でよい（BOA-1397: releases の 504 で shard が試験の前に落ちた） */
export const RETRY_DELAYS_MS = [2000, 5000];

const RETRY_DEFAULTS = {
  fetchImpl: (url) => fetch(url),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  delays: RETRY_DELAYS_MS,
  log: (message) => console.warn(message),
};

/** 1回取る。例外は投げずに { error } で返す */
async function attemptFetch(fetchImpl, url) {
  try {
    return { response: await fetchImpl(url) };
  } catch (error) {
    return { error };
  }
}

const isRetryableResponse = (response) =>
  !response.ok && RETRYABLE_STATUS.has(response.status);

const failureLabel = ({ response, error }) =>
  response ? `${response.status}` : `例外（${error?.message ?? error}）`;

/**
 * fetch を、一時の失敗（RETRYABLE_STATUS・ネットワークの例外）のときだけ待って再試行する。
 * 最後の試行の応答を返す（恒久の失敗や、再試行しても直らない一時の失敗は呼び出し側が !ok で落とす）。
 * 最後の試行がネットワークの例外なら、その例外を投げる
 */
export async function fetchWithRetry(url, options = {}) {
  const { fetchImpl, sleep, delays, log } = { ...RETRY_DEFAULTS, ...options };
  for (let attempt = 0; ; attempt++) {
    const outcome = await attemptFetch(fetchImpl, url);
    const last = attempt >= delays.length;
    if (outcome.response && (last || !isRetryableResponse(outcome.response)))
      return outcome.response;
    if (outcome.error && last) throw outcome.error;
    await outcome.response?.body?.cancel?.(); // 捨てる応答の本文を読まずに閉じる（接続を早く返す）
    log(
      `[e2e recording] 取得が ${failureLabel(outcome)}。${delays[attempt]}ms 待って再試行（${attempt + 1}/${delays.length}）: ${url}`,
    );
    await sleep(delays[attempt]);
  }
}

/** 手元で撮った（まだ Release に上げていない）録画の目印。global-teardown が書く */
export const LOCAL_MARK = "local";

const LOCAL_RECORDING_MESSAGE = [
  "e2e/recordings/ には手元で撮った録画があります（まだ Release に上げていない）。",
  "ポインタの録画で上書きすると失われるため止めました。",
  "  手元の録画で再生する:       E2E_RECORDING_SOURCE=local npm run test:e2e",
  "  採用して Release に上げる:  node scripts/maintenance/e2e-recording.js publish --skipped=N --tests=N",
  "  捨ててポインタの録画に戻す: node scripts/maintenance/e2e-recording.js fetch --force",
].join("\n");

/** 壊れたキャッシュは消して取り直す（CI のキャッシュはキーが同じ間は上書きされないため、
 * ここで失敗させると同じ壊れたファイルを毎回復元して落ち続ける） */
function dropBrokenCache(cached, pointer, quiet) {
  if (!existsSync(cached) || sha256(readFileSync(cached)) === pointer.sha256)
    return;
  if (!quiet)
    console.warn(
      `[e2e recording] キャッシュが壊れているので取り直します: ${cached}`,
    );
  rmSync(cached, { force: true });
}

/** Release から zip を取り、sha256 を照合してキャッシュへ置く */
async function downloadRecording(pointer, cached, quiet) {
  const url = `https://github.com/${repoSlug()}/releases/download/${pointer.tag}/${pointer.asset ?? ASSET_NAME}`;
  if (!quiet) console.log(`[e2e recording] 取得: ${url}`);
  const response = await fetchWithRetry(url);
  if (!response.ok) {
    throw new Error(
      `録画を取得できません（${response.status} ${response.statusText}）: ${url}`,
    );
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const actual = sha256(buffer);
  if (actual !== pointer.sha256) {
    throw new Error(
      `録画の sha256 がポインタと一致しません（期待 ${pointer.sha256} / 実際 ${actual}）: ${url}`,
    );
  }
  const tmp = `${cached}.${process.pid}.tmp`;
  writeFileSync(tmp, buffer);
  renameSync(tmp, cached);
}

function extractRecording(pointer, cached, quiet) {
  rmSync(RECORDINGS_DIR, { recursive: true, force: true });
  mkdirSync(RECORDINGS_DIR, { recursive: true });
  execFileSync("unzip", ["-q", cached, "-d", RECORDINGS_DIR]);
  writeFileSync(SOURCE_MARK, `${pointer.sha256}\n`);
  if (!quiet) {
    console.log(
      `[e2e recording] ${pointer.tag}（録画時刻 ${pointer.recordedAt}）を展開しました`,
    );
  }
}

/**
 * ポインタの録画を e2e/recordings/ に用意する。既に同じものが展開済みなら何もしない。
 * 手元で撮った録画が展開されているときは、黙って上書きせずに止める（force で上書き）
 */
export async function ensureRecording({ quiet = false, force = false } = {}) {
  const pointer = readPointer();
  const mark = existsSync(SOURCE_MARK)
    ? readFileSync(SOURCE_MARK, "utf8").trim()
    : null;
  if (mark === pointer.sha256) return pointer;
  if (mark === LOCAL_MARK && !force) throw new Error(LOCAL_RECORDING_MESSAGE);

  mkdirSync(CACHE_DIR, { recursive: true });
  const cached = path.join(CACHE_DIR, `${pointer.sha256}.zip`);
  dropBrokenCache(cached, pointer, quiet);
  if (!existsSync(cached)) await downloadRecording(pointer, cached, quiet);
  extractRecording(pointer, cached, quiet);
  return pointer;
}
