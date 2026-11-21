/**
 * verify-gha-skip-gate.js の後半の場面（1/6）。verify ではない。
 * 判定と期待値は分ける前の verify-gha-skip-gate.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

let jst,
  minutesAgo,
  show,
  row,
  throwingClient,
  mod,
  record,
  decide,
  skipOf,
  NOW,
  healthy,
  V;

async function gsg1Scene1() {
  // ---- (a) 変数が true でない → DB を読まず、常に実行 ----
  {
    const NOW = jst("2026-09-24 12:00");
    let ok = true;
    const seen = [];
    for (const value of [
      undefined,
      "",
      "false",
      "0",
      "no",
      "1",
      "yes",
      " ",
      "null",
    ]) {
      for (const varName of Object.keys(mod.GHA_SKIP_TARGETS)) {
        const client = throwingClient();
        const d = await mod.shouldSkipOnGha({
          varName,
          env: { [varName]: value },
          client,
          now: NOW,
          logger: null,
        });
        if (
          d.skip !== false ||
          client.calls.length !== 0 ||
          d.reason !== "flag_off"
        ) {
          ok = false;
          seen.push({
            varName,
            value,
            d: d.reason,
            calls: client.calls.length,
          });
        }
      }
    }
    record(
      "変数が未設定・空・false・0・no・1・yes 等: 全ての対象変数で、clientを呼ばず（DBを読まず）実行する（現行と同じ）",
      ok,
      show(seen.slice(0, 3)),
    );
    const client = throwingClient();
    const d = await mod.shouldSkipOnGha({
      varName: "SKIP_ODDS_ON_GHA",
      env: { SKIP_ODDS_ON_GHA: " True " },
      client,
      now: NOW,
      logger: null,
    });
    record(
      "変数は大文字小文字・前後の空白を無視して true と判定する（GitHubの式 vars.X == 'true' と同じ。true のときだけDBを読む）",
      client.calls.length === 1 &&
        d.reason === "read_failed" &&
        d.skip === true,
      show(d),
    );
    const d2 = await mod.shouldSkipOnGha({
      varName: "SKIP_ODDS_REFRESH_ON_GHA",
      env: { SKIP_ODDS_REFRESH_ON_GHA: "true" },
      client: throwingClient(),
      now: NOW,
      logger: null,
    });
    record(
      "対象外の変数（予測リフレッシュ SKIP_ODDS_REFRESH_ON_GHA）が判定に来たら: スキップ（肩代わりの条件を確かめられない。scrape-scheduled.js は静的な変数のまま扱い、このゲートを呼ばない）",
      d2.skip === true && d2.reason === "unsupported_var",
      show(d2),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（jst・minutesAgo・show・row・throwingClient・mod・record・decide・skipOf） */
export async function runGhaSkipGateScenes1(env) {
  ({ jst, minutesAgo, show, row, throwingClient, mod, record, decide, skipOf } =
    env);
  await gsg1Scene1();
}

/** 元の verify の1つの塊 { } を割った 1/3 */
async function gsg1Scene2() {
  const d0 = await decide(V, [healthy()], NOW);
  record(
    "オッズ: live・起動2分前・失敗0・ブレーカー行なし → スキップ（理由付き）",
    d0.skip === true &&
      /スキップ/.test(d0.message) &&
      /最終起動2分前/.test(d0.message),
    show(d0),
  );
  const rowsFor = (r, host) => (host ? [r, host] : [r]);
  // 肩代わりしない（スキップ）: mode が live 以外（どこからも取らない）、Vercel が起動している間の連続失敗（P0）
  const noTakeoverCases = [
    ["modeがshadow", healthy({ mode: "shadow" }), "mode_not_live"],
    ["modeがoff", healthy({ mode: "off" }), "mode_not_live"],
    ["modeが不正", healthy({ mode: null }), "mode_not_live"],
    [
      "連続失敗3回（起動は新しい）",
      healthy({ consecutive_failures: 3 }),
      "vercel_running",
    ],
    [
      "連続失敗が不正（null）",
      healthy({ consecutive_failures: null }),
      "vercel_running",
    ],
    [
      "連続失敗が不正（文字列）",
      healthy({ consecutive_failures: "2" }),
      "vercel_running",
    ],
    ["連続失敗が負", healthy({ consecutive_failures: -1 }), "vercel_running"],
    [
      "起動が5分後（時計のずれ）",
      healthy({ last_tick_at: minutesAgo(NOW, -5) }),
      "clock_skew",
    ],
  ];
  for (const [label, r, reason] of noTakeoverCases) {
    const d = await decide(V, rowsFor(r), NOW);
    record(
      `オッズ: ${label} → スキップ（肩代わりしない）`,
      d.skip === true && d.reason === reason,
      show(d),
    );
  }
  const cases = [
    [
      "起動が12分前（閾値ちょうど）",
      healthy({ last_tick_at: minutesAgo(NOW, 12) }),
      false,
    ],
    [
      "起動が30分前（Vercel Cron停止）",
      healthy({ last_tick_at: minutesAgo(NOW, 30) }),
      false,
    ],
    ["起動の記録なし", healthy({ last_tick_at: null }), false],
    ["起動の値が不正な文字列", healthy({ last_tick_at: "garbage" }), false],
  ];
  for (const [label, r, expected] of cases) {
    const d = await decide(V, rowsFor(r), NOW);
    record(
      `オッズ: ${label} → 実行（スキップしない）`,
      d.skip === expected && /実行/.test(d.message),
      show(d),
    );
  }
  const ok1 = await skipOf(
    V,
    [healthy({ last_tick_at: minutesAgo(NOW, 11) })],
    NOW,
  );
  const ok2 = await skipOf(V, [healthy({ consecutive_failures: 2 })], NOW);
  record(
    "オッズ: 起動11分前・連続失敗2回 → スキップ（起動の閾値の境界）",
    ok1 === true && ok2 === true,
  );
  const d1 = await skipOf(V, [], NOW);
  return { d1 };
}

/** 元の verify の1つの塊 { } を割った 2/3 */
async function gsg1Scene3({ d1 }) {
  record(
    "オッズ: ジョブ状態の行なし（空の応答） → スキップ（mode を確かめられない）",
    d1 === true,
  );
  const open = row("host:boatrace.jp", {
    breaker_open_until: minutesAgo(NOW, -20),
  });
  const past = row("host:boatrace.jp", {
    breaker_open_until: minutesAgo(NOW, 20),
  });
  const closed = row("host:boatrace.jp");
  const b1 = await decide(V, [healthy(), open], NOW);
  record(
    "オッズ: 取得先（host:boatrace.jp）のブレーカーが開いている → スキップ（GitHub の素の fetch で、過負荷・拒否の取得先を別の IP から叩かない。BOA-1145）",
    b1.skip === true && b1.reason === "breaker_open_no_takeover",
    show(b1),
  );
  record(
    "オッズ: ブレーカーが解除済み（期限が過去）・null → スキップ",
    (await skipOf(V, [healthy(), past], NOW)) === true &&
      (await skipOf(V, [healthy(), closed], NOW)) === true,
  );
  {
    // ホスト（429/503）のブレーカー: 連続失敗でも、Vercel が起動していない（tick_stale）ときも肩代わりしない（P0）
    const hostOpen = row("host:boatrace.jp", {
      breaker_open_until: minutesAgo(NOW, -20),
    });
    const h1 = await decide(
      V,
      [healthy({ consecutive_failures: 5 }), hostOpen],
      NOW,
    );
    const h2 = await decide(
      V,
      [healthy({ last_tick_at: minutesAgo(NOW, 30) }), hostOpen],
      NOW,
    );
    record(
      "オッズ: ホストのブレーカーが開いている間は、連続失敗5回でも、Vercel が起動していない（tick_stale）ときもスキップ（P0）",
      h1.skip === true &&
        h1.reason === "breaker_open_no_takeover" &&
        h2.skip === true &&
        h2.reason === "breaker_open_no_takeover",
      show([h1, h2]),
    );
  }
}

/** 元の verify の1つの塊 { } を割った 3/3 */
async function gsg1Scene4() {
  {
    // 403 のパスのブレーカー（BOA-1145）: 展示が live で連続失敗が閾値を超えていても、beforeinfo のパスの
    // ブレーカーが開いている間は、GitHub が beforeinfo を肩代わりで叩かない
    const EX = "SKIP_EXHIBITION_ON_GHA";
    const exRow = row("exhibition", {
      mode: "live",
      last_tick_at: minutesAgo(NOW, 1),
      consecutive_failures: 5,
    });
    const pathOpen = row("host:boatrace.jp/owpc/pc/race/beforeinfo", {
      breaker_open_until: minutesAgo(NOW, -30),
    });
    const e1 = await decide(EX, [exRow, pathOpen], NOW);
    const e2 = await decide(EX, [exRow], NOW);
    const e3 = await decide(
      EX,
      [{ ...exRow, last_tick_at: minutesAgo(NOW, 30) }, pathOpen],
      NOW,
    );
    record(
      "展示: 条件によらず肩代わりしない（spec §8 G2。beforeinfo の 403 は跡が残らず、パスのブレーカーが閉じると拒否の理由が消えるため）",
      [e1, e2, e3].every(
        (d) => d.skip === true && d.reason === "never_takeover",
      ) &&
        mod.NEVER_TAKEOVER_VARS.includes(EX) &&
        show(mod.jobKeysFor(EX)) ===
          show([
            "exhibition",
            "host:boatrace.jp",
            "host:boatrace.jp/owpc/pc/race/beforeinfo",
          ]),
      show([e1, e2, e3, mod.jobKeysFor(EX)]),
    );
    const e4 = await decide(
      EX,
      [
        {
          ...exRow,
          last_tick_at: minutesAgo(NOW, 30),
          consecutive_failures: 0,
        },
      ],
      NOW,
    );
    // ジョブ単位の判定でも、403 のパスのブレーカーは肩代わりを止める（変数の例外が外れても守る）
    const pathJudge = mod.evaluateJobHealth({
      job: "exhibition",
      rowsByJob: new Map([
        ["exhibition", { ...exRow, last_tick_at: minutesAgo(NOW, 30) }],
        ["host:boatrace.jp/owpc/pc/race/beforeinfo", pathOpen],
      ]),
      now: NOW,
    });
    record(
      "展示（ジョブ単位）: beforeinfo のパスのブレーカーが開いていれば、起動が古くても肩代わりしない",
      pathJudge.healthy === true &&
        pathJudge.reason === "breaker_open_no_takeover",
      show(pathJudge),
    );
    record(
      "展示（再現）: 起動が古く・ブレーカーが閉じ・失敗の跡が無くても → スキップ（修正前は肩代わりした）",
      e4.skip === true && e4.reason === "never_takeover",
      show(e4),
    );
  }
}

async function gsg1Scene5() {
  {
    const s1 = await gsg1Scene2();
    await gsg1Scene3(s1);
    await gsg1Scene4();
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（jst・minutesAgo・show・row・throwingClient・mod・record・decide・skipOf・NOW・healthy・V） */
export async function runGhaSkipGateScenes2(env) {
  ({
    jst,
    minutesAgo,
    show,
    row,
    throwingClient,
    mod,
    record,
    decide,
    skipOf,
    NOW,
    healthy,
    V,
  } = env);
  await gsg1Scene5();
}
