/**
 * verify-motor-fresh-rate.js の検査の続き（大きさの関所のため、同じ検査を場面ごとの関数に分けた。verify ではない）。
 * 共通の道具・場面は ctx で受け取る。前の場面で作った物は ctx に足されて次へ渡る。
 */

export async function section1(ctx) {
  const {
    NONE,
    OFFICIAL_POSITIVE_DAY,
    OFFICIAL_ZERO_DAY,
    OWN12,
    RACE,
    VENUE,
    assert,
    freshTables,
    getRaceMotorFreshness,
    oldGenerationTables,
    queriesOn,
    rows3,
    setTables,
  } = ctx;
  // 3b-1. 入れ替えから90日以内・公式0と公式>0と公式なしが混在: 自前の値は「このレースより前」（90日）、前の節までの走数は
  //   節の初日（10/18）より前。公式0の艇も前の節までの走数は付けない。最初の節の確認は、公式0の艇があるので走る
  setTables(freshTables([], { official: OFFICIAL_POSITIVE_DAY }));
  {
    const rows = rows3(0, 40, null);
    const got = await getRaceMotorFreshness(RACE, VENUE, rows);
    assert.deepStrictEqual(got, {
      columns: [
        { ...NONE, generation_runs: 0 }, // 11号機: 0走（公式0）
        { ...OWN12, prior_meet_runs: 2 }, // 12号機: 公式>0 → 節の初日より前の2走
        { ...NONE, generation_runs: 0 }, // 13号機: 公式なし（null）は前の節の走数を付けない
      ],
      freshness: { generationStart: "2026-10-06", firstMeet: false },
      failed: false,
    });
    // 自前の値の期間の上限は、このレースの日（race_id < このレース）。前の節の走数の上限は節の初日（10/18）
    const raceQueries = queriesOn("races").map(
      (q) => q.filters.find(([op]) => op === "lte")[2],
    );
    assert.ok(
      raceQueries.includes("2026-10-20"),
      "このレースの日までのレースを読む",
    );
    assert.ok(
      raceQueries.includes("2026-10-18"),
      "節の初日までのレースを読む（前の節の走数）",
    );
    const confirm = queriesOn("race_entries").filter((q) =>
      q.filters.some(([op]) => op === "like"),
    );
    assert.equal(confirm.length, 1, "公式0の艇があるので最初の節の確認が走る");
    assert.deepStrictEqual(confirm[0].filters, [
      ["like", "race_id", "2026-10-20-03-__"],
      ["gt", "motor_2rate", 0],
    ]);
  }
  // 3b-2. その日の公式2連率が全行 0 なら最初の節。公式>0 の艇が無いので前の節の走数は付かない
  setTables(freshTables([], { official: OFFICIAL_ZERO_DAY }));
  {
    const got = await getRaceMotorFreshness(RACE, VENUE, rows3(0, 0, 0));
    assert.deepStrictEqual(got.freshness, {
      generationStart: "2026-10-06",
      firstMeet: true,
    });
    assert.deepStrictEqual(got.columns[1], { ...OWN12, prior_meet_runs: null });
    assert.equal(got.failed, false);
  }
  // 3b-3. 公式0の艇が無ければ、最初の節の確認はしない（公式の値が取れていない日を、何か月後でも最初の節と取り違えない）
  setTables(freshTables([], { official: [] }));
  {
    const got = await getRaceMotorFreshness(RACE, VENUE, rows3(40, 40, 50));
    assert.equal(got.freshness.firstMeet, false);
    assert.equal(
      queriesOn("race_entries").filter((q) =>
        q.filters.some(([op]) => op === "like"),
      ).length,
      0,
      "公式0の艇が無ければ確認しない",
    );
    assert.deepStrictEqual(
      got.columns[1],
      { ...OWN12, prior_meet_runs: 2 },
      "入れ替えから90日以内なら公式>0 の艇にも自前の値",
    );
  }
  // 3b-4. 入れ替えから90日を過ぎている: 公式0の艇があれば自前の値（90日分。艇ごと）を出すが、節の初日・最初の節は見ない
  setTables(oldGenerationTables());
}

export async function section2(ctx) {
  const {
    NONE,
    OFFICIAL_POSITIVE_DAY,
    OWN12,
    RACE,
    VENUE,
    assert,
    breakdownTables,
    failTables,
    freshTables,
    getRaceMotorFreshness,
    localStore,
    queriesOn,
    quiet,
    rows3,
    setTables,
  } = ctx;
  {
    const got = await getRaceMotorFreshness(RACE, VENUE, rows3(0, 40, 50));
    assert.deepStrictEqual(got, {
      columns: [
        { ...NONE, generation_runs: 0 },
        {
          generation_runs: 2,
          generation_rate2: 50,
          generation_rate3: 100,
          generation_power_index: 30, // ((100-20)+(0-20))/2
          prior_meet_runs: null,
        },
        { ...NONE, generation_runs: 0 },
      ],
      freshness: { generationStart: "2026-01-01", firstMeet: false },
      failed: false,
    });
    assert.equal(
      queriesOn("race_conditions").length,
      0,
      "90日を過ぎたら節の初日は見ない",
    );
    assert.equal(
      queriesOn("race_entries").filter((q) =>
        q.filters.some(([op]) => op === "like"),
      ).length,
      0,
      "90日を過ぎたら最初の節の確認はしない",
    );
  }
  // 3b-5. 公式0の艇が無く90日も過ぎている: 自前の値を取らない（問い合わせなし）
  setTables(freshTables([], { generationStart: "2026-01-01" }));
  {
    const got = await getRaceMotorFreshness(RACE, VENUE, rows3(40, 41, 42));
    assert.deepStrictEqual(got.columns, [NONE, NONE, NONE]);
    assert.equal(queriesOn("races").length, 0);
    assert.equal(queriesOn("race_conditions").length, 0);
  }
  // 3b-6. 世代が分からない会場・使用開始日より前のレース: 材料なし
  setTables(freshTables([]));
  for (const [venue, raceId] of [
    [5, "2026-10-20-05-07"], // 使用開始日の行が無い会場
    [VENUE, "2026-10-05-03-07"], // 使用開始日（10/06）より前
  ]) {
    const got = await getRaceMotorFreshness(raceId, venue, rows3(0, 40, null));
    assert.deepStrictEqual(got, {
      columns: [NONE, NONE, NONE],
      freshness: { generationStart: null, firstMeet: false },
      failed: false,
    });
  }
  // 3b-7. 材料の取得に失敗: failed を立てる（保存させない）。使用開始日が取れなければ材料なし、
  //   節の初日が取れなければ自前の値は出して前の節の走数だけ出さない
  setTables(freshTables([], { official: OFFICIAL_POSITIVE_DAY }));
  failTables.set("venue_motor_start_dates", {});
  {
    const got = await quiet(() =>
      getRaceMotorFreshness(RACE, VENUE, rows3(0, 40, null)),
    );
    assert.deepStrictEqual(got, {
      columns: [NONE, NONE, NONE],
      freshness: { generationStart: null, firstMeet: false },
      failed: true,
    });
  }
  setTables(freshTables([], { official: OFFICIAL_POSITIVE_DAY }));
  failTables.set("race_conditions", {});
  {
    const got = await quiet(() =>
      getRaceMotorFreshness(RACE, VENUE, rows3(0, 40, null)),
    );
    assert.equal(got.failed, true);
    assert.deepStrictEqual(got.columns[1], { ...OWN12, prior_meet_runs: null });
    assert.deepStrictEqual(got.freshness, {
      generationStart: "2026-10-06",
      firstMeet: false,
    });
  }
  // 3b-8. 一覧（getRaceMotorBreakdown）: 過去レースは出走表の公式値の行に自前の値を足し、材料が取れなければ保存しない。
  //   キャッシュの版を上げた: 自前の値の列が無い v10 の保存は読まない
  const staleKey = `boatai:race-motor-breakdown-v10-official-${VENUE}-90-${RACE}`;
  setTables(breakdownTables());
  localStore.set(
    staleKey,
    JSON.stringify({
      data: { rows: [{ stale: true }] },
      timestamp: Date.now(),
    }),
  );
}

export async function section3(ctx) {
  const {
    RACE,
    VENUE,
    assert,
    breakdownTables,
    check,
    failTables,
    getRaceMotorBreakdown,
    localStore,
    quiet,
    read,
    setTables,
  } = ctx;
  {
    const got = await getRaceMotorBreakdown(RACE, VENUE, 90);
    assert.deepStrictEqual(
      got.rows.map((r) => [
        r.boat_number,
        r.motor_number,
        r.rate_source,
        r.motor_2rate,
        r.generation_runs,
        r.prior_meet_runs,
      ]),
      [
        [1, 11, "official", 0, 0, null],
        [2, 12, "official", 40, 4, 2],
      ],
      "v10 の保存を読まず、公式値の行に自前の値を足す",
    );
    assert.deepStrictEqual(got.freshness, {
      generationStart: "2026-10-06",
      firstMeet: false,
    });
    assert.equal(got.fetchFailed, undefined);
    assert.ok(
      [...localStore.keys()].some(
        (k) =>
          k.startsWith("boatai:race-motor-breakdown-v") && !k.includes("-v10-"),
      ),
      "取れたら保存する",
    );
  }
  setTables(breakdownTables());
  failTables.set("race_conditions", {});
  {
    const got = await quiet(() => getRaceMotorBreakdown(RACE, VENUE, 90));
    assert.equal(got.fetchFailed, true);
    assert.deepStrictEqual(
      [...localStore.keys()].filter((k) =>
        k.startsWith("boatai:race-motor-breakdown-"),
      ),
      [],
      "材料が取れなかったら保存しない",
    );
  }
  check(
    "サービス（偽の supabase）: 自前の値・前の節の走数・最初の節の確認・取得失敗・キャッシュの版を、呼んだ結果と問い合わせで確認",
    true,
  );
  // ---- 4. 文言 ----
  const KEYS = [
    "freshNotRun",
    "freshZeroRuns",
    "freshOwnMark",
    "freshOwnExplain",
    "freshOwnExplainBoat",
    "freshOwnHint",
    "freshPriorRuns",
    "freshFirstMeetBanner",
    "officialModeSourceNoteFresh",
    "freshRate2Header",
  ];
  const BANNED = /数える|似た|似ている|ふつう|いつも|競艇|tally|tallied/i;
  for (const lang of ["ja", "en", "zh-TW", "ko"]) {
    const motor = JSON.parse(read(`src/locales/${lang}/common.json`)).analysis
      .motor;
    check(
      `${lang}: BOA-830 の文言キーが揃い、禁止語を使っていない`,
      KEYS.every((k) => typeof motor[k] === "string" && !BANNED.test(motor[k])),
    );
    check(
      `${lang}: 「集計前」の印のキーを消した`,
      motor.officialPendingBadge === undefined &&
        motor.officialPendingNote === undefined,
    );
  }
  const ja = JSON.parse(read("src/locales/ja/common.json")).analysis.motor;
  check(
    "ja: ユーザー決定の文言のまま",
    ja.freshNotRun === "まだ走っていません" &&
      ja.freshZeroRuns === "0%（{{n}}走）" &&
      ja.freshOwnExplain ===
        "公式の2連率がまだ出ていないモーターです。このレースより前の、この場での走り（{{n}}走）から出した2連率です" &&
      ja.freshPriorRuns === "前の節までの走り（{{n}}走）で出た数字" &&
      ja.freshRate2Header === "2連率（節時点）" &&
      ja.freshFirstMeetBanner ===
        "{{venue}}は{{month}}月{{day}}日にモーターが新しくなりました。公式の2連率は次の節から入ります。それまでは、龍神レーダーがこの場での走りから出した数字を出します",
  );
}
