/**
 * verify-gha-skip-gate.js の後半の場面（5/6）。verify ではない。
 * 判定と期待値は分ける前の verify-gha-skip-gate.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

let jst, minutesAgo, show, row, fakeClient, throwingClient, mod, record;

/** 元の verify の1つの塊 { } を割った 1/2 */
async function gsg5Scene1() {
  const NOW = jst("2026-09-24 12:00");
  const V = "SKIP_ODDS_ON_GHA";
  const env = { [V]: "true" };
  const good = [row("odds", { last_tick_at: minutesAgo(NOW, 1) })];
  const d1 = await mod.shouldSkipOnGha({
    varName: V,
    env,
    client: {
      readJobStates: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    },
    now: NOW,
    logger: null,
  });
  record(
    "DBの読み取りが例外 → スキップ（理由付き。確かめられないときは叩かない）",
    d1.skip === true &&
      d1.reason === "read_failed" &&
      /ECONNREFUSED/.test(d1.message),
    show(d1),
  );
  const d2 = await mod.shouldSkipOnGha({
    varName: V,
    env,
    client: {
      readJobStates: () => {
        throw new Error("同期の例外");
      },
    },
    now: NOW,
    logger: null,
  });
  record(
    "DBの読み取りが同期的に例外 → スキップ",
    d2.skip === true && d2.reason === "read_failed",
    show(d2),
  );
  const started = Date.now();
  const d3 = await mod.shouldSkipOnGha({
    varName: V,
    env,
    client: { readJobStates: () => new Promise(() => {}) },
    now: NOW,
    logger: null,
    policy: { ...mod.GHA_SKIP_POLICY, readTimeoutMs: 50 },
  });
  record(
    "DBの読み取りが応答しない（タイムアウト） → スキップ（クライアントがタイムアウトを持たなくても待たされない）",
    d3.skip === true &&
      d3.reason === "read_failed" &&
      // 意図は「readTimeoutMs=50 が効いていて数十秒待たされない」ことの確認で、
      // 具体的な閾値は本質ではない。Quality Gates CI が並列度4で走らせるため、
      // 負荷の高いランナーでの誤検知を避けて余裕を持たせる（ADR-0072）
      Date.now() - started < 5000,
    show(d3),
  );
  for (const [label, rows] of [
    ["null", null],
    ["undefined", undefined],
    ["オブジェクト", { job: "odds" }],
    ["文字列", "ok"],
    [
      "配列の中身が不正（null・数値・jobなし）",
      [null, 1, {}, { mode: "live" }],
    ],
  ]) {
    const d = await mod.shouldSkipOnGha({
      varName: V,
      env,
      client: { readJobStates: async () => rows },
      now: NOW,
      logger: null,
    });
    record(`不正な応答（${label}） → スキップ`, d.skip === true, show(d));
  }
  return { NOW, V, env, good };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function gsg5Scene2({ NOW, V, env, good }) {
  const d4 = await mod.shouldSkipOnGha({
    varName: V,
    env,
    client: fakeClient(good),
    now: NOW,
    logger: null,
  });
  const d4b = await mod.shouldSkipOnGha({
    varName: V,
    env,
    client: fakeClient([row("odds", { last_tick_at: minutesAgo(NOW, 30) })]),
    now: NOW,
    logger: null,
  });
  record(
    "（対照）正しい応答: 起動が新しければスキップ、古ければ実行",
    d4.skip === true && d4b.skip === false,
  );
  const d5 = await mod.shouldSkipOnGha({
    varName: V,
    env: { [V]: "true" },
    now: NOW,
    logger: null,
  });
  record(
    "認証情報（SUPABASE_URL・SUPABASE_SERVICE_KEY）なし・client未指定 → スキップ（DBを読めない）",
    d5.skip === true && d5.reason === "no_credentials",
    show(d5),
  );
  const d6 = await mod.shouldSkipOnGha({
    varName: V,
    env: {
      [V]: "true",
      SUPABASE_URL: "not a url",
      SUPABASE_SERVICE_KEY: "k",
    },
    now: NOW,
    logger: null,
  });
  record(
    "SUPABASE_URL が不正 → スキップ（例外にしない）",
    d6.skip === true,
    show(d6),
  );
  // ログ
  const lines = [];
  await mod.shouldSkipOnGha({
    varName: V,
    env,
    client: fakeClient(good),
    now: NOW,
    logger: { log: (l) => lines.push(l) },
  });
  await mod.shouldSkipOnGha({
    varName: V,
    env,
    client: fakeClient([row("odds", { last_tick_at: minutesAgo(NOW, 30) })]),
    now: NOW,
    logger: { log: (l) => lines.push(l) },
  });
  record(
    "判定結果と理由をログに出す（スキップ: 肩代わりしない・最終起動N分前／実行: 理由）",
    lines.length === 2 &&
      /^\[gha-skip\] SKIP_ODDS_ON_GHA: スキップ: 肩代わりしない（odds: live・最終起動1分前/.test(
        lines[0],
      ) &&
      /^\[gha-skip\] SKIP_ODDS_ON_GHA: 実行: odds: 最終起動30分前/.test(
        lines[1],
      ),
    show(lines),
  );
}

async function gsg5Scene3() {
  {
    const s1 = await gsg5Scene1();
    await gsg5Scene2(s1);
  }
}

async function gsg5Scene4() {
  // ---- (g) 待機 ----
  {
    const V = "SKIP_POINT_RANK_ON_GHA";
    const env = { [V]: "true" };
    let now = jst("2026-09-24 22:01");
    let sleeps = 0;
    const clock = () => new Date(now);
    const sleep = async (ms) => {
      sleeps++;
      now = new Date(now.getTime() + ms);
    };
    // Vercel が 22:02:30 に処理を完了する
    const client = {
      async readJobStates() {
        return [
          row("point_rank", {
            last_target_date:
              now >= jst("2026-09-24 22:02") &&
              now.getTime() >= jst("2026-09-24 22:02").getTime() + 30000
                ? "2026-09-24"
                : "2026-09-23",
          }),
        ];
      },
    };
    const d1 = await mod.shouldSkipOnGhaWaiting(
      { varName: V, env, client, logger: null },
      { sleep, nowFn: clock },
    );
    record(
      "待機: 22:01に未処理 → 30秒おきに再判定し、Vercelが完了したらスキップ",
      d1.skip === true && sleeps >= 2 && sleeps <= 4,
      show({ d1: d1.reason, sleeps }),
    );
    now = jst("2026-09-24 22:01");
    sleeps = 0;
    const never = {
      async readJobStates() {
        return [row("point_rank", { last_target_date: "2026-09-23" })];
      },
    };
    const d2 = await mod.shouldSkipOnGhaWaiting(
      { varName: V, env, client: never, logger: null },
      { sleep, nowFn: clock },
    );
    record(
      "待機: 完了しなければ、指定時刻から10分で待機を打ち切り、実行（フェイルオーバー）。無限に待たない",
      d2.skip === false && sleeps >= 15 && sleeps <= 20,
      show({ d2: d2.reason, sleeps, at: now.toISOString() }),
    );
    sleeps = 0;
    const shadow = {
      async readJobStates() {
        return [row("point_rank", { mode: "shadow" })];
      },
    };
    const d3 = await mod.shouldSkipOnGhaWaiting(
      { varName: V, env, client: shadow, logger: null },
      { sleep, nowFn: clock },
    );
    record(
      "待機: mode=shadow → 待たずにスキップ（どこからも取らない）",
      d3.skip === true && sleeps === 0,
    );
    sleeps = 0;
    const d4 = await mod.shouldSkipOnGhaWaiting(
      {
        varName: V,
        env: { [V]: "false" },
        client: throwingClient(),
        logger: null,
      },
      { sleep, nowFn: clock },
    );
    record(
      "待機: 変数が false → 待たず・DBも読まず実行",
      d4.skip === false && sleeps === 0,
    );
    sleeps = 0;
    now = jst("2026-09-24 22:01");
    const d5 = await mod.shouldSkipOnGhaWaiting(
      { varName: V, env, client: never, logger: null },
      { sleep, nowFn: clock, maxPolls: 3 },
    );
    record(
      "待機: 再判定の回数に上限がある（maxPolls）",
      d5.skip === false && sleeps === 3,
      show({ sleeps }),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（jst・minutesAgo・show・row・fakeClient・throwingClient・mod・record） */
export async function runGhaSkipGateScenes6(env) {
  ({ jst, minutesAgo, show, row, fakeClient, throwingClient, mod, record } = env);
  await gsg5Scene3();
  await gsg5Scene4();
}
