/**
 * レース特記事項（事故・内規違反・減点／モーター・ボート変更／欠場・帰郷）取得
 * （BOA-318/319/320、docs/design/scraping-full-coverage/plan.md FR-1）
 *
 * boatrace.jp の race/information ページ（会場・日付単位、レース番号非依存。
 * rno は必須パラメータだが値によって内容は変わらないことを実データで確認済み）
 * から3区分の通知をまとめて取得し、race_special_notes テーブルへ保存する。
 *
 * 実データ確認済み構造（2026-09-15調査）:
 * - 通知なしの場合: 各区分の<table>内に「※ 現在、お知らせはありません。」の
 *   1行のみ（<td class="is-p10-0">）
 * - 通知がある場合（過去の実例、jcd=12 hd=20171224で確認）:
 *   - 事故・内規違反・減点: <tr>ごとに [日付(MM/DD), レース番号(例:10R), 選手名,
 *     違反/事故内容(例:落水失格（選手責任）), 処分(例:減点5点|処置なし)] の5セル
 *   - モーター・ボート変更: [日付, 選手名, 変更内容(例:26→69（ボート変更）),
 *     適用タイミング(例:2日目より使用)] の4セル
 *   - 欠場・帰郷: [日付, 選手名, 理由(例:帰郷（私傷病のため）)] の3セル
 * - 各行の日付は「MM/DD」形式で、当該節（開催期間）内の過去日を含む累積表示
 *   になっている（hd指定日＝節の最終確認日ではなく、節開始日からの全行が
 *   毎回表示される）。年またぎ節（12月末〜1月）を考慮し、hd の年月と行の
 *   月を突き合わせて実際の年を復元する（resolveRaceDate）。
 *
 * 通知の発生頻度が低く行の内容もほぼ不変なため、venue_code/race_date/category/
 * detail_text/racer_name の組み合わせにUNIQUE制約を張り、10分間隔の再取得で同じ行を
 * 何度取得してもエラーにならない（ignoreDuplicates upsert）設計にする。racer_name を
 * 含めるのは、同じ会場・日付・区分でdetail_textがたまたま一致する別選手の通知を
 * 1行に潰さないため（BOA-371、マイグレーション093）。
 *
 * 構造変化監視: scripts/lib/venueMotorStats/driftHealth.js のコアロジック
 * （updateVenueHealth）を再利用する。Vercel Function（api/cron/race-notices.js）
 * は10分間隔で実行されファイルシステムへの永続化・git commitができないため、
 * 会場×日付単位の当日集計を race_notices_health テーブルに保存し、
 * scripts/maintenance/check-race-notices-drift.js（GitHub Actions日次実行）が
 * 直近日数分を畳み込んで連続失敗日数を判定する。
 *
 * race_notices_health は、変更のある行（had_success・last_reason が変わった会場×日）だけを書く
 * （BOA-353 T4b-11-1、変更の無い行は書かない方針）。last_checked_at は「その行を最後に書いた時刻」
 * になり、最終確認時刻ではなくなる（最終確認・最終成功は scrape_job_state の race_notices の
 * last_success_at）。
 *
 * 共通ラッパ（scripts/lib/scrapeJobs/cronWrapper.js）から呼ぶ場合は、scripts/lib/raceNoticesJob.js が
 * strict（DBの読み書きの失敗を例外にする）・dryRun（shadow: 取得・解析のみ）・並列度・取得関数
 * （politeFetch）を渡す。CLI・従来の呼び出しは、オプション無し（従来どおり、逐次・失敗はログのみ）。
 */

import {
  parseInformationHtml,
  resolveRaceDate,
  parseAccidentRow,
  parseEquipmentChangeRow,
  parseAbsenceRow,
} from "../lib/raceNoticesParse.js";
import { normalizeRacerName, run } from "../lib/raceNoticesRun.js";

// 回帰テスト（scripts/maintenance/verify-race-notices-parser.js）用に内部関数を公開する
// （scripts/daily/update-race-info.jsの_internalパターンを踏襲）
export const _internal = {
  parseInformationHtml,
  resolveRaceDate,
  parseAccidentRow,
  parseEquipmentChangeRow,
  parseAbsenceRow,
  normalizeRacerName,
};

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const { getRaceSchedule } = await import("../lib/raceSchedule.js");
  const { getTodayDateJST, parseDateArg } = await import("../lib/dateUtils.js");
  const date = parseDateArg() || getTodayDateJST();
  const schedule = await getRaceSchedule(date);
  run(schedule, date)
    .then((result) => console.log("完了:", result))
    .catch((error) => {
      console.error("❌ エラー:", error);
      process.exit(1);
    });
}

export { createInformationFetcher, run } from "../lib/raceNoticesRun.js";
