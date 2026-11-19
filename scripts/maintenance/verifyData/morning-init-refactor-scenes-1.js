/**
 * verify-morning-init-refactor.js の後半の場面（1/3）。verify ではない。
 * 判定と期待値は分ける前の verify-morning-init-refactor.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { generateAndWriteFromRacesData } from "../../daily/generate-predictions.js";
import { createFakeSupabaseClient } from "../../lib/scrapeJobs/testing/fakeSupabaseClient.js";

let FIXED_NOW, check, show, rejects, GOLDEN_VENUE, DATE;

/** 元の verify の1つの塊 { } を割った 1/3 */
async function scene1() {
  const racesData = () => ({
    success: true,
    data: [structuredClone(GOLDEN_VENUE)],
  });
  const newClient = (opts = {}) =>
    createFakeSupabaseClient({
      tables: {
        venues: [{ code: 1, avg_first_win_rate: 0.5 }],
        racer_aggregated_stats: [],
        ...opts.tables,
      },
      failOn: opts.failOn,
    });
  const client = newClient();
  const result = await generateAndWriteFromRacesData({
    now: () => FIXED_NOW,
    racesData: racesData(),
    date: DATE,
    client,
    throwOnError: true,
  });
  const raceIds = client.data.races.map((r) => r.race_id).sort();
  check(
    "(b) 12レース分の races・race_entries（72行）・predictions（36行）を書く",
    result.predictedRaceIds.length === 12 &&
      client.data.races.length === 12 &&
      client.data.race_entries.length === 72 &&
      client.data.predictions.length === 36 &&
      raceIds[0] === "2026-09-21-01-01" &&
      raceIds[11] === "2026-09-21-01-12",
    `races=${client.data.races.length} entries=${client.data.race_entries?.length} preds=${client.data.predictions?.length}`,
  );
  check(
    "(b) races.start_time は HH:MM:00・race_date は指定した対象日",
    client.data.races.every(
      (r) => /^\d{2}:\d{2}:00$/.test(r.start_time) && r.race_date === DATE,
    ),
  );
  check(
    "(b) race_conditions に、レース名・開催ステージを書く（BOA-347）",
    client.data.race_conditions.length === 12 &&
      client.data.race_conditions.every((r) => r.race_title || r.race_stage),
  );
  // BOA-590: F数・L数を朝の初期化で書く（レース情報の窓＝発走60分前まで NULL にしない）
  const fl = client.data.race_entries.filter(
    (e) => e.race_id === "2026-09-21-01-01",
  );
  check(
    "(b) BOA-590: race_entries に F数・L数を書く（5号艇 F1、ほかは F0・L0）",
    fl.length === 6 &&
      fl.find((e) => e.boat_number === 5)?.f_count === 1 &&
      fl.filter((e) => e.boat_number !== 5).every((e) => e.f_count === 0) &&
      fl.every((e) => e.l_count === 0),
    show(fl.map((e) => [e.boat_number, e.f_count, e.l_count])),
  );
  return { racesData, newClient, client };
}

/** 元の verify の1つの塊 { } を割った 2/3 */
async function scene2({ racesData, newClient, client }) {
  {
    // F数・L数が読めなかった艇は、列を送らない（既存の値を NULL で上書きしない）
    const noFl = racesData();
    for (const r of noFl.data[0].races)
      for (const x of r.racers) {
        delete x.fCount;
        delete x.lCount;
      }
    const c2 = newClient();
    await generateAndWriteFromRacesData({
      now: () => FIXED_NOW,
      racesData: noFl,
      date: DATE,
      client: c2,
      throwOnError: true,
    });
    // 偽クライアントは送られた行をそのまま保存する（新しい行なので、送らなかった列は行に無い）
    const sent = c2.data.race_entries;
    check(
      "(b) BOA-590: F数・L数が読めなかった艇は、f_count・l_count の列を送らない",
      sent.length > 0 &&
        sent.every((r) => !("f_count" in r) && !("l_count" in r)),
      show(sent.slice(0, 1)),
    );
  }
  const racesUpserts = client.writesTo("races").length;
  const entriesUpserts = client.writesTo("race_entries").length;
  await generateAndWriteFromRacesData({
    now: () => FIXED_NOW,
    racesData: racesData(),
    date: DATE,
    client,
    throwOnError: true,
  });
  check(
    "(b) 2回目: 変更の無い races・race_entries は書かない（WS8(b)）。predictions は upsert で36行のまま、削除しない（BOA-628）",
    client.writesTo("races").length === racesUpserts &&
      client.writesTo("race_entries").length === entriesUpserts &&
      client.data.predictions.length === 36 &&
      client.writesTo("predictions").filter((w) => w.op === "delete").length ===
        0,
  );
  // 失敗の扱い
  const failing = (failOn) => newClient({ failOn });
  return { racesData, newClient, failing };
}

/** 元の verify の1つの塊 { } を割った 3/3 */
async function scene3({ racesData, newClient, failing }) {
  for (const [label, failOn] of [
    ["race_entries の書き込み", { "race_entries:upsert": "boom-entries" }],
    ["races の書き込み", { "races:upsert": "boom-races" }],
    ["predictions の書き込み", { "predictions:upsert": "boom-preds" }],
  ]) {
    const err = await rejects(
      generateAndWriteFromRacesData({
        now: () => FIXED_NOW,
        racesData: racesData(),
        date: DATE,
        client: failing(failOn),
        throwOnError: true,
      }),
    );
    check(`(b) throwOnError: ${label}の失敗は例外`, err !== null, err?.message);
    const swallowed = await rejects(
      generateAndWriteFromRacesData({
        now: () => FIXED_NOW,
        racesData: racesData(),
        date: DATE,
        client: failing(failOn),
        throwOnError: false,
      }),
    );
    check(
      `(b) throwOnError: false（CLI が指定）: ${label}の失敗は握りつぶして続行（morning-init の後続を止めない）`,
      swallowed === null,
      swallowed?.message,
    );
    const byDefault = await rejects(
      generateAndWriteFromRacesData({
        now: () => FIXED_NOW,
        racesData: racesData(),
        date: DATE,
        client: failing(failOn),
      }),
    );
    check(
      `(b) 既定（BOA-391）: ${label}の失敗は例外`,
      byDefault !== null,
      byDefault?.message,
    );
  }
  const noClient = await rejects(
    generateAndWriteFromRacesData({
      now: () => FIXED_NOW,
      racesData: racesData(),
      date: DATE,
      client: null,
      throwOnError: true,
    }),
  );
  check(
    "(b) throwOnError: Supabase が無ければ例外",
    noClient && /Supabase/.test(noClient.message),
  );
  const badData = await rejects(
    generateAndWriteFromRacesData({
      now: () => FIXED_NOW,
      racesData: { success: false },
      date: DATE,
      client: newClient(),
    }),
  );
  check("(b) 有効なデータが無ければ例外（従来どおり）", badData !== null);
}

async function scene4() {
  {
    const s1 = await scene1();
    const s2 = await scene2(s1);
    await scene3(s2);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（FIXED_NOW・check・show・rejects・GOLDEN_VENUE・DATE） */
export async function runMorningInitRefactorScenes1(env) {
  ({ FIXED_NOW, check, show, rejects, GOLDEN_VENUE, DATE } = env);
  await scene4();
}
