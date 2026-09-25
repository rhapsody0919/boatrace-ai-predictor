#!/usr/bin/env node
/**
 * 「本日のデータ一覧」SNSネタ本文のデータ精度検証（BOA-402 T5-1）。
 *
 * コードレビューとは別に、「本文に出る数値が実データ（morning_digest_days /
 * morning_digest_rows）と一致しているか」だけを見る独立ステップ
 * （`.claude/rules/analysis.md`「データ精度の検証」）。**読み取りのみ**で、
 * sns_topics には一切書かない。
 *
 * 使い方:
 *   node scripts/verification/verify-morning-digest-sns-topic.js [--date=YYYY-MM-DD]
 */
import { supabase, isSupabaseEnabled } from "../lib/supabaseClient.js";
import {
  buildSnsTopicText,
  snsTopicMarker,
} from "../daily/generate-morning-digest.js";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);

function todayJST() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
}

async function main() {
  if (!isSupabaseEnabled()) {
    throw new Error("Supabaseの環境変数が未設定です");
  }
  const date = typeof args.date === "string" ? args.date : todayJST();

  const { data: day, error: dayErr } = await supabase
    .from("morning_digest_days")
    .select("*")
    .eq("digest_date", date)
    .maybeSingle();
  if (dayErr) throw dayErr;
  if (!day) {
    console.log(`対象日 ${date} のダイジェストがありません。検証をスキップします。`);
    return;
  }

  const { data: rows, error: rowsErr } = await supabase
    .from("morning_digest_rows")
    .select("*")
    .eq("digest_date", date);
  if (rowsErr) throw rowsErr;

  const text = buildSnsTopicText(date, day, rows);
  console.log("--- 生成されるネタ本文 ---");
  console.log(text);
  console.log("--------------------------\n");

  // 1. 目印（重複登録の鍵）が入っている
  check("目印（対象日）", text.includes(snsTopicMarker(date)), snsTopicMarker(date));

  // 2. 会場数・レース数が morning_digest_days と一致する
  check(
    "会場数・レース数",
    text.includes(`${day.venue_count}会場${day.race_count}レース`),
    `${day.venue_count}会場${day.race_count}レース`,
  );

  // 3. セクション件数が「実際の行数」と一致する（notes.sectionCounts ではなく行を数え直す）
  const actual = {};
  for (const r of rows) actual[r.section] = (actual[r.section] ?? 0) + 1;
  for (const [section, label] of [
    ["nige", "逃げ"],
    ["makuri", "まくり"],
    ["nigashi", "逃がし"],
  ]) {
    check(
      `${label}の件数`,
      text.includes(`${label}${actual[section] ?? 0}件`),
      `期待 ${actual[section] ?? 0}件`,
    );
  }
  check(
    "フライング・帰郷の件数",
    text.includes(`前日のフライング${actual.flying ?? 0}件・帰郷${actual.returned ?? 0}件`),
    `F=${actual.flying ?? 0} 帰郷=${actual.returned ?? 0}`,
  );

  // 4. 注目レースが featured 行と一致する
  const featured = rows.find((r) => r.section === "featured");
  if (featured) {
    check(
      "注目レースの選手・レース番号",
      text.includes(`${featured.race_number}R ${featured.racer_name}選手`),
      `${featured.race_number}R ${featured.racer_name}`,
    );
    // 画面（FeaturedRaceCard.jsx）と同じ Math.round で一致するか
    const roundedVolatility = Math.round(Number(featured.volatility_percentile));
    check(
      "注目レースのコース・イン崩れ指数（画面と同じ丸め）",
      text.includes(`${featured.course}コース、イン崩れ指数${roundedVolatility}%`),
      `course=${featured.course} vol=${featured.volatility_percentile}→${roundedVolatility}`,
    );
    check(
      "イン崩れ指数の生値を出していない",
      roundedVolatility === Number(featured.volatility_percentile) ||
        !text.includes(`${featured.volatility_percentile}%`),
      `生値 ${featured.volatility_percentile}%`,
    );
  } else {
    check("注目レースなしの文言", text.includes("注目レースは該当なし"), "featured 行なし");
  }

  // 5. 禁止事項
  check("「競艇」を使っていない", !text.includes("競艇"));
  check("「勝率」を使っていない", !text.includes("勝率"));
  check(
    "リンクに ?date= を付けていない",
    text.includes("https://www.boat-ai.jp/today") && !text.includes("/today?date="),
  );
  // 推定値（metric_predicted）は本文に出さない（spec FR-4 の改訂）
  const predicted = rows.map((r) => r.metric_predicted).filter((v) => v !== null);
  check(
    "推定値を本文に出していない",
    predicted.every((v) => !text.includes(String(v))),
    `metric_predicted ${predicted.length}件`,
  );

  let failed = 0;
  for (const c of checks) {
    if (!c.ok) failed += 1;
    console.log(`${c.ok ? "✓" : "✗"} ${c.name}${c.detail ? `（${c.detail}）` : ""}`);
  }
  console.log(
    failed === 0
      ? `\n✅ ${checks.length}件すべて一致（対象日 ${date}）`
      : `\n❌ ${failed}/${checks.length}件が不一致（対象日 ${date}）`,
  );
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("検証に失敗しました:", error.message);
  process.exit(1);
});
