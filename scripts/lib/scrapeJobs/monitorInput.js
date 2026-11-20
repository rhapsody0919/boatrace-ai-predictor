import { toJstDateString } from "./time.js";
import { isScrapeSchemaMissingError } from "./schemaErrors.js";
import { EXPECTED_UNPUBLISHED } from "./expectedUnpublished.js";

// ---------------------------------------------------------------------------
// IO
// ---------------------------------------------------------------------------

const SLOT_COLUMNS =
  "job,race_id,offset_min,race_date,status,attempts,outcome,run_mode,first_attempt_at,last_attempt_at,done_at,last_error,races(start_time,cancellation_status)";
const PAGE = 1000;

/** ページ単位で全件を読む（Supabaseの既定の上限1000行）。エラーは例外にする（空＝正常と誤判定しない） */
async function fetchPaged(buildQuery, what) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) {
      const e = new Error(`${what}の読み取りに失敗しました: ${error.message}`);
      e.cause = error;
      throw e;
    }
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

const daysAgo = (now, days) =>
  toJstDateString(new Date(now.getTime() - days * 24 * 3600 * 1000));

/**
 * 監視に必要なデータを読む（読み取りのみ）。
 * level: "tick"（5分ごと。ジョブ状態・expired・当日のスロット）、"daily"（+直近7日。日次サマリー用）
 */
export async function collectMonitorInput(client, now, level) {
  const stateRes = await client.from("scrape_job_state").select("*");
  if (stateRes.error) {
    if (isScrapeSchemaMissingError(stateRes.error)) return { available: false };
    throw new Error(
      `ジョブ状態の読み取りに失敗しました: ${stateRes.error.message}`,
    );
  }
  const today = toJstDateString(now);
  const yesterday = daysAgo(now, 1);
  const slotQuery = (build) => () =>
    build(client.from("scrape_slots").select(SLOT_COLUMNS))
      .order("race_date")
      .order("job")
      .order("race_id")
      .order("offset_min");

  const expiredSlots = await fetchPaged(
    slotQuery((q) => q.eq("status", "expired").gte("race_date", yesterday)),
    "expiredのスロット",
  );
  const todaySlots = await fetchPaged(
    slotQuery((q) => q.eq("race_date", today)),
    "当日のスロット",
  );
  // 期限+許容幅を超えても、claim されず expired になっていないスロットの検知用
  const openSlots = await fetchPaged(
    slotQuery((q) =>
      q.in("status", ["pending", "running"]).gte("race_date", yesterday),
    ),
    "未完了のスロット",
  );
  const racesRes = await client
    .from("races")
    .select("race_id", { count: "exact", head: true })
    .eq("race_date", today);
  if (racesRes.error) {
    throw new Error(
      `当日のracesの件数の取得に失敗しました: ${racesRes.error.message}`,
    );
  }
  let weekSlots = null;
  if (level !== "tick") {
    weekSlots = await fetchPaged(
      slotQuery((q) =>
        q.in("status", ["done", "expired"]).gte("race_date", daysAgo(now, 6)),
      ),
      "直近7日のスロット",
    );
  }
  // 発売開始の遅れ（expectedUnpublished.js）の判定に要る、オッズの後続の窓（-30〜0）のスロット。
  // 候補（-60 の窓が、no_values で未完了、または、試行2回以上で完了＝延長で取得）が1件も無いときは、読まない
  // （5分ごとの実行の読み取りを増やさない）。判定は全レース（第1レースに限らない）で、racesの一覧は要らない
  const rule = EXPECTED_UNPUBLISHED;
  const hasCandidate = [
    ...expiredSlots,
    ...openSlots,
    ...todaySlots,
    ...(weekSlots ?? []),
  ].some(
    (s) =>
      s.job === rule.job &&
      s.offset_min === rule.offsetMin &&
      ((s.status !== "done" && s.outcome === rule.outcome) ||
        (s.status === "done" && (s.attempts ?? 0) >= 2)),
  );
  let oddsSlots = [];
  if (hasCandidate) {
    const from = level === "tick" ? yesterday : daysAgo(now, 6);
    oddsSlots = await fetchPaged(
      slotQuery((q) =>
        q
          .eq("job", rule.job)
          .gt("offset_min", rule.offsetMin)
          .gte("race_date", from),
      ),
      "オッズの後続の窓のスロット（発売開始の遅れの確認用）",
    );
  }
  return {
    available: true,
    jobStates: stateRes.data,
    expiredSlots,
    openSlots,
    todayRaceCount: racesRes.count ?? 0,
    todaySlots,
    weekSlots,
    oddsSlots,
  };
}
