#!/usr/bin/env node
/**
 * middleware の生の HTML の head の差し込みのログ（api/_lib/pageHeadMiddleware.js）が、上限の時間を本番の分布で決め直すための項目を出すこと。
 *
 * 取得の関数と waitUntil を差し替えて直に呼ぶ（ネットに出ない）。
 * 1. 差し込んだ行に head_ms・shell_ms・cache・ua（粗い分類）・country（x-vercel-ip-country）・deploy（VERCEL_DEPLOYMENT_ID の先頭）・limit が付く
 * 2. 時間切れの後、裏の材料の取得が終わったら bg_done の行（打ち切られなかった本当の ms と cache）、失敗なら bg_error の行を出す
 * 3. ua の分類は数えるためだけで、返す HTML は UA で変わらない（ADR-0114 決定2）
 * 4. uaClassOf: Googlebot・Google-InspectionTool は googlebot、ほかの bot・crawler・spider は other_bot、人のブラウザは other
 */
import assert from "node:assert/strict";
import { respondWithPageHead, uaClassOf } from "../../api/_lib/pageHeadMiddleware.js";

const DEFAULT_TITLE = "既定";
const SHELL = `<!doctype html><html><head><title>${DEFAULT_TITLE}</title></head><body></body></html>`;
const HEAD = {
  v: 1,
  kind: "racer",
  title: "峰竜太（競艇）選手の成績",
  description: "説明",
  canonical: "https://www.boat-ai.jp/racer/4320",
  jsonLd: [],
};
const ENV = { PAGE_HEAD_KINDS: "racer", VERCEL_DEPLOYMENT_ID: "dpl_8pZSmDCeUb5ZYNRtCk1Y2Z" };
const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const HUMAN = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";

const apiResponse = () =>
  new Response(JSON.stringify(HEAD), { status: 200, headers: { "x-vercel-cache": "MISS" } });

async function run({ ua = HUMAN, country = "JP", api = apiResponse, timeoutMs } = {}) {
  const logs = [];
  const kept = [];
  const res = await respondWithPageHead(
    new Request("https://www.boat-ai.jp/racer/4320", {
      headers: { "user-agent": ua, "x-vercel-ip-country": country },
    }),
    {
      env: ENV,
      timeoutMs,
      fetchImpl: async (url) => (new URL(String(url)).pathname === "/index.html" ? new Response(SHELL) : api()),
      log: (line) => logs.push(JSON.parse(line)),
      waitUntil: (p) => kept.push(p),
    },
  );
  return { res, logs, kept };
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

await check("1. 差し込んだ行の項目", async () => {
  const { res, logs } = await run({ ua: GOOGLEBOT, country: "US" });
  assert.equal(res?.status, 200);
  const line = logs.at(-1);
  assert.equal(line.outcome, "injected");
  assert.equal(line.page_head, "racer");
  assert.ok(Number.isFinite(line.head_ms) && Number.isFinite(line.shell_ms), JSON.stringify(line));
  assert.deepEqual(
    [line.cache, line.ua, line.country, line.deploy, line.limit],
    ["MISS", "googlebot", "US", "dpl_8pZSmDCeUb5Z", 1000],
  );
});

await check("2. 時間切れの後の bg_done・bg_error", async () => {
  const slow = () => new Promise((resolve) => setTimeout(() => resolve(apiResponse()), 60));
  const timedOut = await run({ api: slow, timeoutMs: 10 });
  assert.equal(timedOut.res, undefined);
  assert.equal(timedOut.logs.at(-1).outcome, "timeout");
  assert.equal(timedOut.logs.at(-1).limit, 10);
  assert.equal(timedOut.kept.length, 1);
  await timedOut.kept[0];
  const bg = timedOut.logs.at(-1);
  assert.equal(bg.outcome, "bg_done");
  assert.equal(bg.cache, "MISS");
  assert.ok(bg.ms >= 50, `bg_done の ms が打ち切りの値のまま: ${bg.ms}`);
  assert.deepEqual([bg.page_head, bg.country, bg.ua], ["racer", "JP", "other"]);

  const failing = () => new Promise((_resolve, reject) => setTimeout(() => reject(new TypeError("fetch failed")), 30));
  const failed = await run({ api: failing, timeoutMs: 10 });
  await failed.kept[0];
  assert.equal(failed.logs.at(-1).outcome, "bg_error");
  assert.match(failed.logs.at(-1).message, /fetch failed/);
});

await check("3. 返す HTML は UA で変わらない", async () => {
  const human = await (await run({ ua: HUMAN })).res.text();
  const bot = await (await run({ ua: GOOGLEBOT })).res.text();
  assert.equal(human, bot);
});

await check("4. uaClassOf の分類", async () => {
  assert.equal(uaClassOf(GOOGLEBOT), "googlebot");
  assert.equal(uaClassOf("Mozilla/5.0 (compatible; Google-InspectionTool/1.0)"), "googlebot");
  assert.equal(uaClassOf("Mozilla/5.0 (compatible; bingbot/2.0)"), "other_bot");
  assert.equal(uaClassOf("Mozilla/5.0 (compatible; AhrefsBot/7.0)"), "other_bot");
  assert.equal(uaClassOf("facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php) crawler"), "other_bot");
  assert.equal(uaClassOf(HUMAN), "other");
  assert.equal(uaClassOf(null), "other");
});

if (failures > 0) {
  console.error(`\n${failures} 件の失敗`);
  process.exit(1);
}
console.log("\nverify-page-head-log: すべて通った");
