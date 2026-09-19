/**
 * race_conditions 欠損行のバックフィル（BOA-347）
 *
 * races には存在するが race_conditions に行が無いレース（発走60分前ウィンドウ
 * での取得失敗により恒久欠損していたもの）を対象に、公式サイトの racelist・
 * beforeinfo を再取得して行を補填する。既存行は絶対に上書きしない
 * （ignoreDuplicates=true の INSERT のみ）。中止・順延（cancellation_status あり）
 * のレースは対象外。
 *
 * 使い方:
 *   node scripts/maintenance/backfill-race-conditions.js --from=2026-09-16 --to=2026-09-18          # dry-run
 *   node scripts/maintenance/backfill-race-conditions.js --from=2026-09-16 --to=2026-09-18 --apply  # 書き込み
 */

import * as cheerio from "cheerio";
import { supabase, isSupabaseEnabled } from "../lib/supabaseClient.js";
import { _internal } from "../daily/update-race-info.js";

const { scrapeRaceMeta, scrapeConditions, convertWindDirection } = _internal;

const FETCH_HEADERS = {
  "User-Agent":
    "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
};
const REQUEST_INTERVAL_MS = 400;
const WRITE_BATCH_SIZE = 100;

function getArg(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : null;
}

function listDates(from, to) {
  const dates = [];
  for (
    let d = new Date(`${from}T00:00:00Z`);
    d <= new Date(`${to}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: FETCH_HEADERS,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return cheerio.load(await res.text());
}

// statement timeout 等の一時的なDBエラーに備えて数回リトライする
async function withRetry(label, fn, attempts = 4) {
  for (let i = 1; ; i++) {
    const { data, error } = await fn();
    if (!error) return data;
    if (i >= attempts) throw new Error(`${label}エラー: ${error.message}`);
    console.warn(`  ⚠️ ${label}エラー(${i}/${attempts}回目、再試行): ${error.message}`);
    await new Promise((r) => setTimeout(r, 3000 * i));
  }
}

async function findMissingRaces(date) {
  const races = await withRetry("races取得", () =>
    supabase
      .from("races")
      .select("race_id, cancellation_status")
      .like("race_id", `${date}%`)
      .limit(1000),
  );
  const conds = await withRetry("race_conditions取得", () =>
    supabase
      .from("race_conditions")
      .select("race_id")
      .like("race_id", `${date}%`)
      .limit(1000),
  );

  const existing = new Set(conds.map((c) => c.race_id));
  const missing = races.filter((r) => !existing.has(r.race_id));
  return {
    targets: missing.filter((r) => !r.cancellation_status),
    skippedCancelled:
      missing.length - missing.filter((r) => !r.cancellation_status).length,
  };
}

async function buildRow(raceId) {
  const [, , , venue, raceNo] = raceId.split("-");
  const ymd = raceId.slice(0, 10).replace(/-/g, "");
  const query = `rno=${parseInt(raceNo, 10)}&jcd=${venue}&hd=${ymd}`;
  const base = "https://www.boatrace.jp/owpc/pc/race";

  const $racelist = await fetchHtml(`${base}/racelist?${query}`);
  const { raceTitle, raceStage, seriesDay, isFinalDay } =
    scrapeRaceMeta($racelist);
  if (!raceTitle && !raceStage) {
    throw new Error("racelistからタイトル・ステージを取得できない");
  }

  let conditions = null;
  try {
    conditions = scrapeConditions(
      await fetchHtml(`${base}/beforeinfo?${query}`),
    );
  } catch (err) {
    console.warn(
      `  ⚠️ ${raceId} beforeinfo取得失敗（天候はnullで補填）: ${err.message}`,
    );
  }

  return {
    race_id: raceId,
    weather: conditions?.weather ?? null,
    wind_direction: convertWindDirection(conditions?.windDirection ?? null),
    wind_speed: conditions?.windVelocity ?? null,
    wave_height:
      conditions?.waveHeight != null ? Math.round(conditions.waveHeight) : null,
    temperature: conditions?.airTemp ?? null,
    water_temperature: conditions?.waterTemp ?? null,
    race_title: raceTitle,
    race_stage: raceStage,
    series_day: seriesDay,
    is_final_day: isFinalDay,
  };
}

async function main() {
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase環境変数が未設定です。");
    process.exit(1);
  }
  const from = getArg("from");
  const to = getArg("to") || from;
  const apply = process.argv.includes("--apply");
  if (!from) {
    console.error("❌ --from=YYYY-MM-DD を指定してください");
    process.exit(1);
  }

  console.log(
    `📋 race_conditions バックフィル ${apply ? "[APPLY]" : "[DRY-RUN]"} ${from}〜${to}`,
  );

  // 日付ごとに取得→書き込みまで完了させる（途中で失敗しても完了済みの日付は
  // 反映済みになり、再実行は未補填分のみを対象にする＝冪等）
  let totalRows = 0;
  let totalFailures = 0;
  let totalWritten = 0;
  const stageCounts = {};
  let noWeather = 0;

  for (const date of listDates(from, to)) {
    const { targets, skippedCancelled } = await findMissingRaces(date);
    console.log(
      `📅 ${date}: 欠損 ${targets.length}件（中止・順延で対象外 ${skippedCancelled}件）`,
    );

    const rows = [];
    for (const { race_id } of targets) {
      try {
        rows.push(await buildRow(race_id));
      } catch (err) {
        totalFailures++;
        console.error(`  ❌ ${race_id}: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, REQUEST_INTERVAL_MS));
    }

    for (const r of rows) {
      const stage = r.race_stage ?? "null";
      stageCounts[stage] = (stageCounts[stage] || 0) + 1;
      if (r.weather == null) noWeather++;
    }
    totalRows += rows.length;
    if (!apply) continue;

    for (let i = 0; i < rows.length; i += WRITE_BATCH_SIZE) {
      const batch = rows.slice(i, i + WRITE_BATCH_SIZE);
      const { error } = await supabase
        .from("race_conditions")
        .upsert(batch, { onConflict: "race_id", ignoreDuplicates: true });
      if (error) {
        console.error(`  ❌ 書き込みエラー(${date} batch ${i}): ${error.message}`);
        process.exitCode = 1;
        continue;
      }
      totalWritten += batch.length;
    }
    console.log(`  ✅ ${date}: ${apply ? "書き込み" : "取得"}完了`);
  }

  console.log(
    `\n取得成功 ${totalRows}件 / 失敗 ${totalFailures}件（うち天候null ${noWeather}件）`,
  );
  console.log("race_stage内訳:", JSON.stringify(stageCounts));
  console.log(
    apply
      ? `✅ race_conditions: ${totalWritten}件書き込み完了`
      : "dry-runのため書き込みはスキップ（--apply で書き込み）",
  );
}

main().catch((err) => {
  console.error("❌ エラー:", err);
  process.exit(1);
});
