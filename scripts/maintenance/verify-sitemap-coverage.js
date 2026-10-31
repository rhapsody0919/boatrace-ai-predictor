/**
 * AppRouter.jsx の静的ルートと generate-sitemap.js の staticPages を突き合わせ、
 * sitemap登録漏れを検知する（BOA: /winning-technique 未登録インシデントの再発防止）。
 */

import { promises as fs } from "fs";
import path from "path";
import assert from "node:assert/strict";
import vm from "node:vm";
import { renderUrlEntry } from "../lib/sitemapLastmod.js";
import { getDaysAgoJST } from "../../src/utils/dateUtils.js";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROUTER_PATH = path.join(__dirname, "../../src/AppRouter.jsx");
const SITEMAP_SCRIPT_PATH = path.join(__dirname, "../generate-sitemap.js");

// AppRouter.jsx にはあるが、意図的にsitemap非対象のルート。
// 新しいルートを除外する場合はここに理由付きで追記すること（暗黙の見落としを防ぐため）
const EXPECTED_EXCLUSIONS = {
  picks: "旧モデルページの廃止に伴うリダイレクト専用ルート（実体ページなし）",
  "outcome-distribution":
    "分析ツールへ統合済みのリダイレクト専用ルート（実体ページなし）",
  venues:
    "言語専用ページ。LANGUAGE_ONLY_PAGESで言語別に登録するためja版のstaticPages対象外",
  "admin/rules": "管理画面。非公開",
  "admin/sns-hub": "管理画面（SNSマーケティングハブ）。非公開",
  holmes: "α版・動線非公開ページ",
  poirot: "α版・動線非公開ページ",
  "share/today-sheet":
    "X の /today 投稿の型 b の画像を撮る撮影用のページ（人が見るページではない。noindex）",
};

function extractLocalizedRoutesBlock(source) {
  const start = source.indexOf("function LocalizedRoutes(");
  const end = source.indexOf("function LanguageSync(");
  if (start === -1 || end === -1) {
    throw new Error(
      "AppRouter.jsx の LocalizedRoutes/LanguageSync が見つかりません。関数名が変更された場合はこのスクリプトの抽出ロジックを更新してください",
    );
  }
  return source.slice(start, end);
}

function extractStaticRoutePaths(routesBlock) {
  const matches = [...routesBlock.matchAll(/<Route\s+path="([^"]*)"/g)];
  return matches.map((m) => m[1]).filter((p) => p !== "*" && !p.includes(":"));
}

function extractSitemapStaticLocs(sitemapSource) {
  const start = sitemapSource.indexOf("const staticPages = [");
  const end = sitemapSource.indexOf("\n];", start);
  if (start === -1 || end === -1) {
    throw new Error(
      "generate-sitemap.js の staticPages 配列が見つかりません。定義が変更された場合はこのスクリプトの抽出ロジックを更新してください",
    );
  }
  const block = sitemapSource.slice(start, end);
  const matches = [...block.matchAll(/loc:\s*"([^"]*)"/g)];
  return new Set(matches.map((m) => m[1]));
}

// 生成器の実関数だけを隔離して実行し、DB・鍵・生成物に触れない。
export async function raceDetailFixture(source, rows, { fail = false } = {}) {
  const match = source.match(
    /async function getRaceDetailPages\(\) \{[\s\S]*?\n\}/,
  );
  assert.ok(match, "確定済み /race の生成関数が無い");
  const now = new Date("2026-10-30T15:30:00Z"); // JST 10/31、UTC 10/30
  const query = {
    gte(key, value) {
      rows = rows.filter((r) => r[key] >= value);
      return this;
    },
    lte(key, value) {
      rows = rows.filter((r) => r[key] <= value);
      return this;
    },
    not(key, op, value) {
      assert.equal(key, "race_results.rank1");
      assert.equal(op, "is");
      assert.equal(value, null);
      rows = rows.filter((r) => r.race_results?.rank1 != null);
      return this;
    },
    order(key) {
      assert.equal(key, "race_id");
      return this;
    },
  };
  const fetchSource = await fs.readFile(
    path.join(__dirname, "../lib/supabaseClient.js"),
    "utf8",
  );
  const fetchCode = fetchSource
    .match(/export async function fetchAll\([\s\S]*?\n\}/)[0]
    .replace("export ", "");
  const fetchAll = vm.runInNewContext(
    `(() => { ${fetchCode}; return fetchAll; })()`,
    {
      assertOrdered: () => {},
    },
  );
  let range;
  query.range = (from, to) => {
    range = [from, to];
    return query;
  };
  query.select = () => query;
  query.then = (resolve) =>
    resolve({ data: rows.slice(range[0], range[1] + 1), error: null });
  const client = {
    isSupabaseEnabled: () => true,
    fetchAll: async (table, columns, build) => {
      assert.equal(table, "races");
      assert.match(columns, /race_results!inner\(rank1\)/);
      if (fail) throw new Error("fixture read failed");
      return fetchAll(table, columns, build, { client: { from: () => query } });
    },
  };
  const code = match[0].replace(
    /await import\("\.\/lib\/supabaseClient\.js"\)/g,
    "client",
  );
  return vm.runInNewContext(
    `(async () => { ${code}; return getRaceDetailPages(); })()`,
    {
      client,
      getDaysAgoJST: (days) => getDaysAgoJST(days, now),
    },
  );
}

export async function sitemapFixture(source, pages, baseCount = 0) {
  const code = source.match(
    /async function generateSitemap\(\) \{[\s\S]*?\n\}/,
  )[0];
  return vm.runInNewContext(
    `(async () => { ${code}; return generateSitemap(); })()`,
    {
      getBlogPosts: () => [],
      getRacePages: async () => [],
      getRaceDetailPages: async () => pages,
      getRacerPages: async () => [],
      getLatestRaceDates: async () => ({ overall: null, byVenue: new Map() }),
      getMeetPages: async () => [],
      staticPages: Array.from({ length: baseCount }, () => ({ loc: "/" })),
      localizedPages: [],
      SITE_URL: "https://www.boat-ai.jp",
      renderUrlEntry,
      alternatesFor: () => [],
    },
  );
}

async function verifyRaceDetails(source) {
  const row = (date, n, rank1 = 1) => ({
    race_id: `${date}-01-${String(n).padStart(2, "0")}`,
    race_date: date,
    race_results: rank1 == null ? null : { rank1 },
  });
  const rows = [
    row("2026-10-31", 1),
    row("2026-10-25", 1),
    row("2026-10-24", 1),
    row("2026-11-01", 1),
    row("2026-10-31", 2, null),
    { ...row("2026-10-31", 5), race_results: { rank1: null } },
    { ...row("2026-10-31", 3, null), cancellation_status: "confirmed" },
    { ...row("2026-10-31", 4), cancellation_status: "confirmed" },
  ];
  const pages = await raceDetailFixture(source, rows);
  assert.deepEqual(
    Array.from(pages, (p) => p.loc),
    [
      "/race/2026-10-31-01-01",
      "/race/2026-10-25-01-01",
      "/race/2026-10-31-01-04",
    ],
  );
  const many = Array.from({ length: 2016 }, (_, i) => row("2026-10-31", i));
  assert.equal((await raceDetailFixture(source, many)).length, 2016);
  await assert.rejects(
    raceDetailFixture(source, [], { fail: true }),
    /fixture read failed/,
  );
  const xml = await sitemapFixture(source, pages);
  assert.equal((xml.match(/<url>/g) ?? []).length, 3);
  for (const page of pages)
    assert.ok(xml.includes(`<loc>https://www.boat-ai.jp${page.loc}</loc>`));
  assert.equal(
    ((await sitemapFixture(source, [], 50000)).match(/<url>/g) ?? []).length,
    50000,
  );
  await assert.rejects(sitemapFixture(source, pages, 49998), /上限超過/);
  console.log(
    `✅ /race 掲載条件・取得失敗・1000件超・総数上限を確認（固定データ${pages.length}件）`,
  );
}

async function main() {
  const [appRouterSource, sitemapSource] = await Promise.all([
    fs.readFile(APP_ROUTER_PATH, "utf-8"),
    fs.readFile(SITEMAP_SCRIPT_PATH, "utf-8"),
  ]);

  await verifyRaceDetails(sitemapSource);

  const routesBlock = extractLocalizedRoutesBlock(appRouterSource);
  const routePaths = extractStaticRoutePaths(routesBlock);
  const sitemapLocs = extractSitemapStaticLocs(sitemapSource);

  const missing = routePaths.filter((routePath) => {
    if (routePath in EXPECTED_EXCLUSIONS) return false;
    const loc = routePath === "" || routePath === "/" ? "/" : `/${routePath}`;
    return !sitemapLocs.has(loc);
  });

  const staleExclusions = Object.keys(EXPECTED_EXCLUSIONS).filter(
    (excludedPath) => !routePaths.includes(excludedPath),
  );

  if (missing.length === 0 && staleExclusions.length === 0) {
    console.log(
      `✅ sitemap整合性OK（${routePaths.length}件の静的ルートを確認、除外${Object.keys(EXPECTED_EXCLUSIONS).length}件）`,
    );
    return;
  }

  if (missing.length > 0) {
    console.error("❌ AppRouter.jsx にあるが sitemap 未登録のルート:");
    missing.forEach((p) => {
      console.error(
        `   - /${p} … scripts/generate-sitemap.js の staticPages に追加するか、意図的な除外ならこのスクリプトの EXPECTED_EXCLUSIONS に理由付きで追記してください`,
      );
    });
  }

  if (staleExclusions.length > 0) {
    console.error(
      "\n⚠️ EXPECTED_EXCLUSIONS に登録されているが AppRouter.jsx から消えたルート（不要になった除外設定、削除推奨）:",
    );
    staleExclusions.forEach((p) => console.error(`   - ${p}`));
  }

  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error("❌ 検証中にエラーが発生しました:", error.message);
    process.exit(1);
  });
