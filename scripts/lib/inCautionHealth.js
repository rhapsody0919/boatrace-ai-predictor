/**
 * BOA-822 イン崩れ注意度の監視（tasks 12、plan §9。完了の定義C）。DB は読み取りだけ。
 *
 * 1. 夜の表（JST 04:30、job=in_caution_health）: RPC get_in_caution_band_rates で、最初の日が config の from、
 *    最後の日が前日、合計の件数が下限以上かを見る（toInCautionRates と同じ判定）。dispatch は投げっぱなしなので、
 *    Actions が動かなかった・失敗した日もここで拾う（design-reviewer 指摘6）
 * 2. 今日の unified（JST 05:45、job=in_caution_today_health）: inCaution がある割合、inCautionSkip の内訳、through の遅れ
 *
 * 2つを別のジョブにしているのは、成功の記録が失敗の記録（last_error・consecutive_failures）を消すため。同じジョブに
 * 載せると、04:30 の失敗が 05:45 の成功で消え、scrape-monitor の運用窓（JST 07:00〜）に届かない（2026-10-13
 * 開発の補助のレビュー F1）。別のジョブなら、失敗は翌日の同じ確認まで残り、07:00 に通知される。
 *
 * 判定は純関数（evaluateInCautionTable・evaluateInCautionToday）。api/cron/in-caution-health.js・
 * api/cron/in-caution-today-health.js と scripts/maintenance/verify-in-caution-coverage.js（手元）が同じ関数を呼ぶ。
 * 問題があれば実行を失敗（outcome: "error"）にし、レジストリの failureAlertAfter: 1 で scrape-monitor が Slack に出す。
 */
import { addDaysToDateString } from "./dateUtils.js";
import { toInCautionRates } from "./inCaution.js";

/** inCaution がある割合の下限（中止・1号艇の欠場・2艇以上の欠場・件数の少ないセルを除く） */
export const IN_CAUTION_COVERAGE_MIN = 0.99;
/** 出さないのが正しい理由（割合の分母から除く） */
const EXPECTED_SKIPS = new Set(["boat1_absent", "multi_absent", "sparse_cell"]);

/**
 * @param {Array<object>} rows RPC get_in_caution_band_rates(NULL, previousDay) の行
 * @param {string} previousDay
 * @returns {{ok: boolean, issues: string[], summary: object}}
 */
export function evaluateInCautionTable(rows, previousDay) {
  const r = toInCautionRates(rows, previousDay);
  const issues = r.usable ? [] : [`夜の表が欠けている: ${r.reason}`];
  if (r.usable && r.through !== previousDay)
    issues.push(
      `夜の表の最後の日が ${r.through}（前日 ${previousDay} まで入っていない）`,
    );
  return {
    ok: issues.length === 0,
    issues,
    summary: {
      first: rows?.[0]?.first_date ?? null,
      through: r.through,
      totalN: r.base.n,
      cells: r.cells.size,
    },
  };
}

/**
 * 中止のレース（races.cancellation_status = 'confirmed' かつ結果が無い。docs/knowledge/data-definitions.md「中止・順延」）は
 * 分子・分母の両方から除く（値の有無にかかわらず。F2）。
 * @param {Array<{race_id: string, ic: object|null, skip: string|null, cancelled?: boolean}>} rows 今日の unified の行
 * @param {string} previousDay
 * @returns {{ok: boolean, issues: string[], summary: object}}
 */
export function evaluateInCautionToday(rows, previousDay) {
  const skips = {};
  let withValue = 0;
  let expected = 0;
  let cancelled = 0;
  const throughs = new Set();
  for (const row of rows ?? []) {
    if (row.cancelled) {
      cancelled++;
      continue;
    }
    if (row.ic) {
      withValue++;
      throughs.add(row.ic.through);
    } else {
      const key = row.skip ?? "missing"; // 旧い生成で書いた行（キーが無い）
      skips[key] = (skips[key] ?? 0) + 1;
      if (EXPECTED_SKIPS.has(key)) expected++;
    }
  }
  const total = rows?.length ?? 0;
  const denominator = total - cancelled - expected;
  const coverage = denominator > 0 ? withValue / denominator : null;
  const issues = [];
  if (total === 0) issues.push("今日の unified の行が0件");
  else if (coverage !== null && coverage < IN_CAUTION_COVERAGE_MIN)
    issues.push(
      `inCaution がある割合 ${(coverage * 100).toFixed(1)}%（${withValue}/${denominator}、下限 ${IN_CAUTION_COVERAGE_MIN * 100}%）。出さない理由: ${JSON.stringify(skips)}`,
    );
  const stale = [...throughs].filter((t) => t !== previousDay).sort();
  if (stale.length > 0)
    issues.push(
      `through が前日（${previousDay}）でない行がある: ${stale.join(", ")}`,
    );
  return {
    ok: issues.length === 0,
    issues,
    summary: {
      total,
      withValue,
      expectedSkips: expected,
      cancelled,
      coverage,
      skips,
      throughs: [...throughs].sort(),
    },
  };
}

/** 夜の表を読む（service_role） */
export async function readInCautionTable(client, previousDay) {
  const { data, error } = await client.rpc("get_in_caution_band_rates", {
    p_from: null,
    p_through: previousDay,
  });
  if (error)
    throw new Error(
      `get_in_caution_band_rates の呼び出しに失敗: ${error.message}`,
    );
  return data ?? [];
}

/**
 * 今日の unified の行（inCaution と inCautionSkip だけ）に、中止（confirmed かつ結果が無い）の印を付ける
 * @returns {Promise<Array<{race_id: string, ic: object|null, skip: string|null, cancelled: boolean}>>}
 */
export async function readInCautionToday(client, date) {
  const today = (q) => q.gte("race_id", date).lt("race_id", `${date}~`);
  const [preds, races, results] = await Promise.all([
    today(
      client
        .from("predictions")
        .select(
          "race_id, ic:feature_contributions->inCaution, skip:feature_contributions->>inCautionSkip",
        )
        .eq("model_id", "unified"),
    )
      .order("race_id")
      .range(0, 999), // 1日は最大 24会場×12R=288 行
    today(
      client
        .from("races")
        .select("race_id")
        .eq("cancellation_status", "confirmed"),
    ).range(0, 999),
    today(
      client.from("race_results").select("race_id").not("rank1", "is", null),
    ).range(0, 999),
  ]);
  for (const [label, r] of [
    ["今日の unified", preds],
    ["今日の中止", races],
    ["今日の結果", results],
  ])
    if (r.error)
      throw new Error(`${label}の読み取りに失敗: ${r.error.message}`);
  const withResult = new Set((results.data ?? []).map((r) => r.race_id));
  const cancelled = new Set(
    (races.data ?? [])
      .map((r) => r.race_id)
      .filter((id) => !withResult.has(id)),
  );
  return (preds.data ?? []).map((row) => ({
    ...row,
    cancelled: cancelled.has(row.race_id),
  }));
}

/**
 * api/cron/in-caution-health.js（target "table"、JST 04:30）と api/cron/in-caution-today-health.js（"today"、05:45）の run
 * @param {{client: object, now: () => Date}} ctx
 * @param {"table"|"today"} target
 */
export async function runInCautionHealth(ctx, target) {
  const now = ctx.now();
  const today = new Date(now.getTime() + 9 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  const previousDay = addDaysToDateString(today, -1);
  if (target !== "table" && target !== "today")
    throw new Error(`不明な監視の対象: ${target}`);
  const result =
    target === "table"
      ? evaluateInCautionTable(
          await readInCautionTable(ctx.client, previousDay),
          previousDay,
        )
      : evaluateInCautionToday(
          await readInCautionToday(ctx.client, today),
          previousDay,
        );
  const report = { target, date: today, ...result };
  if (!result.ok)
    return {
      outcome: "error",
      error: `イン崩れ注意度の監視（${target}）: ${result.issues.join(" / ")}`,
      report,
    };
  return { rowsWritten: 0, report, body: report };
}
