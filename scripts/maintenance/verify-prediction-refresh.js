/**
 * verify-prediction-refresh.js - 予測リフレッシュ案1（BOA-353 T4b-03、plan.md §5）の検証。
 * DBにも取得先にも接続しない（インメモリの偽クライアントを使う）。
 *
 *   (a) トグル: REFRESH_ON_VERCEL・SKIP_ODDS_REFRESH_ON_GHA は、未設定・"true"以外ではoff（現行動作）
 *   (b) GitHub側: 既定はオッズ起点を含む（現行）。SKIP_ODDS_REFRESH_ON_GHA=true でオッズ起点だけ外れる
 *   (c) Vercel側（refreshAfterExhibition）: off なら mainRefresh を呼ばない。on で、変更を書いたレース
 *       のみを upsert 方式・対象日つきで呼ぶ。変更が無ければ呼ばない。失敗は投げない（展示の成否と分離）
 *   (d) mainRefresh の Vercel 対応: process.exit せず例外にする / 引数の日付が argv より優先 /
 *       Deploy Hook は decideDeployHook の抑制を維持 / race_id の一括取得が1000行の上限で欠けない
 *       （200レースを取得できる）/ 展示・気象の取得失敗は例外にする（予測を上書きしない）
 *   (e) 書き込み方式: replace は従来どおり削除→挿入（挿入失敗で予測が空になる）。upsert は削除も挿入もせず、
 *       失敗しても以前の予測が残り、行の内容は replace と同じ（的中フラグ等は null、predicted_at は現在時刻）
 *   (f) 展示取得（scrape-exhibition-data.js）が、実際に書き込んだレースを changedRaceIds で返す
 *   (g) 併走の排他: 案1の状態（GitHub は upsert・Vercel も upsert）で、同じレースを同時に再計算しても、
 *       予測が空にならず、書き込みが衝突して失敗しない。従来の replace 同士の併走では失敗しうる（現行の弱点）
 *
 * 実行: node scripts/maintenance/verify-prediction-refresh.js
 */
import {
  collectGhaRefreshRaceIds,
  isOddsRefreshSkippedOnGha,
  isRefreshOnVercelEnabled,
  refreshAfterExhibition,
} from "../lib/predictionRefresh.js";
import {
  mainRefresh as mainRefreshRaw,
  RACE_ID_CHUNK_SIZE,
} from "../daily/generate-predictions.js";
import { scrapeAndUpsertRaces } from "../daily/scrape-exhibition-data.js";

// 対象日を指定しない呼び出しは、実行日（JSTの今日）が対象になり、フィクスチャ（2026-09-20）と、日付が変わると食い違って
// 失敗していた（2026-09-21以降、master で11件失敗）。フィクスチャの日付を、既定の対象日として固定する
const FIXTURE_DATE = "2026-09-20";
const mainRefresh = (options = {}) =>
  mainRefreshRaw({ date: FIXTURE_DATE, ...options });

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    console.log(`✅ ${label}`);
  } else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}
const show = (v) => JSON.stringify(v);

// ---------------------------------------------------------------------------
// インメモリの偽クライアント（PostgREST の最小限の再現。1リクエストの上限行数も再現する）
// ---------------------------------------------------------------------------
function createFakeClient({ tables = {}, maxRows = 1000, fail = {} } = {}) {
  const state = Object.fromEntries(
    Object.entries(tables).map(([name, rows]) => [
      name,
      rows.map((row) => ({ ...row })),
    ]),
  );
  const calls = [];
  let nextId = 1;

  const matches = (row, filters) =>
    filters.every(([kind, column, value]) => {
      if (kind === "in") return value.includes(row[column]);
      if (kind === "eq") return row[column] === value;
      if (kind === "gte") return row[column] >= value;
      if (kind === "lt") return row[column] < value;
      if (kind === "like")
        return String(row[column]).startsWith(value.replace(/%$/, ""));
      if (kind === "not-null")
        return row[column] !== null && row[column] !== undefined;
      return true;
    });

  const execute = (q) => {
    const key = `${q.table}:${q.op}`;
    calls.push({
      table: q.table,
      op: q.op,
      filters: q.filters,
      rows: q.payload,
      opts: q.opts,
    });
    if (fail[key]) return { data: null, error: { message: fail[key] } };
    const rows = (state[q.table] ??= []);
    if (q.op === "select") {
      const found = rows.filter((row) => matches(row, q.filters));
      // PostgREST は、1リクエストで max_rows（既定1000）を超える行を返さない（エラーにもならない）
      return {
        data: found.slice(0, maxRows).map((row) => ({ ...row })),
        error: null,
      };
    }
    if (q.op === "delete") {
      state[q.table] = rows.filter((row) => !matches(row, q.filters));
      return { data: null, error: null };
    }
    if (q.op === "update") {
      for (const row of rows) {
        if (matches(row, q.filters)) Object.assign(row, q.payload);
      }
      return { data: null, error: null };
    }
    // insert / upsert: predictions の一意制約 (race_id, model_id) を再現する
    const uniqueKeys =
      q.table === "predictions" ? ["race_id", "model_id"] : null;
    const sameKey = (a, b) => uniqueKeys.every((k) => a[k] === b[k]);
    const batch = q.payload.map((row) => ({ ...row }));
    if (q.op === "insert") {
      if (
        uniqueKeys &&
        batch.some((row) => rows.some((existing) => sameKey(existing, row)))
      ) {
        // 1行でも一意制約に違反すると、バッチ全体が失敗する（PostgreSQL の1文の原子性）
        return {
          data: null,
          error: {
            message:
              'duplicate key value violates unique constraint "predictions_race_id_model_id_key"',
          },
        };
      }
      for (const row of batch) rows.push({ prediction_id: nextId++, ...row });
      return { data: null, error: null };
    }
    // upsert
    const keys = (q.opts?.onConflict ?? "").split(",").filter(Boolean);
    for (const row of batch) {
      const existing = keys.length
        ? rows.find((r) => keys.every((k) => r[k] === row[k]))
        : null;
      if (existing) Object.assign(existing, row);
      else rows.push({ prediction_id: nextId++, ...row });
    }
    return { data: null, error: null };
  };

  const from = (table) => {
    const q = { table, op: "select", filters: [], payload: null, opts: null };
    const builder = {
      select: () => builder,
      insert: (rows) => ((q.op = "insert"), (q.payload = rows), builder),
      upsert: (rows, opts) => (
        (q.op = "upsert"),
        (q.payload = rows),
        (q.opts = opts),
        builder
      ),
      update: (values) => ((q.op = "update"), (q.payload = values), builder),
      delete: () => ((q.op = "delete"), builder),
      in: (column, values) => (q.filters.push(["in", column, values]), builder),
      eq: (column, value) => (q.filters.push(["eq", column, value]), builder),
      gte: (column, value) => (q.filters.push(["gte", column, value]), builder),
      lt: (column, value) => (q.filters.push(["lt", column, value]), builder),
      like: (column, value) => (
        q.filters.push(["like", column, value]),
        builder
      ),
      not: (column, operator) => (
        operator === "is" && q.filters.push(["not-null", column]),
        builder
      ),
      order: () => builder,
      then: (resolve, reject) =>
        Promise.resolve(execute(q)).then(resolve, reject),
    };
    return builder;
  };
  return { from, state, calls };
}

// 会場コード1〜24 × レース1〜12 = 288通りのレースID（1日の最大規模を超える）
const raceIdsOf = (count, date = "2026-09-20") =>
  Array.from({ length: count }, (_, i) => {
    const venue = String(Math.floor(i / 12) + 1).padStart(2, "0");
    const race = String((i % 12) + 1).padStart(2, "0");
    return `${date}-${venue}-${race}`;
  });

function raceTables(raceIds, { withExhibition = true } = {}) {
  const grades = ["A1", "A2", "B1", "B1", "B2", "B1"];
  return {
    race_entries: raceIds.flatMap((race_id) =>
      grades.map((grade, i) => ({
        race_id,
        boat_number: i + 1,
        racer_id: `${4000 + i}`,
        player_name: `選手${i + 1}`,
        grade,
        age: 30 + i,
        win_rate: 6.5 - i * 0.5,
        global_2rate: 50 - i * 5,
        global_3rate: 65 - i * 5,
        local_win_rate: 6.0 - i * 0.4,
        local_2rate: 48 - i * 4,
        local_3rate: 62 - i * 4,
        motor_number: 10 + i,
        motor_2rate: 40 - i * 2,
        motor_3rate: 55 - i * 2,
        boat_number_id: 20 + i,
        boat_2rate: 38 - i * 2,
        boat_3rate: 52 - i * 2,
      })),
    ),
    race_conditions: raceIds.map((race_id) => ({
      race_id,
      weather: "晴",
      temperature: 22,
      wind_speed: 2,
      water_temperature: 21,
      wave_height: 3,
      race_title: "テスト戦",
    })),
    exhibition_data: withExhibition
      ? raceIds.flatMap((race_id) =>
          [1, 2, 3, 4, 5, 6].map((boat_number) => ({
            race_id,
            boat_number,
            exhibition_time: 6.7 + boat_number * 0.01,
            start_timing: 0.1 + boat_number * 0.01,
          })),
        )
      : [],
    races: raceIds.map((race_id) => ({ race_id, race_grade: "一般" })),
    venues: [],
    racer_aggregated_stats: [],
    predictions: [],
  };
}

const NOW = new Date("2026-09-20T03:03:00.000Z"); // 毎時の先頭5分以内（Deploy Hook の対象になりうる）
const NOW_LATE = new Date("2026-09-20T03:30:00.000Z"); // 毎時の先頭5分より後（抑制される）

/** コンソール出力を捨てながら fn を実行し、出力した行を返す */
async function quiet(fn) {
  const lines = [];
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  console.log = (...a) => lines.push(a.join(" "));
  console.warn = (...a) => lines.push(a.join(" "));
  console.error = (...a) => lines.push(a.join(" "));
  try {
    return { value: await fn(), lines };
  } catch (error) {
    return { error, lines };
  } finally {
    Object.assign(console, original);
  }
}

// ---------------------------------------------------------------------------
// (a) トグル
// ---------------------------------------------------------------------------
{
  const off = [undefined, "", "false", "FALSE", "1", "yes", "on", "truee"];
  check(
    "REFRESH_ON_VERCEL: 未設定・true以外はoff（現行動作）",
    off.every((v) => !isRefreshOnVercelEnabled({ REFRESH_ON_VERCEL: v })) &&
      !isRefreshOnVercelEnabled({}),
  );
  check(
    'REFRESH_ON_VERCEL: "true" でon（大文字小文字・前後の空白は許容）',
    ["true", "TRUE", " true "].every((v) =>
      isRefreshOnVercelEnabled({ REFRESH_ON_VERCEL: v }),
    ),
  );
  check(
    "SKIP_ODDS_REFRESH_ON_GHA: 未設定・true以外はoff（オッズ起点を外さない）、trueでon",
    off.every(
      (v) => !isOddsRefreshSkippedOnGha({ SKIP_ODDS_REFRESH_ON_GHA: v }),
    ) &&
      !isOddsRefreshSkippedOnGha({}) &&
      isOddsRefreshSkippedOnGha({ SKIP_ODDS_REFRESH_ON_GHA: "true" }),
  );
}

// ---------------------------------------------------------------------------
// (b) GitHub側の対象レースの集め方
// ---------------------------------------------------------------------------
{
  const input = {
    infoRaceIds: ["r1", "r2"],
    oddsRaceIds: ["r2", "r3", "r4"],
    exhibitionRaceIds: ["r5"],
  };
  const legacy = collectGhaRefreshRaceIds(input);
  check(
    "GitHub側（既定）: レース情報・オッズ・展示の起点を全て含む（現行動作と同じ）",
    show([...legacy].sort()) === show(["r1", "r2", "r3", "r4", "r5"]),
    show([...legacy]),
  );
  const skipped = collectGhaRefreshRaceIds({ ...input, skipOddsRefresh: true });
  check(
    "GitHub側（SKIP_ODDS_REFRESH_ON_GHA=true）: オッズ起点だけが外れ、レース情報・展示の起点は残る（オッズ起点のみのr3・r4が消え、r2はレース情報起点で残る）",
    show([...skipped].sort()) === show(["r1", "r2", "r5"]),
    show([...skipped]),
  );
  check(
    "GitHub側: 起点が空でもエラーにならない",
    collectGhaRefreshRaceIds({}).size === 0,
  );
}

// ---------------------------------------------------------------------------
// (c) Vercel側: 展示取得の後の再計算
// ---------------------------------------------------------------------------
{
  const silent = { log() {}, error() {} };
  const calls = [];
  const refresh = async (args) => {
    calls.push(args);
  };

  const off = await refreshAfterExhibition({
    result: { changedRaceIds: ["a", "b"] },
    date: "2026-09-20",
    refresh,
    env: {},
    logger: silent,
  });
  check(
    "Vercel側（REFRESH_ON_VERCEL 未設定）: mainRefresh を呼ばない（現行動作）",
    calls.length === 0 && off.refreshed === false,
    show({ calls, off }),
  );

  const on = await refreshAfterExhibition({
    result: { changedRaceIds: ["a", "b", "a"] },
    date: "2026-09-20",
    refresh,
    env: { REFRESH_ON_VERCEL: "true" },
    logger: silent,
  });
  check(
    "Vercel側（on）: 変更を書いたレース（重複除去）だけを、対象日・upsert方式・dry-runなしで1回呼ぶ",
    calls.length === 1 &&
      show(calls[0]) ===
        show({
          isDryRun: false,
          specificRaceIds: ["a", "b"],
          date: "2026-09-20",
          writeMode: "upsert",
        }) &&
      on.refreshed === true,
    show({ calls, on }),
  );

  const before = calls.length;
  for (const result of [
    { changedRaceIds: [] },
    {},
    null,
    undefined,
    { updated: true, count: 5 },
  ]) {
    await refreshAfterExhibition({
      result,
      date: "2026-09-20",
      refresh,
      env: { REFRESH_ON_VERCEL: "true" },
      logger: silent,
    });
  }
  check(
    "Vercel側（on）: 変更を書いたレースが無い（未公開・変更なし・戻り値なし）なら呼ばない",
    calls.length === before,
    `${calls.length - before}回呼ばれた`,
  );

  const failing = await refreshAfterExhibition({
    result: { changedRaceIds: ["a"] },
    date: "2026-09-20",
    refresh: async () => {
      throw new Error("DBが落ちている");
    },
    env: { REFRESH_ON_VERCEL: "true" },
    logger: silent,
  });
  check(
    "Vercel側（on）: 再計算の失敗は投げず、error として返す（展示データの取得・保存の成否と分離する）",
    failing.refreshed === false && failing.error === "DBが落ちている",
    show(failing),
  );
}

// ---------------------------------------------------------------------------
// (d) mainRefresh の Vercel 対応
// ---------------------------------------------------------------------------
{
  // process.exit を呼んだらテストが止まらないよう、例外に差し替えて検知する
  const realExit = process.exit;
  let exitCalled = false;
  process.exit = () => {
    exitCalled = true;
    throw new Error("process.exit が呼ばれた");
  };
  const noClient = await quiet(() =>
    mainRefresh({ isDryRun: false, specificRaceIds: ["x"], client: null }),
  );
  process.exit = realExit;
  check(
    "mainRefresh: Supabase未設定は process.exit ではなく例外（Vercel Function を落とさない）",
    !exitCalled &&
      noClient.error instanceof Error &&
      /Supabase環境変数が未設定/.test(noClient.error.message),
    noClient.error?.message,
  );

  const badMode = await quiet(() =>
    mainRefresh({
      isDryRun: false,
      specificRaceIds: ["x"],
      client: createFakeClient(),
      writeMode: "bogus",
    }),
  );
  check(
    "mainRefresh: 不正な writeMode は例外",
    badMode.error instanceof Error && /writeMode/.test(badMode.error.message),
  );

  // 対象日: 引数が argv より優先。引数が無ければ従来どおり argv の --date=
  const ids = raceIdsOf(2);
  const withDate = await quiet(() => {
    const savedArgv = process.argv;
    process.argv = [...savedArgv, "--date=1999-01-02"];
    return mainRefresh({
      isDryRun: true,
      specificRaceIds: ids,
      client: createFakeClient({ tables: raceTables(ids) }),
      date: "2026-09-20",
      now: () => NOW,
    }).finally(() => {
      process.argv = savedArgv;
    });
  });
  check(
    "mainRefresh: 引数の date が process.argv の --date= より優先される（Vercel では argv に日付が無い）",
    withDate.lines.some((l) => l.includes("対象日: 2026-09-20")),
    show(withDate.lines.filter((l) => l.includes("対象日"))),
  );
  const fromArgv = await quiet(() => {
    const savedArgv = process.argv;
    process.argv = [...savedArgv, "--date=1999-01-02"];
    // date を渡さない従来の呼び出しの検証なので、対象日を補うラッパではなく、元の関数を呼ぶ
    return mainRefreshRaw({
      isDryRun: true,
      specificRaceIds: ids,
      client: createFakeClient({ tables: raceTables(ids) }),
      now: () => NOW,
    }).finally(() => {
      process.argv = savedArgv;
    });
  });
  check(
    "mainRefresh: date を渡さない従来の呼び出しは、これまでどおり --date= 引数を読む（CLI・GitHub Actionsの動作は不変）",
    fromArgv.lines.some((l) => l.includes("対象日: 1999-01-02")),
    show(fromArgv.lines.filter((l) => l.includes("対象日"))),
  );

  // 200レース: race_id の .in() を1リクエストにまとめると、6行×166レースを超えた分が黙って欠ける
  const many = raceIdsOf(200);
  const fake = createFakeClient({ tables: raceTables(many) });
  const big = await quiet(() =>
    mainRefresh({
      isDryRun: false,
      specificRaceIds: many,
      client: fake,
      writeMode: "upsert",
      now: () => NOW,
    }),
  );
  const predicted = new Set(fake.state.predictions.map((p) => p.race_id));
  check(
    `mainRefresh: 200レースの再計算で、1000行の上限（約166レース）を超えても全レースの予測を書く（${RACE_ID_CHUNK_SIZE}件ずつ取得）`,
    !big.error &&
      predicted.size === 200 &&
      fake.state.predictions.length === 600,
    `${big.error?.message ?? ""} 予測のあるレース${predicted.size}件・${fake.state.predictions.length}行`,
  );
  const selectCalls = fake.calls.filter(
    (c) =>
      c.op === "select" &&
      ["race_entries", "exhibition_data", "race_conditions", "races"].includes(
        c.table,
      ) &&
      c.filters.some(([k, col]) => k === "in" && col === "race_id"),
  );
  const maxIds = Math.max(
    ...selectCalls.map((c) => c.filters.find(([k]) => k === "in")[2].length),
  );
  check(
    `mainRefresh: 取得は${RACE_ID_CHUNK_SIZE}レースずつに分割される（1リクエストの race_id は最大${maxIds}件、race_entries は${selectCalls.filter((c) => c.table === "race_entries").length}回）`,
    maxIds <= RACE_ID_CHUNK_SIZE &&
      selectCalls.filter((c) => c.table === "race_entries").length === 2,
  );

  // 展示・気象の取得失敗は例外にする（入力の欠けた予測で、良い予測を上書きしない）
  for (const table of ["exhibition_data", "race_conditions", "race_entries"]) {
    const ids2 = raceIdsOf(3);
    const failFake = createFakeClient({
      tables: {
        ...raceTables(ids2),
        predictions: ids2.flatMap((race_id) =>
          ["standard", "safeBet", "upsetFocus"].map((model_id) => ({
            race_id,
            model_id,
            top_pick: 1,
            is_shadow: false,
          })),
        ),
      },
      fail: { [`${table}:select`]: "statement timeout" },
    });
    const result = await quiet(() =>
      mainRefresh({
        isDryRun: false,
        specificRaceIds: ids2,
        client: failFake,
        writeMode: "upsert",
        now: () => NOW,
      }),
    );
    check(
      `mainRefresh: ${table} の取得に失敗したら例外にし、予測を書き換えない`,
      result.error instanceof Error &&
        failFake.calls.every(
          (c) => c.table !== "predictions" || c.op === "select",
        ) &&
        failFake.state.predictions.length === 9,
      result.error?.message,
    );
  }

  // Deploy Hook: decideDeployHook の抑制を維持する
  const realFetch = globalThis.fetch;
  const hookCalls = [];
  globalThis.fetch = async (url, init) => {
    hookCalls.push({ url, method: init?.method });
    return new Response("{}", { status: 200 });
  };
  const savedHook = process.env.VERCEL_DEPLOY_HOOK;
  const hookRun = async (now, hook) => {
    if (hook === undefined) delete process.env.VERCEL_DEPLOY_HOOK;
    else process.env.VERCEL_DEPLOY_HOOK = hook;
    hookCalls.length = 0;
    const ids3 = raceIdsOf(2);
    await quiet(() =>
      mainRefresh({
        isDryRun: false,
        specificRaceIds: ids3,
        client: createFakeClient({ tables: raceTables(ids3) }),
        writeMode: "upsert",
        now: () => now,
      }),
    );
    return hookCalls.length;
  };
  const inWindow = await hookRun(NOW, "https://hooks.example.invalid/x");
  const outWindow = await hookRun(NOW_LATE, "https://hooks.example.invalid/x");
  const noHook = await hookRun(NOW, undefined);
  globalThis.fetch = realFetch;
  if (savedHook === undefined) delete process.env.VERCEL_DEPLOY_HOOK;
  else process.env.VERCEL_DEPLOY_HOOK = savedHook;
  check(
    "mainRefresh: Deploy Hook は、毎時の先頭5分以内の実行だけ叩く（BOA-361の抑制を維持）。窓の外・環境変数なしでは叩かない",
    inWindow === 1 && outWindow === 0 && noHook === 0,
    `窓内${inWindow}回・窓外${outWindow}回・未設定${noHook}回`,
  );
}

// ---------------------------------------------------------------------------
// (e) 書き込み方式（replace / upsert）
// ---------------------------------------------------------------------------
{
  const ids = raceIdsOf(3);
  const existing = ids.flatMap((race_id) =>
    ["standard", "safeBet", "upsetFocus"].map((model_id) => ({
      race_id,
      model_id,
      top_pick: 6, // 再計算後の値（1〜）と区別できる古い値
      is_shadow: false,
      is_hit_win: true,
      payout_win: 500,
      scores: { old: true },
    })),
  );
  const build = (fail = {}) =>
    createFakeClient({
      tables: { ...raceTables(ids), predictions: existing },
      fail,
    });

  // replace（既定）: 従来どおり削除→挿入
  const replaceFake = build();
  const replaceRun = await quiet(() =>
    mainRefresh({
      isDryRun: false,
      specificRaceIds: ids,
      client: replaceFake,
      now: () => NOW,
    }),
  );
  const predOps = replaceFake.calls
    .filter((c) => c.table === "predictions" && c.op !== "select")
    .map((c) => c.op);
  check(
    "replace（既定）: 従来どおり、削除→挿入の順（upsert は使わない）",
    show(predOps) === show(["delete", "insert"]) && !replaceRun.error,
    show(predOps),
  );
  const deleteCall = replaceFake.calls.find(
    (c) => c.table === "predictions" && c.op === "delete",
  );
  check(
    "replace: 削除は対象レースの is_shadow=false のみ（従来と同じ条件）",
    show(deleteCall.filters) ===
      show([
        ["in", "race_id", ids],
        ["eq", "is_shadow", false],
      ]),
    show(deleteCall.filters),
  );
  check(
    "replace: 戻り値は { predictedRaceIds, volatilityUpdated, writeMode }（従来の呼び出し元は戻り値を使わない）",
    show(replaceRun.value?.predictedRaceIds) === show(ids) &&
      replaceRun.value?.writeMode === "replace",
    show(replaceRun.value),
  );

  // replace で挿入が失敗すると、予測が空になる（現行の弱点。upsert が解消する対象）
  const replaceBroken = build({ "predictions:insert": "connection reset" });
  await quiet(() =>
    mainRefresh({
      isDryRun: false,
      specificRaceIds: ids,
      client: replaceBroken,
      now: () => NOW,
    }),
  );
  check(
    "replace（現行の弱点の記録）: 挿入が失敗すると、削除済みのため対象レースの予測が空になり、例外にもならない",
    replaceBroken.state.predictions.length === 0,
    `${replaceBroken.state.predictions.length}行`,
  );

  // upsert: 削除も挿入もしない。1文の upsert（一意制約 race_id,model_id）
  const upsertFake = build();
  const upsertRun = await quiet(() =>
    mainRefresh({
      isDryRun: false,
      specificRaceIds: ids,
      client: upsertFake,
      writeMode: "upsert",
      now: () => NOW,
    }),
  );
  const upsertOps = upsertFake.calls.filter(
    (c) => c.table === "predictions" && c.op !== "select",
  );
  check(
    "upsert: predictions への書き込みは upsert の1回のみ（削除・挿入をしない）で、競合キーは race_id,model_id",
    upsertOps.length === 1 &&
      upsertOps[0].op === "upsert" &&
      upsertOps[0].opts?.onConflict === "race_id,model_id" &&
      !upsertRun.error,
    show(upsertOps.map((c) => [c.op, c.opts])),
  );
  const afterUpsert = upsertFake.state.predictions;
  check(
    "upsert: 行数は増えず（3レース×3モデル=9行のまま）、全て再計算後の値に更新される",
    afterUpsert.length === 9 && afterUpsert.every((p) => p.top_pick !== 6),
    `${afterUpsert.length}行`,
  );
  const sample = afterUpsert[0];
  check(
    "upsert: 行の内容は replace（削除→挿入）と同じ。的中フラグ・払戻・scores は null に戻り、predicted_at は現在時刻、is_shadow は false",
    sample.is_hit_win === null &&
      sample.payout_win === null &&
      sample.scores === null &&
      sample.is_shadow === false &&
      sample.predicted_at === NOW.toISOString(),
    show(sample),
  );
  const replaceKeys = Object.keys(
    replaceFake.state.predictions[0] ?? {},
  ).filter((k) => k !== "prediction_id");
  check(
    "upsert: 書き込む列の集合は、replace（挿入）が書く列を全て含む（挿入で null/DEFAULT になる列が、古い値のまま残らない）",
    replaceKeys.every((k) => k in sample),
    show(replaceKeys.filter((k) => !(k in sample))),
  );

  // upsert で失敗しても、以前の予測が残る（例外にする）
  const upsertBroken = build({ "predictions:upsert": "connection reset" });
  const broken = await quiet(() =>
    mainRefresh({
      isDryRun: false,
      specificRaceIds: ids,
      client: upsertBroken,
      writeMode: "upsert",
      now: () => NOW,
    }),
  );
  check(
    "upsert: 書き込みに失敗したら例外にし、以前の予測（9行・古い値）は残る（予測が空にならない）",
    broken.error instanceof Error &&
      /predictions書き込みエラー/.test(broken.error.message) &&
      upsertBroken.state.predictions.length === 9 &&
      upsertBroken.state.predictions.every((p) => p.top_pick === 6),
    `${broken.error?.message} / ${upsertBroken.state.predictions.length}行`,
  );

  // races の volatility 更新は、変更のあるレースのみ（WS8(b)）。2回目は、値が同じなら書かない
  const twice = build();
  await quiet(() =>
    mainRefresh({
      isDryRun: false,
      specificRaceIds: ids,
      client: twice,
      writeMode: "upsert",
      now: () => NOW,
    }),
  );
  const firstUpdates = twice.calls.filter(
    (c) => c.table === "races" && c.op === "update",
  ).length;
  await quiet(() =>
    mainRefresh({
      isDryRun: false,
      specificRaceIds: ids,
      client: twice,
      writeMode: "upsert",
      now: () => NOW,
    }),
  );
  const secondUpdates =
    twice.calls.filter((c) => c.table === "races" && c.op === "update").length -
    firstUpdates;
  check(
    "races の volatility 更新は、1回目は変更のある3レース、値が同じ2回目は0件（変更の無い行は書かない）",
    firstUpdates === 3 && secondUpdates === 0,
    `${firstUpdates}件・${secondUpdates}件`,
  );
}

// ---------------------------------------------------------------------------
// (e2) unified の行: replace は削除してしまう（副作用）。upsert は触らない
//      unified は、朝の日次バッチ（generate-unified-predictions.js）が書く model_id='unified'（is_shadow=false）。
//      replace は is_shadow=false の全モデルを削除するため、再計算のたびに unified が消え、次の GitHub Actions
//      の実行（morning-init.js の ensureUnifiedPredictions）が「unified が欠けたレースがある」ことを検知して
//      日全体を再生成している。この再生成の起点は、削除の副作用による（設計上は朝の日次バッチ）。
// ---------------------------------------------------------------------------
{
  const ids = raceIdsOf(2);
  const unified = ids.map((race_id) => ({
    race_id,
    model_id: "unified",
    top_pick: 9,
    is_shadow: false,
    feature_contributions: { placeRecommendation: "morning" },
  }));
  const build = () =>
    createFakeClient({
      tables: {
        ...raceTables(ids),
        predictions: unified.map((r) => ({ ...r })),
      },
    });
  const unifiedOf = (fake) =>
    fake.state.predictions.filter((p) => p.model_id === "unified");

  const replaceFake = build();
  await quiet(() =>
    mainRefresh({
      isDryRun: false,
      specificRaceIds: ids,
      client: replaceFake,
      now: () => NOW,
    }),
  );
  check(
    "replace（現行の副作用の記録）: is_shadow=false の全モデルを削除するため、unified の行も消える（次の GitHub Actions の ensureUnifiedPredictions が再生成する）",
    unifiedOf(replaceFake).length === 0,
    `${unifiedOf(replaceFake).length}行`,
  );

  const upsertFake = build();
  await quiet(() =>
    mainRefresh({
      isDryRun: false,
      specificRaceIds: ids,
      client: upsertFake,
      writeMode: "upsert",
      now: () => NOW,
    }),
  );
  check(
    "upsert: unified の行は削除も更新もしない（朝の日次バッチの値のまま残る）。standard・safeBet・upsetFocus だけを書く",
    unifiedOf(upsertFake).length === 2 &&
      unifiedOf(upsertFake).every(
        (p) =>
          p.top_pick === 9 &&
          p.feature_contributions?.placeRecommendation === "morning",
      ) &&
      upsertFake.state.predictions.length === 8,
    `${upsertFake.state.predictions.length}行`,
  );
}

// ---------------------------------------------------------------------------
// (f) 展示取得（scrapeAndUpsertRaces）が、実際に書き込んだレースを changedRaceIds で返す
//     公式ページの代わりに、合成した beforeinfo の HTML を fetch で返し、偽クライアントに書き込む
// ---------------------------------------------------------------------------
{
  const fs = await import("node:fs");
  const weatherBlock = fs
    .readFileSync(
      new URL(
        "../lib/__fixtures__/weather/beforeinfo-05-01-1634.html",
        import.meta.url,
      ),
      "utf8",
    )
    .replace(/<!--[\s\S]*?-->/g, "");
  // .table1 の2つ目に、6艇分の tbody（1艇4行）。展示タイムは第5セル（index 4）
  const beforeinfoHtml = (times) => `<html><body>
    <div class="table1"><table></table></div>
    <div class="table1"><table>${times
      .map(
        (t, i) =>
          `<tbody><tr><td>${i + 1}</td><td></td><td></td><td>52.0kg</td><td>${t}</td><td>-0.5</td><td></td><td><ul></ul></td><td>R</td><td>3</td></tr><tr></tr><tr></tr><tr></tr></tbody>`,
      )
      .join("")}</table></div>
    ${weatherBlock}</body></html>`;

  const raceIds = ["2026-09-19-05-01", "2026-09-19-05-02"];
  const targets = raceIds.map((race_id, i) => ({
    race_id,
    venue_code: 5,
    race_no: i + 1,
    start_time: new Date("2026-09-19T08:00:00.000Z"),
  }));
  // レースごとの展示タイム（1つ目のレースだけ、あとで変える）
  const timesOf = {
    1: [6.71, 6.72, 6.73, 6.74, 6.75, 6.76],
    2: [6.8, 6.81, 6.82, 6.83, 6.84, 6.85],
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const raceNo = Number(new URL(url).searchParams.get("rno"));
    return new Response(beforeinfoHtml(timesOf[raceNo]), { status: 200 });
  };
  const runScrape = async (client) =>
    (
      await quiet(() =>
        scrapeAndUpsertRaces(targets, "2026-09-19", {
          updateWeather: true,
          client,
        }),
      )
    ).value;

  try {
    const fake = createFakeClient({
      tables: { exhibition_data: [], race_conditions: [] },
    });
    const first = await runScrape(fake);
    check(
      "展示取得: 初回は、書き込んだ2レース（exhibition_data・気象）を changedRaceIds で返す",
      first?.updated === true &&
        show([...first.changedRaceIds].sort()) === show(raceIds),
      show(first?.changedRaceIds),
    );
    check(
      "展示取得: exhibition_data に12行（2レース×6艇）、race_conditions に2行が書かれる",
      fake.state.exhibition_data.length === 12 &&
        fake.state.race_conditions.length === 2,
      `${fake.state.exhibition_data.length}行・${fake.state.race_conditions.length}行`,
    );

    const second = await runScrape(fake);
    check(
      "展示取得: 同じ内容の2回目は、updated=true（取得した行はある）でも、変更を書いていないため changedRaceIds は空（再計算しない）",
      second?.updated === true &&
        second.count === 12 &&
        show(second.changedRaceIds) === show([]),
      show({ updated: second?.updated, changed: second?.changedRaceIds }),
    );

    timesOf[1] = [6.71, 6.72, 6.73, 6.74, 6.75, 6.99]; // 1つ目のレースの1艇だけ変わる
    const third = await runScrape(fake);
    check(
      "展示取得: 値が変わったレースだけが changedRaceIds に入る（1つ目のみ）",
      show(third?.changedRaceIds) === show([raceIds[0]]),
      show(third?.changedRaceIds),
    );

    const failFake = createFakeClient({
      tables: { exhibition_data: [], race_conditions: [] },
      fail: { "exhibition_data:upsert": "connection reset" },
    });
    const failed = await runScrape(failFake);
    check(
      "展示取得: exhibition_data の書き込みが失敗したら、そのレースは changedRaceIds に入れない（気象を書けたレースのみ入る）",
      show([...(failed?.changedRaceIds ?? [])].sort()) === show(raceIds) &&
        failFake.state.exhibition_data.length === 0,
      "気象は書けるため、気象の変更で2レースが入る",
    );
    const bothFail = createFakeClient({
      tables: { exhibition_data: [], race_conditions: [] },
      fail: {
        "exhibition_data:upsert": "connection reset",
        "race_conditions:upsert": "connection reset",
      },
    });
    const none = await runScrape(bothFail);
    check(
      "展示取得: 展示・気象とも書き込めなかったら、changedRaceIds は空（DBが変わっていないので再計算しない）",
      show(none?.changedRaceIds) === show([]),
      show(none?.changedRaceIds),
    );
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ---------------------------------------------------------------------------
// (g) 併走の排他: 同じレースを、GitHub と Vercel が同時に再計算する
//     GitHub が [r1, r2] を削除した直後に、Vercel が [r1] を書く状況を再現する
// ---------------------------------------------------------------------------
{
  const ids = raceIdsOf(2);
  const initial = ids.flatMap((race_id) =>
    ["standard", "safeBet", "upsetFocus"].map((model_id) => ({
      race_id,
      model_id,
      top_pick: 6,
      is_shadow: false,
    })),
  );

  const interleave = async (githubMode, vercelMode) => {
    const fake = createFakeClient({
      tables: { ...raceTables(ids), predictions: initial },
    });
    const realFrom = fake.from;
    let injected = false;
    const wrapped = {
      ...fake,
      from: (table) => {
        const builder = realFrom(table);
        if (table !== "predictions") return builder;
        const realDelete = builder.delete;
        builder.delete = () => {
          const b = realDelete();
          const realThen = b.then;
          b.then = (resolve, reject) =>
            realThen.call(
              b,
              (value) => {
                // GitHub の削除が済んだ直後に、Vercel の再計算（同じレース r1）が書き込む
                if (!injected) {
                  injected = true;
                  return quiet(() =>
                    mainRefresh({
                      isDryRun: false,
                      specificRaceIds: [ids[0]],
                      client: { ...fake, from: realFrom },
                      writeMode: vercelMode,
                      now: () => NOW,
                    }),
                  ).then(() => resolve(value), reject);
                }
                return resolve(value);
              },
              reject,
            );
          return b;
        };
        return builder;
      },
    };
    const github = await quiet(() =>
      mainRefresh({
        isDryRun: false,
        specificRaceIds: ids,
        client: wrapped,
        writeMode: githubMode,
        now: () => NOW,
      }),
    );
    const races = new Set(fake.state.predictions.map((p) => p.race_id));
    const conflict = github.lines.some((l) =>
      l.includes("predictions書き込みエラー"),
    );
    return { fake, github, races, conflict };
  };

  const legacy = await interleave("replace", "replace");
  const upsertBoth = await interleave("upsert", "upsert");
  const mixed = await interleave("replace", "upsert");

  check(
    "併走（現行の弱点の記録: replace 同士）: GitHub の挿入が一意制約に衝突し、バッチごと書かれず、r2 の予測が空になる",
    legacy.conflict && !legacy.races.has(ids[1]) && legacy.races.has(ids[0]),
    `予測のあるレース: ${show([...legacy.races])} / 衝突${legacy.conflict}`,
  );
  check(
    "併走（過渡期: GitHub=replace・Vercel=upsert）: 同じく衝突して r2 が空になる。これが、案1の状態では GitHub も upsert にそろえる理由（scrape-scheduled.js の writeMode）",
    mixed.conflict && !mixed.races.has(ids[1]),
    `予測のあるレース: ${show([...mixed.races])} / 衝突${mixed.conflict}`,
  );
  check(
    "併走（案1の状態: GitHub も Vercel も upsert）: 同じレースを同時に再計算しても、衝突せず、2レースとも予測が残る（6行のまま増えない）",
    !upsertBoth.conflict &&
      !upsertBoth.github.error &&
      upsertBoth.races.size === 2 &&
      upsertBoth.fake.state.predictions.length === 6,
    `予測のあるレース: ${show([...upsertBoth.races])} / ${upsertBoth.fake.state.predictions.length}行`,
  );
}

// ---------------------------------------------------------------------------
// (h) 配線の静的確認（scrape-scheduled.js・api/cron/exhibition.js は、import 時に実行される／HTTPハンドラーの
//     ため、ここでは実行できない。トグルの配線が外れていないことを、ソースで確認する）
// ---------------------------------------------------------------------------
{
  const fs = await import("node:fs");
  const read = (path) =>
    fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const scheduled = read("scripts/daily/scrape-scheduled.js");
  check(
    "scrape-scheduled.js: オッズ起点の除外は SKIP_ODDS_REFRESH_ON_GHA（isOddsRefreshSkippedOnGha）で決まり、collectGhaRefreshRaceIds で対象を集める",
    /const skipOddsRefresh = isOddsRefreshSkippedOnGha\(\)/.test(scheduled) &&
      /collectGhaRefreshRaceIds\(\{[\s\S]*?skipOddsRefresh,[\s\S]*?\}\)/.test(
        scheduled,
      ),
  );
  check(
    "scrape-scheduled.js: 書き込み方式は、案1の状態（オッズ起点を外す）だけ upsert、既定は replace（従来どおり）",
    /writeMode: skipOddsRefresh \? "upsert" : "replace"/.test(scheduled),
  );
  check(
    "scrape-scheduled.js: オッズ・レース情報・展示の各起点を別々の集合に集めている（オッズ起点だけを外せる）",
    /oddsRaceIds\.add/.test(scheduled) &&
      /infoRaceIds\.add/.test(scheduled) &&
      /exhibitionRaceIds\.add/.test(scheduled) &&
      !/updatedRaceIds\.add/.test(scheduled),
  );
  const workflow = read(".github/workflows/scrape-scheduled.yml");
  check(
    "scrape-scheduled.yml: SKIP_ODDS_REFRESH_ON_GHA を、リポジトリ変数（vars）から環境に渡す（未設定なら空＝off）",
    /SKIP_ODDS_REFRESH_ON_GHA: \$\{\{ vars\.SKIP_ODDS_REFRESH_ON_GHA \}\}/.test(
      workflow,
    ),
  );
  const exhibition = read("api/cron/exhibition.js");
  check(
    "api/cron/exhibition.js: 展示の取得の後に refreshAfterExhibition を呼び、mainRefresh は有効なときだけ動的 import する（無効なときは従来と同じ動作・同じモジュール読み込み）",
    /\.then\(\(result\) =>\s*refreshAfterExhibition\(/.test(exhibition) &&
      /await import\("\.\.\/\.\.\/scripts\/daily\/generate-predictions\.js"\)/.test(
        exhibition,
      ) &&
      !/^import .*generate-predictions/m.test(exhibition),
  );
}

if (failures > 0) {
  console.error(`\n❌ ${failures}件の検証に失敗`);
  process.exit(1);
}
console.log("\n✅ 全ての検証に成功");
