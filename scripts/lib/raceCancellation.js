import { isCancellationConfirmed } from "./cancellationStatus.js";

/**
 * 指定のレースのうち、結果（race_results の行）が無く、まだ確定していないものを、中止・順延「確定」にする。
 * 呼び出し側が「発走90分超」を保証して渡す（GitHub Actionsは schedule から、Vercel Cron は発走時刻の範囲の
 * クエリから、result-catchup は当日の全レースから選ぶ）。
 *
 * 読み取りに失敗したら、書き込まずに例外にする（結果の有無が分からないまま「結果なし」とみなして、
 * 結果のあるレースまで中止にしてしまわないため）。
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {string[]} overdueIds
 * @param {{reason?: string}} [options] reason: ログに出す確定の根拠（既定は発走90分超・結果未取得。
 *   公式の告知による確定＝ race_status ジョブは、その旨を渡す）
 * @returns {Promise<{checked: number, confirmed: string[]}>}
 */
export async function confirmCancellationsForRaceIds(
  client,
  overdueIds,
  { reason = "発走90分超・結果未取得" } = {},
) {
  if (overdueIds.length === 0) return { checked: 0, confirmed: [] };

  const [results, races] = await Promise.all([
    client.from("race_results").select("race_id").in("race_id", overdueIds),
    client
      .from("races")
      .select("race_id, cancellation_status")
      .in("race_id", overdueIds),
  ]);
  if (results.error) {
    throw new Error(
      `中止・順延の確定: race_results の取得に失敗しました: ${results.error.message}`,
    );
  }
  if (races.error) {
    throw new Error(
      `中止・順延の確定: races の取得に失敗しました: ${races.error.message}`,
    );
  }

  const hasResult = new Set((results.data || []).map((r) => r.race_id));
  const alreadyConfirmed = new Set(
    (races.data || [])
      .filter((r) => isCancellationConfirmed(r.cancellation_status))
      .map((r) => r.race_id),
  );

  const toConfirm = overdueIds.filter(
    (id) => !hasResult.has(id) && !alreadyConfirmed.has(id),
  );
  if (toConfirm.length === 0) {
    return { checked: overdueIds.length, confirmed: [] };
  }

  const { error } = await client
    .from("races")
    .update({ cancellation_status: "confirmed" })
    .in("race_id", toConfirm);
  if (error) {
    throw new Error(
      `races (cancellation_status確定) 一括更新エラー: ${error.message}`,
    );
  }
  console.log(`  ⚠️ 中止・順延を確定: ${toConfirm.length}件（${reason}）`);
  return { checked: overdueIds.length, confirmed: toConfirm };
}
/**
 * 指定のレースのうち、結果（race_results の行。rank1 は NOT NULL）があるのに、中止・順延の暫定（tentative）・
 * 確定（confirmed）が付いているものを解除する（cancellation_status を NULL、cancellation_check_streak を 0 に戻す）。
 * 結果があるレースは開催済みで、中止の値は誤り（BOA-512: 2026-09-12 に、結果の読み取りの失敗で32本が誤って
 * confirmed になった。結果が先に入り、確定が後から付いたため、結果の書き込みの時点では解除できない。BOA-524）。
 *
 * 読み取りに失敗したら、書き込まずに例外にする（confirmCancellationsForRaceIds と同じ。読めなかった集合を空と
 * みなして判定を反転させない）。更新は、読んだ後に値が変わった行を巻き込まないよう、非NULL の行に限る。
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {string[]} raceIds
 * @returns {Promise<{checked: number, cleared: string[]}>}
 */
export async function clearCancellationsWithResults(client, raceIds) {
  if (raceIds.length === 0) return { checked: 0, cleared: [] };
  // .in() は GET の URL に race_id を並べるため、台風等で中止が数百件あっても URL 長の上限を超えないよう分ける
  const CHUNK = 200;
  const toClear = [];
  for (let i = 0; i < raceIds.length; i += CHUNK) {
    const ids = raceIds.slice(i, i + CHUNK);
    const [results, races] = await Promise.all([
      client.from("race_results").select("race_id").in("race_id", ids),
      client
        .from("races")
        .select("race_id, cancellation_status")
        .in("race_id", ids),
    ]);
    if (results.error) {
      throw new Error(
        `中止・順延の解除: race_results の取得に失敗しました: ${results.error.message}`,
      );
    }
    if (races.error) {
      throw new Error(
        `中止・順延の解除: races の取得に失敗しました: ${races.error.message}`,
      );
    }
    const hasResult = new Set((results.data ?? []).map((r) => r.race_id));
    toClear.push(
      ...(races.data ?? [])
        .filter(
          (r) => r.cancellation_status != null && hasResult.has(r.race_id),
        )
        .map((r) => r.race_id),
    );
  }
  if (toClear.length === 0) return { checked: raceIds.length, cleared: [] };

  for (let i = 0; i < toClear.length; i += CHUNK) {
    const { error } = await client
      .from("races")
      .update({ cancellation_status: null, cancellation_check_streak: 0 })
      .in("race_id", toClear.slice(i, i + CHUNK))
      .not("cancellation_status", "is", null);
    if (error) {
      throw new Error(
        `races (中止・順延の解除) 一括更新エラー: ${error.message}`,
      );
    }
  }
  console.log(
    `  ⚠️ 結果があるのに中止・順延だったレースを解除: ${toClear.length}件（${toClear.join(", ")}）`,
  );
  return { checked: raceIds.length, cleared: toClear };
}

/**
 * 期間（両端含む）の、中止・順延の暫定・確定が付いたレースを探し、結果があるものを解除する
 * （clearCancellationsWithResults）。結果の日次の catch-up が、対象日から遡って呼ぶ。
 * 中止・順延の付いたレースは期間あたり数十件のため、1回の読み取りで足りる（上限に達したら例外にして、黙って切り捨てない）。
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {{from: string, to: string}} range YYYY-MM-DD
 * @returns {Promise<{checked: number, cleared: string[]}>}
 */
export async function clearCancellationsWithResultsInRange(
  client,
  { from, to },
) {
  const LIMIT = 1000;
  const { data, error } = await client
    .from("races")
    .select("race_id")
    .gte("race_date", from)
    .lte("race_date", to)
    .not("cancellation_status", "is", null)
    .limit(LIMIT);
  if (error) {
    throw new Error(
      `中止・順延の解除: 対象レースの取得に失敗しました: ${error.message}`,
    );
  }
  if ((data ?? []).length >= LIMIT) {
    throw new Error(
      `中止・順延の解除: 中止・順延の付いたレースが${LIMIT}件以上あります（${from}〜${to}）。期間を狭めてください`,
    );
  }
  return clearCancellationsWithResults(
    client,
    (data ?? []).map((r) => r.race_id),
  );
}
