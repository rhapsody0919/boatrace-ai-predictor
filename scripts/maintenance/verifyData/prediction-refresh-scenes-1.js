/**
 * verify-prediction-refresh.js の後半の場面（1/3）。verify ではない。
 * 判定と期待値は分ける前の verify-prediction-refresh.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { RACE_ID_CHUNK_SIZE, mainRefresh as mainRefreshRaw } from "../../daily/generate-predictions.js";
import { raceIdsOf, createFakeClient } from "./prediction-refresh-fake-client.js";

let mainRefresh, check, show, raceTables, NOW, NOW_LATE, quiet;

/** 元の verify の1つの塊 { } を割った 1/3 */
async function scene1() {
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
  return { many, fake };
}

/** 元の verify の1つの塊 { } を割った 2/3 */
async function scene2({ many, fake }) {
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
  return { realFetch, hookCalls };
}

/** 元の verify の1つの塊 { } を割った 3/3 */
async function scene3({ realFetch, hookCalls }) {
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

async function scene4() {
  {
    const s1 = await scene1();
    const s2 = await scene2(s1);
    await scene3(s2);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（mainRefresh・check・show・raceTables・NOW・NOW_LATE・quiet） */
export async function runPredictionRefreshScenes1(env) {
  ({ mainRefresh, check, show, raceTables, NOW, NOW_LATE, quiet } = env);
  await scene4();
}
