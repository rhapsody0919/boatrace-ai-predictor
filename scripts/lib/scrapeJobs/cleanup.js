/**
 * 予定表の保守（scrape-cleanup、plan.md §3.9・T4a-11）。日次（JST 04:00）。
 *
 *   1) 古い未完了を expired にする: claim_scrape_slots は race_date >= JSTの今日−1日 だけを走査するため、
 *      それより古い pending・running（Cronが長期間止まっていた場合の残り）は、ここで expired にして
 *      「未完了のまま残る」状態を作らない。監視（expiredの通知）は昨日以降のみを見るため、通知は出ない
 *   2) 保持期間（60日）を過ぎた行を削除する。7日の窓内取得率と月次の傾向を見るのに足りる期間
 *
 * 予定表のテーブルが無い（072未適用）場合は、共通ラッパが何もしない。
 */
import { addDaysToDateString } from "../dateUtils.js";
import { toJstDateString } from "./time.js";

export const SLOT_RETENTION_DAYS = 60;

/** 保持期間の削除・古い未完了の判定に使う日付（純粋関数） */
export function cleanupCutoffs(now) {
  const today = toJstDateString(now);
  return {
    today,
    // race_date がこれより古い未完了は、claim の走査対象外
    staleBefore: addDaysToDateString(today, -1),
    // race_date がこれより古い行は削除
    retentionBefore: addDaysToDateString(today, -SLOT_RETENTION_DAYS),
  };
}

export async function runCleanup(ctx) {
  const { client } = ctx;
  const { staleBefore, retentionBefore } = cleanupCutoffs(ctx.now());

  const swept = await client
    .from("scrape_slots")
    .update({
      status: "expired",
      lease_until: null,
      next_attempt_at: null,
      last_error: "scrape-cleanup: 2日以上前の未完了を expired にしました",
    })
    .in("status", ["pending", "running"])
    .lt("race_date", staleBefore)
    .select("race_id");
  if (swept.error) {
    throw new Error(
      `古い未完了の expired 化に失敗しました: ${swept.error.message}`,
    );
  }

  const deleted = await client
    .from("scrape_slots")
    .delete({ count: "exact" })
    .lt("race_date", retentionBefore);
  if (deleted.error) {
    throw new Error(
      `保持期間を過ぎた予定表の削除に失敗しました: ${deleted.error.message}`,
    );
  }

  return {
    rowsWritten: (swept.data?.length ?? 0) + (deleted.count ?? 0),
    body: {
      staleExpired: swept.data?.length ?? 0,
      deleted: deleted.count ?? 0,
      retentionBefore,
    },
  };
}
