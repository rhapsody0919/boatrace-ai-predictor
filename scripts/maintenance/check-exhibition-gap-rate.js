#!/usr/bin/env node
/**
 * 展示データの欠落率チェック（GitHub Actions: exhibition-gap-monitor.yml から呼ばれる）
 *
 * 結果が確定済み（race_results.payout_winが非null）のレースのうち、
 * 展示タイム（exhibition_dataのexhibition_time非null）が存在しないものの割合を
 * 前日分（JST）で計測する。
 * docs/design/scraping-serverless-migration/spec.md Step 2の並走期間中の
 * 日次監視に使う。移行前3日間の実測値は0.6%/6.7%/8.1%（2026-09-12〜14、
 * ただし下記の旧基準での値）。
 *
 * 判定基準は「行が存在するか」ではなく「展示タイムが入っているか」。
 * 鳴門・丸亀・児島・江戸川等では展示STが展示タイムより先に公開されるため、
 * 展示タイムがnullでSTだけの行が書かれることがある。行の有無で判定すると
 * これを欠落として検知できない（2026-09-19判明、9/18は29レース＝16%が該当）。
 *
 * exhibition_data は1レース6行のため1日180レースで1000行を超える。
 * Supabaseのデフォルト上限（1000行）で切り捨てられて誤報しないよう、
 * すべて fetchAll でページネーションして取得する（BOA-350）。取得エラー（statement
 * timeout等）は throwOnError で例外にする。既定のまま部分結果・空配列を受け取ると
 * 「結果確定0件→欠落率0%→OK」と誤判定し、監視が黙って正常扱いになるため。
 *
 * 閾値を超えている場合のみ、Slack通知用のテキストをstdoutに出力し、
 * exit code 1 を返す（ワークフロー側はexit codeで通知要否を判断する）。
 */

import { getYesterdayDateJST } from "../lib/dateUtils.js";
import { fetchAll } from "../lib/supabaseClient.js";

const GAP_RATE_ALERT_THRESHOLD = 0.02; // 2%

async function main() {
  const date = getYesterdayDateJST();

  const inDay = (q) =>
    q.gte("race_id", date).lt("race_id", `${date}~`).order("race_id");

  const strict = { throwOnError: true };
  const races = await fetchAll("races", "race_id", inDay, strict);
  const results = await fetchAll(
    "race_results",
    "race_id",
    (q) => inDay(q).not("payout_win", "is", null),
    strict,
  );
  const exhibitions = await fetchAll(
    "exhibition_data",
    "race_id",
    (q) => inDay(q).not("exhibition_time", "is", null).order("boat_number"),
    strict,
  );

  const finishedIds = new Set(results.map((r) => r.race_id));
  const exhibitionIds = new Set(exhibitions.map((r) => r.race_id));
  const finishedRaces = races.filter((r) => finishedIds.has(r.race_id));
  const missing = finishedRaces.filter((r) => !exhibitionIds.has(r.race_id));

  const gapRate =
    finishedRaces.length === 0 ? 0 : missing.length / finishedRaces.length;
  const gapRatePercent = (gapRate * 100).toFixed(1);

  const summary = `${date}: 結果確定${finishedRaces.length}件中、展示タイム欠落${missing.length}件（欠落率${gapRatePercent}%）`;

  if (gapRate <= GAP_RATE_ALERT_THRESHOLD) {
    console.log(`OK: ${summary}`);
    process.exit(0);
  }

  console.log(
    `${summary}\n閾値（${GAP_RATE_ALERT_THRESHOLD * 100}%）を超過\n欠落レース例: ${missing
      .slice(0, 10)
      .map((r) => r.race_id)
      .join(", ")}`,
  );
  process.exit(1);
}

main().catch((error) => {
  console.error("❌ check-exhibition-gap-rate 実行中にエラー:", error.message);
  process.exit(1);
});
