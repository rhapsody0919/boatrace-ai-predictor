// スタートタイミング補完スクリプト
// race_start_timings: boat_number, start_timing, is_flying, is_late_start
// race_results: winning_technique（欠損分のみ）
//
// 使用方法:
//   node scripts/maintenance/backfill-start-timings.js --from=2025-12-01 --to=2025-12-31
//   node scripts/maintenance/backfill-start-timings.js --from=2025-12-01 --to=2025-12-31 --dry-run

import * as cheerio from "cheerio";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

// コマンドライン引数をパース
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    from: null,
    to: null,
    dryRun: false,
    limit: null,
    verbose: false,
  };

  for (const arg of args) {
    if (arg.startsWith("--from=")) {
      options.from = arg.replace("--from=", "");
    } else if (arg.startsWith("--to=")) {
      options.to = arg.replace("--to=", "");
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg.startsWith("--limit=")) {
      options.limit = parseInt(arg.replace("--limit=", ""));
    } else if (arg === "--verbose" || arg === "-v") {
      options.verbose = true;
    }
  }

  return options;
}

// URLを生成
function getUrl(date, placeCd, raceNo) {
  const urlBase = "https://www.boatrace.jp/owpc/pc/race/";
  const ymd = date.replace(/-/g, "");
  const jcd = String(placeCd).padStart(2, "0");
  return `${urlBase}raceresult?rno=${raceNo}&jcd=${jcd}&hd=${ymd}`;
}

// 結果ページからスタートタイミングをスクレイピング
function scrapeStartTimings($) {
  const startTimings = [];

  const startInfoTable = $(".is-w495.is-h292__3rdadd");
  if (startInfoTable.length === 0) {
    return startTimings;
  }

  startInfoTable.find(".table1_boatImage1").each((index, el) => {
    // 艇番（画像URLから抽出）
    const imgSrc = $(el).find(".table1_boatImage1Boat img").attr("src") || "";
    const boatMatch = imgSrc.match(/img_boat2_(\d)\.png/);
    const boatNum = boatMatch ? parseInt(boatMatch[1]) : null;

    if (!boatNum) return;

    // ST値を取得
    const stText = $(el).find(".table1_boatImage1Time").text().trim();

    // フライング（F）やレイトスタート（L）を判定
    const isFlying = stText.includes("F");
    const isLateStart = stText.includes("L");

    // 数値部分を抽出（例: "F.05" → 0.05, ".12" → 0.12）
    const numMatch = stText.match(/[FL]?\.?(\d+)/);
    let stValue = null;
    if (numMatch) {
      stValue = parseFloat("0." + numMatch[1]);
    }

    if (stValue !== null) {
      startTimings.push({
        boat_number: boatNum,
        start_timing: stValue,
        is_flying: isFlying,
        is_late_start: isLateStart,
      });
    }
  });

  return startTimings;
}

// 結果ページから決まり手をスクレイピング
function scrapeWinningTechnique($) {
  let winningTechnique = null;
  $(".is-w243").each((i, table) => {
    const header = $(table).find("th").first().text().trim();
    if (header === "決まり手") {
      winningTechnique = $(table).find("tbody td").first().text().trim();
    }
  });
  return winningTechnique || null;
}

// sleep関数
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 結果ページをスクレイピング（リトライ付き）
async function scrapeRaceResult(date, placeCd, raceNo, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const url = getUrl(date, placeCd, raceNo);
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
        },
      });

      if (response.status === 429 || response.status === 503) {
        const wait = (attempt + 1) * 5000;
        console.warn(
          `  レート制限 (${response.status}), ${wait / 1000}秒待機...`,
        );
        await sleep(wait);
        continue;
      }

      if (!response.ok) return null;

      const html = await response.text();
      const $ = cheerio.load(html);

      const startTimings = scrapeStartTimings($);
      const winningTechnique = scrapeWinningTechnique($);

      return { startTimings, winningTechnique };
    } catch {
      if (attempt < maxRetries - 1) {
        await sleep((attempt + 1) * 2000);
        continue;
      }
      return null;
    }
  }
  return null;
}

// race_start_timingsをupsert
async function upsertStartTimings(raceId, startTimings, dryRun) {
  const rows = startTimings.map((st) => ({
    race_id: raceId,
    boat_number: st.boat_number,
    start_timing: st.start_timing,
    is_flying: st.is_flying,
    is_late_start: st.is_late_start,
  }));

  if (dryRun) {
    return { success: true, count: rows.length };
  }

  const { error } = await supabase
    .from("race_start_timings")
    .upsert(rows, { onConflict: "race_id,boat_number" });

  return { success: !error, count: rows.length, error };
}

// race_results.winning_techniqueを更新
async function updateWinningTechnique(raceId, winningTechnique, dryRun) {
  if (dryRun) {
    return { success: true };
  }

  const { error } = await supabase
    .from("race_results")
    .update({ winning_technique: winningTechnique })
    .eq("race_id", raceId);

  return { success: !error, error };
}

function printUsage() {
  console.log(
    [
      "使用方法:",
      "  node scripts/maintenance/backfill-start-timings.js --from=2025-12-01 --to=2025-12-31",
      "",
      "オプション:",
      "  --dry-run       実際には更新しない（テスト実行）",
      "  --limit=N       最初のN件のみ処理",
      "  --verbose, -v   詳細ログを出力",
    ].join("\n"),
  );
}

// 対象レースを取得（Supabaseのデフォルトlimit 1000を回避）
async function fetchAllRaces(options) {
  let allRaces = [];
  const pageSize = 1000;
  let offset = 0;
  while (true) {
    let query = supabase
      .from("races")
      .select("race_id, race_date, venue_code, race_number")
      .gte("race_date", options.from)
      .lte("race_date", options.to)
      .order("race_id")
      .range(offset, offset + pageSize - 1);

    const { data, error: fetchError } = await query;
    if (fetchError) {
      console.error("レース取得エラー:", fetchError.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    allRaces = allRaces.concat(data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return allRaces;
}

// 指定の表から race_id の集合を取得（Supabaseのinクエリは大量データに対応するためチャンクで取得。refine で条件を足す）
async function fetchRaceIdSet(table, columns, raceIds, refine = (q) => q) {
  const found = new Set();
  for (let i = 0; i < raceIds.length; i += 500) {
    const chunk = raceIds.slice(i, i + 500);
    const { data } = await refine(
      supabase.from(table).select(columns).in("race_id", chunk),
    );
    for (const row of data ?? []) found.add(row.race_id);
  }
  return found;
}

// 1レースを処理（ctx: options・existingTimings・missingTechniques・stats・total）
async function processRace(race, ctx) {
  const { options, existingTimings, missingTechniques, stats } = ctx;
  const result = await scrapeRaceResult(
    race.race_date,
    race.venue_code,
    race.race_number,
  );

  if (!result) {
    stats.timingsSkipped++;
    stats.techniquesSkipped++;
  } else {
    // スタートタイミング
    if (!existingTimings.has(race.race_id) && result.startTimings.length > 0) {
      const upsertResult = await upsertStartTimings(
        race.race_id,
        result.startTimings,
        options.dryRun,
      );
      if (upsertResult.success) {
        stats.timingsUpserted++;
      } else {
        stats.errors++;
        console.error(
          `${race.race_id} ST更新エラー:`,
          upsertResult.error?.message,
        );
      }
    } else {
      stats.timingsSkipped++;
    }

    // 決まり手
    if (missingTechniques.has(race.race_id) && result.winningTechnique) {
      const updateResult = await updateWinningTechnique(
        race.race_id,
        result.winningTechnique,
        options.dryRun,
      );
      if (updateResult.success) {
        stats.techniquesUpdated++;
      } else {
        stats.errors++;
      }
    } else {
      stats.techniquesSkipped++;
    }
  }

  stats.processed++;
  if (stats.processed % 50 === 0 || stats.processed === ctx.total) {
    console.log(
      `[${stats.processed}/${ctx.total}] ST: ${stats.timingsUpserted}件登録, 決まり手: ${stats.techniquesUpdated}件更新`,
    );
  }
}

// メイン処理
async function main() {
  const options = parseArgs();

  if (!options.from || !options.to) {
    printUsage();
    process.exit(1);
  }

  const mode = options.dryRun ? "ドライラン（テスト）" : "本番実行";
  console.log(
    `=== スタートタイミング補完スクリプト ===\n期間: ${options.from} 〜 ${options.to}\nモード: ${mode}\n`,
  );

  const allRaces = await fetchAllRaces(options);

  const races = options.limit ? allRaces.slice(0, options.limit) : allRaces;
  const error = null;

  if (error) {
    console.error("レース取得エラー:", error.message);
    process.exit(1);
  }

  console.log(
    `対象レース数: ${races.length}件${options.limit ? ` (limit: ${options.limit})` : ""}`,
  );

  const raceIds = races.map((r) => r.race_id);
  // 既にスタートタイミングが登録済みのレース
  const existingTimings = await fetchRaceIdSet(
    "race_start_timings",
    "race_id",
    raceIds,
  );
  // winning_techniqueがnullのレース
  const missingTechniques = await fetchRaceIdSet(
    "race_results",
    "race_id, winning_technique",
    raceIds,
    (q) => q.is("winning_technique", null),
  );

  // スタートタイミング未登録 or 決まり手未登録のレースのみ対象
  const targetRaces = races.filter(
    (r) => !existingTimings.has(r.race_id) || missingTechniques.has(r.race_id),
  );

  console.log(`ST未登録: ${races.length - existingTimings.size}件`);
  console.log(`決まり手未登録: ${missingTechniques.size}件`);
  console.log(`スクレイピング対象: ${targetRaces.length}件`);
  console.log("");

  const stats = {
    timingsUpserted: 0,
    timingsSkipped: 0,
    techniquesUpdated: 0,
    techniquesSkipped: 0,
    errors: 0,
    processed: 0,
  };
  const ctx = {
    options,
    existingTimings,
    missingTechniques,
    stats,
    total: targetRaces.length,
  };

  const CONCURRENCY = 5;
  const BATCH_DELAY_MS = 1000;

  // 並列実行（CONCURRENCY件ずつ、バッチ間ディレイ付き）
  for (let i = 0; i < targetRaces.length; i += CONCURRENCY) {
    const batch = targetRaces.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map((race) => processRace(race, ctx)));
    if (i + CONCURRENCY < targetRaces.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  console.log(
    `\n=== 完了 ===\nrace_start_timings登録: ${stats.timingsUpserted}件\nrace_start_timingsスキップ: ${stats.timingsSkipped}件\nwinning_technique更新: ${stats.techniquesUpdated}件\nwinning_techniqueスキップ: ${stats.techniquesSkipped}件\nエラー: ${stats.errors}件`,
  );
}

main().catch(console.error);
