import {
  observationPeriod,
  validateObservation,
  validateProviderObservation,
} from "../../src/utils/snsObservations.js";

/** 注入インターフェース: provider.collect({draft, window, period, observedAt}) -> 観測配列。
 * store.append(draftId, observation) は136のRPC等で履歴を追記する。認証・通信は実装しない。
 * 呼び出し側は保存済み窓を渡す。欠測の補完はcompletedから除いて明示再実行する。
 */
export async function collectDueObservations({
  drafts,
  provider,
  store,
  completed = new Set(),
  now = new Date().toISOString(),
}) {
  const results = [];
  for (const draft of drafts) {
    if (draft.status !== "posted" || !draft.posted_at) continue;
    for (const window of ["48h", "7d"]) {
      const period = observationPeriod(draft.posted_at, window);
      if (
        Date.parse(period.period_end) > Date.parse(now) ||
        completed.has(`${draft.id}/${window}`)
      )
        continue;
      try {
        const rows = await provider.collect({
          draft,
          window,
          period,
          observedAt: now,
        });
        if (!Array.isArray(rows) || !rows.length)
          throw new Error("収集結果がありません");
        // 全件を検査してから保存する。通信エラーは値を捏造せず結果へ返す。
        const validated = rows.map((row) =>
          validateObservation(
            normalizeProviderObservation(row, window, period, draft),
            draft,
          ),
        );
        for (const row of validated) await store.append(draft.id, row);
        results.push({ draft_id: draft.id, window, status: "saved" });
      } catch (error) {
        results.push({
          draft_id: draft.id,
          window,
          status: "failed",
          reason: error.message,
        });
      }
    }
  }
  return results;
}

// providerの実測メタデータを先に照合し、窓が違う値を欠測へ変換する。
function normalizeProviderObservation(row, window, period, draft) {
  // 欠測変換で値・曲線・理由等の入力違反を消す前に拒否する。
  validateProviderObservation({ ...row, window }, draft);
  // 不正な日時を有効な要求日時で補完しない。
  observationPeriod(row.period_start, window);
  observationPeriod(row.period_end, window);
  const mismatch =
    Date.parse(row.period_start) !== Date.parse(period.period_start) ||
    Date.parse(row.period_end) !== Date.parse(period.period_end);
  const lateSnapshot = row.measurement_kind === "snapshot" &&
    Date.parse(row.observed_at) !== Date.parse(period.period_end);
  const incomplete = Date.parse(row.data_through) !== Date.parse(period.period_end);
  if (mismatch || (row.metric_value !== null && (lateSnapshot || incomplete))) {
    return {
      ...row,
      window,
      ...period,
      metric_value: null,
      missing_reason: `providerの対象窓不一致・遅延: period_start=${row.period_start}, period_end=${row.period_end}, observed_at=${row.observed_at}, data_through=${row.data_through}`,
      curve: [],
    };
  }
  return { ...row, window };
}

export const mockObservationProvider = {
  async collect({ period, observedAt }) {
    return [
      {
        ...period,
        observed_at: observedAt,
        source: "mock",
        metric_name: "views",
        metric_value: null,
        missing_reason: "モック収集・外部API未接続",
        data_through: null,
        definition: "mock-v1",
        measurement_kind: "period",
        duration_seconds: null,
        external_post_id: null,
        curve: [],
      },
    ];
  },
};
