#!/usr/bin/env node
/**
 * verify-motor-fresh-rate.js — 新しいモーターの最初の開催で、モータ情報の一覧が全艇 0.0% に
 * ならないことを固定する（BOA-830、2026-10-11 ユーザー決定「艇ごとに、公式が0のときだけ自前の値」）。
 *
 * ## なぜ要るか
 *
 * 公式の出走表のモーター2連率・3連率は、入れ替え後の最初の節の間は全艇 0（2節目の初日から入る）。
 * 過去レースの一覧は公式の値をそのまま出していたため、常滑（2026-10-06 入れ替え）の
 * 10/06〜10/11 は全行 0.0%・機力指数「-」だった。
 *
 * ## 何を検査するか
 *
 * 1. motorRateView / motorRate3View の決まり。行は本番の実データから取った
 *    - 常滑 2026-10-06 7R（全艇 公式 0）: 0走（20号機）・1走で2着以内0回（35号機）・1走1回（57号機）
 *    - 唐津（会場コード23）2026-09-30 3R（公式と自前の混在）: 10号機 公式55.56（前の節まで9走）、
 *      7号機 公式2連率0・3連率28.57（8走で2着以内0回）、53号機 公式0（0走）
 * 2. 入れ替えから90日以内の判定
 * 3. 画面とサービスのソース（一覧が motorRateView を使う・帯・「※」・キャッシュの版）
 * 4. 4言語の文言キーと、禁止語を使っていないこと
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";
import {
  motorRateView,
  motorRate3View,
  isWithinFreshMotorWindow,
} from "../../src/utils/motorFreshRate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

const failures = [];
const check = (label, ok) => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- 1. 決まり（本番の実データ） ----
// 過去レースの行（rate_source: "official"、motor_2rate/3rate は出走表時点の公式値）
const past = (o) => ({ rate_source: "official", ...o });

// 常滑 2026-10-06 7R
const tokoNotRun = past({
  motor_2rate: 0,
  motor_3rate: 0,
  generation_runs: 0,
  generation_rate2: null,
  generation_rate3: null,
});
const tokoZero = past({
  motor_2rate: 0,
  motor_3rate: 0,
  generation_runs: 1,
  generation_rate2: 0,
  generation_rate3: 0,
});
const tokoOwn = past({
  motor_2rate: 0,
  motor_3rate: 0,
  generation_runs: 1,
  generation_rate2: 100,
  generation_rate3: 100,
});
check(
  "常滑 10/06 7R 20号機（公式0・0走）→ まだ走っていません",
  same(motorRateView(tokoNotRun), { kind: "notRun" }) &&
    same(motorRate3View(tokoNotRun), { kind: "notRun" }),
);
check(
  "常滑 10/06 7R 35号機（公式0・1走で2着以内0回）→ 0%（1走）",
  same(motorRateView(tokoZero), { kind: "zero", runs: 1 }),
);
check(
  "常滑 10/06 7R 57号機（公式0・1走1回）→ 自前の 100%（1走）、3連率も自前",
  same(motorRateView(tokoOwn), { kind: "own", value: 100, runs: 1 }) &&
    same(motorRate3View(tokoOwn), { kind: "own", value: 100 }),
);

// 唐津 2026-09-30 3R
const karaOfficial = past({
  motor_2rate: 55.56,
  motor_3rate: 66.67,
  generation_runs: 9,
  generation_rate2: 55.56,
  prior_meet_runs: 9,
});
const karaZeroWith3 = past({
  motor_2rate: 0,
  motor_3rate: 28.57,
  generation_runs: 8,
  generation_rate2: 0,
  generation_rate3: 25,
});
const karaNotRun = past({
  motor_2rate: 0,
  motor_3rate: 0,
  generation_runs: 0,
});
check(
  "唐津 9/30 3R 10号機（公式55.56）→ 公式のまま、前の節までの走り（9走）を添える",
  same(motorRateView(karaOfficial), {
    kind: "official",
    value: 55.56,
    priorRuns: 9,
  }) && same(motorRate3View(karaOfficial), { kind: "official", value: 66.67 }),
);
check(
  "唐津 9/30 3R 7号機（公式2連率0・3連率28.57・8走で2着以内0回）→ 2連率は 0%（8走）、3連率は公式のまま",
  same(motorRateView(karaZeroWith3), { kind: "zero", runs: 8 }) &&
    same(motorRate3View(karaZeroWith3), { kind: "official", value: 28.57 }),
);
check(
  "唐津 9/30 3R 53号機（公式0・0走）→ まだ走っていません",
  same(motorRateView(karaNotRun), { kind: "notRun" }),
);
check(
  "自前の値が無い（世代が分からない・入れ替え前のレース）なら、公式0でも公式のまま",
  same(
    motorRateView(
      past({ motor_2rate: 0, motor_3rate: 0, generation_runs: null }),
    ),
    { kind: "official", value: 0, priorRuns: null },
  ),
);
check(
  "当日のレースは公式の列（official_2rate）で判定する",
  same(
    motorRateView({
      rate_source: "recalc",
      motor_2rate: 25,
      official_2rate: 0,
      generation_runs: 8,
      generation_rate2: 25,
    }),
    { kind: "own", value: 25, runs: 8 },
  ) &&
    same(
      motorRateView({
        rate_source: "recalc",
        motor_2rate: 30,
        official_2rate: 41.2,
        generation_runs: 20,
        prior_meet_runs: 17,
      }),
      { kind: "official", value: 41.2, priorRuns: 17 },
    ),
);

// ---- 2. 入れ替えから90日以内 ----
check(
  "入れ替えから90日以内（使用開始日の当日は含む、91日目は外れる、前のレースは外れる）",
  isWithinFreshMotorWindow("2026-10-06", "2026-10-06") &&
    isWithinFreshMotorWindow("2026-09-16", "2026-09-30") &&
    isWithinFreshMotorWindow("2026-10-06", "2027-01-04") &&
    !isWithinFreshMotorWindow("2026-10-06", "2027-01-05") &&
    !isWithinFreshMotorWindow("2026-10-06", "2026-10-05") &&
    !isWithinFreshMotorWindow(null, "2026-10-06"),
);

// ---- 3. ソース ----
const chart = read("src/components/analysis/MotorConditionChart.jsx");
check(
  "一覧の2連率の列は motorRateView、過去レースの3連率は motorRate3View で決める",
  chart.includes("breakdown.map(motorRateView)") &&
    chart.includes("motorRate3View(row)"),
);
check(
  "最初の節（その日の公式2連率が全行0）は表の上に帯を出し、優出・優勝は「-」",
  chart.includes('t("analysis.motor.freshFirstMeetBanner"') &&
    /firstMeet\s*\?\s*"-"\s*:\s*\(row\.final_count \?\? "-"\)/.test(chart) &&
    /firstMeet\s*\?\s*"-"\s*:\s*\(row\.championship_count \?\? "-"\)/.test(
      chart,
    ),
);
check(
  "最初の開催だけ、2連率の列の見出しから「公式」を外す（2026-10-11 ユーザー決定）",
  /firstMeet\s*\?\s*"analysis\.motor\.freshRate2Header"\s*:\s*"analysis\.motor\.officialRate2Header"/.test(
    chart,
  ),
);
check(
  "「※」は押しても行のドリルダウンを開かない（stopPropagation）",
  /className="motor-fresh-own-mark"[\s\S]{0,900}e\.stopPropagation\(\)/.test(
    chart,
  ),
);
check(
  "過去レースの機力指数は、自前の値があれば出す（generation_power_index）",
  chart.includes("row.generation_power_index"),
);
check(
  "サービス: 材料が取れなかったら保存しない（fetchFailed）",
  /fresh\.failed\s*\n?\s*\?\s*\{ rows: merged, freshness: fresh\.freshness, fetchFailed: true \}/.test(
    read("src/pure/raceMotorBreakdown.js"),
  ),
);

// ---- サービス層を偽の supabase クライアントの上で呼ぶ土台（BOA-1675。本文の正規表現から置き換え） ----
// src/ の .js は vite の書き方（拡張子の無い import・import.meta.env）なので、renderJsx の module hooks で読む。
// その上に、src/services/supabaseClient.js を偽のクライアントを返すだけの物へ差し替える hook を重ねる
const FAKE_KEY = "__verifyMotorFreshRateSupabase";
const SWAP_CLIENT = `
export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  if (resolved.url.endsWith("/src/services/supabaseClient.js")) {
    return {
      url: "data:text/javascript," + encodeURIComponent("export const supabase = globalThis.${FAKE_KEY};"),
      shortCircuit: true,
    };
  }
  return resolved;
}
`;
register(new URL("../lib/renderJsx.js", import.meta.url));
register(`data:text/javascript,${encodeURIComponent(SWAP_CLIENT)}`);

/**
 * 偽の supabase クライアント（メモリ上の表）。select・eq・gt・gte・lt・lte・in・like・order（ascending）・limit・range・
 * maybeSingle と await を扱い、呼ばれた問い合わせを calls に残す。failTables（表 → 例外へ足す項目）の表は例外で失敗する
 */
function makeFakeSupabase(tables, { failTables = new Map() } = {}) {
  const calls = [];
  const likeToRe = (pat) =>
    new RegExp(
      `^${pat
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/_/g, ".")
        .replace(/%/g, ".*")}$`,
    );
  const client = {
    calls,
    from(table) {
      const q = {
        table,
        select: null,
        filters: [],
        orders: [],
        desc: new Set(),
        range: null,
        limit: null,
      };
      calls.push(q);
      const run = (single = false) => {
        // 本物のクライアントは throwOnError を既定で付ける（supabaseClient.js）ので、失敗は例外で来る
        if (failTables.has(table))
          return Promise.reject(
            Object.assign(
              new Error(`fake failure: ${table}`),
              failTables.get(table),
            ),
          );
        let rows = (tables[table] ?? []).filter((row) =>
          q.filters.every(([op, col, val]) => {
            const v = row[col];
            if (op === "eq") return v === val;
            if (op === "gt") return v > val;
            if (op === "gte") return v >= val;
            if (op === "lt") return v < val;
            if (op === "lte") return v <= val;
            if (op === "in") return val.includes(v);
            if (op === "like") return likeToRe(val).test(v);
            throw new Error(`偽のクライアントに無い絞り: ${op}`);
          }),
        );
        if (q.orders.length > 0)
          rows = [...rows].sort((a, b) => {
            for (const col of q.orders) {
              const dir = q.desc.has(col) ? -1 : 1;
              if (a[col] < b[col]) return -dir;
              if (a[col] > b[col]) return dir;
            }
            return 0;
          });
        if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
        if (q.limit !== null) rows = rows.slice(0, q.limit);
        const copy = rows.map((r) => ({ ...r }));
        return Promise.resolve({
          data: single ? (copy[0] ?? null) : copy,
          error: null,
        });
      };
      const filter = (op) => (col, val) => {
        q.filters.push([op, col, val]);
        return chain;
      };
      const chain = {
        select(cols) {
          q.select = cols;
          return chain;
        },
        eq: filter("eq"),
        gt: filter("gt"),
        gte: filter("gte"),
        lt: filter("lt"),
        lte: filter("lte"),
        in: filter("in"),
        like: filter("like"),
        order(col, { ascending = true } = {}) {
          q.orders.push(col);
          if (!ascending) q.desc.add(col);
          return chain;
        },
        limit(n) {
          q.limit = n;
          return chain;
        },
        range(a, b) {
          q.range = [a, b];
          return chain;
        },
        maybeSingle: () => run(true),
        then(res, rej) {
          return run().then(res, rej);
        },
      };
      return chain;
    },
  };
  return client;
}
// サービス層のキャッシュは localStorage にも書く。Node には無いので、メモリの Map で代える（setTables で空にする）
const localStore = new Map();
globalThis.localStorage = {
  getItem: (k) => localStore.get(k) ?? null,
  setItem: (k, v) => void localStore.set(k, String(v)),
  removeItem: (k) => void localStore.delete(k),
  key: (i) => [...localStore.keys()][i] ?? null,
  get length() {
    return localStore.size;
  },
};

// ---- 3b. サービス（getRaceMotorFreshness・getRaceMotorBreakdown を偽の supabase の上で呼ぶ） ----
const fakeTables = {};
const failTables = new Map();
const fake = makeFakeSupabase(fakeTables, { failTables });
globalThis[FAKE_KEY] = fake;
const { clearCache } = await import("../../src/services/core.js");
const { getRaceMotorFreshness } =
  await import("../../src/services/motorQueries2.js");
const { getRaceMotorBreakdown } =
  await import("../../src/services/motorQueries3.js");
const setTables = (next) => {
  for (const k of Object.keys(fakeTables)) delete fakeTables[k];
  Object.assign(fakeTables, next);
  failTables.clear();
  localStore.clear();
  clearCache();
  fake.calls.length = 0;
};
const queriesOn = (table) => fake.calls.filter((c) => c.table === table);
const quiet = async (fn) => {
  // 失敗の再現中の console.error を静かにする
  const orig = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = orig;
  }
};

const VENUE = 3;
const RACE = "2026-10-20-03-07";
const race = (id) => ({
  race_id: id,
  race_date: id.slice(0, 10),
  venue_code: Number(id.slice(11, 13)),
});
const ent = (
  race_id,
  boat_number,
  global_2rate,
  motor_number,
  motor_2rate = 40,
) => ({
  race_id,
  boat_number,
  global_2rate,
  motor_number,
  motor_2rate,
});
const res = (race_id, rank1, rank2, rank3) => ({
  race_id,
  rank1,
  rank2,
  rank3,
});
// 12号機の走（全国2連率 20）。このレースより前に4走、節の初日（10/18）より前に2走
const RUN_RACES = [
  "2026-10-10-03-01", // 艇2: 1着
  "2026-10-17-03-02", // 艇3: 着外
  "2026-10-18-03-03", // 艇1: 2着（節の初日）
  "2026-10-19-03-04", // 艇4: 3着
];
const freshTables = (
  rows,
  { generationStart = "2026-10-06", official = [] } = {},
) => ({
  venue_motor_start_dates: [
    { venue_code: VENUE, start_date: generationStart },
    { venue_code: 4, start_date: "2026-10-19" },
  ],
  races: [...RUN_RACES, RACE, "2026-10-20-03-08"].map(race),
  race_entries: [
    ent(RUN_RACES[0], 2, 20, 12),
    ent(RUN_RACES[1], 3, 20, 12),
    ent(RUN_RACES[2], 1, 20, 12),
    ent(RUN_RACES[3], 4, 20, 12),
    ent(RACE, 5, 20, 12, 0), // このレース自身は数えない（公式0）
    ent("2026-10-20-03-08", 5, 20, 12, 0), // 後のレースも数えない（公式0）
    ...official, // その日その会場の出走表（公式の2連率）
  ],
  race_results: [
    res(RUN_RACES[0], 2, 4, 5),
    res(RUN_RACES[1], 1, 2, 4),
    res(RUN_RACES[2], 3, 1, 2),
    res(RUN_RACES[3], 1, 2, 4),
    res(RACE, 5, 1, 2),
    res("2026-10-20-03-08", 5, 1, 2),
  ],
  race_conditions: [
    { race_id: "2026-10-18-03-01", series_day: 1, is_final_day: false },
    { race_id: "2026-10-19-03-01", series_day: 2, is_final_day: false },
    { race_id: "2026-10-20-03-01", series_day: 3, is_final_day: false },
    { race_id: "2026-10-05-03-01", series_day: 1, is_final_day: true }, // 12日より前の節
  ],
});
const NONE = {
  generation_runs: null,
  generation_rate2: null,
  generation_rate3: null,
  generation_power_index: null,
  prior_meet_runs: null,
};
// 12号機の、このレースより前の走（4走・艇2と艇1が2着以内・艇4が3着）の自前の値
const OWN12 = {
  generation_runs: 4,
  generation_rate2: 50,
  generation_rate3: 75,
  generation_power_index: 30, // ((100-20)+(0-20)+(100-20)+(0-20))/4
};
const rows3 = (r11, r12, r13) => [
  { motor_number: 11, motor_2rate: r11 },
  { motor_number: 12, motor_2rate: r12 },
  { motor_number: 13, motor_2rate: r13 },
];
const OFFICIAL_ZERO_DAY = [
  ent("2026-10-20-03-01", 1, 20, 11, 0),
  ent("2026-10-20-03-02", 1, 20, 12, 0),
];
const OFFICIAL_POSITIVE_DAY = [
  ent("2026-10-20-03-01", 1, 20, 11, 0),
  ent("2026-10-20-03-02", 1, 20, 12, 40),
];

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
setTables({
  ...freshTables([], { generationStart: "2026-01-01" }),
  races: [
    "2026-07-21-03-01", // 90日前（7/22）より前
    "2026-07-22-03-01", // 90日前の日（含む）
    "2026-10-19-03-04",
    RACE,
  ].map(race),
  race_entries: [
    ent("2026-07-21-03-01", 1, 20, 12),
    ent("2026-07-22-03-01", 1, 20, 12),
    ent("2026-10-19-03-04", 4, 20, 12),
  ],
  race_results: [
    res("2026-07-21-03-01", 1, 2, 3),
    res("2026-07-22-03-01", 1, 2, 3),
    res("2026-10-19-03-04", 1, 2, 4),
  ],
});
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
const breakdownTables = () => ({
  ...freshTables([], { official: OFFICIAL_POSITIVE_DAY }),
  race_entries: [
    ...freshTables([]).race_entries.filter((e) => e.race_id !== RACE),
    // 出走表（このレースの艇）。公式の2連率は 11号機 0・12号機 40
    {
      race_id: RACE,
      boat_number: 1,
      player_name: "A",
      racer_id: 1001,
      motor_number: 11,
      motor_2rate: 0,
      motor_3rate: 0,
      global_2rate: 20,
    },
    {
      race_id: RACE,
      boat_number: 2,
      player_name: "B",
      racer_id: 1002,
      motor_number: 12,
      motor_2rate: 40,
      motor_3rate: 60,
      global_2rate: 20,
    },
  ],
});
setTables(breakdownTables());
localStore.set(
  staleKey,
  JSON.stringify({ data: { rows: [{ stale: true }] }, timestamp: Date.now() }),
);
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

if (failures.length > 0) {
  console.error(`\n${failures.length}件失敗`);
  process.exit(1);
}
console.log("\nすべて成功");
