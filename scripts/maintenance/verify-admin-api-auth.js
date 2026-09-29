#!/usr/bin/env node
/**
 * 管理API（api/admin/ 配下）の全ハンドラが、関数自身でBasic認証をかけているかを検証する。
 *
 * 背景: middleware.js の Basic 認証は config.matcher（デコード前のパス）に一致したときしか
 * 起動しない。2026-09-29、本番で `/api/admin/sns-h%75b/drafts` が middleware を迂回して
 * 認証なしで 200 を返した。関数側の requireAdminAuth（api/_lib/adminAuth.js）で塞いだ。
 *
 * ハンドラはファイル一覧から自動で列挙するので、今後ハンドラを足してガードを付け忘れると落ちる。
 * fetch はスタブにして外部（Supabase・GitHub・YouTube 等）へは一切出ない。
 *
 * 実行: node scripts/maintenance/verify-admin-api-auth.js
 */
import { readdirSync, statSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const ADMIN_DIR = path.join(ROOT, "api/admin");

// Vercel のバンドラは import 属性なしの JSON import を許すが、Node 単体では通らないので読み替える。
// CI（Quality Gates）は Node 20 なので、22.15 以降にしか無い registerHooks ではなく
// 20.6 以降にある module.register（別スレッドのローダー）を使う
const JSON_LOADER = `
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && url.endsWith(".json")) {
    const source = readFileSync(fileURLToPath(url), "utf8");
    return { format: "module", source: "export default " + source + ";", shortCircuit: true };
  }
  return nextLoad(url, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(JSON_LOADER)}`);

// モジュール読み込み時に env を読むハンドラがあるため、import 前に「設定済み」にしておく
Object.assign(process.env, {
  SUPABASE_URL: "https://supabase.invalid",
  SUPABASE_SERVICE_KEY: "test-service-key",
  GITHUB_MERGE_TOKEN: "test-github-token",
  YOUTUBE_CLIENT_ID: "test-yt-id",
  YOUTUBE_CLIENT_SECRET: "test-yt-secret",
  YOUTUBE_REFRESH_TOKEN: "test-yt-refresh",
});

let fetchCalls = 0;
globalThis.fetch = async (input) => {
  fetchCalls += 1;
  throw new Error(`テスト中の外部呼び出し: ${String(input?.url ?? input)}`);
};

function listHandlers(dir) {
  return readdirSync(dir)
    .flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return listHandlers(full);
      return /\.(js|mjs|ts)$/.test(name) ? [full] : [];
    })
    .sort();
}

function basic(user, password) {
  const bytes = new TextEncoder().encode(`${user}:${password}`);
  return `Basic ${btoa(String.fromCharCode(...bytes))}`;
}

function setAuthEnv(user, password) {
  for (const [key, value] of [
    ["SNS_HUB_BASIC_AUTH_USER", user],
    ["SNS_HUB_BASIC_AUTH_PASSWORD", password],
  ]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

// ハンドラを呼び、status（例外なら "threw"）と外部呼び出し回数を返す
async function call(handler, urlPath, method, authorization) {
  const headers = authorization ? { authorization } : {};
  const init = { method, headers };
  if (method !== "GET") {
    init.body = "{}";
    headers["content-type"] = "application/json";
  }
  const request = new Request(`https://www.boat-ai.jp${urlPath}`, init);
  const before = fetchCalls;
  // スタブの fetch が投げる例外や未設定の env をハンドラがログに出すので、呼び出し中だけ黙らせる
  const originalConsole = {
    error: console.error,
    warn: console.warn,
    log: console.log,
  };
  console.error = console.warn = console.log = () => {};
  try {
    const response = await handler(request);
    return { status: response?.status, response, fetched: fetchCalls - before };
  } catch (error) {
    return { status: "threw", error, fetched: fetchCalls - before };
  } finally {
    Object.assign(console, originalConsole);
  }
}

const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
};

function expect401(label, result) {
  check(
    result.status === 401,
    `${label}: 401 ではなく ${result.status}${result.error ? `（${result.error.message}）` : ""}`,
  );
  check(
    result.fetched === 0,
    `${label}: 認証前に外部呼び出しが ${result.fetched} 回発生`,
  );
  if (result.status === 401) {
    check(
      result.response.headers.get("www-authenticate") ===
        'Basic realm="SNS Marketing Hub"',
      `${label}: WWW-Authenticate が不正`,
    );
    check(
      result.response.headers.get("cache-control") === "no-store",
      `${label}: Cache-Control: no-store が無い`,
    );
  }
}

function expectPassed(label, result) {
  check(result.status !== 401, `${label}: 正しい認証なのに 401`);
}

const USER = "admin";
const PASSWORD = "correct-password";
const COLON_PASSWORD = "pa:ss:word";
const METHODS = ["GET", "POST", "PATCH", "DELETE"];

const handlerFiles = listHandlers(ADMIN_DIR);
check(handlerFiles.length > 0, "api/admin/ にハンドラが1本も見つからない");

for (const file of handlerFiles) {
  const rel = path.relative(ROOT, file);
  const urlPath = `/${rel
    .replace(/\.(js|mjs|ts)$/, "")
    .replace(/\/index$/, "")
    .replace(/\[[^\]]+\]/g, "1")}`;
  const mod = await import(pathToFileURL(file).href);
  const handler = mod.default;
  if (typeof handler !== "function") {
    failures.push(
      `${rel}: default export の handler が無い（名前付き export 形式ならこの検証を拡張すること）`,
    );
    continue;
  }

  setAuthEnv(USER, PASSWORD);
  for (const method of METHODS) {
    expect401(
      `${rel} ${method} 認証なし`,
      await call(handler, urlPath, method),
    );
    expect401(
      `${rel} ${method} 誤ったパスワード`,
      await call(handler, urlPath, method, basic(USER, "wrong")),
    );
    expect401(
      `${rel} ${method} 誤ったユーザー`,
      await call(handler, urlPath, method, basic("other", PASSWORD)),
    );
    expect401(
      `${rel} ${method} Basic以外`,
      await call(handler, urlPath, method, `Bearer ${PASSWORD}`),
    );
    expect401(
      `${rel} ${method} 壊れたbase64`,
      await call(handler, urlPath, method, "Basic !!!"),
    );
    expectPassed(
      `${rel} ${method} 正しい認証`,
      await call(handler, urlPath, method, basic(USER, PASSWORD)),
    );
  }

  // 環境変数が未設定・空なら、どんな認証でも拒否する（fail-closed）
  for (const [envUser, envPassword, label] of [
    [undefined, undefined, "両方未設定"],
    [USER, undefined, "パスワード未設定"],
    [undefined, PASSWORD, "ユーザー未設定"],
    ["", "", "両方空"],
  ]) {
    setAuthEnv(envUser, envPassword);
    expect401(
      `${rel} env${label}`,
      await call(handler, urlPath, "POST", basic(USER, PASSWORD)),
    );
    expect401(
      `${rel} env${label} 空の認証`,
      await call(handler, urlPath, "POST", basic("", "")),
    );
  }

  // パスワードに ":" を含む場合、最初の ":" だけで分割する
  setAuthEnv(USER, COLON_PASSWORD);
  expectPassed(
    `${rel} ':'入りパスワード 正`,
    await call(handler, urlPath, "POST", basic(USER, COLON_PASSWORD)),
  );
  expect401(
    `${rel} ':'入りパスワード 途中まで`,
    await call(handler, urlPath, "POST", basic(USER, "pa")),
  );
  expect401(
    `${rel} ':'入りパスワード 途中まで2`,
    await call(handler, urlPath, "POST", basic(USER, "pa:ss")),
  );
}

setAuthEnv(undefined, undefined);

if (failures.length > 0) {
  console.error(`NG: 管理APIの認証ガードに ${failures.length} 件の不備`);
  for (const message of failures.slice(0, 60)) console.error(`  - ${message}`);
  if (failures.length > 60)
    console.error(`  ...ほか ${failures.length - 60} 件`);
  process.exit(1);
}

console.log(
  `OK: api/admin/ のハンドラ ${handlerFiles.length} 本すべてが関数側でBasic認証を要求する`,
);
