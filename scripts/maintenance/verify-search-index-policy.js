/**
 * 検索に出す・出さないの決まり（BOA-1701、docs/adr/0107-noindex-localized-race-pages.md）が、
 * 表（src/config/languages.js の isSearchIndexed）・sitemap・hreflang・応答のヘッダ（vercel.json の X-Robots-Tag）・
 * robots.txt で食い違わないことを確かめる。
 *
 * 守るもの:
 * (a) 型ごとの見本の URL × 4言語の期待の表（この中に字で持つ）と isSearchIndexed の答えが同じ
 * (b) 偽の DB で作った sitemap に検索に出さない URL が0、ja の /race/<id> は在る。混じれば生成が throw する
 * (c) getHreflangAlternates の href が全部「検索に出す」URL
 * (d) vercel.json の X-Robots-Tag の規則がちょうど1つ・値 noindex・has と missing が無く、
 *     source が「検索に出さない」見本の全部に当たり「検索に出す」見本に1つも当たらない
 * (e) public/robots.txt の検索の bot の組の Disallow が見本のどれにも当たらない（塞ぐと noindex が読まれない。/admin だけ）。
 *     学習用の AI クローラー（src/config/aiCrawlerBots.js）だけの組は Disallow: / だけを許す
 */

import assert from "node:assert/strict";
import { BLOCKED_CRAWLER_USER_AGENTS } from "../../src/config/aiCrawlerBots.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SUPPORTED_LANGUAGES,
  getHreflangAlternates,
  isSearchIndexed,
  localizePath,
  parseLangFromPath,
} from "../../src/config/languages.js";
import {
  atFixedNow,
  emptyDbScene,
  loadSitemapGenerator,
  urlEntries,
} from "./verifyData/sitemap-generator.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SITE = "https://www.boat-ai.jp";
const RACE_ID = "2026-10-31-01-01";

// 期待の表: 言語の接頭を外したパス → 検索に出す言語。表と isSearchIndexed が食い違えば落ちる
const ALL = ["ja", "en", "zh-TW", "ko"];
const EXPECTED = {
  "/": ALL,
  "/venue/1": ALL,
  "/guide": ALL,
  [`/race/${RACE_ID}`]: ["ja"],
  [`/race/${RACE_ID}/assist`]: ["ja"],
  "/blog": ALL,
};

// vercel.json の規則が当たってはいけない「検索に出す」見本（ja の /race を巻き込まない）
const INDEXED_SAMPLES = [
  `/race/${RACE_ID}`,
  `/race/${RACE_ID}/assist`,
  "/",
  "/venue/1",
  "/en",
  "/en/venue/1",
  "/en/blog/some-post",
  "/en/race",
  "/en/races/2026-10-31",
  "/racer/1234",
  "/today",
];

function samples() {
  return Object.entries(EXPECTED).flatMap(([basePath, langs]) =>
    ALL.map((lang) => ({
      basePath,
      lang,
      url: localizePath(basePath, lang),
      indexed: langs.includes(lang),
    })),
  );
}

function verifyTable() {
  assert.deepEqual(
    SUPPORTED_LANGUAGES.map(({ code }) => code).sort(),
    [...ALL].sort(),
    "SUPPORTED_LANGUAGES が見本の4言語と違う（表を直す）",
  );
  for (const s of samples()) {
    assert.equal(
      isSearchIndexed(s.basePath, s.lang),
      s.indexed,
      `(a) isSearchIndexed(${s.basePath}, ${s.lang}) が期待 ${s.indexed} と違う`,
    );
  }
  console.log(`✅ (a) 見本 ${samples().length} 件の検索に出す・出さないが表と同じ`);
}

function raceRow() {
  return { race_id: RACE_ID, race_date: "2026-10-31", race_results: { rank1: 1 } };
}

async function verifySitemap() {
  const gen = await loadSitemapGenerator();
  emptyDbScene([raceRow()]);
  const entries = urlEntries(await atFixedNow(() => gen.generateSitemap()));
  const locs = entries.map((e) => e.loc);
  assert.ok(locs.includes(`${SITE}/race/${RACE_ID}`), "(b) ja の /race/<id> が sitemap に無い");
  const unindexed = entries
    .flatMap((e) => [e.loc, ...e.alternates.map((a) => a.href)])
    .filter((url) => {
      const { lng, basePath } = parseLangFromPath(url.slice(SITE.length));
      return !isSearchIndexed(basePath, lng);
    });
  assert.deepEqual(unindexed, [], "(b) sitemap に検索に出さない URL（loc か xhtml:link）");
  for (const s of samples().filter((x) => !x.indexed)) {
    assert.ok(!locs.includes(`${SITE}${s.url}`), `(b) ${s.url} が sitemap に在る`);
  }
  // 検索に出さない URL が混じったら黙って落とさず throw する
  const restore = gen.staticPages.length;
  try {
    gen.staticPages.push({ loc: `/en/race/${RACE_ID}` });
    await assert.rejects(
      atFixedNow(() => gen.generateSitemap()),
      /検索に出さない URL/,
      "(b) 検索に出さない URL が混じっても生成が throw しない",
    );
  } finally {
    gen.staticPages.length = restore;
  }
  console.log(`✅ (b) sitemap ${entries.length} 件に検索に出さない URL が0・混じれば throw`);
}

function verifyHreflang() {
  let n = 0;
  for (const basePath of Object.keys(EXPECTED)) {
    for (const { href } of getHreflangAlternates(basePath, SITE)) {
      const { lng, basePath: bp } = parseLangFromPath(href.slice(SITE.length));
      assert.ok(isSearchIndexed(bp, lng), `(c) hreflang に検索に出さない ${href}（${basePath}）`);
      n += 1;
    }
  }
  assert.deepEqual(getHreflangAlternates(`/race/${RACE_ID}`, SITE), [], "(c) /race/<id> の hreflang が空でない");
  assert.ok(getHreflangAlternates("/guide", SITE).length > 0, "(c) /guide の hreflang が空（巻き込み）");
  console.log(`✅ (c) hreflang の href ${n} 件が全部検索に出す URL`);
}

// verify-middleware-routing.js の sourceRegExp と同じ組み方
function sourceRegExp(source) {
  if (/\/:[A-Za-z]/.test(source)) {
    throw new Error(`source "${source}" の :name 形はこの検証が解釈できない`);
  }
  return new RegExp(`^${source}$`);
}

function verifyVercel() {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf-8"));
  const rules = (config.headers ?? []).filter((r) =>
    (r.headers ?? []).some((h) => h.key.toLowerCase() === "x-robots-tag"),
  );
  assert.equal(rules.length, 1, `(d) X-Robots-Tag の規則が ${rules.length} 本（ちょうど1本）`);
  const [rule] = rules;
  const tag = rule.headers.find((h) => h.key.toLowerCase() === "x-robots-tag");
  assert.equal(tag.value, "noindex", "(d) X-Robots-Tag の値が noindex でない");
  assert.equal(rule.has, undefined, "(d) X-Robots-Tag の規則に has がある（全経路に付ける）");
  assert.equal(rule.missing, undefined, "(d) X-Robots-Tag の規則に missing がある（全経路に付ける）");
  const re = sourceRegExp(rule.source);
  for (const s of samples().filter((x) => !x.indexed)) {
    assert.ok(re.test(s.url), `(d) X-Robots-Tag が ${s.url} に当たらない`);
  }
  for (const url of [...INDEXED_SAMPLES, ...samples().filter((x) => x.indexed).map((x) => x.url)]) {
    assert.ok(!re.test(url), `(d) X-Robots-Tag が検索に出す ${url} に当たる`);
  }
  console.log(`✅ (d) vercel.json の X-Robots-Tag: noindex が1本・見本どおりに当たる（${rule.source}）`);
}

// robots.txt を User-agent の組に分ける（空行で区切らず、User-agent の行が続けば同じ組、規則の後の User-agent で新しい組）
function robotsGroups(text) {
  const groups = [];
  let cur = null;
  for (const line of text.split("\n")) {
    const ua = line.match(/^\s*User-agent:\s*(\S+)/i)?.[1];
    if (ua) {
      if (!cur || cur.rules.length > 0) groups.push((cur = { agents: [], rules: [] }));
      cur.agents.push(ua);
      continue;
    }
    const dis = line.match(/^\s*Disallow:\s*(\S+)/i)?.[1];
    if (dis && cur) cur.rules.push(dis);
  }
  return groups;
}

function verifyRobots() {
  const text = fs.readFileSync(path.join(ROOT, "public/robots.txt"), "utf-8");
  const groups = robotsGroups(text);
  // 学習用の AI クローラー（src/config/aiCrawlerBots.js、#2992）だけの組は全体を断ってよい。検索の bot は読まない組
  const blocked = new Set(BLOCKED_CRAWLER_USER_AGENTS.map((u) => u.toLowerCase()));
  const isBlockedOnly = (g) => g.agents.every((a) => blocked.has(a.toLowerCase()));
  for (const g of groups.filter(isBlockedOnly)) {
    assert.deepEqual(g.rules, ["/"], `(e) 学習用の AI クローラーの組（${g.agents.join("・")}）は Disallow: / だけにする`);
  }
  const searchGroups = groups.filter((g) => !isBlockedOnly(g));
  assert.ok(searchGroups.some((g) => g.agents.includes("*")), "(e) robots.txt に User-agent: * の組が無い");
  const disallows = searchGroups.flatMap((g) => g.rules);
  const urls = [...INDEXED_SAMPLES, ...samples().map((s) => s.url)];
  for (const prefix of disallows) {
    const hit = urls.filter((u) => u.startsWith(prefix));
    assert.deepEqual(hit, [], `(e) robots.txt の Disallow: ${prefix} が見本に当たる（塞ぐと noindex が読まれない）`);
  }
  console.log(`✅ (e) 検索の bot の組の Disallow（${disallows.join("・") || "なし"}）が見本に当たらない（学習用の AI クローラーの組は ${groups.filter(isBlockedOnly).length} つ）`);
}

async function main() {
  try {
    verifyTable();
    await verifySitemap();
    verifyHreflang();
    verifyVercel();
    verifyRobots();
    console.log("✅ verify-search-index-policy: 検索に出す・出さないの決まりが5か所で揃っている");
  } catch (err) {
    console.error(`❌ verify-search-index-policy: ${err.message}`);
    process.exit(1);
  }
}

main();
