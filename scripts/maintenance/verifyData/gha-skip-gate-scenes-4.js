/**
 * verify-gha-skip-gate.js の後半の場面（4/6）。verify ではない。
 * 判定と期待値は分ける前の verify-gha-skip-gate.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

let jst, minutesAgo, show, row, fakeClient, record, mod, decide;

/** 元の verify の1つの塊 { } を割った 1/3 */
async function gsg4Scene1() {
  const V = "SKIP_RACER_SEASON_ON_GHA";
  const N = jst("2026-10-02 04:00");
  const d1 = await decide(
    V,
    [
      row("racer_profiles", {
        last_tick_at: minutesAgo(N, 10),
        last_target_date: "2026-09-02",
      }),
    ],
    N,
  );
  record(
    "racer_profiles: 03:00以降に起動があり10分前 → 処理中としてスキップ",
    d1.skip === true && d1.reason === "vercel_running",
    show(d1),
  );
  const d2 = await decide(
    V,
    [
      row("racer_profiles", {
        last_tick_at: jst("2026-10-02 02:00").toISOString(),
        last_target_date: "2026-09-02",
      }),
    ],
    N,
  );
  record(
    "racer_profiles: 起動が指定時刻(03:00)より前（前月・前日の残り） → 実行",
    d2.skip === false && d2.reason === "target_pending",
    show(d2),
  );
  const d3 = await decide(
    V,
    [
      row("racer_profiles", {
        last_tick_at: minutesAgo(N, 50),
        last_target_date: "2026-09-02",
      }),
    ],
    N,
  );
  record(
    "racer_profiles: 03:10 に起動があり、その後止まっている → スキップ（当日 Vercel が動いた。P0）",
    d3.skip === true && d3.reason === "vercel_running",
    show(d3),
  );
  const d4 = await decide(
    V,
    [row("racer_profiles", { last_target_date: "2026-10-02" })],
    N,
  );
  record(
    "racer_profiles: 対象日を完了済み → スキップ",
    d4.skip === true && d4.reason === "daily_done",
    show(d4),
  );
  const d5 = await decide(
    V,
    [
      row("racer_profiles", {
        last_tick_at: minutesAgo(N, 10),
        updated_at: minutesAgo(N, 10),
        consecutive_failures: 3,
      }),
    ],
    N,
  );
  return { V, N, d5 };
}

/** 元の verify の1つの塊 { } を割った 2/3 */
async function gsg4Scene2({ V, N, d5 }) {
  const d5b = await decide(
    V,
    [
      row("racer_profiles", {
        last_tick_at: minutesAgo(N, 10),
        updated_at: minutesAgo(N, 10),
        consecutive_failures: 3,
        last_error:
          "取得に失敗しました（3回試行）: https://www.boatrace.jp/owpc/pc/data/racersearch/season — fetch failed",
      }),
    ],
    N,
  );
  record(
    "racer_profiles: 起動中で取得先と関係ない失敗3回 → 実行。接続の失敗3回 → スキップ（P0）",
    d5.skip === false &&
      d5.reason === "daily_failures" &&
      d5b.skip === true &&
      d5b.reason === "fetch_failure_no_takeover",
    show([d5, d5b]),
  );
  const d6 = await decide(
    V,
    [
      row("racer_profiles", { last_success_at: minutesAgo(N, 10) }),
      row("host:boatrace.jp", { breaker_open_until: minutesAgo(N, -10) }),
    ],
    N,
  );
  record(
    "racer_profiles: ブレーカーが開いている → スキップ（肩代わりしない。BOA-1145）",
    d6.skip === true,
    show(d6),
  );
  const d7 = await decide(
    V,
    [
      row("racer_profiles", {
        last_success_at: minutesAgo(N, 10),
        mode: "shadow",
      }),
    ],
    N,
  );
  record(
    "racer_profiles: shadow → スキップ（どこからも取らない）",
    d7.skip === true && d7.reason === "mode_not_live",
    show(d7),
  );
  // チャンクでない日次ジョブは、成功が新しくても、対象日が未処理なら実行
  const d8 = await decide(
    "SKIP_POINT_RANK_ON_GHA",
    [
      row("point_rank", {
        last_success_at: minutesAgo(jst("2026-09-24 22:30"), 5),
        last_target_date: "2026-09-23",
      }),
    ],
    jst("2026-09-24 22:30"),
  );
  record(
    "point_rank（チャンクでない）: 直近の成功があっても、対象日が未処理なら実行",
    d8.skip === false,
    show(d8),
  );
  const dPre = await decide(
    V,
    [
      row("racer_profiles", {
        last_success_at: minutesAgo(jst("2026-10-02 03:10"), 20),
        last_target_date: "2026-09-02",
      }),
    ],
    jst("2026-10-02 03:10"),
  );
  return { V, dPre };
}

/** 元の verify の1つの塊 { } を割った 3/3 */
async function gsg4Scene3({ V, dPre }) {
  record(
    "racer_profiles: 成功が02:50（指定時刻03:00の前。前回の処理の残り）で、20分前と新しくても → 実行（今回の対象日の処理とは認めない）",
    dPre.skip === false,
    show(dPre),
  );
  // 03:00 直後（Vercelの最初のチャンクが未完了）は retryable
  const d9 = await decide(
    V,
    [row("racer_profiles", { last_target_date: "2026-09-02" })],
    jst("2026-10-02 03:02"),
  );
  record(
    "racer_profiles: 03:02（最初のチャンクの完了前） → 実行だが retryable（待機の対象）",
    d9.skip === false && d9.retryable === true,
    show(d9),
  );
}

/** 元の verify の1つの塊 { } を割った 1/2 */
async function gsg4Scene4() {
  const V = "SKIP_RESULTS_ON_GHA";
  const NOW = jst("2026-09-24 12:00");
  const result = (o = {}) =>
    row("result", {
      last_tick_at: minutesAgo(NOW, 2),
      last_success_at: minutesAgo(NOW, 1),
      ...o,
    });
  const catchup = (o = {}) =>
    row("result_catchup", { last_target_date: "2026-09-23", ...o });
  const d1 = await decide(V, [result(), catchup()], NOW);
  record(
    "結果取得: result（live・起動新しい）と result_catchup（前夜23:50の対象日=09-23を処理済み）が健全 → スキップ",
    d1.skip === true &&
      /result:/.test(d1.message) &&
      /result_catchup:/.test(d1.message),
    show(d1),
  );
  const d2 = await decide(V, [result(), catchup({ mode: "shadow" })], NOW);
  record(
    "結果取得: result_catchup が shadow・result が起動中 → スキップ（どちらも肩代わりの条件を満たさない）",
    d2.skip === true,
    show(d2),
  );
  const d3 = await decide(
    V,
    [result({ last_tick_at: minutesAgo(NOW, 30) }), catchup()],
    NOW,
  );
  record(
    "結果取得: result の起動が古い → 実行（片方でも肩代わりの条件を満たせば実行）",
    d3.skip === false && d3.reason === "tick_stale",
    show(d3),
  );
  const d4 = await decide(
    V,
    [result(), catchup({ last_target_date: "2026-09-22" })],
    NOW,
  );
  record(
    "結果取得: result_catchup が前夜の対象日を処理していない → 実行",
    d4.skip === false && d4.reason === "target_pending",
    show(d4),
  );
  const d5 = await decide(V, [result()], NOW);
  record(
    "結果取得: result_catchup の行なし → スキップ（確かめられない）",
    d5.skip === true,
    show(d5),
  );
  const d6 = await decide(V, [catchup()], NOW);
  record("結果取得: result の行なし → スキップ", d6.skip === true);
  const vetoed = await decide(
    V,
    [
      result({
        last_error:
          "HTTP 403 for https://www.boatrace.jp/owpc/pc/race/raceresult",
        updated_at: minutesAgo(NOW, 2),
        consecutive_failures: 4,
      }),
      catchup({ last_target_date: "2026-09-22" }),
    ],
    NOW,
  );
  record(
    "結果取得（再現 P0）: result が 403 で止まっているなら、result_catchup が未処理でも変数ごとスキップ（raceresult を GitHub が叩かない）",
    vetoed.skip === true && vetoed.reason === "fetch_failure_no_takeover",
    show(vetoed),
  );
  return { V, NOW, result, catchup };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function gsg4Scene5({ V, NOW, result, catchup }) {
  const client = fakeClient([result(), catchup()]);
  await mod.shouldSkipOnGha({
    varName: V,
    env: { [V]: "true" },
    client,
    now: NOW,
    logger: null,
  });
  record(
    "結果取得: 読む行は、対象ジョブ（result・result_catchup）と取得先ホスト（host:boatrace.jp）だけ（1回の読み取り）",
    client.calls.length === 1 &&
      show(client.calls[0].slice().sort()) ===
        show(["host:boatrace.jp", "result", "result_catchup"]),
    show(client.calls),
  );
  const N23 = jst("2026-09-24 23:55");
  const d7 = await decide(
    V,
    [result({ last_tick_at: minutesAgo(N23, 2) }), catchup()],
    N23,
  );
  record(
    "結果取得: 23:55（result_catchup の指定時刻23:50を過ぎ、当日分は未処理） → 実行（retryable。日付が変わるまでの補足）",
    d7.skip === false && d7.retryable === true,
    show(d7),
  );
}

async function gsg4Scene6() {
  {
    const s1 = await gsg4Scene1();
    const s2 = await gsg4Scene2(s1);
    await gsg4Scene3(s2);
  }
  {
    const s1 = await gsg4Scene4();
    await gsg4Scene5(s1);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（jst・minutesAgo・show・row・fakeClient・record・mod・decide） */
export async function runGhaSkipGateScenes5(env) {
  ({ jst, minutesAgo, show, row, fakeClient, record, mod, decide } = env);
  await gsg4Scene6();
}
