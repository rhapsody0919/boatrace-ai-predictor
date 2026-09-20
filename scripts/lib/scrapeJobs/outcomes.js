/**
 * スロット・ジョブの結果（outcome）の扱い（純粋関数）。
 *
 * outcome（scrape_slots.outcome。CHECK制約は付けず、ここで管理する）:
 *   ok                完了（書き込めた。変更なしも含む）
 *   skipped_have_data 既にデータがあり取得不要（完了）
 *   partial           一部のみ取得できた（再試行）
 *   no_values         未公開（再試行）
 *   error             失敗（再試行）
 *   breaker_open      サーキットブレーカーが開いていた（ブレーカーが閉じる頃まで再試行を遅らせる）
 *   cancelled_race    確定中止（claim_scrape_slots が終端する。ハンドラーは返さない）
 */

/** 完了として扱う outcome（それ以外は pending に戻して再試行） */
export const FINAL_OUTCOMES = Object.freeze(["ok", "skipped_have_data"]);

export const MAX_ERROR_LENGTH = 500;

export function isFinalOutcome(outcome) {
  return FINAL_OUTCOMES.includes(outcome);
}

/** last_error に保存する文字列（500字で切る） */
export function truncateError(error, max = MAX_ERROR_LENGTH) {
  if (error === null || error === undefined) return null;
  const text =
    typeof error === "string" ? error : (error.message ?? String(error));
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * 0件エラー: 「期待件数が0でないのに、取得元から0件しか解析できなかった」結果を、成功にしない。
 *
 * 書き込み行数（rowsWritten）ではなく、取得元から解析できた行数（rowsParsed）で判定する。
 * 「変更の無い行は書かない」方針のため、書き込み0件は、変更が無かっただけで正常な場合がある。
 * 期待件数（rowsExpected）を返さない結果は、判定しない（期待件数が0でない、と言えないため）。
 * shadow でも判定する（取得・解析は行うため）。
 *
 * @param {{outcome: string, rowsParsed?: number, rowsExpected?: number, error?: unknown}} result
 */
export function applyZeroRowGuard(result) {
  if (result.outcome !== "ok") return result;
  if (
    typeof result.rowsExpected === "number" &&
    result.rowsExpected > 0 &&
    result.rowsParsed === 0
  ) {
    return {
      ...result,
      outcome: "error",
      error: `期待件数が${result.rowsExpected}件なのに、解析できた行が0件でした（0件を成功にしません）`,
    };
  }
  return result;
}

/** 再試行の間隔から差し引く秒数（Cronの起動時刻のぶれで、毎分の起動を1回飛ばさないため） */
export const RETRY_JITTER_SEC = 10;

/**
 * 再試行を許す時刻。起点は、ハンドラーの完了時刻ではなく、スロットを claim した時刻（last_attempt_at）にする。
 * 完了時刻を起点にすると、1件約10秒かかる取得の分だけ間隔が延び、毎分のCronの次の起動（+60秒）に間に合わず、
 * 許容幅3分のジョブ（オッズ・レース情報）が窓内に2回しか試行できなくなる。現在時刻より前にはならない。
 *
 * @param {{now: Date, claimedAt?: string|Date|null, retrySec: number}} params
 */
export function computeRetryAt({ now, claimedAt, retrySec }) {
  const claimedMs = claimedAt ? new Date(claimedAt).getTime() : NaN;
  const baseMs = Number.isFinite(claimedMs) ? claimedMs : now.getTime();
  const at = baseMs + Math.max(0, retrySec - RETRY_JITTER_SEC) * 1000;
  return new Date(Math.max(now.getTime(), at));
}
