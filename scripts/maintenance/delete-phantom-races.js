#!/usr/bin/env node
/**
 * `races` に入った「実在しない会場日」の行と、その従属行を消す（BOA-468）
 *
 * 背景: 2026-04-11 の戸田・常滑・三国・児島の48レースは、公式には開催が無かった日の行だった。
 * 出走表は2026-04-09の同会場・同レース番号の完全な複製で、公式の出走表ページ・結果ページは
 * いずれも「データがありません」を返す。BOA-422（出走表の複製汚染）と同じ機構だが、
 * あちらは「実在する会場日の出走表が上書きされた」ケースで、公式Bファイルとの突き合わせで検出できた。
 * 会場日ごと捏造されたこのケースは、Bファイルが存在しないため、あの監査では原理的に拾えなかった。
 *
 * **対象の見つけ方はこのスクリプトの仕事ではない。** `audit-missing-results.js` が phantom として
 * 出したレースIDを、人が確認したうえで `--race-ids=` に渡す（暗黙の探索で消す範囲を広げない）。
 *
 * ## 既存の `delete-phantom-race-days.js`（BOA-407）との関係
 *
 * 同じ事象を消すスクリプトが既にある（[BOA-420](https://linear.app/boat-ai/issue/BOA-420) は
 * 「それを期間拡張して再利用する」としている）。それを使わず別に作った理由は2つ:
 *
 *   1. **判定材料が使えない。** あちらはK-fileの解析結果（`data/kb-archive` の `parsed`）を必要とするが、
 *      アーカイブは 2026-01 までしか無い（本体テーブル開始前の期間が対象）。2026-04 は判定できない。
 *      本スクリプトは公式の開催場一覧だけで判定するため、アーカイブに依存しない
 *   2. **探索と削除を分けたい。** あちらは期間を渡すと自分で対象を探して消す。本スクリプトは
 *      `--race-ids=` で明示された分しか消さず、実行時に3つの守りを掛ける
 *
 * どちらを使ってもよいが、**アーカイブが無い期間は本スクリプトを使う。**
 *
 * 実行時の守り（すべて満たさないレースは対象から外し、1件でも外れたら既定で中断する）:
 *   1. 公式の開催場一覧（race/index）に、その会場がその日**載っていない**こと。
 *      順延・中止の会場は過去日の一覧にも残るため、「載っていない」は開催が無かったことを意味する
 *   2. `race_results`・`race_odds`・`race_start_timings`・`race_payouts` に行が**無い**こと。
 *      1件でもあれば、実際に走った証拠なので消さない。あわせて `sns_campaign_entries`（唯一
 *      CASCADEでない外部キー。行があると `races` の削除自体が失敗する）も確認する
 *   3. `predictions` の的中フラグが**すべてNULL**であること。判定済みの予想は的中率の履歴に載っており、
 *      消すと過去の集計が変わる（BOA-422では、判定済みの657行を「汚染期間として記録して残す」と判断した）
 *
 * 削除するテーブル（従属→本体の順）:
 *   predictions → bet_recommendations → prediction_odds → exhibition_data → race_conditions
 *   → race_entries → races
 *
 * **`races` には `ON DELETE CASCADE` の外部キーが17本あり、`races` を消せば従属行は連動して消える**
 * （`pg_constraint` で確認。2026-09-28）。それでも順に消しているのは、**テーブルごとの削除行数を
 * 記録に残すため**（CASCADEだと何行消えたか分からない）。冪等で、二重に消しても害はない。
 *
 * **例外1本: `sns_campaign_entries` は `NO ACTION`**（CASCADEでない）。該当行があると `races` の削除が
 * 失敗するため、守り2の確認に含めている（0行であることを確かめてから消す）。
 *
 * 消した内容は data/analysis/deleted-phantom-races-<日付>.json に残す（後の分析が「消えた理由」を辿れるように）。
 *
 * 使い方:
 *   node --env-file=.env.local scripts/maintenance/delete-phantom-races.js --race-ids=2026-04-11-02-01,... # 確認のみ
 *   node --env-file=.env.local scripts/maintenance/delete-phantom-races.js --race-ids=... --apply          # 削除
 *   （--allow-partial を付けると、守りを満たさないレースがあっても、満たしたものだけを消す）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { supabase } from "../lib/supabaseClient.js";
import { raceIndexUrl, parseVenueStatuses } from "../lib/raceStatusParsers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "../../data/analysis");

const FETCH_DELAY_MS = 1400;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const RACE_ID_PATTERN = /^(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})$/;

/**
 * 1件でもあれば消さないテーブル。
 * 前4つは「実際に走った証拠」。`sns_campaign_entries` は唯一 ON DELETE CASCADE でない外部キーで、
 * 行があると `races` の削除自体が失敗する（`pg_constraint` で確認、2026-09-28）
 */
const EVIDENCE_TABLES = Object.freeze([
  "race_results",
  "race_odds",
  "race_start_timings",
  "race_payouts",
  "sns_campaign_entries",
]);

/** 消す順（従属→本体） */
const DELETE_ORDER = Object.freeze([
  "predictions",
  "bet_recommendations",
  "prediction_odds",
  "exhibition_data",
  "race_conditions",
  "race_entries",
  "races",
]);

const getArg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const hasFlag = (name) => process.argv.includes(`--${name}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function parseRaceId(raceId) {
  const m = RACE_ID_PATTERN.exec(raceId);
  if (!m) throw new Error(`race_id の形式が不正: ${raceId}`);
  return { date: m[1], venueCode: Number(m[2]), raceNumber: Number(m[3]) };
}

/** 日ごとに開催場一覧を1回読み、載っている会場コードの集合を返す */
async function loadListedVenues(dates) {
  const byDate = new Map();
  for (const date of dates) {
    const res = await fetch(raceIndexUrl(date), {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok)
      throw new Error(`開催場一覧の取得に失敗: ${date} ${res.status}`);
    const venues = parseVenueStatuses(await res.text());
    if (venues.length === 0) {
      throw new Error(
        `${date}: 開催場一覧から会場を1件も読めなかった（構造変化の可能性。中断する）`,
      );
    }
    byDate.set(date, new Set(venues.map((v) => v.venueCode)));
    await sleep(FETCH_DELAY_MS);
  }
  return byDate;
}

async function countByRaceIds(table, raceIds) {
  const { count, error } = await supabase
    .from(table)
    .select("race_id", { count: "exact", head: true })
    .in("race_id", raceIds);
  if (error) throw new Error(`${table} の件数取得に失敗: ${error.message}`);
  return count ?? 0;
}

/** 的中フラグが1つでも入っている予想のレースIDを返す */
async function findJudgedPredictions(raceIds) {
  const { data, error } = await supabase
    .from("predictions")
    .select("race_id, is_hit_win, is_hit_place, is_hit_trifecta, is_hit_trio")
    .in("race_id", raceIds);
  if (error) throw new Error(`predictions の取得に失敗: ${error.message}`);
  return new Set(
    data
      .filter(
        (r) =>
          r.is_hit_win != null ||
          r.is_hit_place != null ||
          r.is_hit_trifecta != null ||
          r.is_hit_trio != null,
      )
      .map((r) => r.race_id),
  );
}

async function main() {
  const raw = getArg("race-ids");
  if (!raw) {
    console.error(
      "使い方: node scripts/maintenance/delete-phantom-races.js --race-ids=<カンマ区切り> [--apply] [--allow-partial]",
    );
    return 1;
  }
  const raceIds = [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  const parsed = raceIds.map((id) => ({ raceId: id, ...parseRaceId(id) }));
  console.log(`指定: ${raceIds.length}レース`);

  // 守り1: 公式の開催場一覧に載っていないこと
  const dates = [...new Set(parsed.map((p) => p.date))].sort();
  console.log(`開催場一覧を読む日: ${dates.length}日`);
  const listed = await loadListedVenues(dates);
  const rejected = [];
  let targets = parsed.filter((p) => {
    if (listed.get(p.date).has(p.venueCode)) {
      rejected.push({
        raceId: p.raceId,
        reason: "公式の開催場一覧にこの会場が載っている（実在の開催日）",
      });
      return false;
    }
    return true;
  });

  // 守り2: 走った証拠が無いこと
  for (const table of EVIDENCE_TABLES) {
    const ids = targets.map((t) => t.raceId);
    if (ids.length === 0) break;
    const { data, error } = await supabase
      .from(table)
      .select("race_id")
      .in("race_id", ids);
    if (error) throw new Error(`${table} の確認に失敗: ${error.message}`);
    const withRows = new Set(data.map((r) => r.race_id));
    if (withRows.size > 0) {
      for (const id of withRows) {
        rejected.push({
          raceId: id,
          reason: `${table} に行がある（走った証拠）`,
        });
      }
      targets = targets.filter((t) => !withRows.has(t.raceId));
    }
  }

  // 守り3: 判定済みの予想が無いこと
  if (targets.length > 0) {
    const judged = await findJudgedPredictions(targets.map((t) => t.raceId));
    if (judged.size > 0) {
      for (const id of judged) {
        rejected.push({
          raceId: id,
          reason:
            "predictions に的中フラグが入っている（的中率の履歴に載っているため消さない）",
        });
      }
      targets = targets.filter((t) => !judged.has(t.raceId));
    }
  }

  if (rejected.length > 0) {
    console.log(`\n守りに引っかかった ${rejected.length}件:`);
    for (const r of rejected) console.log(`  ${r.raceId} — ${r.reason}`);
    if (!hasFlag("allow-partial")) {
      console.error(
        "\n中断する。内容を確認し、意図どおりなら --allow-partial を付けて再実行する",
      );
      return 1;
    }
  }
  if (targets.length === 0) {
    console.log("\n対象が0件のため、何もしない");
    return 0;
  }

  const ids = targets.map((t) => t.raceId);
  console.log(`\n削除の対象: ${ids.length}レース`);
  const counts = {};
  for (const table of DELETE_ORDER) {
    counts[table] = await countByRaceIds(table, ids);
    console.log(`  ${table}: ${counts[table]}行`);
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`  合計: ${total}行`);

  if (!hasFlag("apply")) {
    console.log("\n[DRY-RUN] --apply を付けると上記を削除する");
    return 0;
  }

  const record = {
    schema: "deleted-phantom-races/v1",
    deleted_at: new Date().toISOString(),
    reason:
      "公式の開催場一覧にその会場が載っておらず、走った証拠（結果・オッズ・ST・払戻）も無い。races に入った実在しない会場日の行（BOA-468）",
    race_ids: ids,
    rejected,
    rows_before: counts,
    rows_deleted: {},
  };

  for (const table of DELETE_ORDER) {
    if (counts[table] === 0) {
      record.rows_deleted[table] = 0;
      continue;
    }
    const { data, error } = await supabase
      .from(table)
      .delete()
      .in("race_id", ids)
      .select("race_id");
    if (error) {
      console.error(`${table} の削除に失敗: ${error.message}`);
      record.rows_deleted[table] = `失敗: ${error.message}`;
      break;
    }
    record.rows_deleted[table] = data.length;
    console.log(`  ${table}: ${data.length}行を削除`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(
    OUT_DIR,
    `deleted-phantom-races-${new Date().toISOString().slice(0, 10)}.json`,
  );
  fs.writeFileSync(outFile, `${JSON.stringify(record, null, 2)}\n`);
  console.log(
    `\n記録: ${path.relative(path.join(__dirname, "../.."), outFile)}`,
  );
  return 0;
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
