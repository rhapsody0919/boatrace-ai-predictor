// 選手ID補完スクリプト
// race_entries: racer_id（欠損分のみ）
//
// 使用方法:
//   node scripts/maintenance/backfill-racer-ids.js --from=2025-12-01 --to=2025-12-31
//   node scripts/maintenance/backfill-racer-ids.js --from=2025-12-01 --to=2025-12-31 --dry-run

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
  return `${urlBase}racelist?rno=${raceNo}&jcd=${jcd}&hd=${ymd}`;
}

// 出走表から選手IDをスクレイピング
async function scrapeRacerIds(date, placeCd, raceNo) {
  try {
    const url = getUrl(date, placeCd, raceNo);
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
      },
    });

    if (!response.ok) return null;

    const html = await response.text();
    const $ = cheerio.load(html);

    const racers = [];

    $(".table1 tbody.is-fs12").each((index, tbody) => {
      if (index >= 6) return;

      const $tbody = $(tbody);
      const $fs11Divs = $tbody.find(".is-fs11");

      // 登録番号と級別（例: "4203 / B1" → "4203"）
      const gradeText = $fs11Divs.eq(0).text().trim();
      const racerIdMatch = gradeText.match(/^(\d+)/);
      const racerId = racerIdMatch ? parseInt(racerIdMatch[1]) : null;

      racers.push({
        boatNumber: index + 1,
        racerId,
      });
    });

    return racers.length === 6 ? racers : null;
  } catch {
    return null;
  }
}

// メイン処理
async function main() {
  const options = parseArgs();

  if (!options.from || !options.to) {
    console.log("使用方法:");
    console.log(
      "  node scripts/maintenance/backfill-racer-ids.js --from=2025-12-01 --to=2025-12-31",
    );
    console.log("");
    console.log("オプション:");
    console.log("  --dry-run       実際には更新しない（テスト実行）");
    console.log("  --limit=N       最初のN件のレースのみ処理");
    console.log("  --verbose, -v   詳細ログを出力");
    process.exit(1);
  }

  console.log("=== 選手ID補完スクリプト ===");
  console.log(`期間: ${options.from} 〜 ${options.to}`);
  console.log(
    `モード: ${options.dryRun ? "ドライラン（テスト）" : "本番実行"}`,
  );
  console.log("");

  // racer_idがNULLのエントリを取得（Supabaseのデフォルトlimit 1000を回避）
  let entries = [];
  const pageSize = 1000;
  let offset = 0;
  while (true) {
    const { data, error: fetchError } = await supabase
      .from("race_entries")
      .select(
        "race_id, boat_number, races!inner(race_date, venue_code, race_number)",
      )
      .is("racer_id", null)
      .gte("races.race_date", options.from)
      .lte("races.race_date", options.to)
      .order("race_id")
      .range(offset, offset + pageSize - 1);

    if (fetchError) {
      console.error("エントリ取得エラー:", fetchError.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    entries = entries.concat(data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  if (!entries || entries.length === 0) {
    console.log("racer_idが欠損しているエントリはありません。");
    process.exit(0);
  }

  console.log(`racer_id欠損エントリ: ${entries.length}件`);

  // レースごとにグループ化
  const raceMap = new Map();
  for (const entry of entries) {
    if (!raceMap.has(entry.race_id)) {
      raceMap.set(entry.race_id, {
        raceId: entry.race_id,
        raceDate: entry.races.race_date,
        venueCode: entry.races.venue_code,
        raceNumber: entry.races.race_number,
        boatNumbers: [],
      });
    }
    raceMap.get(entry.race_id).boatNumbers.push(entry.boat_number);
  }

  let targetRaces = Array.from(raceMap.values());

  if (options.limit) {
    targetRaces = targetRaces.slice(0, options.limit);
  }

  console.log(
    `対象レース数: ${targetRaces.length}件${options.limit ? ` (limit: ${options.limit})` : ""}`,
  );
  console.log("");

  let racesUpdated = 0;
  let entriesUpdated = 0;
  let racesSkipped = 0;
  let errors = 0;

  for (let i = 0; i < targetRaces.length; i++) {
    const race = targetRaces[i];
    const progress = `[${i + 1}/${targetRaces.length}]`;

    if (options.verbose)
      console.log(`${progress} ${race.raceId} - スクレイピング中...`);

    const racers = await scrapeRacerIds(
      race.raceDate,
      race.venueCode,
      race.raceNumber,
    );

    if (!racers) {
      racesSkipped++;
      if (options.verbose)
        console.log(`${progress} ${race.raceId} - スキップ（取得失敗）`);
    } else {
      // 欠損している艇番のみ更新
      const targetBoats = race.boatNumbers;
      let raceSuccess = true;

      for (const boatNum of targetBoats) {
        const racer = racers.find((r) => r.boatNumber === boatNum);
        if (!racer || !racer.racerId) {
          if (options.verbose)
            console.log(
              `${progress} ${race.raceId} 艇${boatNum} - 選手ID取得失敗`,
            );
          continue;
        }

        if (options.dryRun) {
          entriesUpdated++;
          if (options.verbose)
            console.log(
              `${progress} ${race.raceId} 艇${boatNum} → ${racer.racerId} (dry-run)`,
            );
          continue;
        }

        const { error: updateError } = await supabase
          .from("race_entries")
          .update({ racer_id: racer.racerId })
          .eq("race_id", race.raceId)
          .eq("boat_number", boatNum);

        if (updateError) {
          errors++;
          raceSuccess = false;
          console.error(
            `${progress} ${race.raceId} 艇${boatNum} 更新エラー:`,
            updateError.message,
          );
        } else {
          entriesUpdated++;
          if (options.verbose)
            console.log(
              `${progress} ${race.raceId} 艇${boatNum} → ${racer.racerId}`,
            );
        }
      }

      if (raceSuccess) {
        racesUpdated++;
      }
    }

    // 進捗表示（10件ごと）
    if ((i + 1) % 10 === 0 || i === targetRaces.length - 1) {
      console.log(
        `${progress} レース: ${racesUpdated}件処理, エントリ: ${entriesUpdated}件更新`,
      );
    }

    // レート制限対策（50msの遅延）
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  console.log("");
  console.log("=== 完了 ===");
  console.log(`レース処理: ${racesUpdated}件`);
  console.log(`エントリ更新: ${entriesUpdated}件`);
  console.log(`レーススキップ: ${racesSkipped}件`);
  console.log(`エラー: ${errors}件`);
}

main().catch(console.error);
