/**
 * 期別成績（fan、racer_period_stats）の Vercel Cron。対象日より前に終わった期の fan を、取り込み済みでなければ
 * 1回取得して取り込む。実装: scripts/lib/fanPeriodJob.js
 *
 * cron式（vercel.json）はUTC:
 *   UTC 21:00 ＝ JST 06:00（指定時刻）
 *   UTC 21:30 ＝ JST 06:30（補足。06:00 が通信エラー等で完了しなかった日だけ処理する。06:00 に取り込み済み・未公開（404）を
 *                確認した日は、共通ラッパが last_target_date で何もしない）
 * 06:00 にする理由: 開催時間帯と、他の日次ジョブ（04:00 の節・07:00 の K）を避けるため。
 *
 * モード（scrape_job_state.mode の job='fan_period'）: off（または行なし）は何もしない。shadow は取得・解析・差分の集計のみ。live は書く。
 * 動作確認: GET /api/cron/fan-period?fanId=fan2604（Authorization: Bearer {CRON_SECRET}）。取り込み済みでも取り直し、
 * 既存行との差分を返す（shadow では書かない）。
 *
 * maxDuration は、レジストリ（fan_period.maxDurationSec）と同じ値をリテラルで書く。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import { runFanPeriodJob } from "../../scripts/lib/fanPeriodJob.js";

export const config = {
  maxDuration: 120,
};

export default createScrapeCronHandler({
  job: "fan_period",
  run: (ctx) => runFanPeriodJob(ctx),
});
