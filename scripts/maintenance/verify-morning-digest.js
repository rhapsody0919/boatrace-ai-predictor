#!/usr/bin/env node
/**
 * verify-morning-digest.js
 *
 * 「本日のデータ一覧」（BOA-402）が当日ぶん生成されているかを検証する。
 * generate-morning-digest.yml の2回目（JST 06:30）から呼び、書けていなければ失敗させる。
 *
 * generate-morning-digest.js は完全性チェックを満たさないとき
 * **書き込まずに終了コード0で終わる**（次回の実行で再試行させるため）。
 * その設計だけだと「毎日静かに空のまま」になりうるので、
 * 2回目でも書けていない日をここで失敗として顕在化させる。
 *
 * 使い方:
 *   node scripts/maintenance/verify-morning-digest.js            # JSTの当日
 *   node scripts/maintenance/verify-morning-digest.js --date=YYYY-MM-DD
 */

import { supabase, isSupabaseEnabled } from "../lib/supabaseClient.js";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);

function todayJST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split("T")[0];
}

async function main() {
  if (!isSupabaseEnabled()) {
    throw new Error(
      "Supabaseの環境変数が未設定です（SUPABASE_URL / SUPABASE_SERVICE_KEY）",
    );
  }
  const date = typeof args.date === "string" ? args.date : todayJST();

  const { data: day, error } = await supabase
    .from("morning_digest_days")
    .select("digest_date, generated_at, venue_count, race_count, notes")
    .eq("digest_date", date)
    .maybeSingle();
  if (error) throw error;

  const problems = [];
  if (!day) {
    problems.push(`morning_digest_days に ${date} の行がありません（未生成）`);
  } else if (!day.generated_at) {
    // generated_at は書き込み完了のマーク（ADR-0070）。NULLは途中で落ちた状態
    problems.push(
      `${date} の generated_at がNULLです（rows の投入中に落ちた可能性）`,
    );
  }

  if (day) {
    const { count, error: cntErr } = await supabase
      .from("morning_digest_rows")
      .select("*", { count: "exact", head: true })
      .eq("digest_date", date);
    if (cntErr) throw cntErr;
    if (!count) {
      problems.push(`${date} の morning_digest_rows が0行です`);
    } else {
      console.log(
        `OK: ${date} は ${count} 行（${day.venue_count}会場 ${day.race_count}レース）` +
          ` generated_at=${day.generated_at}`,
      );
      console.log(`  内訳: ${JSON.stringify(day.notes?.sectionCounts ?? {})}`);
    }
  }

  if (problems.length > 0) {
    console.error("\n検証に失敗しました:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("\n失敗しました:", error.message);
  process.exit(1);
});
