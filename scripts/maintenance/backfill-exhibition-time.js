#!/usr/bin/env node
/**
 * 展示タイム欠落レースの補完（過去分）
 *
 * 発走済みだが exhibition_data に展示タイム（exhibition_time 非null）が無いレースを
 * 公式ページから再取得して upsert する。原因は、展示STが展示タイムより先に公開される会場
 * （鳴門・丸亀・児島・江戸川等）で、展示タイム未公開のnull行が「取得済み」扱いになり
 * 補完されなかったこと（scrape-exhibition-data.js の getRaceIdsWithExhibitionTime 参照）。
 * 公式ページは発走後も展示タイムを表示し続けるため、過去分も取得できる。
 * 中止・順延で公式ページに展示タイムが無いレースは取得されず、書き込まれない。
 *
 * 使用方法:
 *   node scripts/maintenance/backfill-exhibition-time.js --from=2026-09-15 --to=2026-09-19 --dry-run
 *   node scripts/maintenance/backfill-exhibition-time.js --from=2026-09-18 --to=2026-09-18 --limit=1
 *   node scripts/maintenance/backfill-exhibition-time.js --from=2026-09-15 --to=2026-09-19
 */

import { getRaceSchedule } from "../lib/raceSchedule.js";
import { addDaysToDateString } from "../lib/dateUtils.js";
import { isSupabaseEnabled, VENUE_NAMES } from "../lib/supabaseClient.js";
import {
  getRaceIdsWithExhibitionTime,
  scrapeAndUpsertRaces,
} from "../daily/scrape-exhibition-data.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseArgs(args = process.argv.slice(2)) {
  const valueOf = (name) =>
    args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const limit = valueOf("limit");
  return {
    from: valueOf("from"),
    to: valueOf("to"),
    dryRun: args.includes("--dry-run"),
    limit: limit === undefined ? null : parseInt(limit, 10),
  };
}

function listDates(from, to) {
  const dates = [];
  for (let d = from; d <= to; d = addDaysToDateString(d, 1)) dates.push(d);
  return dates;
}

/**
 * 発走済みで展示タイムが未取得のレースを返す。
 * getRaceSchedule は取得エラー（statement timeout等）でも空配列を返すため、空の場合は
 * 「欠落0件」と区別できるよう null を返す（誤って「補完済み」と読まれるのを防ぐ）
 */
async function findMissingRaces(date) {
  const now = new Date();
  const schedule = await getRaceSchedule(date);
  if (schedule.length === 0) return null;
  const withTime = await getRaceIdsWithExhibitionTime(date);
  return schedule.filter((r) => r.start_time < now && !withTime.has(r.race_id));
}

async function main() {
  const { from, to, dryRun, limit } = parseArgs();
  if (!DATE_PATTERN.test(from ?? "") || !DATE_PATTERN.test(to ?? "")) {
    throw new Error("--from=YYYY-MM-DD と --to=YYYY-MM-DD を指定してください");
  }
  if (from > to) throw new Error("--from は --to 以前の日付を指定してください");
  if (limit !== null && !(limit > 0)) {
    throw new Error("--limit は1以上の整数を指定してください");
  }
  if (!isSupabaseEnabled()) {
    throw new Error("Supabase環境変数が未設定です");
  }

  let remaining = limit;
  for (const date of listDates(from, to)) {
    let missing = await findMissingRaces(date);
    if (missing === null) {
      console.warn(
        `⚠️ ${date}: レーススケジュールを取得できませんでした（未登録または一時エラー）。この日は未確認のため、必要なら再実行してください`,
      );
      continue;
    }
    if (remaining !== null) missing = missing.slice(0, remaining);

    const byVenue = missing.reduce((acc, r) => {
      const name = VENUE_NAMES[r.venue_code];
      acc[name] = (acc[name] ?? 0) + 1;
      return acc;
    }, {});
    console.log(
      `📅 ${date}: 展示タイム未取得（発走済み）${missing.length}レース ${JSON.stringify(byVenue)}`,
    );

    if (missing.length === 0 || dryRun) continue;

    await scrapeAndUpsertRaces(missing, date);
    const stillMissing = await findMissingRaces(date);
    console.log(
      stillMissing === null
        ? "   → 補完後の確認ができませんでした（スケジュール取得不可）。dry-runで再確認してください"
        : `   → 補完後の未取得: ${stillMissing.length}レース（中止・順延等で公式ページに展示タイムが無いものを含む）`,
    );

    if (remaining !== null) {
      remaining -= missing.length;
      if (remaining <= 0) break;
    }
  }
  if (dryRun) console.log("🔍 dry-run のため書き込みは行っていません");
}

main().catch((error) => {
  console.error("❌ backfill-exhibition-time 実行中にエラー:", error.message);
  process.exit(1);
});
