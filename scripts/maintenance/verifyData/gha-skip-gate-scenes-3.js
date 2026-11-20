/**
 * verify-gha-skip-gate.js の後半の場面（3/6）。verify ではない。
 * 判定と期待値は分ける前の verify-gha-skip-gate.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { SCRAPE_JOBS } from "../../lib/scrapeJobs/registry.js";

let jst, minutesAgo, show, row, record, mod, decide, skipOf;

/** 元の verify の1つの塊 { } を割った 1/4 */
async function gsg3Scene1() {
  const V = "SKIP_POINT_RANK_ON_GHA";
  const done = row("point_rank", { last_target_date: "2026-09-24" });
  const N1 = jst("2026-09-24 22:30");
  const d1 = await decide(V, [done], N1);
  record(
    "point_rank（22:00指定）: 22:30に当日(09-24)を処理済み → スキップ",
    d1.skip === true && /処理済み/.test(d1.message),
    show(d1),
  );
  const N2 = jst("2026-09-25 06:00");
  record(
    "point_rank: 翌朝06:00（対象日は09-24のまま）も、処理済みならスキップ",
    (await skipOf(V, [done], N2)) === true,
  );
  const prevOnly = row("point_rank", { last_target_date: "2026-09-23" });
  const d3 = await decide(V, [prevOnly], jst("2026-09-24 22:30"));
  record(
    "point_rank: 22:30に前日分(09-23)までしか処理していない → 実行（当日のVercelの失敗を救う）。指定時刻から30分経過のため待機の対象ではない",
    d3.skip === false &&
      d3.reason === "target_pending" &&
      d3.retryable === false,
    show(d3),
  );
  const d4 = await decide(V, [prevOnly], jst("2026-09-24 22:04"));
  record(
    "point_rank: 22:04に未処理 → 実行だが retryable（指定時刻の直後。Vercelの完了を待つ価値がある）",
    d4.skip === false && d4.retryable === true,
    show(d4),
  );
  const d5 = await decide(V, [prevOnly], jst("2026-09-24 22:10"));
  record(
    "point_rank: 22:10（待機の上限）で未処理 → retryable でなくなる",
    d5.retryable === false,
    show(d5),
  );
  const d6 = await decide(
    V,
    [row("point_rank", { mode: "shadow", last_target_date: "2026-09-24" })],
    N1,
  );
  record(
    "point_rank: mode=shadow → スキップ（どこからも取らない）",
    d6.skip === true && d6.reason === "mode_not_live",
    show(d6),
  );
  const d7 = await decide(V, [row("point_rank", { mode: "off" })], N1);
  record(
    "point_rank: mode=off → スキップ（どこからも取らない）",
    d7.skip === true && d7.reason === "mode_not_live",
  );
  const ranAt = jst("2026-09-24 22:00").toISOString();
  const d8 = await decide(
    V,
    [
      row("point_rank", {
        consecutive_failures: 3,
        last_target_date: "2026-09-23",
        last_tick_at: ranAt,
        updated_at: ranAt,
        last_error:
          "HTTP 403 for https://www.boatrace.jp/owpc/pc/extra/pointrank",
      }),
    ],
    jst("2026-09-24 22:30"),
  );
  return { V, N1, ranAt, d8 };
}

/** 元の verify の1つの塊 { } を割った 2/4 */
async function gsg3Scene2({ V, N1, ranAt, d8 }) {
  record(
    "point_rank（再現 P0）: 22:00 に Vercel が起動し、403 で連続失敗3回・未処理 → スキップ（GitHub の IP で叩き直さない）",
    d8.skip === true && d8.reason === "fetch_failure_no_takeover",
    show(d8),
  );
  const d8d = await decide(
    V,
    [
      row("point_rank", {
        consecutive_failures: 3,
        last_target_date: "2026-09-23",
        last_tick_at: ranAt,
        updated_at: ranAt,
        last_error: "point_rank の書き込みに失敗しました: permission denied",
      }),
    ],
    jst("2026-09-24 22:30"),
  );
  const d8e = await decide(
    V,
    [
      row("point_rank", {
        consecutive_failures: 1,
        last_target_date: "2026-09-23",
        last_tick_at: ranAt,
      }),
    ],
    jst("2026-09-24 22:30"),
  );
  const d8f = await decide(
    V,
    [
      row("point_rank", {
        consecutive_failures: 5,
        last_target_date: "2026-09-23",
        last_tick_at: ranAt,
        updated_at: jst("2026-09-23 23:30").toISOString(),
        last_error: "point_rank の書き込みに失敗しました: permission denied",
      }),
    ],
    jst("2026-09-24 22:30"),
  );
  const d8g = await decide(
    V,
    [
      row("point_rank", {
        consecutive_failures: 5,
        last_target_date: "2026-09-23",
        last_tick_at: jst("2026-09-23 23:30").toISOString(),
        updated_at: jst("2026-09-23 23:30").toISOString(),
        last_error: "HTTP 403",
      }),
    ],
    jst("2026-09-24 22:30"),
  );
  record(
    "point_rank: 前日の失敗（指定時刻より前）は、今日の daily_failures にも 403 の拒否にも数えない（今日の起動ありならスキップ、起動なしなら実行）",
    d8f.skip === true &&
      d8f.reason === "vercel_running" &&
      d8g.skip === false &&
      d8g.reason === "target_pending",
    show([d8f, d8g]),
  );
  record(
    "point_rank: Vercel が起動し、取得先と関係ない失敗（DB・コード）が3回 → 実行（日次の予備）。失敗1回ならまだ待つ（スキップ）",
    d8d.skip === false &&
      d8d.reason === "daily_failures" &&
      d8e.skip === true &&
      d8e.reason === "vercel_running",
    show([d8d, d8e]),
  );
  return { V, N1 };
}

/** 元の verify の1つの塊 { } を割った 3/4 */
async function gsg3Scene3({ V, N1 }) {
  const d8b = await decide(
    V,
    [
      row("point_rank", {
        consecutive_failures: 3,
        last_target_date: "2026-09-23",
        last_tick_at: jst("2026-09-23 22:00").toISOString(),
        last_error:
          "HTTP 403 for https://www.boatrace.jp/owpc/pc/extra/pointrank",
      }),
    ],
    jst("2026-09-24 22:30"),
  );
  record(
    "point_rank（再現 P0）: 当日の起動は無いが、直近の失敗が 403 → スキップ",
    d8b.skip === true && d8b.reason === "fetch_failure_no_takeover",
    show(d8b),
  );
  const d8c = await decide(
    V,
    [
      row("point_rank", {
        last_target_date: "2026-09-23",
        last_tick_at: jst("2026-09-23 22:00").toISOString(),
      }),
    ],
    jst("2026-09-24 22:30"),
  );
  record(
    "point_rank: 当日の起動が無い（最終起動が前日）・失敗なし → 実行（Vercel の停止の予備）",
    d8c.skip === false && d8c.reason === "target_pending",
    show(d8c),
  );
  const d9 = await decide(
    V,
    [row("point_rank", { last_target_date: "garbage" })],
    N1,
  );
  record(
    "point_rank: last_target_date が不正 → スキップ（確かめられない）",
    d9.skip === true && d9.reason === "invalid_value",
    show(d9),
  );
  const d10 = await decide(
    V,
    [row("point_rank", { last_target_date: null })],
    N1,
  );
  record(
    "point_rank: 未処理（last_target_date なし） → 実行",
    d10.skip === false,
  );
  const d11 = await decide(
    V,
    [
      row("point_rank", { last_target_date: "2026-09-23" }),
      row("host:boatrace.jp", {
        breaker_open_until: minutesAgo(jst("2026-09-24 22:04"), -10),
      }),
    ],
    jst("2026-09-24 22:04"),
  );
  record(
    "point_rank: 未処理でもブレーカーが開いている → スキップ（肩代わりしない。BOA-1145）",
    d11.skip === true && d11.reason === "breaker_open_no_takeover",
    show(d11),
  );
  const d12 = await decide(
    V,
    [row("point_rank", { last_target_date: "2026-09-25" })],
    N1,
  );
  record(
    "point_rank: last_target_date が対象日より新しい → スキップ（>=）",
    d12.skip === true,
  );
}

/** 元の verify の1つの塊 { } を割った 4/4 */
async function gsg3Scene4() {
  // 全ての日次変数が、対応するジョブの指定時刻で、当日分の処理済みでスキップする
  let allOk = true;
  const detail = [];
  for (const [varName, jobs] of Object.entries(mod.GHA_SKIP_TARGETS)) {
    for (const job of jobs) {
      const def = SCRAPE_JOBS[job];
      if (def.kind !== "daily") continue;
      const nowAt = jst(`2026-10-02 ${def.targetTimeJst}`);
      const later = new Date(nowAt.getTime() + 20 * 60000);
      const doneRow = row(job, { last_target_date: "2026-10-02" });
      const okRow =
        (await skipOf(
          varName,
          jobs.map((j) =>
            j === job
              ? doneRow
              : row(j, {
                  last_target_date: "2026-10-02",
                  last_tick_at: later.toISOString(),
                  last_success_at: later.toISOString(),
                }),
          ),
          later,
        )) === true;
      const ngRow =
        (await skipOf(
          varName,
          jobs.map((j) =>
            j === job
              ? row(job, { last_target_date: "2026-10-01" })
              : row(j, { last_target_date: "2026-10-02" }),
          ),
          later,
        )) === false;
      if (!okRow || !ngRow) {
        allOk = false;
        detail.push({ varName, job, okRow, ngRow });
      }
    }
  }
  record(
    "全ての日次ジョブ: 指定時刻の20分後、当日分の処理済みでスキップ・前日分までなら実行",
    allOk,
    show(detail),
  );
}

async function gsg3Scene5() {
  {
    const s1 = await gsg3Scene1();
    const s2 = await gsg3Scene2(s1);
    await gsg3Scene3(s2);
    await gsg3Scene4();
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（jst・minutesAgo・show・row・record・mod・decide・skipOf） */
export async function runGhaSkipGateScenes4(env) {
  ({ jst, minutesAgo, show, row, record, mod, decide, skipOf } = env);
  await gsg3Scene5();
}
