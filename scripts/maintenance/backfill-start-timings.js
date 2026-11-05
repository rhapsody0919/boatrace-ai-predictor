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
        console.warn(`  レート制限 (${response.status}), ${wait / 1000}秒待機...`);
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

// メイン処理
async function main() {
  const options = parseArgs();

  if (!options.from || !options.to) {
    console.log("使用方法:");
    console.log(
      "  node scripts/maintenance/backfill-start-timings.js --from=2025-12-01 --to=2025-12-31",
    );
    console.log("");
    console.log("オプション:");
    console.log("  --dry-run       実際には更新しない（テスト実行）");
    console.log("  --limit=N       最初のN件のみ処理");
    console.log("  --verbose, -v   詳細ログを出力");
    process.exit(1);
  }

  console.log("=== スタートタイミング補完スクリプト ===");
  console.log(`期間: ${options.from} 〜 ${options.to}`);
  console.log(
    `モード: ${options.dryRun ? "ドライラン（テスト）" : "本番実行"}`,
  );
  console.log("");

  // 対象レースを取得（Supabaseのデフォルトlimit 1000を回避）
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

  const races = options.limit ? allRaces.slice(0, options.limit) : allRaces;
  const error = null;

  if (error) {
    console.error("レース取得エラー:", error.message);
    process.exit(1);
  }

  console.log(
    `対象レース数: ${races.length}件${options.limit ? ` (limit: ${options.limit})` : ""}`,
  );

  // 既にスタートタイミングが登録済みのレースを取得
  const raceIds = races.map((r) => r.race_id);
  const existingTimings = new Set();

  // Supabaseのinクエリは大量データに対応するためチャンクで取得
  for (let i = 0; i < raceIds.length; i += 500) {
    const chunk = raceIds.slice(i, i + 500);
    const { data } = await supabase
      .from("race_start_timings")
      .select("race_id")
      .in("race_id", chunk);
    if (data) {
      for (const row of data) {
        existingTimings.add(row.race_id);
      }
    }
  }

  // winning_techniqueがnullのレースを取得
  const missingTechniques = new Set();
  for (let i = 0; i < raceIds.length; i += 500) {
    const chunk = raceIds.slice(i, i + 500);
    const { data } = await supabase
      .from("race_results")
      .select("race_id, winning_technique")
      .in("race_id", chunk)
      .is("winning_technique", null);
    if (data) {
      for (const row of data) {
        missingTechniques.add(row.race_id);
      }
    }
  }

  // スタートタイミング未登録 or 決まり手未登録のレースのみ対象
  const targetRaces = races.filter(
    (r) => !existingTimings.has(r.race_id) || missingTechniques.has(r.race_id),
  );

  console.log(`ST未登録: ${races.length - existingTimings.size}件`);
  console.log(`決まり手未登録: ${missingTechniques.size}件`);
  console.log(`スクレイピング対象: ${targetRaces.length}件`);
  console.log("");

  let timingsUpserted = 0;
  let timingsSkipped = 0;
  let techniquesUpdated = 0;
  let techniquesSkipped = 0;
  let errors = 0;
  let processed = 0;

  const CONCURRENCY = 5;
  const BATCH_DELAY_MS = 1000;

  async function processRace(race) {
    const result = await scrapeRaceResult(
      race.race_date,
      race.venue_code,
      race.race_number,
    );

    if (!result) {
      timingsSkipped++;
      techniquesSkipped++;
    } else {
      // スタートタイミング
      if (
        !existingTimings.has(race.race_id) &&
        result.startTimings.length > 0
      ) {
        const upsertResult = await upsertStartTimings(
          race.race_id,
          result.startTimings,
          options.dryRun,
        );
        if (upsertResult.success) {
          timingsUpserted++;
        } else {
          errors++;
          console.error(
            `${race.race_id} ST更新エラー:`,
            upsertResult.error?.message,
          );
        }
      } else {
        timingsSkipped++;
      }

      // 決まり手
      if (missingTechniques.has(race.race_id) && result.winningTechnique) {
        const updateResult = await updateWinningTechnique(
          race.race_id,
          result.winningTechnique,
          options.dryRun,
        );
        if (updateResult.success) {
          techniquesUpdated++;
        } else {
          errors++;
        }
      } else {
        techniquesSkipped++;
      }
    }

    processed++;
    if (processed % 50 === 0 || processed === targetRaces.length) {
      console.log(
        `[${processed}/${targetRaces.length}] ST: ${timingsUpserted}件登録, 決まり手: ${techniquesUpdated}件更新`,
      );
    }
  }

  // 並列実行（CONCURRENCY件ずつ、バッチ間ディレイ付き）
  for (let i = 0; i < targetRaces.length; i += CONCURRENCY) {
    const batch = targetRaces.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map((race) => processRace(race)));
    if (i + CONCURRENCY < targetRaces.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  console.log("");
  console.log("=== 完了 ===");
  console.log(`race_start_timings登録: ${timingsUpserted}件`);
  console.log(`race_start_timingsスキップ: ${timingsSkipped}件`);
  console.log(`winning_technique更新: ${techniquesUpdated}件`);
  console.log(`winning_techniqueスキップ: ${techniquesSkipped}件`);
  console.log(`エラー: ${errors}件`);
}

main().catch(console.error);
