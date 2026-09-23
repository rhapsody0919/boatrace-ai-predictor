#!/usr/bin/env node
/**
 * update-course-baseline-stats.js
 *
 * ST考察の「同コース・同級別の平均」（`st_course_baseline`、24行）と
 * 逃げシミュレーション（`nige_second_by_course`、最大120行）を日次で更新する。
 *
 * 設計: docs/design/analysis-visualization-upgrade/plan.md §5
 *       docs/adr/0068-course-baseline-precomputation.md
 *       docs/db-migration/094_course_baselines.sql
 *
 * ## なぜ事前集計するか
 *
 * どちらもレース詳細の1画面より広い母集団（約56万行）を必要とする。
 * レース詳細は本サービスで最もアクセスが多いページなので、そこで毎回集計するのは
 * BOA-357（Supabase Disk IO Budget枯渇）の状況で取れない。日次で極小のテーブルに
 * まとめ、画面は単純なSELECTで読む。
 *
 * ## 集計本体はDB側（RPC）にある
 *
 * `compute_st_course_baseline()` / `compute_nige_second_by_course()`（094で作成）が
 * 集計し、結果の24行＋最大120行だけを返す。Node側に56万行を持たない。
 * Fの除外規則（ST順1位の基準からも母数からも外す。符号反転はしない）もRPC側にある。
 *
 * ## 実行
 *
 *   node scripts/daily/update-course-baseline-stats.js            # 本番へ書き込む
 *   node scripts/daily/update-course-baseline-stats.js --dry-run  # 書き込まずに結果を出す
 */

import { supabase, isSupabaseEnabled } from "../lib/supabaseClient.js";
import { upsertChangedRows, formatSkipSummary } from "../lib/unchangedRows.js";

const DRY_RUN = process.argv.includes("--dry-run");

function todayJST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split("T")[0];
}

/**
 * RPCを呼んで集計結果を得る。
 * 「集計結果が0行」は異常（対象データが必ずあるはずのため）。
 * これと「変更が無くて書き込みが0行」は別物なので取り違えない（plan.md §5.1）。
 */
async function callAggregate(fnName) {
  const { data, error } = await supabase.rpc(fnName);
  if (error) {
    throw new Error(`${fnName} の実行に失敗しました: ${error.message}`);
  }
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(
      `${fnName} の集計結果が0行でした（対象データがあるはずなので異常です）`,
    );
  }
  return data;
}

async function main() {
  if (!isSupabaseEnabled()) {
    throw new Error(
      "Supabaseの環境変数が未設定です（SUPABASE_URL / SUPABASE_SERVICE_KEY）",
    );
  }

  const today = todayJST();
  console.log(
    `コース×級別ベースラインの集計を開始します（${today} JST${DRY_RUN ? " / dry-run" : ""}）`,
  );

  // --- 1. ST考察のベースライン（コース×級別の24セル） ---
  const stRows = await callAggregate("compute_st_course_baseline");
  console.log(`\n[st_course_baseline] 集計結果 ${stRows.length} 行`);
  if (stRows.length !== 24) {
    throw new Error(
      `st_course_baseline は24行（コース6 × 級別4）のはずですが ${stRows.length} 行でした`,
    );
  }
  const window = { start: stRows[0].window_start, end: stRows[0].window_end };
  console.log(
    `  集計期間 ${window.start} 〜 ${window.end}（${stRows[0].window_days}日）`,
  );
  for (const r of stRows) {
    const breakout =
      r.breakout_count === null
        ? "抜出 —"
        : `抜出 ${r.breakout_count}回(${r.breakout_rate}%)`;
    console.log(
      `  ${r.course}コース ${r.grade}: n=${r.runs} 平均ST=${r.avg_st} 安定率=${r.stable_rate}% 出遅率=${r.late_rate}% ${breakout}`,
    );
  }

  // --- 2. 逃げシミュレーション（会場 × 2着コース） ---
  const nigeRows = await callAggregate("compute_nige_second_by_course");
  console.log(
    `\n[nige_second_by_course] 集計結果 ${nigeRows.length} 行（${
      new Set(nigeRows.map((r) => r.venue_code)).size
    }会場）`,
  );

  // --- 3. 整合チェック（T2-3。壊れた値を本番に入れない） ---
  const problems = [];
  for (const r of stRows) {
    const bins = r.st_histogram ?? {};
    const sum = Object.values(bins).reduce((a, b) => a + Number(b), 0);
    if (sum !== r.runs) {
      problems.push(
        `st_histogram のビン合計(${sum})が runs(${r.runs}) と一致しません（${r.course}コース ${r.grade}）`,
      );
    }
  }
  const byVenue = new Map();
  for (const r of nigeRows) {
    if (!byVenue.has(r.venue_code)) byVenue.set(r.venue_code, []);
    byVenue.get(r.venue_code).push(r);
  }
  for (const [venueCode, rows] of byVenue) {
    const secondSum = rows.reduce((a, r) => a + Number(r.second_rate), 0);
    if (Math.abs(secondSum - 100) > 0.5) {
      problems.push(
        `会場${venueCode}: 逃し時2着率の合計が ${secondSum.toFixed(2)}%（100%±0.5 から外れています）`,
      );
    }
    // 2連単確率の合計 = P(1コース逃げ)。分母の取り違えを機械的に検知する
    // （当初の設計では2着率と2連単確率で分母が違い、3.6%ずれていた）
    const exactaSum = rows.reduce((a, r) => a + Number(r.exacta_rate), 0);
    const nigePct =
      (Number(rows[0].nige_races) / Number(rows[0].total_races)) * 100;
    if (Math.abs(exactaSum - nigePct) > 0.5) {
      problems.push(
        `会場${venueCode}: 2連単確率の合計 ${exactaSum.toFixed(2)}% が 1コース逃げ率 ${nigePct.toFixed(2)}% と一致しません（分母の取り違えの疑い）`,
      );
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `整合チェックに失敗しました:\n  - ${problems.join("\n  - ")}`,
    );
  }
  console.log("\n整合チェック: OK（ビン合計 / 2着率の合計 / 2連単確率の合計）");

  // --- 4. 書き込み（変更のある行だけ） ---
  // last_updated は「値が実際に変わった日」を入れる。毎日書き換えると全行が必ず
  // 変更扱いになり、条件付きupsertの意味が消えるため ignoreColumns で比較から外す
  const stamp = (rows) => rows.map((r) => ({ ...r, last_updated: today }));

  const stResult = await upsertChangedRows(
    supabase,
    "st_course_baseline",
    stamp(stRows),
    {
      onConflict: "course,grade",
      keyColumns: ["course", "grade"],
      ignoreColumns: ["last_updated"],
      chunkColumn: "course",
      label: "st_course_baseline",
      dryRun: DRY_RUN,
      stampUpdatedAt: true,
    },
  );
  if (stResult.error) throw stResult.error;
  console.log(
    "\n" +
      formatSkipSummary("st_course_baseline", stResult.stats, {
        fallback: stResult.fallback,
      }),
  );

  const nigeResult = await upsertChangedRows(
    supabase,
    "nige_second_by_course",
    stamp(nigeRows),
    {
      onConflict: "venue_code,second_course",
      keyColumns: ["venue_code", "second_course"],
      ignoreColumns: ["last_updated"],
      chunkColumn: "venue_code",
      label: "nige_second_by_course",
      dryRun: DRY_RUN,
      stampUpdatedAt: true,
    },
  );
  if (nigeResult.error) throw nigeResult.error;
  console.log(
    formatSkipSummary("nige_second_by_course", nigeResult.stats, {
      fallback: nigeResult.fallback,
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
