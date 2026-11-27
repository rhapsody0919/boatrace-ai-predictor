#!/usr/bin/env node
/**
 * middleware の生の HTML の head の差し込み（api/_lib/pageHeadMiddleware.js）が、対象のパスだけで全ての UA に同じ HTML を返し、どんな失敗も素通りにすること。
 *
 * 外枠は index.html の head と同じ形の見本を、取得の関数を差し替えて渡す（ネットに出ない）。src/ の本文は読まず、import して呼ぶ。
 * 1. PAGE_HEAD_KINDS が未設定・空・ほかの種類なら差し込まず、外枠も取らない
 * 2. 有効なら、人・Googlebot・bingbot に同じ 200 の HTML（title・canonical・description が1つずつ）を返し、no-store 等の見出しを付ける。
 *    外枠は同じ origin の /index.html を取る（/ を取らない）。canonical はサイトの URL（Preview の host でも）
 * 3. 対象の外のパス（一覧・0埋め・実在しない日・範囲外）と GET 以外は素通りで、外枠を取らない。クエリは中身を変えない
 * 4. 外枠が 200 でない・取得が投げる・時間切れ・差し込めない外枠は素通り（undefined）で、理由を1行の JSON に出す
 * 5. 差し込む会場名（src/constants の STADIUM_NAMES）と「ホーム」は ja の訳と同じ字（全24会場の title で見る）
 * 6. middleware の入口からも同じに動き、ほかの振り分け（/venue/1 の bingbot は関数へ rewrite）は変わらない
 */
import assert from "node:assert/strict";
import ja from "../../src/locales/ja/common.json" with { type: "json" };
import { respondWithPageHead } from "../../api/_lib/pageHeadMiddleware.js";

// 外枠（index.html）の head と同じ形の見本: title が1つ、description・canonical は無い、共通の JSON-LD が3つ。
// 本物の index.html への差し込みは受け渡しの e2e が配備と同じ外枠（vite の index.html）で見る
const DEFAULT_TITLE = "ボートレースのデータ分析とAI予想が無料｜競艇 龍神レーダー";
const SHELL = [
  "<!doctype html>",
  '<html lang="ja">',
  "<head>",
  '<meta charset="UTF-8" />',
  '<meta name="robots" content="index, follow" />',
  `<title>${DEFAULT_TITLE}</title>`,
  ...["WebSite", "SoftwareApplication", "Organization"].map(
    (type) => `<script type="application/ld+json">{"@context":"https://schema.org","@type":"${type}"}</script>`,
  ),
  "</head>",
  '<body><div id="root"></div><script type="module" src="/assets/index-abc.js"></script></body>',
  "</html>",
].join("\n");
const PATH = "/races/2026-10-11/1";
const UAS = {
  human: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
  googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  bingbot: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
};
const ON = { PAGE_HEAD_KINDS: "pastVenue" };

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

function fakeFetch(respond = () => new Response(SHELL, { status: 200 })) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push(String(url));
    return respond(url, init);
  };
  return { fn, calls };
}

const req = (path, { ua = UAS.human, method = "GET", host = "https://www.boat-ai.jp" } = {}) =>
  new Request(`${host}${path}`, { method, headers: { "user-agent": ua } });

async function run(path, opts = {}, deps = {}) {
  const logs = [];
  const f = deps.fetch ?? fakeFetch();
  const res = await respondWithPageHead(req(path, opts), {
    env: deps.env ?? ON,
    fetchImpl: f.fn,
    timeoutMs: deps.timeoutMs,
    log: (line) => logs.push(JSON.parse(line)),
  });
  return { res, calls: f.calls, logs };
}

const headOf = (html) => html.slice(0, html.indexOf("</head>"));
const count = (text, re) => [...text.matchAll(re)].length;

await check("1. 入切の環境変数が無い・ほかの種類なら差し込まない", async () => {
  for (const env of [{}, { PAGE_HEAD_KINDS: "" }, { PAGE_HEAD_KINDS: " , " }, { PAGE_HEAD_KINDS: "racer,venue" }]) {
    const { res, calls } = await run(PATH, {}, { env });
    assert.equal(res, undefined, JSON.stringify(env));
    assert.deepEqual(calls, []);
  }
  const { res } = await run(PATH, {}, { env: { PAGE_HEAD_KINDS: "venue, pastVenue" } });
  assert.ok(res instanceof Response);
});

await check("2. 全ての UA に同じ HTML、外枠は /index.html、canonical はサイトの URL", async () => {
  const bodies = [];
  for (const ua of Object.values(UAS)) {
    const { res, calls, logs } = await run(PATH, { ua });
    assert.equal(res.status, 200);
    assert.deepEqual(calls, ["https://www.boat-ai.jp/index.html"]);
    assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(res.headers.get("cache-control"), "no-cache, no-store, must-revalidate, s-maxage=0");
    assert.equal(res.headers.get("cdn-cache-control"), "no-store");
    assert.equal(res.headers.get("vercel-cdn-cache-control"), "no-store");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.match(res.headers.get("server-timing") ?? "", /^page-head;dur=\d+$/);
    assert.equal(res.headers.get("content-encoding"), null);
    assert.equal(logs.at(-1).outcome, "injected");
    bodies.push(await res.text());
  }
  assert.equal(new Set(bodies).size, 1, "UA で中身が違う");
  const h = headOf(bodies[0]);
  assert.equal(count(h, /<title[\s>]/g), 1);
  assert.equal(count(h, /rel="canonical"/g), 1);
  assert.equal(count(h, /<meta name="description"/g), 1);
  assert.ok(h.includes("桐生競艇の結果・配当 2026年10月11日(日)"));
  const preview = await run(PATH, { host: "https://boatrace-ai-predictor-git-x.vercel.app" });
  assert.deepEqual(preview.calls, ["https://boatrace-ai-predictor-git-x.vercel.app/index.html"]);
  assert.ok((await preview.res.text()).includes('href="https://www.boat-ai.jp/races/2026-10-11/1"'));
});

await check("3. 対象の外・GET 以外は素通りで外枠を取らない。クエリは中身を変えない", async () => {
  for (const path of ["/races/2026-10-11", "/races", "/races/2026-10-11/01", "/races/2026-10-11/25", "/races/2026-02-30/1", "/en/races/2026-10-11/1", "/venue/1", "/racer/4444"]) {
    const { res, calls } = await run(path);
    assert.equal(res, undefined, path);
    assert.deepEqual(calls, [], path);
  }
  for (const method of ["HEAD", "POST"]) {
    const { res, calls } = await run(PATH, { method });
    assert.equal(res, undefined, method);
    assert.deepEqual(calls, []);
  }
  const plain = await (await run(PATH)).res.text();
  const withQuery = await (await run(`${PATH}?x=1&date=2026-01-01`)).res.text();
  assert.equal(withQuery, plain);
});

await check("4. 失敗は全て素通り（undefined）で理由を出す", async () => {
  const cases = [
    ["shell_status", fakeFetch(() => new Response("no", { status: 401 }))],
    ["shell_status", fakeFetch(() => new Response("x", { status: 500 }))],
    ["error", fakeFetch(() => { throw new TypeError("fetch failed"); })],
    ["not_injectable", fakeFetch(() => new Response(SHELL.replace("</head>", "<title>x</title></head>")))],
    ["not_injectable", fakeFetch(() => new Response("<html><body>no head</body></html>"))],
  ];
  for (const [outcome, f] of cases) {
    const { res, logs } = await run(PATH, {}, { fetch: f });
    assert.equal(res, undefined, outcome);
    assert.equal(logs.at(-1).outcome, outcome);
    assert.equal(logs.at(-1).page_head, "pastVenue");
  }
  // 時間切れ: signal で止まる取得。上限の後に素通りする
  const hang = fakeFetch((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason));
  }));
  const t0 = Date.now();
  // AbortSignal.timeout の時計は Node の待ちを保たない（unref）。試験の間だけ別の時計で保つ
  const keepAlive = setTimeout(() => {}, 5000);
  const { res, logs } = await run(PATH, {}, { fetch: hang, timeoutMs: 30 }).finally(() =>
    clearTimeout(keepAlive),
  );
  assert.equal(res, undefined);
  assert.equal(logs.at(-1).outcome, "timeout");
  assert.ok(Date.now() - t0 < 2000, "上限で止まらない");
});

await check("5. 会場名と「ホーム」は ja の訳と同じ字", async () => {
  for (let code = 1; code <= 24; code += 1) {
    const html = await (await run(`/races/2026-10-11/${code}`)).res.text();
    const title = html.match(/<title[^>]*>([^<]*)<\/title>/)[1];
    assert.ok(title.startsWith(`${ja.venues[String(code)]}競艇の結果・配当`), `会場 ${code}: ${title}`);
  }
  const html = await (await run(PATH)).res.text();
  assert.ok(html.includes(`"name":"${ja.analysisPage.breadcrumbHome}"`), "パンくずのホームが訳と違う");
});

await check("6. middleware の入口から同じに動き、ほかの振り分けは変わらない", async () => {
  const { default: middleware } = await import("../../middleware.js");
  const realFetch = globalThis.fetch;
  const before = process.env.PAGE_HEAD_KINDS;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(SHELL, { status: 200 });
  };
  try {
    process.env.PAGE_HEAD_KINDS = "pastVenue";
    const res = await middleware(req(PATH, { ua: UAS.bingbot }));
    assert.ok(res instanceof Response && res.status === 200);
    assert.ok((await res.text()).includes('rel="canonical"'));
    const rewritten = await middleware(req("/venue/1", { ua: UAS.bingbot }));
    assert.match(rewritten?.headers.get("x-middleware-rewrite") ?? "", /\/api\/bot-page\/venue\/1$/);
    assert.equal(await middleware(req("/races/2026-10-11")), undefined);
    delete process.env.PAGE_HEAD_KINDS;
    assert.equal(await middleware(req(PATH)), undefined);
    assert.deepEqual(calls, ["https://www.boat-ai.jp/index.html"]);
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
console.log("\nverify-page-head-middleware: すべて通った");
