#!/usr/bin/env node
/**
 * 結果が無いレースを、公式サイトの2つの表示から3つに分類する（BOA-468）
 *
 * 背景: `data_health` の `result.monthly` が 2026-04〜06 で未達（欠損231レース）だった。
 * 中止検知（BOA-254）の導入前・不調時の期間は、中止だったレースが `cancellation_status` に
 * 記録されておらず、放っておいても消えない（過去日を遡って確定する経路が無い）。
 * BOA-412（Kファイルの中止テキスト解析）を待たずに、公式サイトの表示だけで分類できる。
 *
 * 分類（公式の2つの表示を使う）:
 *   cancelled   開催場一覧（race/index）の状態欄が「N R以降中止（順延）」で、そのレース番号が N 以上
 *               → `cancellation_status='confirmed'` にする（--apply）
 *   missing     告知が無い、または告知のレース番号より小さい。結果ページに結果表がある
 *               → 走っているのに取得できていない。`backfill-results-by-race-id.js` で取り直す
 *   phantom     開催場一覧に会場そのものが載っていない（＝その日その会場は開催していない）
 *               → `races` に実在しない行がある。**このスクリプトは消さない**（破壊的なため、SQLを出すだけ）
 *
 * 判定の根拠（2026-09-28の実測）:
 *   - **順延・中止の会場は、過去日の開催場一覧にも残る**（2026-04-02の「中止順延」が半年後も出る）。
 *     したがって「一覧に載っていない」は、順延ではなく開催が無かったことを意味する
 *   - 過去の全日順延は、結果ページ・出走表ページが「データがありません」になり、`isRaceCancelledPage`
 *     では判定できない。一覧の状態欄が唯一の材料
 *   - 2026-04-11の4会場（戸田・常滑・三国・児島）の48レースは、出走表が2026-04-09の完全な複製で、
 *     公式には出走表ページも存在しなかった（BOA-422の汚染が、実在しない会場日を作った例）
 *
 * 取得先への負荷: 日ごとに開催場一覧1回（`--verify-races` を付けると、`missing` 候補だけ結果ページを1回ずつ）。
 * 逐次実行で1.4秒の待機を挟む。
 *
 * **期間は3か月までにする。** 4か月分（約20,000レース）を一度に取ると `fetchAll` が
 * `AbortError: This operation was aborted` で落ちる（2026-09-28の実測）。落ちるだけで部分成功にはしない。
 *
 * 使い方:
 *   node --env-file=.env.local scripts/maintenance/audit-missing-results.js --from=2026-04-01 --to=2026-06-30
 *   node --env-file=.env.local scripts/maintenance/audit-missing-results.js --from=2026-04-01 --to=2026-06-30 --verify-races
 *   node --env-file=.env.local scripts/maintenance/audit-missing-results.js --from=2026-04-01 --to=2026-06-30 --apply
 *   （--apply は cancelled のみを confirmed にする。phantom は消さず、削除用のSQLを出力する）
 */
import { fetchAll, supabase } from "../lib/supabaseClient.js";
import { isCancellationConfirmed } from "../lib/cancellationStatus.js";
import {
  raceIndexUrl,
  parseVenueStatuses,
  raceResultUrl,
  isRaceCancelledPage,
} from "../lib/raceStatusParsers.js";

const FETCH_DELAY_MS = 1400;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const getArg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const hasFlag = (name) => process.argv.includes(`--${name}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad2 = (n) => String(n).padStart(2, "0");

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return await res.text();
}

/** 結果（rank1）が無く、中止確定でもないレースを取る */
async function findMissingRaces(from, to) {
  const races = await fetchAll(
    "races",
    "race_id, race_date, venue_code, race_number, cancellation_status",
    (q) => q.gte("race_date", from).lte("race_date", to).order("race_id"),
    { throwOnError: true },
  );
  const results = await fetchAll(
    "race_results",
    "race_id, rank1",
    (q) => q.gte("race_id", from).lte("race_id", `${to}~`).order("race_id"),
    { throwOnError: true },
  );
  const withRank1 = new Set(
    results.filter((r) => r.rank1 != null).map((r) => r.race_id),
  );
  const seen = new Set();
  return races.filter((r) => {
    if (seen.has(r.race_id)) return false;
    seen.add(r.race_id);
    if (isCancellationConfirmed(r.cancellation_status)) return false;
    return !withRank1.has(r.race_id);
  });
}

/** 日ごとに開催場一覧を読み、会場コード → 告知 のMapにする */
async function loadAnnouncements(dates) {
  const byDate = new Map();
  for (const date of dates) {
    const venues = parseVenueStatuses(await fetchHtml(raceIndexUrl(date)));
    if (venues.length === 0) {
      throw new Error(
        `${date}: 開催場一覧から会場を1件も読めなかった（構造変化の可能性。中断する）`,
      );
    }
    byDate.set(date, new Map(venues.map((v) => [v.venueCode, v])));
    await sleep(FETCH_DELAY_MS);
  }
  return byDate;
}

/**
 * 1レースを分類する。
 * @returns {{kind: "cancelled"|"missing"|"phantom", reason: string}}
 */
export function classifyRace(race, announcementsForDate) {
  const listed = announcementsForDate.get(race.venue_code);
  if (!listed) {
    return {
      kind: "phantom",
      reason:
        "開催場一覧に会場が載っていない（この日その会場は開催していない）",
    };
  }
  const { status, statusText } = listed;
  if (status.kind === "cancelled_from" && race.race_number >= status.fromRace) {
    return { kind: "cancelled", reason: `一覧の状態欄「${statusText}」` };
  }
  if (status.kind === "unrecognized") {
    return {
      kind: "missing",
      reason: `一覧の状態欄が未知の文言「${statusText}」（人が確認する）`,
    };
  }
  return {
    kind: "missing",
    reason:
      status.kind === "cancelled_from"
        ? `一覧の告知は${status.fromRace}R以降のみ（このレースは対象外）`
        : "一覧に中止の告知が無い",
  };
}

/** missing 候補が本当に結果を持っているかを、結果ページで確かめる */
async function verifyMissing(races) {
  const checked = [];
  for (const r of races) {
    const html = await fetchHtml(
      raceResultUrl(r.venue_code, r.race_number, r.race_date),
    );
    checked.push({
      ...r,
      pageCancelled: isRaceCancelledPage(html),
      pageHasResult: html.includes("table1_boatImage1"),
      pageNoData: html.includes("データがありません"),
    });
    await sleep(FETCH_DELAY_MS);
  }
  return checked;
}

function printGroups(label, races) {
  if (races.length === 0) return;
  const byVenueDay = new Map();
  for (const r of races) {
    const key = `${r.race_date} v${pad2(r.venue_code)}`;
    if (!byVenueDay.has(key)) byVenueDay.set(key, []);
    byVenueDay.get(key).push(r);
  }
  console.log(
    `\n## ${label}: ${races.length}レース / ${byVenueDay.size}会場日`,
  );
  for (const [key, list] of [...byVenueDay].sort()) {
    const numbers = list
      .map((r) => r.race_number)
      .sort((a, b) => a - b)
      .join(",");
    console.log(`  ${key} R${numbers}  — ${list[0].reason}`);
  }
}

async function main() {
  const from = getArg("from");
  const to = getArg("to");
  if (!from || !to) {
    console.error(
      "使い方: node scripts/maintenance/audit-missing-results.js --from=YYYY-MM-DD --to=YYYY-MM-DD [--verify-races] [--apply]",
    );
    return 1;
  }
  const apply = hasFlag("apply");

  const missingRaces = await findMissingRaces(from, to);
  console.log(
    `結果(rank1)が無く中止確定でもないレース: ${missingRaces.length}件（${from}〜${to}）`,
  );
  if (missingRaces.length === 0) return 0;

  const dates = [...new Set(missingRaces.map((r) => r.race_date))].sort();
  console.log(`開催場一覧を読む日: ${dates.length}日`);
  const announcements = await loadAnnouncements(dates);

  const classified = missingRaces.map((r) => ({
    ...r,
    ...classifyRace(r, announcements.get(r.race_date)),
  }));
  const cancelled = classified.filter((r) => r.kind === "cancelled");
  let missing = classified.filter((r) => r.kind === "missing");
  const phantom = classified.filter((r) => r.kind === "phantom");

  if (hasFlag("verify-races") && missing.length > 0) {
    console.log(`\nmissing 候補 ${missing.length}件の結果ページを確認する`);
    missing = await verifyMissing(missing);
    const contradictions = missing.filter((r) => !r.pageHasResult);
    if (contradictions.length > 0) {
      console.log(
        `⚠️ 結果表が無い ${contradictions.length}件（中止表示 or データなし。人が確認する）:`,
      );
      for (const r of contradictions) {
        console.log(
          `    ${r.race_id} 中止表示=${r.pageCancelled} データなし=${r.pageNoData}`,
        );
      }
    }
  }

  printGroups("cancelled（confirmed にする）", cancelled);
  printGroups("missing（結果を取り直す）", missing);
  printGroups("phantom（races に実在しない行）", phantom);

  if (missing.length > 0) {
    console.log(
      `\n取り直しのコマンド:\n  node --env-file=.env.local scripts/maintenance/backfill-results-by-race-id.js --race-ids=${missing.map((r) => r.race_id).join(",")} --apply`,
    );
  }
  if (phantom.length > 0) {
    const ids = phantom.map((r) => `'${r.race_id}'`).join(",\n    ");
    console.log(
      `\nphantom の削除は、このスクリプトでは行わない（破壊的なため）。従属テーブルを確認したうえで、ユーザーが実行する:\n` +
        `  -- 事前確認\n` +
        `  select 'race_entries' t, count(*) from race_entries where race_id in (\n    ${ids}\n  )\n` +
        `  union all select 'predictions', count(*) from predictions where race_id in (\n    ${ids}\n  );\n`,
    );
  }

  if (!apply) {
    console.log(
      `\n[DRY-RUN] --apply を付けると cancelled ${cancelled.length}件を confirmed にする（missing・phantom は触らない）`,
    );
    return 0;
  }
  if (cancelled.length === 0) {
    console.log("\ncancelled が0件のため、書き込みは行わない");
    return 0;
  }
  const { data, error } = await supabase
    .from("races")
    .update({ cancellation_status: "confirmed" })
    .in(
      "race_id",
      cancelled.map((r) => r.race_id),
    )
    .is("cancellation_status", null) // 二重防御: 実行時点でNULLの行だけ
    .select("race_id");
  if (error) {
    console.error("書き込みエラー:", error.message);
    return 1;
  }
  console.log(`\n書き込み完了: ${data.length}件を confirmed にした`);
  return 0;
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
