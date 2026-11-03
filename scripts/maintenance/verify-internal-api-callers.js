/**
 * /api の合言葉の付け忘れを止める（BOA-1110 段階1、ADR-0103、docs/design/public-api-lockdown/plan.md §1.2・§4）。
 * 関門が enforce（段階4）になると、合言葉の無い自分の呼び出しは 403 になる。それより前に CI で漏れを見つける。
 *
 * 1. internalApiHeaders: 鍵があれば x-ryujin-internal-key と x-ryujin-caller、無い・空なら caller だけ。
 *    呼び出し元の名前は英数字とハイフン32字まで（関門の sanitizeCaller と同じ形）
 * 2. 付けたヘッダが関門（apiGate.js の decideApiGate）で reason=internal・caller として通る（名前の食い違いを防ぐ）
 * 3. Vercel の中の呼び出し元（botPage・botRace・snsClaimCheck）が実際に送るヘッダに合言葉と caller が入る
 * 4. 静的な走査: api・scripts・sns-video-studio の .js・.mjs・.cjs のうち、/api/…（cron・admin・bot-page を除く）を
 *    文字列に持ち fetch 等で取得するファイルは、internalApiHeaders を呼ぶこと。例外は EXEMPT に理由つきで書く
 *
 * 鍵の値は試験用の固定の文字列だけを使う（本物の値は読まない）。
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { decideApiGate } from "../../api/_lib/apiGate.js";
import { createTodayRacesSource } from "../../api/_lib/botPage.js";
import { createPredictionsSource } from "../../api/_lib/botRace.js";
import {
  CALLER_HEADER,
  INTERNAL_KEY_HEADER,
  internalApiHeaders,
} from "../../api/_lib/internalApiHeaders.js";
import { checkClaims } from "../../api/_lib/snsClaimCheck.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TEST_KEY = "verify-internal-key-0123456789";
let failures = 0;
const check = (name, fn) =>
  Promise.resolve()
    .then(fn)
    .then(
      () => console.log(`ok  ${name}`),
      (e) => {
        failures++;
        console.error(`NG  ${name}: ${e?.message ?? e}`);
      },
    );

// ---- 1. internalApiHeaders ----
await check("鍵があれば合言葉と caller", () =>
  assert.deepEqual(
    internalApiHeaders("bot-page", { INTERNAL_API_KEY: TEST_KEY }),
    {
      [CALLER_HEADER]: "bot-page",
      [INTERNAL_KEY_HEADER]: TEST_KEY,
    },
  ),
);
await check("鍵が無い・空なら caller だけ（合言葉を付けない）", () => {
  assert.deepEqual(internalApiHeaders("bot-page", {}), {
    [CALLER_HEADER]: "bot-page",
  });
  assert.deepEqual(internalApiHeaders("bot-page", { INTERNAL_API_KEY: "" }), {
    [CALLER_HEADER]: "bot-page",
  });
});
await check("caller の形が違えば投げる", () => {
  for (const bad of ["", "a b", "x".repeat(33), "名前", undefined]) {
    assert.throws(() => internalApiHeaders(bad, {}), /32字/);
  }
});

// ---- 2. 関門と名前がそろっている ----
await check("付けたヘッダが関門で internal・caller として通る", async () => {
  const decision = await decideApiGate({
    url: "https://www.boat-ai.jp/api/predictions/2026-11-03",
    headers: new Headers(
      internalApiHeaders("hq-finals", { INTERNAL_API_KEY: TEST_KEY }),
    ),
    ip: null,
    mode: "enforce",
    keys: { current: TEST_KEY },
    ipRanges: [],
  });
  assert.equal(decision.reason, "internal");
  assert.equal(decision.caller, "hq-finals");
  assert.equal(decision.key_slot, "current");
});

// ---- 3. Vercel の中の呼び出し元が実際に送るヘッダ ----
async function sentHeaders(run) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), headers: new Headers(init?.headers) });
    return new Response("{}", { status: 500 });
  };
  const before = process.env.INTERNAL_API_KEY;
  process.env.INTERNAL_API_KEY = TEST_KEY;
  try {
    await run(fetchImpl).catch(() => {});
  } finally {
    if (before === undefined) delete process.env.INTERNAL_API_KEY;
    else process.env.INTERNAL_API_KEY = before;
  }
  assert.ok(seen.length > 0, "fetch が呼ばれていない");
  return seen;
}
const expectKey = (seen, caller) => {
  for (const { url, headers } of seen) {
    if (!new URL(url).pathname.startsWith("/api/")) continue;
    assert.equal(
      headers.get(INTERNAL_KEY_HEADER),
      TEST_KEY,
      `${url} に合言葉が無い`,
    );
    assert.equal(headers.get(CALLER_HEADER), caller, `${url} の caller`);
  }
};
const ORIGIN = "https://www.boat-ai.jp";
await check("botPage（/api/races/today）", async () =>
  expectKey(
    await sentHeaders((fetchImpl) =>
      createTodayRacesSource({ fetchImpl })(ORIGIN),
    ),
    "bot-page",
  ),
);
await check("botRace（/api/predictions）", async () =>
  expectKey(
    await sentHeaders((fetchImpl) =>
      createPredictionsSource({ fetchImpl })(ORIGIN, "2026-11-03"),
    ),
    "bot-race",
  ),
);
await check("snsClaimCheck（/api/analogy/*）", async () => {
  const raceId = "2026-11-03-12-12";
  expectKey(
    await sentHeaders((fetchImpl) =>
      checkClaims({
        claims: [
          {
            id: "c1",
            source: { endpoint: `/api/analogy/facts/${raceId}`, path: ["x"] },
            value: 1,
          },
        ],
        raceId,
        fetchImpl,
        base: ORIGIN,
      }),
    ),
    "sns-claim-check",
  );
});

// ---- 4. 静的な走査 ----
const SCAN_ROOTS = ["api", "scripts", "sns-video-studio"];
const SKIP_DIRS = new Set(["node_modules", "dist", "out", "build", "public"]);
// 自分の /api を取りに行くが合言葉が要らないもの（理由を必ず書く）
const EXEMPT = new Map([
  [
    "scripts/maintenance/verify-odds-live-api.js",
    "関数を直接呼ぶ試験。本番の /api を叩かない（fetch は公式の取得の差し替え）",
  ],
  [
    "scripts/maintenance/verify-internal-api-callers.js",
    "この検査そのもの（差し替えの fetch だけ）",
  ],
]);
// 自分の /api（関門を通さない cron・admin・bot-page は除く）を指す文字列
const OWN_API = new RegExp(
  String.raw`["'\x60][^"'\x60\n]*\/api\/(?!cron\b|admin\b|bot-page\b)[a-z]`,
);
const FETCHES = /\bfetch(?:Impl)?\s*\(|\bhttps?\.get\s*\(|\brequest\s*\(/;
const isComment = (line) => /^\s*(?:\*|\/\/|\/\*)/.test(line);

function listFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) listFiles(p, out);
    else if (/\.(?:m|c)?js$/.test(name)) out.push(p);
  }
  return out;
}

await check("自分の /api を取るファイルは internalApiHeaders を使う", () => {
  const callers = [];
  const missing = [];
  for (const root of SCAN_ROOTS) {
    for (const file of listFiles(join(ROOT, root))) {
      const rel = relative(ROOT, file).split("\\").join("/");
      if (EXEMPT.has(rel)) continue;
      const code = readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => !isComment(line))
        .join("\n");
      if (!OWN_API.test(code) || !FETCHES.test(code)) continue;
      callers.push(rel);
      if (!/\binternalApiHeaders\s*\(/.test(code)) missing.push(rel);
    }
  }
  // 走査が空振りしていないこと（既知の呼び出し元が見えている）
  for (const known of [
    "api/_lib/botPage.js",
    "api/_lib/botRace.js",
    "api/_lib/snsClaimCheck.js",
    "scripts/maintenance/verify-bot-html-parity.js",
    "sns-video-studio/remotion/scripts/full-picture/fetch-materials.mjs",
    "sns-video-studio/remotion/scripts/full-picture/daily.mjs",
  ]) {
    assert.ok(
      callers.includes(known),
      `既知の呼び出し元 ${known} を走査が拾っていない`,
    );
  }
  assert.deepEqual(
    missing,
    [],
    `合言葉を付けていない（api/_lib/internalApiHeaders.js の internalApiHeaders を fetch の headers に混ぜる。要らないなら EXEMPT に理由を書く）: ${missing.join(", ")}`,
  );
});

if (failures > 0) {
  console.error(`\n${failures} 件失敗`);
  process.exit(1);
}
console.log("\nすべて通った");
