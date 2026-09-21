/**
 * BOATCASTのモーター使用開始日（N26。bc_mst）の Vercel Cron（docs/design/boatcast-original-exhibition/plan.md）。
 *
 * 全24会場の bc_mst（`YYYYMMDD`の1行）を、共通ラッパ（scripts/lib/scrapeJobs/cronWrapper.js）経由で、1日1回
 * 逐次（2.2秒以上の間隔）で取得し、venue_motor_start_dates へ、新しい（会場, 使用開始日）の組だけを追記する。
 * 取得・解析・書き込みは scripts/lib/boatcast/motorStartJob.js。
 *
 * モード（scrape_job_state.mode の job='boatcast_motor_start'）: off（または行なし）は何もしない。shadow は取得・解析のみ
 * （書かない）。live は書く（マイグレーション087の適用後）。
 *
 * cron式（vercel.json）はUTC。JSTに換算した起動時間帯:
 *   `30 21 * * *`  06:30 JST（指定時刻。bc_mst は毎日 00:10 JST頃に再生成される）
 *   `0 23 * * *`   08:00 JST（補足。06:30の実行が完了しなかった（一部が失敗・時間切れ）場合のみ処理する。完了済みなら、共通ラッパが
 *                  last_target_date で何もしない）
 *
 * 認証: Authorization: Bearer {CRON_SECRET}（共通ラッパ）。
 *
 * maxDuration は、レジストリ（boatcast_motor_start.maxDurationSec）と同じ値をリテラルで書く。
 */
import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
import {
  MOTOR_START_JOB,
  createMotorStartRun,
} from "../../scripts/lib/boatcast/motorStartJob.js";

export const config = {
  maxDuration: 120,
};

export default createScrapeCronHandler({
  job: MOTOR_START_JOB,
  run: createMotorStartRun(),
});
