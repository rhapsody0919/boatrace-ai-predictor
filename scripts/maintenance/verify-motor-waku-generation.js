#!/usr/bin/env node
/**
 * verify-motor-waku-generation.js — モーターの枠番別成績・選手×枠成績（BOA-301）が、
 * 入れ替え前の別モーターの成績を混ぜないことを固定する。
 *
 * ## なぜ要るか
 *
 * getMotorWakuStats / getMotorRacerWakuStats は「会場×モーター番号」の直近180日を
 * 集計していた。モーターは会場ごとに概ね年1回入れ替わり番号が再利用されるため、
 * 180日窓は入れ替えをまたぐと別モーターの成績を混ぜる（窓を絞るのは、使用開始日が
 * 取れなかった頃の暫定策だった。BOA-329）。例: 丸亀は2026-09-17に入れ替えたので、
 * 9/28時点の180日窓は約170日分が旧モーターの成績だった。
 * 使用開始日（venue_motor_start_dates、マイグレーション104で匿名から読める）が
 * 取れるようになったため、現行世代（使用開始日以降）で集計する。
 *
 * ## 何を検査するか
 *
 * サービス層（getMotorWakuStats / getMotorRacerWakuStats / getRacesForVenueSince）を偽の supabase クライアントの上で
 * 呼び、返り値と記録された問い合わせで見る（BOA-1406。以前は本文の正規表現）。
 * 1. 2関数とも venue_motor_start_dates の最新の使用開始日（当日を含む）以降のレースだけを集計する
 * 2. 日数の窓（以前の直近180日）で切らない（180日より前でも現行世代なら数える）
 * 3. 使用開始日が不明なら集計せず generationStart: null を返す（別モーターを混ぜない）。
 *    使用開始日の取得失敗は fetchFailed で返し保存しない（世代不明と区別する）
 * 4. 戻り値の形を変えたので、localStorageに残る旧形式の配列のキャッシュを読まない（読むと画面が .rows で落ちる）
 * 5. 画面（ソースを検査する）が世代不明を「表示していません」に倒し、「直近180日」の文言が残っていない
 * 6. 使用開始日以降のレースのページ送りが一意の並びである
 *    （世代全体で最長約1年分、1000件超の会場が16ある。同じ日のレースの並びが
 *    不定だとページ境界で行が重複・欠落しうる。偽のクライアントは並びが決まらない行を不定の順で返す）
 */

import { readFileSync } from "node:fs";
import {
  createFakeSupabase,
  installLocalStorage,
  registerFakeServiceSupabase,
  setFakeSupabase,
} from "./verifyData/fakeServiceSupabase.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SMALL_SAMPLE_THRESHOLD } from "../../src/pure/basicInfoStats.js";
import { formatGenerationDate } from "../../src/utils/motorGeneration.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

// サービス層を偽の supabase クライアントの上で呼ぶ（BOA-1675。共通の部品 verifyData/fakeServiceSupabase.js）
registerFakeServiceSupabase();

const say = console.log.bind(console);
const sayErr = console.error.bind(console);
const failures = [];
const check = (label, ok) => {
  say(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
};
// サービス層の [Cache ...] ・エラーの通知は出さない（結果は check で見る）
console.log = console.error = console.warn = () => {};

const fake = setFakeSupabase(createFakeSupabase({}, { scramble: true }));
// サービス層のキャッシュは localStorage にも書く。Node には無いので、中身を見られる物を置く（メモリのキャッシュは clearCache で消す）
const store = installLocalStorage({ inspectable: true });

const { clearCache } = await import("../../src/services/core.js");
const { getRacesForVenueSince } =
  await import("../../src/services/motorQueries.js");
const { getMotorWakuStats, getMotorRacerWakuStats } =
  await import("../../src/services/motorQueries5.js");

const V = 15;
const M = 24;
const GEN = "2026-03-01"; // 今から180日より前（日数の窓なら入れ替え後でも切れる）
const IDS = {
  preGen: "2026-02-28-15-01", // 使用開始日の前日（除外）
  startDay: "2026-03-01-15-01", // 使用開始日の当日（含む）
  old: "2026-03-10-15-02", // 180日より前だが現行世代（含む）
  recent: "2026-10-01-15-03",
  later: "2026-10-20-15-04", // beforeRaceId で除く
  other: "2026-10-01-16-03", // 他の会場（除外）
};
const race = (race_id, venue_code = V) => ({
  race_id,
  race_date: race_id.slice(0, 10),
  venue_code,
});
const ent = (
  race_id,
  boat_number,
  racer_id,
  player_name,
  motor_number = M,
) => ({
  race_id,
  boat_number,
  racer_id,
  player_name,
  motor_number,
});
// boat 艇が course コースで走り、rank1/rank2/rank3 の艇番を返す結果
const res = (race_id, boat, course, ranks) => ({
  race_id,
  rank1: ranks[0],
  rank2: ranks[1],
  rank3: ranks[2],
  race_status: null,
  ...Object.fromEntries(
    [1, 2, 3, 4, 5, 6].map((n) => [
      `actual_course_${n}`,
      n === boat ? course : null,
    ]),
  ),
  ...(boat === 1 ? {} : { actual_course_1: 1 }), // バックフィル済み（1艇でも進入コースがある）
});
const baseTables = () => ({
  venue_motor_start_dates: [
    { venue_code: V, start_date: "2025-01-01" },
    { venue_code: V, start_date: GEN },
    { venue_code: 16, start_date: "2027-01-01" }, // 他会場の行
  ],
  races: Object.values(IDS).map((id) => race(id, id === IDS.other ? 16 : V)),
  race_entries: [
    ent(IDS.preGen, 1, 13, "旧"),
    ent(IDS.startDay, 1, 11, "甲"),
    ent(IDS.old, 2, 12, "乙"),
    ent(IDS.recent, 1, 11, "甲"),
    ent(IDS.later, 4, 11, "甲"),
    ent(IDS.other, 1, 14, "他"),
    ent(IDS.recent, 6, 15, "別モーター", 25), // 別のモーター番号（除外）
  ],
  race_results: [
    res(IDS.preGen, 1, 1, [1, 2, 3]),
    res(IDS.startDay, 1, 1, [1, 2, 3]), // 1コース 1着
    res(IDS.old, 2, 2, [1, 2, 3]), // 2コース 2着
    res(IDS.recent, 1, 3, [1, 4, 5]), // 3コース（1号艇）1着
    res(IDS.later, 4, 4, [4, 1, 2]), // 4コース 1着
    res(IDS.other, 1, 1, [1, 2, 3]),
  ],
  exhibition_data: [
    { race_id: IDS.startDay, boat_number: 1, exhibition_time: 6.7 },
    { race_id: IDS.recent, boat_number: 1, exhibition_time: 6.8 },
    { race_id: IDS.later, boat_number: 4, exhibition_time: 6.9 },
  ],
});
const run = async (tables, errors, fn) => {
  clearCache();
  Object.keys(store).forEach((k) => delete store[k]);
  fake.reset(tables, errors);
  return fn();
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const tablesAsked = () => fake.calls.map((c) => c.table);
const tally = (stats) =>
  stats.rows.map((r) => [
    r.course,
    r.raceCount,
    r.winRate,
    r.top2Rate,
    r.top3Rate,
  ]);
// 1〜6コースの空の行（返り値の rows の形）
const EMPTY_ROWS = [1, 2, 3, 4, 5, 6].map((course) => ({
  course,
  raceCount: 0,
  winRate: null,
  top2Rate: null,
  top3Rate: null,
  avgExhibitionTime: null,
  exhibitionTrend: [],
}));

// 1・2. 現行世代（最新の使用開始日。当日を含む）以降を、日数の窓で切らずに集計する
{
  const got = await run(baseTables(), {}, () => getMotorWakuStats(V, M));
  check(
    "getMotorWakuStats: 現行世代の開始日（他会場の行は無視）以降の出走だけを、日数の窓で切らず、進入コース別に数える" +
      "（前日・他会場・別モーターは入れない。使用開始日の当日と180日より前の現行世代は入れる）",
    got.generationStart === GEN &&
      same(tally(got), [
        [1, 1, 100, 100, 100],
        [2, 1, 0, 100, 100],
        [3, 1, 100, 100, 100],
        [4, 1, 100, 100, 100],
        [5, 0, null, null, null],
        [6, 0, null, null, null],
      ]) &&
      same(got.rows[0].exhibitionTrend, [
        { raceId: IDS.startDay, time: 6.7 },
      ]) &&
      got.rows[0].avgExhibitionTime === 6.7,
  );
  const racesAsked = fake.calls.filter((c) => c.table === "races");
  check(
    "getMotorWakuStats: レースは使用開始日以降（当日を含む）を会場で絞って読む（日数から数えた日で切らない）",
    racesAsked.length === 1 &&
      racesAsked[0].filters.some(
        ([op, col, val]) => op === "gte" && col === "race_date" && val === GEN,
      ) &&
      racesAsked[0].filters.some(
        ([op, col, val]) => op === "eq" && col === "venue_code" && val === V,
      ),
  );
  const racer = await run(baseTables(), {}, () => getMotorRacerWakuStats(V, M));
  check(
    "getMotorRacerWakuStats: 現行世代の開始日以降の出走を、選手×進入コース別にコース昇順で数える（日数の窓で切らない）",
    racer.generationStart === GEN &&
      same(racer.rows, [
        {
          racerId: 11,
          playerName: "甲",
          course: 1,
          raceCount: 1,
          winRate: 100,
          top2Rate: 100,
          top3Rate: 100,
        },
        {
          racerId: 12,
          playerName: "乙",
          course: 2,
          raceCount: 1,
          winRate: 0,
          top2Rate: 100,
          top3Rate: 100,
        },
        {
          racerId: 11,
          playerName: "甲",
          course: 3,
          raceCount: 1,
          winRate: 100,
          top2Rate: 100,
          top3Rate: 100,
        },
        {
          racerId: 11,
          playerName: "甲",
          course: 4,
          raceCount: 1,
          winRate: 100,
          top2Rate: 100,
          top3Rate: 100,
        },
      ]),
  );
}

// 上限（beforeRaceId）: そのレースより前の出走だけを数え、渡さない呼び出しのキャッシュと分ける
{
  clearCache();
  fake.reset(baseTables());
  const all = await getMotorWakuStats(V, M);
  const before = await getMotorWakuStats(V, M, IDS.later);
  const allRacer = await getMotorRacerWakuStats(V, M);
  const beforeRacer = await getMotorRacerWakuStats(V, M, IDS.later);
  check(
    "getMotorWakuStats: beforeRaceId のレースより前だけを数え、渡さない呼び出しのキャッシュを読まない",
    all.rows[3].raceCount === 1 &&
      before.rows[3].raceCount === 0 &&
      before.rows[0].raceCount === 1,
  );
  check(
    "getMotorRacerWakuStats: beforeRaceId のレースより前だけを数え、渡さない呼び出しのキャッシュを読まない",
    allRacer.rows.length === 4 &&
      beforeRacer.rows.length === 3 &&
      !beforeRacer.rows.some((r) => r.course === 4),
  );
}

// 3. 使用開始日が不明なら集計せず generationStart: null（別モーターを混ぜない）
{
  const t = baseTables();
  t.venue_motor_start_dates = t.venue_motor_start_dates.filter(
    (r) => r.venue_code !== V,
  );
  const waku = await run(t, {}, () => getMotorWakuStats(V, M));
  const askedWaku = tablesAsked();
  const racer = await run(t, {}, () => getMotorRacerWakuStats(V, M));
  check(
    "getMotorWakuStats: 使用開始日が不明なら集計せず generationStart: null・1〜6コースの空の行で返し、レースの取得に進まない",
    same(waku, { generationStart: null, rows: EMPTY_ROWS }) &&
      askedWaku.every((n) => n === "venue_motor_start_dates"),
  );
  check(
    "getMotorRacerWakuStats: 使用開始日が不明なら集計せず generationStart: null・空の行で返し、レースの取得に進まない",
    same(racer, { generationStart: null, rows: [] }) &&
      tablesAsked().every((n) => n === "venue_motor_start_dates"),
  );
}
// 権限エラーは世代不明、それ以外の取得失敗は fetchFailed（保存しない。世代不明と区別する）
{
  const denied = {
    code: "42501",
    message: "permission denied for table venue_motor_start_dates",
  };
  const unknown = await run(
    baseTables(),
    { venue_motor_start_dates: denied },
    () => getMotorWakuStats(V, M),
  );
  check(
    "使用開始日の権限エラーは世代不明（generationStart: null・fetchFailed なし）に倒す",
    same(unknown, { generationStart: null, rows: EMPTY_ROWS }),
  );
  for (const [name, fn, emptyRows] of [
    ["getMotorWakuStats", getMotorWakuStats, EMPTY_ROWS],
    ["getMotorRacerWakuStats", getMotorRacerWakuStats, []],
  ]) {
    clearCache();
    fake.reset(baseTables(), { venue_motor_start_dates: new Error("boom") });
    const failed = await fn(V, M);
    fake.reset(baseTables());
    const retried = await fn(V, M);
    check(
      `${name}: 使用開始日の取得失敗を fetchFailed: true で返し（世代不明と区別）、保存しない（次の呼び出しで取り直せる）`,
      same(failed, {
        generationStart: null,
        rows: emptyRows,
        fetchFailed: true,
      }) &&
        retried.generationStart === GEN &&
        retried.fetchFailed === undefined,
    );
  }
}

// 4. 戻り値の形を変えた: 旧形式（配列）のキャッシュを読まない
{
  const [waku, racer] = await run(baseTables(), {}, async () => {
    const stale = {
      data: [{ course: 1, raceCount: 999 }],
      timestamp: Date.now(),
    };
    localStorage.setItem(
      `boatai:motor-waku-stats-${V}-${M}`,
      JSON.stringify(stale),
    );
    localStorage.setItem(
      `boatai:motor-racer-waku-stats-${V}-${M}`,
      JSON.stringify(stale),
    );
    return Promise.all([getMotorWakuStats(V, M), getMotorRacerWakuStats(V, M)]);
  });
  check(
    "getMotorWakuStats: localStorage に残る旧形式（配列）のキャッシュを読まない（画面が .rows で落ちない）",
    waku.generationStart === GEN &&
      Array.isArray(waku.rows) &&
      waku.rows.length === 6 &&
      waku.rows[0].raceCount === 1,
  );
  check(
    "getMotorRacerWakuStats: localStorage に残る旧形式（配列）のキャッシュを読まない（画面が .rows で落ちない）",
    racer.generationStart === GEN &&
      Array.isArray(racer.rows) &&
      racer.rows.length === 4,
  );
}

// 6. 使用開始日以降のレースのページ送りが一意の並びで、行が欠けない・重複しない
{
  // 1日12レースを 179日分（2148件＝3ページ。同じ日のレースは race_date だけでは順序が決まらない）
  const races = [];
  for (let d = 0; d < 179; d += 1) {
    const date = new Date(Date.UTC(2026, 2, 1 + d)).toISOString().slice(0, 10);
    for (let n = 1; n <= 12; n += 1)
      races.push(race(`${date}-15-${String(n).padStart(2, "0")}`));
  }
  const got = await run({ races }, {}, () => getRacesForVenueSince(V, GEN));
  const ids = got.map((r) => r.race_id);
  check(
    "getRacesForVenueSince: 1000件を超える会場でも、ページの境目で行が欠けず重複しない（2148件を1度ずつ、使用開始日の当日から）",
    ids.length === 2148 &&
      new Set(ids).size === 2148 &&
      ids.includes(`${GEN}-15-01`),
  );
}

// 画面: 本文の字でなく、ドリルダウンの部品（MotorMain）を ja の文言で描いた DOM で見る（verifyData/motorWakuDrill.js）
const { drawMotorDrill, t } = await import("./verifyData/motorWakuDrill.js");
const drill = (generationStart, course) =>
  drawMotorDrill(M, generationStart, course);
const unknown = await drill(null);
const known = await drill(GEN);
check(
  "枠番別成績の表: 世代不明なら表を出さず「表示していません」に倒す（世代が分かれば .rows の行を出す）",
  unknown.text.includes(t("analysis.motor.wakuStatsUnknownGeneration")) &&
    unknown.tableRows === 0 &&
    known.tableRows === 2 &&
    !known.text.includes(t("analysis.motor.wakuStatsUnknownGeneration")),
);
const racers = await drill(GEN, 1);
check(
  "モータ情報: 新しい形（.rows / generationStart）で受け取る。選手×枠は選んだ枠の .rows だけを出す",
  same(racers.racers.length, 2) && known.tableRows === 2,
);
check(
  "wakuStatsWindowNote・racerWakuNote: 注記に小標本の閾値（SMALL_SAMPLE_THRESHOLD）を渡している",
  known.notes.includes(
    t("analysis.motor.wakuStatsWindowNote", {
      n: SMALL_SAMPLE_THRESHOLD,
      date: formatGenerationDate(GEN, { short: true }),
    }),
  ) &&
    racers.notes.includes(
      t("analysis.motor.racerWakuNote", { n: SMALL_SAMPLE_THRESHOLD }),
    ),
);
// 選手別でも率に参考値の色を付ける（nだけだと大きな緑の率が目立つ。ファン評価2周目）
check(
  "選手×枠: 率（1着率・2連率・3連率）にも小標本の色を付ける",
  same(racers.racers, [3, 0]) &&
    read("src/components/analysis/MotorConditionChart.css").includes(
      ".usage-history-rate.is-small-sample",
    ),
);
for (const lang of ["ja", "en", "zh-TW", "ko"]) {
  const motor = JSON.parse(read(`src/locales/${lang}/common.json`)).analysis
    .motor;
  check(
    `${lang}: 集計期間の文言に「180」が残っていない`,
    !/180/.test(motor.wakuStatsWindowNote) && !/180/.test(motor.racerWakuNote),
  );
  check(
    `${lang}: 世代不明の文言がある`,
    typeof motor.wakuStatsUnknownGeneration === "string" &&
      motor.wakuStatsUnknownGeneration.length > 0,
  );
}

for (const lang of ["ja", "en", "zh-TW", "ko"]) {
  const motor = JSON.parse(read(`src/locales/${lang}/common.json`)).analysis
    .motor;
  check(
    `${lang}: 注記が小標本の色の意味と閾値（{{n}}）を説明している`,
    motor.wakuStatsWindowNote.includes("{{n}}") &&
      motor.racerWakuNote.includes("{{n}}"),
  );
}

if (failures.length > 0) {
  sayErr(`\n${failures.length}件失敗`);
  process.exit(1);
}
say("\nすべて成功");
