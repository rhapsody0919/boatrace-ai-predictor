import {
  observationPeriod,
  validateObservation,
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
            { ...row, window, ...period, observed_at: now },
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

export const mockObservationProvider = {
  async collect({ period }) {
    return [
      {
        ...period,
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
