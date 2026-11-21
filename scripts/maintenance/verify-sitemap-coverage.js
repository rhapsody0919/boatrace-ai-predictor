/**
 * AppRouter.jsx の静的ルートと generate-sitemap.js の staticPages を突き合わせ、
 * sitemap登録漏れを検知する（BOA: /winning-technique 未登録インシデントの再発防止）。
 *
 * 本文の字は読まない。ルートは AppRouter を描いて各言語の <Route path> を集め（verifyData/app-routes.js）、
 * sitemap は generate-sitemap.js を import して staticPages と生成の関数を偽の DB で回す（verifyData/sitemap-generator.js）。
 */

import assert from "node:assert/strict";
import {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  localizePath,
} from "../../src/config/languages.js";
import { fileURLToPath } from "url";
import { meetSeries, makeMeetRun } from "./verifyData/sitemap-coverage-meet.js";
import {
  atFixedNow,
  emptyDbScene,
  loadSitemapGenerator,
  raceDetailRun,
  sitemapScene,
  urlEntries,
} from "./verifyData/sitemap-generator.js";
import { appRoutePaths } from "./verifyData/app-routes.js";

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
  "admin/sns-hub/auto": "管理画面（SNSマーケティングハブの用途別ページ）。非公開",
  "admin/sns-hub/metrics": "管理画面（SNSマーケティングハブの用途別ページ）。非公開",
  "admin/sns-hub/library": "管理画面（SNSマーケティングハブの用途別ページ）。非公開",
};

// 描いた <Route path> のうち、静的な1枚のページの path（入れ物の /{lang}/*・/*、不明なパスの *、:param を持つ物を除く）
function staticRoutePaths(paths) {
  return [
    ...new Set(
      paths.filter(
        (p) => typeof p === "string" && !p.endsWith("*") && !p.includes(":"),
      ),
    ),
  ];
}

async function verifyRaceDetails(gen) {
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
  const pages = await raceDetailRun(gen, rows);
  assert.deepEqual(
    Array.from(pages, (p) => p.loc),
    [
      "/race/2026-10-31-01-01",
      "/race/2026-10-25-01-01",
      "/race/2026-10-31-01-04",
    ],
  );
  const many = Array.from({ length: 2016 }, (_, i) => row("2026-10-31", i));
  assert.equal((await raceDetailRun(gen, many)).length, 2016);
  await assert.rejects(
    raceDetailRun(gen, [], { fail: true }),
    /fixture read failed/,
  );
  // 生成の全体（staticPages・記事・他の DB の読みは空）に、確定済み /race の固定データを流す
  emptyDbScene(rows);
  const xml = await atFixedNow(() => gen.generateSitemap());
  const raceLocs = urlEntries(xml)
    .map((e) => e.loc)
    .filter((loc) => /\/race\//.test(loc));
  // ja 3件 + 言語版（en・zh-TW・ko）3件×3言語
  assert.equal(raceLocs.length, 3 + 3 * 3);
  for (const page of pages) {
    assert.ok(xml.includes(`<loc>https://www.boat-ai.jp${page.loc}</loc>`));
    for (const { code } of SUPPORTED_LANGUAGES) {
      if (code === DEFAULT_LANGUAGE) continue;
      assert.ok(
        xml.includes(
          `<loc>https://www.boat-ai.jp${localizePath(page.loc, code)}</loc>`,
        ),
      );
    }
  }
  // 思考アシスト（/race/{id}/assist）は足さない（記事の名前の assist は別物なので /race の URL だけを見る）
  assert.ok(!raceLocs.some((loc) => loc.includes("/assist")));
  // 総数の上限 50000: staticPages（export の配列）に埋めの行を足して、ちょうど上限は出し、1つ越えは止める
  emptyDbScene([]);
  const base = urlEntries(await atFixedNow(() => gen.generateSitemap())).length;
  const fill = (n) =>
    gen.staticPages.push(...Array.from({ length: n }, () => ({ loc: "/" })));
  const restore = gen.staticPages.length;
  try {
    fill(50000 - base);
    assert.equal(
      urlEntries(await atFixedNow(() => gen.generateSitemap())).length,
      50000,
    );
    fill(1);
    await assert.rejects(
      atFixedNow(() => gen.generateSitemap()),
      /上限超過/,
    );
  } finally {
    gen.staticPages.length = restore;
  }
  console.log(
    `✅ /race 掲載条件・取得失敗・1000件超・総数上限を確認（固定データ${pages.length}件）`,
  );
}

// 本物の getMeetPages を固定データ（偽の DB）で実行する。
async function verifyMeetPages(gen) {
  const model = await import("../../src/utils/meetPageModel.js");
  const languages = await import("../../src/config/languages.js");
  const series = meetSeries;
  const run = makeMeetRun(gen);
  for (const [meet, dates, included] of [
    [series("2026-11-01"), ["2026-11-01"], false],
    [series("2026-11-01"), [], false],
    [series("2026-10-31"), ["2026-11-01"], false],
    [series("2026-10-31"), [], false],
    [series("2026-10-31"), ["2026-10-31"], true], // 結果なしでも prelim
    [series("2026-10-29"), ["2026-10-29", "2026-10-30", "2026-10-31"], true],
    [series("2026-10-25"), ["2026-10-25", "2026-10-26"], true],
    [series("2026-10-29"), [], false], // notFound
    [series("2026-10-31", 1, "グランプリ"), ["2026-10-31"], false],
    [series("2026-10-31", 2), ["2026-10-31"], false], // 他会場の出走表
  ]) {
    const pages = await run(meet, dates);
    const base = `/venue/${meet.venue_code}/meet/${meet.start_date}`;
    assert.deepEqual(
      Array.from(pages, (p) => p.loc),
      included
        ? languages.SUPPORTED_LANGUAGES.map(({ code }) =>
            languages.localizePath(base, code),
          )
        : [],
      `節 ${meet.start_date} / 出走日 ${dates} の掲載条件`,
    );
    if (included) assert.equal(pages[0].lastmod, "2026-10-31");
  }
  const finishedMeet = { ...series("2026-10-25"), end_date: "2026-10-26" };
  const final = {
    race_id: "2026-10-26-01-01",
    race_stage: "優勝戦",
    is_final_day: true,
  };
  assert.equal(
    model.meetPageState({
      today: "2026-10-31",
      startDate: finishedMeet.start_date,
      meetDays: ["2026-10-25", "2026-10-26"],
      hasEntries: true,
      grade: "G1",
      title: finishedMeet.title,
      conditions: [final],
      doneRaceIds: new Set([final.race_id]),
      raceIds: [final.race_id],
    }),
    "finished",
  );
  const finishedPages = await run(finishedMeet, ["2026-10-25", "2026-10-26"], {
    conditions: [final],
  });
  assert.equal(finishedPages.length, languages.SUPPORTED_LANGUAGES.length);
  assert.equal(finishedPages[0].lastmod, "2026-10-26");
  // 初日不一致（種別が2日目）もページ同様に notFound。
  assert.equal(
    (
      await run(series("2026-10-31"), ["2026-10-31"], {
        conditions: [{ race_id: "2026-10-31-01-01", series_day: 2 }],
      })
    ).length,
    0,
  );
  for (const fail of [
    "race_series",
    "race_entries",
    "race_conditions",
    "races",
  ])
    await assert.rejects(
      run(series("2026-10-31"), ["2026-10-31"], { fail }),
      /fixture meet read failed/,
    );
  console.log(
    "✅ /meet の開幕前除外・初日結果なし・開催中・終了後・多言語・取得失敗を確認",
  );
}

// BOA-1232: 読取失敗を「データなし」にせず、3種類とも生成を止める。
async function verifyReadFailures(gen) {
  const failures = [];
  for (const [name, label] of [
    ["getRacePages", "レースページ"],
    ["getRacerPages", "選手ページ"],
    ["getLatestRaceDates", "開催日"],
  ]) {
    assert.equal(typeof gen[name], "function", `${name} が無い`);
    const run = (enabled, error) => {
      const query = {
        select: () => query,
        gte: () => query,
        eq: () => query,
        lte: () => query,
        order: () => query,
        limit: () => query,
        then: (resolve, reject) =>
          Promise.resolve({ data: error ? null : [], error }).then(resolve, reject),
      };
      sitemapScene({
        enabled,
        client: {
          from: () => {
            assert.ok(enabled, "未設定時に読み取らない");
            return query;
          },
        },
        fetchAll: async () => [],
      });
      return atFixedNow(() => gen[name]());
    };
    for (const enabled of [false, true]) {
      const empty = await run(enabled, null);
      if (name === "getLatestRaceDates") {
        assert.equal(empty.overall, null);
        assert.equal(empty.byVenue.size, enabled ? 24 : 0);
      } else assert.equal(empty.length, 0);
    }
    try {
      await assert.rejects(run(true, { message: "timeout" }), (error) => {
        assert.ok(error.message.includes(label), error.message);
        assert.ok(error.message.includes("timeout"), error.message);
        return true;
      });
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
    }
  }
  assert.equal(failures.length, 0, failures.join("\n"));
  console.log("✅ レースページ・選手ページ・開催日の読取失敗と未設定時の空応答を確認");
}

async function main() {
  // generate-sitemap.js を先に読み込む（AppRouter を描く renderJsx の hooks が src/ の import を Vite 向けに変える前に）
  const gen = await loadSitemapGenerator();
  await verifyReadFailures(gen);
  await verifyRaceDetails(gen);
  await verifyMeetPages(gen);

  const routePaths = staticRoutePaths(await appRoutePaths());
  const sitemapLocs = new Set(gen.staticPages.map((p) => p.loc));

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
