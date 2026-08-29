/**
 * AppRouter.jsx の静的ルートと generate-sitemap.js の staticPages を突き合わせ、
 * sitemap登録漏れを検知する（BOA: /winning-technique 未登録インシデントの再発防止）。
 */

import { promises as fs } from "fs";
import path from "path";
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

async function main() {
  const [appRouterSource, sitemapSource] = await Promise.all([
    fs.readFile(APP_ROUTER_PATH, "utf-8"),
    fs.readFile(SITEMAP_SCRIPT_PATH, "utf-8"),
  ]);

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

main().catch((error) => {
  console.error("❌ 検証中にエラーが発生しました:", error.message);
  process.exit(1);
});
