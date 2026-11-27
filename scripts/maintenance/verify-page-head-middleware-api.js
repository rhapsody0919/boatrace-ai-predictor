#!/usr/bin/env node
/**
 * middleware の生の HTML の head の差し込みが、会場（本日）・レース詳細では /api/page-head の JSON を取り、版・種類が合うときだけ差し込み、時間切れでも CDN を温めること。
 *
 * 取得の関数と waitUntil を差し替えて api/_lib/pageHeadMiddleware.js を直に呼ぶ（ネットに出ない）。外枠は index.html の head と同じ形の見本。
 * 1. PAGE_HEAD_KINDS に venue・race があるときだけ、/venue/{1〜24}・/race/{実在する日}-{01〜24}-{01〜12} で差し込む。材料は合言葉の見出しつきで
 *    /api/page-head/v1/{kind}/{key} を取り、ログに内側の x-vercel-cache を出す
 * 2. 形の外（0埋め・範囲外・実在しない日・言語の接頭辞）は外枠も材料も取らない
 * 3. 材料が 404・503・版が違う・種類が違う・JSON でない、外枠が 200 でない、は素通り（undefined）で理由を出す
 * 4. 上限の時間を越えたら素通りにし、材料の取得は waitUntil に渡して最後まで走らせる（CDN を温める）
 * 5. middleware の入口からも同じで、AI の UA の /venue/1 は今どおり関数へ rewrite する
 */
import assert from "node:assert/strict";
import { respondWithPageHead } from "../../api/_lib/pageHeadMiddleware.js";

// 外枠の最小の見本（title が1つ、description・canonical は無い）
const DEFAULT_TITLE = "既定の title";
const SHELL = `<!doctype html><html lang="ja"><head><meta charset="UTF-8" /><title>${DEFAULT_TITLE}</title></head><body><div id="root"></div></body></html>`;
const HEAD = (kind, title) => ({
  v: 1,
  kind,
  title,
  description: `${title} の説明`,
  canonical: "https://www.boat-ai.jp/x",
  jsonLd: [{ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [] }],
});
const ON = { PAGE_HEAD_KINDS: "venue,race", INTERNAL_API_KEY: "k-test" };
const json = (body, status = 200, cache = "HIT") =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "x-vercel-cache": cache } });

function router(apiResponse) {
  const calls = [];
  const fn = async (url, init) => {
    const u = new URL(String(url));
    calls.push({ path: u.pathname, headers: init?.headers ?? {} });
    if (u.pathname === "/index.html") return new Response(SHELL, { status: 200 });
    return apiResponse(u.pathname, init);
  };
  return { fn, calls };
}

async function run(path, { env = ON, api = (p) => json(HEAD(p.split("/")[4], "T")), timeoutMs, ua } = {}) {
  const logs = [];
  const kept = [];
  const r = router(api);
  const res = await respondWithPageHead(
    new Request(`https://www.boat-ai.jp${path}`, { headers: { "user-agent": ua ?? "Mozilla/5.0" } }),
    { env, fetchImpl: r.fn, timeoutMs, log: (l) => logs.push(JSON.parse(l)), waitUntil: (p) => kept.push(p) },
  );
  return { res, calls: r.calls, logs, kept };
}

let failures = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}\n     ${error.message}`);
  }
};

await check("1. 会場・レース詳細は /api/page-head の JSON を差し込む", async () => {
  for (const [path, apiPath, kind] of [
    ["/venue/1", "/api/page-head/v1/venue/1", "venue"],
    ["/venue/24", "/api/page-head/v1/venue/24", "venue"],
    ["/race/2026-12-01-01-05", "/api/page-head/v1/race/2026-12-01-01-05", "race"],
    ["/race/2024-02-29-24-12", "/api/page-head/v1/race/2024-02-29-24-12", "race"],
  ]) {
    const { res, calls, logs } = await run(`${path}?x=1`, { api: () => json(HEAD(kind, `T-${kind}`)) });
    assert.equal(res?.status, 200, path);
    const html = await res.text();
    assert.ok(html.includes(`<title data-page-head="${DEFAULT_TITLE}">T-${kind}</title>`), path);
    assert.ok(html.includes('rel="canonical"'));
    assert.deepEqual(calls.map((c) => c.path).sort(), [apiPath, "/index.html"].sort(), path);
    const apiCall = calls.find((c) => c.path === apiPath);
    assert.equal(apiCall.headers["x-ryujin-caller"], "page-head");
    assert.equal(apiCall.headers["x-ryujin-internal-key"], "k-test");
    assert.deepEqual([logs.at(-1).page_head, logs.at(-1).outcome, logs.at(-1).cache], [kind, "injected", "HIT"]);
  }
  // 有効でない種類は取らない
  for (const env of [{}, { PAGE_HEAD_KINDS: "pastVenue" }, { PAGE_HEAD_KINDS: "race" }]) {
    const { res, calls } = await run("/venue/1", { env });
    assert.equal(res, undefined);
    assert.deepEqual(calls, []);
  }
});

await check("2. 形の外は何も取らない", async () => {
  for (const path of ["/venue/01", "/venue/0", "/venue/25", "/venue/1/meet/2026-12-01", "/race/2026-02-30-01-01", "/race/2026-12-01-25-01", "/race/2026-12-01-01-13", "/race/2026-12-01-00-01", "/race/202612010105", "/en/venue/1", "/en/race/2026-12-01-01-05"]) {
    const { res, calls } = await run(path);
    assert.equal(res, undefined, path);
    assert.deepEqual(calls, [], path);
  }
});

await check("3. 材料・外枠の失敗と版・種類の違いは素通り", async () => {
  const cases = [
    ["head_status", () => json({}, 404, "MISS")],
    ["head_status", () => json({}, 503, "MISS")],
    ["head_version", () => json({ ...HEAD("venue", "T"), v: 2 })],
    ["head_version", () => json(HEAD("race", "T"))],
    ["error", () => new Response("<html>", { status: 200 })],
    ["not_injectable", () => json({ ...HEAD("venue", "T"), canonical: "https://example.com/" })],
  ];
  for (const [outcome, api] of cases) {
    const { res, logs } = await run("/venue/3", { api });
    assert.equal(res, undefined, outcome);
    assert.equal(logs.at(-1).outcome, outcome);
  }
  const shellDown = router(() => json(HEAD("venue", "T")));
  const logs = [];
  const res = await respondWithPageHead(new Request("https://www.boat-ai.jp/venue/3"), {
    env: ON,
    fetchImpl: async (url, init) => (new URL(String(url)).pathname === "/index.html" ? new Response("", { status: 401 }) : shellDown.fn(url, init)),
    log: (l) => logs.push(JSON.parse(l)),
    waitUntil: () => {},
  });
  assert.equal(res, undefined);
  assert.deepEqual([logs.at(-1).outcome, logs.at(-1).status], ["shell_status", 401]);
});

await check("4. 時間切れは素通りにし、材料の取得は waitUntil で最後まで走らせる", async () => {
  let finished = false;
  const slow = () =>
    new Promise((resolve) => setTimeout(() => {
      finished = true;
      resolve(json(HEAD("venue", "T")));
    }, 80));
  const t0 = Date.now();
  const { res, logs, kept } = await run("/venue/5", { api: slow, timeoutMs: 20 });
  assert.equal(res, undefined);
  assert.equal(logs.at(-1).outcome, "timeout");
  assert.ok(Date.now() - t0 < 70, "上限で止まらない");
  assert.equal(kept.length, 1, "waitUntil に渡していない");
  await kept[0];
  assert.ok(finished, "材料の取得を最後まで走らせていない");
});

await check("5. middleware の入口からも同じで、AI の UA の rewrite は変わらない", async () => {
  const { default: middleware } = await import("../../middleware.js");
  const realFetch = globalThis.fetch;
  const before = process.env.PAGE_HEAD_KINDS;
  globalThis.fetch = async (url) =>
    new URL(String(url)).pathname === "/index.html" ? new Response(SHELL) : json(HEAD("venue", "T-mw"));
  try {
    process.env.PAGE_HEAD_KINDS = "venue";
    const human = await middleware(new Request("https://www.boat-ai.jp/venue/7", { headers: { "user-agent": "Mozilla/5.0" } }));
    assert.equal(human?.status, 200);
    assert.ok((await human.text()).includes(">T-mw</title>"));
    const bot = await middleware(new Request("https://www.boat-ai.jp/venue/7", { headers: { "user-agent": "Mozilla/5.0 (compatible; bingbot/2.0)" } }));
    assert.match(bot?.headers.get("x-middleware-rewrite") ?? "", /\/api\/bot-page\/venue\/7$/);
  } finally {
    globalThis.fetch = realFetch;
    if (before === undefined) delete process.env.PAGE_HEAD_KINDS;
    else process.env.PAGE_HEAD_KINDS = before;
  }
});

if (failures > 0) {
  console.error(`\n${failures} 件の失敗`);
  process.exit(1);
}
console.log("\nverify-page-head-middleware-api: すべて通った");
