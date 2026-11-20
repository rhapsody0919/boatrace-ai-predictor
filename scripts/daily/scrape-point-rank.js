/**
 * 今節得点率取得スクリプト（BOA-220/BOA-291、FR-3）
 *
 * boatrace.jp「得点率一覧」ページ（pointrank）を、開催中の全会場に対して
 * 1日1回取得する。SG/G1等の記念競走（予選勝ち上がり制）でのみデータが
 * 存在し、一般戦・特別選抜競走（オールレディース/マスターズ等）は
 * ページ自体にテーブルが無い（scripts/lib/pointRankParser.js参照）。
 * 対象グレードを事前に決め打ちせず、テーブルの有無で判定する。
 * ただし「テーブルが無いのが異常か」の判定（judgeVenue）にだけ、実測に基づく
 * 期待条件（SG/G1かつ4日目以降）を使う。
 *
 * meet_start_date（開催初日）は race_conditions.series_day（BOA-226）を
 * 使って対象日から逆算する。
 *
 * 対象日: 「now - 6時間」のJST日付（resolveTargetDate）。cronは22:00 JSTだが、
 * GitHub Actionsのscheduleは約4時間遅延する実績があり（2026-09-16〜18の3回とも
 * 02:00 JST前後に起動）、単純な「今日のJST日付」だと翌日を指して
 * 「開催会場なし」で0件終了していた（翌日のracesは午前に生成される）。
 * 00:00〜06:00 JSTの起動は前日分ジョブの遅延起動とみなす。
 *
 * 失敗の扱い（.claude/rules/data-acquisition.md 1章）: 「期待件数が0でない限り
 * 0件を成功扱いしない」に従い、次のいずれかで非0終了する。
 *   - 対象日の開催会場が0件 / 取得失敗 / 表はあるが行を解析できない
 *   - SG/G1の4日目以降なのに表が無い（期待件数=このような会場数）
 *   - 表はあるがseries_day未取得でmeet_start_dateを算出できない
 *   - DBの読み書きエラー
 * 表が無いのが正常なケース（一般戦・G3等、SG/G1でも1〜3日目）は成功扱い。
 *
 * GitHub Actionsから日次実行（低頻度・T4相当、BOA-313の対象外）。
 */

import { parseDateArg } from "../lib/dateUtils.js";
import { isSupabaseEnabled } from "../lib/supabaseClient.js";
import { isGhaFetchStopped } from "../lib/ghaSkipGate.js";
import {
  buildDailyRows,
  buildVenueGrades,
  buildVenueLastRaces,
  isTableExpected,
  judgeVenue,
  selectDailyVenues,
} from "../lib/pointRankJobParts.js";
import {
  writeDailyRows,
  resolveTargetDate,
  getActiveVenueGrades,
  getSeriesDay,
  run,
} from "../lib/pointRankRun.js";
import { fetchPointRank } from "../lib/pointRankFetch.js";

async function main() {
  console.log("📋 得点率取得開始");
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase環境変数が未設定です。");
    process.exit(1);
  }
  // 取得の非常停止（fetch_stop、マイグレーション178）が立っていれば、SKIP 変数に関係なく公式へ取りに行かない（ADR-0101 決定6、BOA-1145 P4a ④a）
  if ((await isGhaFetchStopped()).stopped) {
    console.log("⏭️ 取得の非常停止中のため、取得を行わない");
    return;
  }
  const date = parseDateArg() || resolveTargetDate();
  console.log(`📅 対象日: ${date}`);
  const { failures, daily } = await run(date);
  // GitHub Actions の肩代わりには補足の起動が無い。表にその日の結果が出ていない会場は、取り直せないので失敗にして知らせる
  for (const v of daily?.pendingVenues ?? [])
    failures.push(
      `会場${v.venueCode}(${v.seriesDay}日目): 表が${v.asOfSeriesDay}日目${v.asOfRace}Rの時点（最終${v.lastRace}R、${v.reason}）`,
    );
  if (failures.length > 0) {
    console.error(`❌ 得点率取得に失敗（${failures.length}件）:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("🏁 完了");
}

export const _internal = {
  buildDailyRows,
  buildVenueLastRaces,
  selectDailyVenues,
  writeDailyRows,
  resolveTargetDate,
  isTableExpected,
  judgeVenue,
  buildVenueGrades,
  getActiveVenueGrades,
  getSeriesDay,
  fetchPointRank,
};

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((err) => {
    console.error("❌ エラー:", err);
    process.exit(1);
  });
}

export { run } from "../lib/pointRankRun.js";
