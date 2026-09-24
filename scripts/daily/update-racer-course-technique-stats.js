#!/usr/bin/env node
/**
 * update-racer-course-technique-stats.js
 *
 * 「本日のデータ一覧」（BOA-402）が使う2つの事前集計テーブルを日次で更新する。
 *   - venue_course_technique_baseline（会場 × グレード × 実進入コース、約612行）
 *   - racer_course_technique_stats（選手 × 実進入コース、約9,471行）
 *
 * 設計: docs/design/morning-data-digest/plan.md §3.1
 *       docs/adr/0071-venue-adjusted-skill-delta.md
 *       docs/db-migration/098_morning_data_digest.sql
 *
 * ## なぜ事前集計するか
 *
 * 基礎の母集団は全期間で約26万行（43,643レース × 6艇）。朝のダイジェスト生成
 * （generate-morning-digest.js）から毎回これを読むと、BOA-357（Supabase Disk IO
 * Budget枯渇）の状況で取れない。重い全期間スキャンを夜間に1回だけ行い、
 * 朝のバッチは小さい2表を読むだけにする。
 *
 * ## 集計本体はDB側（RPC）にある
 *
 * compute_venue_course_technique_baseline() / compute_racer_course_technique_stats()
 * （098で作成）が集計し、結果の約612行＋約9,471行だけを返す。Node側に26万行を持たない。
 *
 * ## 実行順序が重要
 *
 * racer 側のRPCは venue_course_technique_baseline を**読む**（各走の期待値を引くため）。
 * 必ず baseline を書き込んでから racer 側を呼ぶ。順序を逆にすると、前日の
 * ベースラインで期待値が計算される（初回は0行なので全行の expected が NULL になり
 * CHECK制約 rcts_rate_by_course に弾かれる）。
 *
 * ## 実行
 *
 *   node scripts/daily/update-racer-course-technique-stats.js            # 本番へ書き込む
 *   node scripts/daily/update-racer-course-technique-stats.js --dry-run  # 書き込まずに結果を出す
 */

import { supabase, isSupabaseEnabled } from "../lib/supabaseClient.js";
import { upsertChangedRows, formatSkipSummary } from "../lib/unchangedRows.js";

const DRY_RUN = process.argv.includes("--dry-run");

/** ベースラインのセルを採用する最低母数。未満なら race_grade='ALL' へフォールバックする */
const MIN_BASELINE_RUNS = 100;

/** PostgRESTの1ページあたりの行数。Supabaseのデフォルト上限は1000行 */
const PAGE_SIZE = 1000;

function todayJST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split("T")[0];
}

/**
 * RPCを呼んで集計結果を得る。
 *
 * ⚠️ **RPCの戻り値にも1000行の上限がかかる**（2026-09-24、dry-runで実測して発見）。
 * PostgRESTは集合を返す関数をテーブルと同じように扱うため、`.range()` を付けないと
 * **エラーにならず黙って1000行で切り捨てられる**。racer側は約9,471行あり、
 * 最初の実装では「1000行・172選手」しか返らなかった。
 * `.claude/rules/frontend-data-fetch.md` §5 が読み取り側について警告しているのと
 * 同じ罠が集計RPCにもある（plan.md §3.1 は「RPCにしない場合はページネーション必須」と
 * 書いていたが、RPCでも必須だった）。
 *
 * 「集計結果が0行」は異常（対象データが必ずあるはずのため）。
 * これと「変更が無くて書き込みが0行」は別物なので取り違えない（plan.md §3.1）。
 */
async function callAggregate(fnName) {
  const all = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .rpc(fnName)
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      throw new Error(`${fnName} の実行に失敗しました: ${error.message}`);
    }
    if (!Array.isArray(data)) {
      throw new Error(`${fnName} が配列を返しませんでした`);
    }
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  if (all.length === 0) {
    throw new Error(
      `${fnName} の集計結果が0行でした（対象データがあるはずなので異常です）`,
    );
  }
  return all;
}

/**
 * 壊れた値を本番に入れないための整合チェック。
 * CHECK制約で弾かれるものも、DBに投げる前に読みやすいメッセージで落とす。
 */
function checkBaseline(rows) {
  const problems = [];

  const allRows = rows.filter((r) => r.race_grade === "ALL");
  if (allRows.length === 0) {
    problems.push(
      "race_grade='ALL' のフォールバック行が1件もありません（期待値の算出で参照できなくなります）",
    );
  }

  const venues = new Set(rows.map((r) => r.venue_code));
  for (const venueCode of venues) {
    for (let course = 1; course <= 6; course += 1) {
      const hasAll = rows.some(
        (r) =>
          r.venue_code === venueCode &&
          r.race_grade === "ALL" &&
          r.course === course,
      );
      if (!hasAll) {
        problems.push(
          `会場${venueCode} ${course}コースの race_grade='ALL' 行がありません（フォールバック先が無い）`,
        );
      }
    }
  }

  for (const r of rows) {
    const label = `会場${r.venue_code} ${r.race_grade} ${r.course}コース`;
    if (r.course === 1 && (r.nige_rate === null || r.nigashi_rate !== null)) {
      problems.push(
        `${label}: 1コースは逃げ率を持ち逃がし率を持たないはずです`,
      );
    }
    if (r.course > 1 && (r.nige_rate !== null || r.nigashi_rate === null)) {
      problems.push(
        `${label}: 2〜6コースは逃がし率を持ち逃げ率を持たないはずです`,
      );
    }
    if (r.makuri_rate === null) {
      problems.push(`${label}: まくり率がNULLです`);
    }
    if (r.runs <= 0) {
      problems.push(`${label}: runs が ${r.runs} です`);
    }
  }

  return problems;
}

function checkRacerStats(rows) {
  const problems = [];

  for (const r of rows) {
    const label = `選手${r.racer_id} ${r.course}コース`;
    if (
      r.course === 1 &&
      (r.nige_rate === null ||
        r.nige_expected === null ||
        r.nigashi_rate !== null)
    ) {
      problems.push(
        `${label}: 1コースは逃げの3列を持ち逃がしを持たないはずです`,
      );
    }
    if (
      r.course > 1 &&
      (r.nige_rate !== null ||
        r.nigashi_rate === null ||
        r.nigashi_expected === null)
    ) {
      problems.push(
        `${label}: 2〜6コースは逃がしの3列を持ち逃げを持たないはずです`,
      );
    }
    if (r.makuri_rate === null || r.makuri_expected === null) {
      problems.push(`${label}: まくりの率または期待値がNULLです`);
    }
    if (r.runs <= 0) {
      problems.push(`${label}: runs が ${r.runs} です`);
    }
    // 調子窓に走が無ければ率はNULL（「0%だった」と「走っていない」を区別する）
    if (
      r.runs_90d === 0 &&
      (r.nige_rate_90d !== null ||
        r.makuri_rate_90d !== null ||
        r.nigashi_rate_90d !== null)
    ) {
      problems.push(
        `${label}: runs_90d=0 なのに90日窓の率がNULLではありません`,
      );
    }
  }

  return problems;
}

async function main() {
  if (!isSupabaseEnabled()) {
    throw new Error(
      "Supabaseの環境変数が未設定です（SUPABASE_URL / SUPABASE_SERVICE_KEY）",
    );
  }

  const today = todayJST();
  console.log(
    `選手×コース別の決まり手集計を開始します（${today} JST${DRY_RUN ? " / dry-run" : ""}）`,
  );

  // --- 1. 会場 × グレード × コースのベースライン ---
  const baselineRows = await callAggregate(
    "compute_venue_course_technique_baseline",
  );
  const gradeCells = baselineRows.filter((r) => r.race_grade !== "ALL").length;
  const allCells = baselineRows.length - gradeCells;
  console.log(
    `\n[venue_course_technique_baseline] 集計結果 ${baselineRows.length} 行（グレード別 ${gradeCells} ＋ ALL ${allCells}）`,
  );
  console.log(
    `  集計期間 ${baselineRows[0].window_start} 〜 ${baselineRows[0].window_end}（${baselineRows[0].window_days}日）`,
  );
  const sparse = baselineRows.filter(
    (r) => r.race_grade !== "ALL" && r.runs < MIN_BASELINE_RUNS,
  ).length;
  console.log(
    `  母数${MIN_BASELINE_RUNS}未満のグレード別セル ${sparse} 件（ALL 行へフォールバックする）`,
  );

  const baselineProblems = checkBaseline(baselineRows);
  if (baselineProblems.length > 0) {
    throw new Error(
      `venue_course_technique_baseline の整合チェックに失敗しました:\n  - ${baselineProblems
        .slice(0, 20)
        .join(
          "\n  - ",
        )}${baselineProblems.length > 20 ? `\n  - ...他 ${baselineProblems.length - 20} 件` : ""}`,
    );
  }
  console.log("  整合チェック: OK");

  const stamp = (rows) => rows.map((r) => ({ ...r, last_updated: today }));

  const baselineResult = await upsertChangedRows(
    supabase,
    "venue_course_technique_baseline",
    stamp(baselineRows),
    {
      onConflict: "venue_code,race_grade,course",
      keyColumns: ["venue_code", "race_grade", "course"],
      ignoreColumns: ["last_updated"],
      chunkColumn: "venue_code",
      label: "venue_course_technique_baseline",
      dryRun: DRY_RUN,
      stampUpdatedAt: true,
    },
  );
  if (baselineResult.error) throw baselineResult.error;
  console.log(
    formatSkipSummary("venue_course_technique_baseline", baselineResult.stats, {
      fallback: baselineResult.fallback,
    }),
  );

  // --- 2. 選手 × コースの実績 ---
  //
  // racer 側のRPCは venue_course_technique_baseline を読むため、1の書き込み後に呼ぶ。
  // dry-run では1が書かれていないので、表がまだ空なら選手側の期待値は全てNULLになる。
  // それを「整合チェックの失敗」として報告すると原因が分かりにくいため、先に区別する。
  if (DRY_RUN) {
    const { count, error } = await supabase
      .from("venue_course_technique_baseline")
      .select("*", { count: "exact", head: true });
    if (error) throw error;
    if (!count) {
      console.log(
        "\n[dry-run] venue_course_technique_baseline がまだ空のため、選手側の集計は行いません。" +
          "\n         （期待値はこの表を引くため、空のままでは全てNULLになります）" +
          "\n         本番実行（--dry-run なし）でベースラインを投入してから、もう一度 dry-run してください。",
      );
      console.log("\n完了しました（dry-run のため書き込んでいません）");
      return;
    }
    console.log(
      `\n[dry-run] ベースラインを書き込んでいないため、選手側の期待値は既存の ${count} 行を参照します`,
    );
  }

  const racerRows = await callAggregate("compute_racer_course_technique_stats");
  console.log(
    `\n[racer_course_technique_stats] 集計結果 ${racerRows.length} 行（${
      new Set(racerRows.map((r) => r.racer_id)).size
    }選手）`,
  );
  const noForm = racerRows.filter((r) => r.runs_90d === 0).length;
  console.log(
    `  直近90日に1走も無い (racer, course) の組 ${noForm} 件（率はNULLで保存する）`,
  );

  const racerProblems = checkRacerStats(racerRows);
  if (racerProblems.length > 0) {
    throw new Error(
      `racer_course_technique_stats の整合チェックに失敗しました:\n  - ${racerProblems
        .slice(0, 20)
        .join(
          "\n  - ",
        )}${racerProblems.length > 20 ? `\n  - ...他 ${racerProblems.length - 20} 件` : ""}`,
    );
  }
  console.log("  整合チェック: OK");

  const racerResult = await upsertChangedRows(
    supabase,
    "racer_course_technique_stats",
    stamp(racerRows),
    {
      onConflict: "racer_id,course",
      keyColumns: ["racer_id", "course"],
      ignoreColumns: ["last_updated"],
      chunkColumn: "racer_id",
      label: "racer_course_technique_stats",
      dryRun: DRY_RUN,
      stampUpdatedAt: true,
    },
  );
  if (racerResult.error) throw racerResult.error;
  console.log(
    formatSkipSummary("racer_course_technique_stats", racerResult.stats, {
      fallback: racerResult.fallback,
    }),
  );

  console.log(
    `\n完了しました${DRY_RUN ? "（dry-run のため書き込んでいません）" : ""}`,
  );
}

main().catch((error) => {
  console.error("\n失敗しました:", error.message);
  process.exit(1);
});
