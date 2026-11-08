/**
 * E2E Live の /api の合言葉（BOA-1110、BOA-1384）の検査。
 * live の /api/ の要求だけに付き、replay・record・/api/ 以外には付かず、鍵の値を出さないこと。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { liveApiHeaders } from "../../e2e/live-api-key.js";

const KEY = "test-key-0123456789";
const env = { INTERNAL_API_KEY: KEY };
const base = { accept: "application/json", "x-extra": "1" };
const API = "https://boatai.example/api/predictions/abc";

// live かつ /api/ で付く。元のヘッダ・呼び手のヘッダは残る
const live = liveApiHeaders(API, base, { mode: "live", env });
assert.equal(live["x-ryujin-internal-key"], KEY);
assert.equal(live["x-ryujin-caller"], "e2e-live");
assert.equal(live.accept, "application/json");
assert.equal(live["x-extra"], "1");

// /api/ 以外・外部の host には付かない
for (const url of [
  "https://boatai.example/rest/v1/races?select=*",
  "https://example.com/other",
  "https://example.com/not-api/x",
]) {
  assert.deepEqual(liveApiHeaders(url, base, { mode: "live", env }), base);
}

// replay・record では付かない
for (const mode of ["replay", "record"]) {
  assert.deepEqual(liveApiHeaders(API, base, { mode, env }), base);
}

// live で鍵が空・無しなら投げ、文に鍵の文字が入らない
for (const e of [{}, { INTERNAL_API_KEY: "" }, { INTERNAL_API_KEY: "  " }]) {
  assert.throws(
    () => liveApiHeaders(API, base, { mode: "live", env: e }),
    (err) => /INTERNAL_API_KEY/.test(err.message) && !err.message.includes(KEY),
  );
}
// 鍵があっても例外の文には入らない（/api/ 以外は投げない）
assert.doesNotThrow(() =>
  liveApiHeaders("https://example.com/x", base, { mode: "live", env: {} }),
);

// fixtures.js の本文
const src = readFileSync(new URL("../../e2e/fixtures.js", import.meta.url), "utf8");
assert.match(src, /liveApiHeaders\(/, "live の枝が liveApiHeaders を通す");
assert.match(
  src,
  /if \(E2E_MODE === "live"\) return fromApiResponse\(await route\.fetch\(options\)\);/,
);
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
