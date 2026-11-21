/**
 * verify-morning-init-jobs.js の後半の場面（3/4）。verify ではない。
 * 判定と期待値は分ける前の verify-morning-init-jobs.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { IN_CAUTION_MAX_ATTEMPTS, inCautionAlertUntil } from "../../lib/racesInit/job.js";
import {
  digestScrapedVenue,
  compareRaceDigests,
  raceIdOf,
  digestScrapedRace,
  digestDbRace,
} from "../../lib/racesInit/digest.js";

let check, show, same, jst, clone, GOLDEN_VENUE, DATE, JOB, newEnv, newDeps, T0, at;

// イン崩れ注意度の夜の表（RPC get_in_caution_band_rates の行）。全期間・前日まで・全部の帯にセルがある（BOA-822）
const inCautionTable = (through) =>
  Array.from({ length: 15 }, (_, i) => ({
    round_grp: "other",
    gap_band: i - 8,
    n: 30000,
    non_win: 9000 + i * 1000,
    first_date: "2019-04-01",
    last_date: through,
  }));

/** 元の verify の1つの塊 { } を割った 1/2 */
async function scene1() {
  // 5回読めなければ打ち切って失敗を1回だけ記録し、翌起動で後始末を終える
  const env = newEnv({ mode: "live" });
  const d = newDeps({ venues: [1] });
  d.state.inCautionFails = Infinity;
  const statuses = [];
  for (let i = 0; i < IN_CAUTION_MAX_ATTEMPTS; i++)
    statuses.push((await env.invoke(at(2 * i), { deps: d.deps })).status);
  const alerts = env.row().last_report?.alerts ?? [];
  check(
    `(e) イン崩れ注意度の表が${IN_CAUTION_MAX_ATTEMPTS}回読めない: ${IN_CAUTION_MAX_ATTEMPTS}回目だけ失敗にして通知し、unified を済みにする`,
    same(statuses, [...Array(IN_CAUTION_MAX_ATTEMPTS - 1).fill(200), 500]) &&
      /イン崩れ注意度/.test(env.row().last_error ?? "") &&
      alerts.some((a) => a.key === "finalize_failed") &&
      env.row().cursor.finalize.unified?.inCautionFailed === true,
    show({ statuses, finalize: env.row().cursor.finalize }),
  );
  const last = await env.invoke(at(2 * IN_CAUTION_MAX_ATTEMPTS), {
    deps: d.deps,
  });
  check(
    "(e) 打ち切りの次の起動: unified を作り直さず、後始末を終えて done",
    last.body.done === true &&
      d.calls.unified === IN_CAUTION_MAX_ATTEMPTS &&
      env.row().last_target_date === DATE,
    show({ body: last.body, unified: d.calls.unified }),
  );
  // 2026-10-13 レビュー F1: 打ち切りの次の起動の成功の報告でも、通知（finalize_failed）を残す。
  // 残さないと 05:1x の成功で alerts が空になり、scrape-monitor（JST 07:00〜）に届かない
  const kept = (env.row().last_report?.alerts ?? []).find(
    (a) => a.key === "finalize_failed",
  );
  return { env, kept };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
function scene2({ env, kept }) {
  check(
    "(e) 打ち切りの次の起動（成功）の報告にも、打ち切りの通知を JST 09:00 まで残す",
    env.row().consecutive_failures === 0 &&
      /イン崩れ注意度/.test(kept?.text ?? "") &&
      kept?.until === "2026-09-21T00:00:00.000Z",
    show(env.row().last_report?.alerts),
  );
  check(
    "(e) 通知を残す期限: 3時間後と当日 JST 09:00 の遅い方",
    inCautionAlertUntil(jst("2026-09-21 05:10")) ===
      "2026-09-21T00:00:00.000Z" &&
      inCautionAlertUntil(jst("2026-09-21 07:30")) ===
        "2026-09-21T01:30:00.000Z",
  );
}

/** 元の verify の1つの塊 { } を割った 1/4 */
async function scene3() {
  const rpcs = {
    ensure_scrape_slots: () => 7,
    get_in_caution_band_rates: ({ p_through }) => inCautionTable(p_through),
  };
  const env = newEnv({
    mode: "live",
    rpcs,
    tables: {
      venues: [{ code: 1, avg_first_win_rate: 0.5 }],
      racer_aggregated_stats: [],
      scrape_job_state: [
        { job: JOB, mode: "live", consecutive_failures: 0 },
        { job: "odds", mode: "live" },
        { job: "result", mode: "shadow" },
        { job: "race_info", mode: "off" },
        { job: "pcexpect", mode: "off" },
        { job: "pseudo", mode: "live" },
      ],
    },
  });
  let hooks = 0;
  const res = await env.invoke(T0, {
    deps: {
      getVenues: async () => [1],
      scrapeVenue: async () => structuredClone(GOLDEN_VENUE),
      triggerDeployHook: async () => {
        hooks++;
        return { triggered: true };
      },
    },
  });
  const d = env.client.data;
  check(
    "(g) 既定の依存で live 1会場: races 12・race_entries 72・standard等 36・unified 12 を書き、done",
    res.status === 200 &&
      res.body.done === true &&
      d.races.length === 12 &&
      d.race_entries.length === 72 &&
      d.predictions.filter((p) => p.model_id !== "unified").length === 36 &&
      d.predictions.filter((p) => p.model_id === "unified").length === 12 &&
      hooks === 1,
    show({
      body: res.body,
      races: d.races?.length,
      entries: d.race_entries?.length,
      preds: d.predictions?.length,
    }),
  );
  const slotCall = env.client.rpcCalls.find(
    (c) => c.name === "ensure_scrape_slots",
  );
  return { env, d, slotCall };
}

/** 元の verify の1つの塊 { } を割った 2/4 */
function scene4({ env, d, slotCall }) {
  check(
    "(g) 予定表の生成: 有効（shadow・live）な窓型ジョブだけ（odds・result）。off のジョブ・疑似ジョブ（pseudo）は含めない",
    slotCall &&
      same([...new Set(slotCall.args.p_defs.map((x) => x.job))].sort(), [
        "odds",
        "result",
      ]) &&
      slotCall.args.p_date === DATE &&
      slotCall.args.p_skip_lapsed === true &&
      env.row().cursor.finalize.slots.created === 7,
    show(slotCall?.args?.p_defs?.map((x) => x.job)),
  );
  const unified = d.predictions.filter((p) => p.model_id === "unified");
  const ic = env.client.rpcCalls.filter(
    (c) => c.name === "get_in_caution_band_rates",
  );
  check(
    "(g) unified にイン崩れ注意度（BOA-822）: RPC を前日までで1回読み、全レースに inCaution（段・%・def）を書く",
    ic.length === 1 &&
      same(ic[0].args, { p_from: null, p_through: "2026-09-20" }) &&
      unified.every(
        (p) =>
          p.feature_contributions.inCautionSkip === null &&
          ["low", "mid", "high"].includes(
            p.feature_contributions.inCaution?.level,
          ) &&
          p.feature_contributions.inCaution.def === "gapband-r-v1" &&
          // 旧キーは読み手を全部切り替えるまで書き続ける
          typeof p.feature_contributions.volatilityPercentile === "number",
      ),
    show(unified[0]?.feature_contributions),
  );
  check(
    "(g) 後始末の unified: 欠けたレースがあったので日全体（12レース）を生成した",
    env.row().cursor.finalize.unified.missing === 12 &&
      env.row().cursor.finalize.unified.generated === 12,
    show(env.row().cursor.finalize),
  );
  // ダイジェスト: shadow が記録する値と、（GitHub Actions が書いたのと同じ形の）DBの行から計算する値の一致
  const shadowSummary = digestScrapedVenue(DATE, structuredClone(GOLDEN_VENUE));
  const cmp = compareRaceDigests(
    shadowSummary.digests,
    d.races,
    d.race_entries,
  );
  return { d, shadowSummary, cmp };
}

/** 元の verify の1つの塊 { } を割った 3/4 */
function scene5({ d, shadowSummary, cmp }) {
  check(
    "(g) shadow のダイジェストは、書き込まれた races・race_entries の行から計算したダイジェストと、12レース全て一致",
    cmp.matched === 12 &&
      cmp.mismatched.length === 0 &&
      cmp.missingInDb.length === 0 &&
      cmp.extraInDb.length === 0,
    show(cmp),
  );
  // 不一致・欠け・余りの検出
  const races2 = clone(d.races);
  const entries2 = clone(d.race_entries);
  entries2.find(
    (e) => e.race_id === raceIdOf(DATE, 1, 3) && e.boat_number === 2,
  ).racer_id += 1;
  races2.find((r) => r.race_id === raceIdOf(DATE, 1, 5)).start_time =
    "23:59:00";
  const cmp2 = compareRaceDigests(
    shadowSummary.digests,
    races2
      .filter((r) => r.race_id !== raceIdOf(DATE, 1, 7))
      .concat([{ race_id: raceIdOf(DATE, 1, 13), start_time: "20:00:00" }]),
    entries2.concat([
      { race_id: raceIdOf(DATE, 1, 13), boat_number: 1, racer_id: 1 },
    ]),
  );
  check(
    "(g) ダイジェストの比較: 選手の違い・発走時刻の違い（不一致）・DBに無いレース（欠け）・shadowに無いレース（余り）を検出する",
    cmp2.matched === 9 &&
      same(
        cmp2.mismatched.map((m) => m.race_id),
        [raceIdOf(DATE, 1, 3), raceIdOf(DATE, 1, 5)],
      ) &&
      same(cmp2.missingInDb, [raceIdOf(DATE, 1, 7)]) &&
      same(cmp2.extraInDb, [raceIdOf(DATE, 1, 13)]),
    show(cmp2),
  );
  // 中止・順延が確定したレースは、公式の発走予定時刻が仮の値になり、朝にDBへ書いた時刻と一致しない。比較から外す
  const races3 = clone(d.races);
  for (const n of [3, 5]) {
    races3.find((r) => r.race_id === raceIdOf(DATE, 1, n)).start_time =
      "10:06:00";
  }
  const cmp3 = compareRaceDigests(
    shadowSummary.digests,
    races3.concat([{ race_id: raceIdOf(DATE, 1, 13), start_time: "20:00:00" }]),
    d.race_entries.concat([
      { race_id: raceIdOf(DATE, 1, 13), boat_number: 1, racer_id: 1 },
    ]),
    {
      excludeRaceIds: [
        raceIdOf(DATE, 1, 3),
        raceIdOf(DATE, 1, 5),
        raceIdOf(DATE, 1, 13),
      ],
    },
  );
  check(
    "(g) ダイジェストの比較: 中止・順延の確定で発走時刻が仮の値になったレース（excludeRaceIds）は、不一致・余りに数えず excluded に数える",
    cmp3.matched === 10 &&
      cmp3.mismatched.length === 0 &&
      cmp3.extraInDb.length === 0 &&
      cmp3.excluded === 2 &&
      compareRaceDigests(shadowSummary.digests, races3, d.race_entries)
        .mismatched.length === 2,
    show(cmp3),
  );
  check(
    "(g) 選手のいないレースは、ダイジェストに含めない（DBにも行が作られない）",
    digestScrapedRace(DATE, {
      placeCd: 1,
      raceNo: 1,
      startTime: "09:00",
      racers: [],
    }) === null &&
      digestDbRace({ race_id: "x", start_time: "09:00:00" }, []) === null,
  );
}

/** 元の verify の1つの塊 { } を割った 4/4 */
function scene6() {
  const rid = raceIdOf(DATE, 1, 1);
  check(
    "(g) 同じ内容なら、HH:MM と HH:MM:SS・null と undefined の違いは、ダイジェストに影響しない",
    digestDbRace({ race_id: rid, start_time: "09:00:00" }, [
      {
        boat_number: 1,
        racer_id: 1,
        grade: null,
        age: undefined,
        motor_number: 1,
        boat_number_id: 1,
      },
    ]) ===
      digestScrapedRace(DATE, {
        placeCd: 1,
        raceNo: 1,
        startTime: "09:00",
        racers: [
          {
            lane: 1,
            racerId: 1,
            grade: undefined,
            age: null,
            motorNumber: 1,
            boatNumber: 1,
          },
        ],
      }).digest,
  );
}

async function scene7() {
  {
    const s1 = await scene1();
    scene2(s1);
  }
  {
    // BOA-822 統合: 1回目の起動は RPC が失敗（3回試して null）→ 全レース rates_unavailable で予想は書く。
    // 2回目の起動で findRacesMissingUnified が rates_unavailable の行を欠けとして拾い、inCaution が入る
    let rpcUp = false;
    const env = newEnv({
      mode: "live",
      rpcs: {
        ensure_scrape_slots: () => 7,
        get_in_caution_band_rates: ({ p_through }) => {
          if (!rpcUp) throw new Error("rpc-down");
          return inCautionTable(p_through);
        },
      },
      tables: {
        venues: [{ code: 1, avg_first_win_rate: 0.5 }],
        racer_aggregated_stats: [],
        scrape_job_state: [{ job: JOB, mode: "live", consecutive_failures: 0 }],
      },
    });
    const deps = {
      getVenues: async () => [1],
      scrapeVenue: async () => structuredClone(GOLDEN_VENUE),
      triggerDeployHook: async () => ({ triggered: true }),
    };
    const r1 = await env.invoke(T0, { deps });
    const u1 = env.client.data.predictions.filter(
      (p) => p.model_id === "unified",
    );
    check(
      "(g) RPC の失敗: 予想（unified 12）は書き、inCaution は null・rates_unavailable、対象日は済みにしない",
      r1.status === 200 &&
        u1.length === 12 &&
        u1.every(
          (p) =>
            p.feature_contributions.inCaution === null &&
            p.feature_contributions.inCautionSkip === "rates_unavailable",
        ) &&
        env.row().cursor.done === false,
      show({ status: r1.status, fc: u1[0]?.feature_contributions }),
    );
    rpcUp = true;
    const r2 = await env.invoke(at(2), { deps });
    const u2 = env.client.data.predictions.filter(
      (p) => p.model_id === "unified",
    );
    check(
      "(g) 2回目の起動: rates_unavailable の行を欠けとして作り直し、12レースに inCaution が入って done",
      r2.body.done === true &&
        u2.length === 12 &&
        u2.every((p) => p.feature_contributions.inCaution?.level) &&
        env.row().cursor.finalize.unified?.missing === 12,
      show({ body: r2.body, finalize: env.row().cursor.finalize }),
    );
  }
  {
    const s1 = await scene3();
    const s2 = scene4(s1);
    scene5(s2);
    scene6();
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・jst・clone・GOLDEN_VENUE・DATE・JOB・newEnv・newDeps・T0・at） */
export async function runMorningInitJobsScenes3(env) {
  ({ check, show, same, jst, clone, GOLDEN_VENUE, DATE, JOB, newEnv, newDeps, T0, at } = env);
  await scene7();
}
