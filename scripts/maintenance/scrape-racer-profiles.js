// 選手プロフィール取得スクリプト（生年月日・支部・出身地等）
// race_entries.racer_id のうち racer_profiles 未登録分を対象に、
// boatrace.jp 選手検索ページ（racersearch/profile?toban=）をスクレイピングして保存する
//
// 使用方法:
//   node scripts/maintenance/scrape-racer-profiles.js
//   node scripts/maintenance/scrape-racer-profiles.js --dry-run
//   node scripts/maintenance/scrape-racer-profiles.js --limit=10 --verbose

import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import { supabase } from "../lib/supabaseClient.js";

const REQUEST_DELAY_MS = 500;
const REPORT_DIR = "data/analysis/racer-fortune-telling";
const REPORT_PATH = path.join(REPORT_DIR, "profile-scrape-report.json");

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { dryRun: false, limit: null, verbose: false };
  for (const arg of args) {
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg.startsWith("--limit="))
      options.limit = parseInt(arg.replace("--limit=", ""), 10);
    else if (arg === "--verbose" || arg === "-v") options.verbose = true;
  }
  return options;
}

function getProfileUrl(racerId) {
  return `https://www.boatrace.jp/owpc/pc/data/racersearch/profile?toban=${racerId}`;
}

// dl.list3 の dt/dd ペアをパースして選手プロフィールを取得する。
// プロフィールが存在しない racer_id は dl.list3 自体が出力されないため null を返す
async function scrapeProfile(racerId) {
  const response = await fetch(getProfileUrl(racerId), {
    headers: {
      "User-Agent":
        "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
    },
  });

  if (!response.ok) return null;

  const html = await response.text();
  const $ = cheerio.load(html);

  const $dl = $("dl.list3").first();
  if ($dl.length === 0) return null;

  const fields = {};
  const $items = $dl.children();
  for (let i = 0; i < $items.length; i += 2) {
    const key = $($items[i]).text().trim();
    const value = $($items[i + 1])
      .text()
      .trim();
    fields[key] = value;
  }

  const birthDateText = fields["生年月日"]; // "1983/06/09"
  if (!birthDateText) return null;
  const birthDate = birthDateText.replace(/\//g, "-");

  return {
    racerId,
    name: $(".racer1_bodyName").first().text().trim() || null,
    nameKana: $(".racer1_bodyKana").first().text().trim() || null,
    birthDate,
    heightCm: fields["身長"] ? parseInt(fields["身長"], 10) : null,
    weightKg: fields["体重"] ? parseInt(fields["体重"], 10) : null,
    bloodType: fields["血液型"] || null,
    branch: fields["支部"] || null,
    hometown: fields["出身地"] || null,
    registrationPeriod: fields["登録期"] || null,
    gradeAtScrape: fields["級別"] || null,
  };
}

async function getTargetRacerIds(limit) {
  const registered = new Set();
  {
    let offset = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error } = await supabase
        .from("racer_profiles")
        .select("racer_id")
        .range(offset, offset + pageSize - 1);
      if (error) throw new Error(`racer_profiles取得エラー: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const row of data) registered.add(row.racer_id);
      if (data.length < pageSize) break;
      offset += pageSize;
    }
  }

  const allRacerIds = new Set();
  {
    let offset = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error } = await supabase
        .from("race_entries")
        .select("racer_id")
        .not("racer_id", "is", null)
        .order("racer_id")
        .range(offset, offset + pageSize - 1);
      if (error) throw new Error(`race_entries取得エラー: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const row of data) allRacerIds.add(row.racer_id);
      if (data.length < pageSize) break;
      offset += pageSize;
    }
  }

  let target = [...allRacerIds]
    .filter((id) => !registered.has(id))
    .sort((a, b) => a - b);
  if (limit) target = target.slice(0, limit);
  return target;
}

async function main() {
  const options = parseArgs();

  console.log("=== 選手プロフィール取得スクリプト ===");
  console.log(
    `モード: ${options.dryRun ? "ドライラン（テスト）" : "本番実行"}`,
  );
  console.log("");

  const targetRacerIds = await getTargetRacerIds(options.limit);

  if (targetRacerIds.length === 0) {
    console.log("対象のracer_idはありません（全件取得済み）。");
    process.exit(0);
  }

  console.log(
    `対象racer_id数: ${targetRacerIds.length}件${options.limit ? ` (limit: ${options.limit})` : ""}`,
  );
  console.log("");

  let successCount = 0;
  let failCount = 0;
  const failedRacerIds = [];

  for (let i = 0; i < targetRacerIds.length; i++) {
    const racerId = targetRacerIds[i];
    const progress = `[${i + 1}/${targetRacerIds.length}]`;

    const profile = await scrapeProfile(racerId).catch((err) => {
      if (options.verbose)
        console.log(`${progress} racer_id=${racerId} - エラー: ${err.message}`);
      return null;
    });

    if (!profile) {
      failCount++;
      failedRacerIds.push(racerId);
      if (options.verbose)
        console.log(`${progress} racer_id=${racerId} - 取得失敗（スキップ）`);
    } else if (options.dryRun) {
      successCount++;
      if (options.verbose)
        console.log(
          `${progress} racer_id=${racerId} → ${profile.name} 生年月日=${profile.birthDate} (dry-run)`,
        );
    } else {
      const { error } = await supabase.from("racer_profiles").upsert({
        racer_id: profile.racerId,
        name: profile.name,
        name_kana: profile.nameKana,
        birth_date: profile.birthDate,
        height_cm: profile.heightCm,
        weight_kg: profile.weightKg,
        blood_type: profile.bloodType,
        branch: profile.branch,
        hometown: profile.hometown,
        registration_period: profile.registrationPeriod,
        grade_at_scrape: profile.gradeAtScrape,
      });

      if (error) {
        failCount++;
        failedRacerIds.push(racerId);
        console.error(
          `${progress} racer_id=${racerId} - 保存エラー: ${error.message}`,
        );
      } else {
        successCount++;
        if (options.verbose)
          console.log(
            `${progress} racer_id=${racerId} → ${profile.name} 生年月日=${profile.birthDate}`,
          );
      }
    }

    if ((i + 1) % 50 === 0 || i === targetRacerIds.length - 1) {
      console.log(`${progress} 成功: ${successCount}件, 失敗: ${failCount}件`);
    }

    await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
  }

  console.log("");
  console.log("=== 完了 ===");
  console.log(`成功: ${successCount}件`);
  console.log(`失敗（除外）: ${failCount}件`);

  if (!options.dryRun) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(
      REPORT_PATH,
      JSON.stringify(
        {
          executedAt: new Date().toISOString(),
          targetCount: targetRacerIds.length,
          successCount,
          failCount,
          failedRacerIds,
        },
        null,
        2,
      ),
    );
    console.log(`レポート保存: ${REPORT_PATH}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
