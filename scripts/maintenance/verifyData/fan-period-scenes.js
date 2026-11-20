/**
 * verify-fan-period.js の一部の場面。大きさの関所のため、本文を字のまま移した。verify ではない。
 * check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

/** verify の元の 490〜630 行（2つに割った） */
export async function syncProfilesScenes({ cli, fakeClient, check, dir, o }) {
  const { fan } = await syncProfilesScenesPart1({ cli, fakeClient, check, dir, o });
  await syncProfilesScenesPart2({ cli, fakeClient, check, o, fan });
}

async function syncProfilesScenesPart1({ cli, fakeClient, check, dir, o }) {
  // sync-profiles
  const fan = cli.readParsedFan(dir, "fan2604");
  const profiles = fan.records.map((r) => ({
    racer_id: r.racer_id,
    ability_index: 999,
    flying_count_period: 99,
    false_start_count_period: 99,
    period_label: "2026-first",
    official_win_rate_period: 1,
    height_cm: 100,
    weight_kg: 100,
    branch: "旧",
    sex: null,
    training_term: null,
  }));
  const pdb = fakeClient({ racer_profiles: profiles });
  const noApply = await cli.cmdSyncProfiles(
    { ...o, id: "fan2604" },
    { client: pdb, log: () => {} },
  );
  check(
    "sync-profiles: --apply なしは更新しない",
    noApply === 0 && pdb.calls.updates.length === 0,
  );
  const applied = await cli.cmdSyncProfiles(
    { ...o, id: "fan2604", apply: true, sleepMs: 0 },
    { client: pdb, sleep: async () => {}, log: () => {} },
  );
  const r3955 = pdb.tables.racer_profiles.find((r) => r.racer_id === 3955);
  check(
    "sync-profiles --apply: 期別成績・身長体重・支部・性別・養成期を更新し、氏名等は触れない",
    applied === 0 &&
      r3955.ability_index === 49 &&
      r3955.flying_count_period === 0 &&
      r3955.period_label === "2026-second" &&
      r3955.official_win_rate_period === 4.84 &&
      r3955.height_cm === 161 &&
      r3955.branch === "徳島" &&
      r3955.sex === 1 &&
      r3955.training_term === 82 &&
      !("name" in r3955) &&
      !!r3955.official_updated_at,
    JSON.stringify(r3955),
  );
  const n1 = pdb.calls.updates.length;
  await cli.cmdSyncProfiles(
    { ...o, id: "fan2604", apply: true, sleepMs: 0 },
    { client: pdb, sleep: async () => {}, log: () => {} },
  );
  check(
    "sync-profiles --apply: 再実行は変更の無い選手を更新しない",
    pdb.calls.updates.length === n1,
    `${pdb.calls.updates.length} vs ${n1}`,
  );
  check(
    "sync-profiles: 出走0の選手の期別成績はNULL（B6と同じ）",
    pdb.tables.racer_profiles.find((r) => r.racer_id === 5472).ability_index ===
      null &&
      pdb.tables.racer_profiles.find((r) => r.racer_id === 5472)
        .period_label === null,
  );
  return { fan };
}

async function syncProfilesScenesPart2({ cli, fakeClient, check, o, fan }) {
  // より新しい期の値が入っている行は書き戻さない
  const newer = fakeClient({
    racer_profiles: fan.records.map((r) => ({
      racer_id: r.racer_id,
      ability_index: 55,
      flying_count_period: 0,
      false_start_count_period: 0,
      period_label: "2027-first",
      official_win_rate_period: 5,
      height_cm: 100,
      weight_kg: 100,
      branch: "旧",
      sex: null,
      training_term: null,
    })),
  });
  await cli.cmdSyncProfiles(
    { ...o, id: "fan2604", apply: true, sleepMs: 0 },
    { client: newer, sleep: async () => {}, log: () => {} },
  );
  check(
    "sync-profiles: より新しい期（2027-first）の行は、古い期の値で書き戻さない",
    newer.calls.updates.length === 0,
  );
  // 083未適用（sex・training_term が無い）でも、既存の列だけ更新する
  const old = fakeClient(
    {
      racer_profiles: fan.records.map((r) => ({
        racer_id: r.racer_id,
        ability_index: 1,
        flying_count_period: 9,
        false_start_count_period: 9,
        period_label: "2026-first",
        official_win_rate_period: 1,
        height_cm: 100,
        weight_kg: 100,
        branch: "旧",
      })),
    },
    { missing: new Set(["racer_profiles.sex"]) },
  );
  const codeOld = await cli.cmdSyncProfiles(
    { ...o, id: "fan2604", apply: true, sleepMs: 0 },
    { client: old, sleep: async () => {}, log: () => {} },
  );
  check(
    "sync-profiles: DDL 083 未適用（sex なし）でも、既存の列だけ更新し、新しい列は書かない",
    codeOld === 0 &&
      old.calls.updates.length > 0 &&
      old.calls.updates.every(
        (u) => !("sex" in u.values) && !("training_term" in u.values),
      ),
  );
  // racer_profiles に無い選手は作らない
  const partial = fakeClient({
    racer_profiles: [
      {
        racer_id: 3955,
        ability_index: 1,
        flying_count_period: 9,
        false_start_count_period: 9,
        period_label: "2026-first",
        official_win_rate_period: 1,
        height_cm: 100,
        weight_kg: 100,
        branch: "旧",
        sex: null,
        training_term: null,
      },
    ],
  });
  await cli.cmdSyncProfiles(
    { ...o, id: "fan2604", apply: true, sleepMs: 0 },
    { client: partial, sleep: async () => {}, log: () => {} },
  );
  check(
    "sync-profiles: racer_profiles に無い選手（新人）は新規作成しない",
    partial.tables.racer_profiles.length === 1 &&
      partial.calls.updates.length === 1,
  );
}

export async function loadScenes({ cli, fakeClient, check, o }) {
  // load: 既定は検証のみ
  const dry = fakeClient({});
  const codeDry = await cli.cmdLoad(o, { client: dry, log: () => {} });
  check(
    "load: --apply なしはDBに触れない（クライアントの呼び出し0回）",
    codeDry === 0 &&
      dry.calls.selects.length === 0 &&
      dry.calls.upserts.length === 0,
  );
  // --apply: 書き込み
  const db = fakeClient({});
  const codeApply = await cli.cmdLoad(
    { ...o, apply: true, sleepMs: 0 },
    { client: db, sleep: async () => {}, log: () => {} },
  );
  check(
    "load --apply: 12行を racer_period_stats へ書く",
    codeApply === 0 &&
      db.tables.racer_period_stats.length === 12 &&
      db.calls.upserts.reduce((a, u) => a + u.n, 0) === 12,
  );
  // 再実行: 投入済みはスキップ。--force でも変更なしの行は書かない
  const codeAgain = await cli.cmdLoad(
    { ...o, apply: true, sleepMs: 0 },
    { client: db, sleep: async () => {}, log: () => {} },
  );
  check(
    "load --apply: 再実行は投入済みでスキップ（書き込み増えず）",
    codeAgain === 0 && db.calls.upserts.length === 1,
  );
  const writesBefore = db.calls.upserts.length;
  await cli.cmdLoad(
    { ...o, apply: true, force: true, sleepMs: 0 },
    { client: db, sleep: async () => {}, log: () => {} },
  );
  check(
    "load --apply --force: 変更の無い行は書かない（WAL・Disk IO対策）",
    db.calls.upserts.length === writesBefore,
  );
  // 1行だけ値が変わったとき、その1行だけ書く
  db.tables.racer_period_stats.find((r) => r.racer_id === 3955).win_rate = 9.99;
  await cli.cmdLoad(
    { ...o, apply: true, force: true, sleepMs: 0 },
    { client: db, sleep: async () => {}, log: () => {} },
  );
  const last = db.calls.upserts.at(-1);
  check(
    "load --apply --force: 値が変わった1行だけを書き直す",
    last &&
      last.n === 1 &&
      db.tables.racer_period_stats.find((r) => r.racer_id === 3955).win_rate ===
        4.84,
    JSON.stringify(last),
  );
  // DDL未適用（テーブルが無い）→ 書かずに失敗
  const noTable = fakeClient({}, { missing: new Set(["racer_period_stats"]) });
  const codeNo = await cli.cmdLoad(
    { ...o, apply: true, force: true },
    { client: noTable, log: () => {} },
  );
  check(
    "load --apply: DDL 083 が未適用（テーブルなし）なら、書き込まず終了コード1",
    codeNo === 1 && noTable.calls.upserts.length === 0,
  );
}

export function evaluateScenes({ parserMod, rowsMod, check, same, fileBytes, evaluate }) {
  const results = evaluate(parserMod, rowsMod);
  for (const r of results) check(r.label, r.pass, r.detail);

  // 名前・ID・関数
  check(
    "レイアウト表の幅の合計が、レコード長（410・416）と一致する",
    parserMod.FAN_RECORD_BYTES_EXPECTED_NO_HOMETOWN ===
      parserMod.FAN_RECORD_BYTES_NO_HOMETOWN &&
      parserMod.FAN_RECORD_BYTES_NO_HOMETOWN + 6 === parserMod.FAN_RECORD_BYTES,
  );
  check(
    "fan{YYMM} の一覧: 2001-10〜2026-04 の50ファイル",
    parserMod.listFanIds("fan0110", "fan2604").length === 50 &&
      parserMod.listFanIds("fan0110", "fan2604")[1] === "fan0204",
  );
  check(
    "最新の期待ファイル: 2026-09 → fan2604、2026-11 → fan2610、2027-02 → fan2610",
    parserMod.latestExpectedFanId(new Date("2026-09-21T00:00:00Z")) ===
      "fan2604" &&
      parserMod.latestExpectedFanId(new Date("2026-11-03T00:00:00Z")) ===
        "fan2610" &&
      parserMod.latestExpectedFanId(new Date("2027-02-01T00:00:00Z")) ===
        "fan2610",
  );
  check(
    "URL: kibetsu/fan2604.lzh",
    parserMod.buildFanUrl("fan2604") ===
      "https://www.boatrace.jp/static_extra/pc_static/download/data/kibetsu/fan2604.lzh",
  );
  let threw = false;
  try {
    parserMod.parseFanId("fan2607");
  } catch {
    threw = true;
  }
  check("04・10 以外の月のファイル名は拒否する", threw);

  // 一意性・行の性質
  const fan = parserMod.parseFanFile(fileBytes("fan2604"), { id: "fan2604" });
  const { rows } = rowsMod.buildStatsRows(fan);
  check(
    "行: 主キー (racer_id, period_year, period_no) が一意",
    new Set(rows.map((r) => `${r.racer_id}|${r.period_year}|${r.period_no}`))
      .size === rows.length,
  );
  check(
    "行の列は STATS_COLUMNS と完全一致（135列）",
    rows.every((r) => same(Object.keys(r), rowsMod.STATS_COLUMNS)) &&
      rowsMod.STATS_COLUMNS.length === 135,
  );
  check(
    "回数は0を0のまま保持する（NULLにしない）: 出走0の選手の着回数",
    rows.find((r) => r.racer_id === 5472).c1_p1 === 0 &&
      rows.find((r) => r.racer_id === 5472).starts === 0,
  );
  const noNew = rowsMod.buildProfileSyncRows(fan, {
    includeNewColumns: false,
  }).rows;
  check(
    "反映行: 083未適用向けは sex・training_term を含まない",
    noNew.every((r) => !("sex" in r) && !("training_term" in r)),
  );
}

export async function parserRowsMutantScenes({ parserMod, rowsMod, parserMutants, rowsMutants, check, evaluate, withMutant }) {
  for (const [label, reps] of parserMutants) {
    const failed = await withMutant("fanPeriodParser.js", reps, async (mod) => {
      try {
        return evaluate(mod, rowsMod).filter((r) => !r.pass);
      } catch (e) {
        return [{ label: `例外: ${e.message}` }]; // 壊した版が例外で落ちるのも「検証が失敗した」とみなす
      }
    });
    check(
      `変異検証（パーサー）: ${label}`,
      failed.length > 0,
      "この変異を検知できない（検証が通ってしまう）",
    );
  }
  for (const [label, reps] of rowsMutants) {
    const failed = await withMutant("fanPeriodRows.js", reps, async (mod) => {
      try {
        return evaluate(parserMod, mod).filter((r) => !r.pass);
      } catch (e) {
        return [{ label: `例外: ${e.message}` }];
      }
    });
    check(
      `変異検証（行変換）: ${label}`,
      failed.length > 0,
      "この変異を検知できない（検証が通ってしまう）",
    );
  }
}
