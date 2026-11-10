/**
 * E2E の /api の合言葉（BOA-1110、BOA-1384、BOA-1436）の検査。
 * live・record の、本番（boat-ai.jp）か本番へ転送するローカル（localhost）の /api/ の要求だけに付き、
 * replay（再生・素通し）・未知のモード・/api/ 以外・本番以外の host には付かず、鍵の値を出さないこと。
 * record で 401・403 を録画しないこと（BOA-1436）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { liveApiHeaders } from "../../e2e/live-api-key.js";

const KEY = "test-key-0123456789";
const env = { INTERNAL_API_KEY: KEY };
const base = { accept: "application/json", "x-extra": "1" };
const API = "http://localhost:4173/api/predictions/abc";
const PROD_API = "https://www.boat-ai.jp/api/predictions/abc";
const KEY_MODES = ["live", "record"];

// live・record かつ本番・ローカルの /api/ で付く。元のヘッダ・呼び手のヘッダは残る
for (const mode of KEY_MODES) {
  for (const url of [API, PROD_API, "https://boat-ai.jp/api/races"]) {
    const got = liveApiHeaders(url, base, { mode, env });
    assert.equal(got["x-ryujin-internal-key"], KEY, `${mode} ${url}`);
    assert.equal(got["x-ryujin-caller"], "e2e-live");
    assert.equal(got.accept, "application/json");
    assert.equal(got["x-extra"], "1");
  }
}

// /api/ 以外・本番以外の host（/api/ の path でも）には付かない。どのモードでも
for (const mode of KEY_MODES) {
  for (const url of [
    "https://abc.supabase.co/rest/v1/races?select=*",
    "http://localhost:4173/rest/v1/races",
    "http://localhost:4173/not-api/x",
    "https://example.com/other",
    "https://example.com/api/predictions/abc",
    "https://boat-ai.jp.example.com/api/x",
    "https://evil-boat-ai.jp/api/x",
    "not a url",
  ]) {
    assert.deepEqual(liveApiHeaders(url, base, { mode, env }), base, `${mode} ${url}`);
  }
}

// replay（通常の再生・素通し）・mock 等の未知のモード・空では付かない
for (const mode of ["replay", "mock", "", undefined, "LIVE", "Record"]) {
  assert.deepEqual(liveApiHeaders(API, base, { mode, env }), base, `mode=${mode}`);
  assert.deepEqual(liveApiHeaders(PROD_API, base, { mode, env }), base, `mode=${mode}`);
}

// live・record で鍵が空・無しなら投げ、文に鍵の文字が入らない
for (const mode of KEY_MODES) {
  for (const e of [{}, { INTERNAL_API_KEY: "" }, { INTERNAL_API_KEY: "  " }]) {
    assert.throws(
      () => liveApiHeaders(API, base, { mode, env: e }),
      (err) => /INTERNAL_API_KEY/.test(err.message) && !err.message.includes(KEY),
    );
  }
  // /api/ 以外・本番以外の host は鍵が無くても投げない
  assert.doesNotThrow(() =>
    liveApiHeaders("https://example.com/x", base, { mode, env: {} }),
  );
  assert.doesNotThrow(() =>
    liveApiHeaders("https://example.com/api/x", base, { mode, env: {} }),
  );
}

// fixtures.js の本文
const src = readFileSync(new URL("../../e2e/fixtures.js", import.meta.url), "utf8");
assert.match(src, /liveApiHeaders\(/, "live の枝が liveApiHeaders を通す");
assert.match(
  src,
  /if \(E2E_MODE === "live"\) return fromApiResponse\(await route\.fetch\(options\)\);/,
);
// fetchRecorded は live・record で合言葉を付ける（BOA-1436）
assert.match(
  src,
  /if \(E2E_MODE === "live" \|\| E2E_MODE === "record"\) \{\n\s+options = \{\n\s+\.\.\.options,\n\s+headers: liveApiHeaders\(/,
  "fetchRecorded の live・record の枝が liveApiHeaders を通す",
);
// context.route の録画（record）も route.fetch に合言葉を付ける（BOA-1436）
assert.match(
  src,
  /recordThrough\(request, \(\) =>\s+route\.fetch\(\{\s+headers: liveApiHeaders\(request\.url\(\), request\.headers\(\), \{\s+mode: E2E_MODE,/,
  "record の context.route が liveApiHeaders を通す",
);
assert.ok(
  !/recordThrough\(request, \(\) => route\.fetch\(\)\)/.test(src),
  "record の context.route が合言葉なしの route.fetch の呼び出しに戻っている",
);
// 401・403・5xx は録画しない（BOA-1436）
assert.match(
  src,
  /if \(status >= 500 \|\| status === 401 \|\| status === 403\) \{\n\s+return toResponse\(/,
  "recordThrough が 401・403・5xx を録画せずに返す",
);
// 録画（HAR）の request.headers は空のまま（鍵を録画に書かない）
assert.match(src, /request: \{\n\s+method: request\.method\(\),\n\s+url: request\.url\(\),\n\s+headers: \[\],/);
for (const line of src.split("\n")) {
  if (!/INTERNAL_API_KEY|x-ryujin-internal-key/.test(line)) continue;
  assert.ok(
    !/console\.|attach\(/.test(line),
    `鍵を console・attach に渡す行がある: ${line.trim()}`,
  );
}
assert.ok(
  !/console\.[a-z]+\([^)]*options\.headers|attach\([^)]*headers/.test(src),
  "ヘッダを console・attach に渡す行がある",
);

console.log("verify-e2e-live-api-key: OK");
