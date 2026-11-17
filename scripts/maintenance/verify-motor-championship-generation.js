#!/usr/bin/env node
/**
 * verify-motor-championship-generation.js — モータ情報「優勝した日・選手」が、
 * 入れ替え前の別モーターの優勝を混ぜないことを固定する。
 *
 * ## なぜ要るか
 *
 * getVenueMotorChampionshipHistory は race_stage='優勝戦' × 会場 × モーター番号 だけで
 * 優勝履歴を集めていて、期間の下限が無かった。モーターは会場ごとに概ね年1回入れ替わり、
 * 番号は新しいモーターに再利用されるため、入れ替え前の別モーターの優勝が現行モーターの
 * 履歴として出ていた（2026-09-28の実測で、優勝戦552レースのうち165レースが現行世代より前）。
 *
 * ## 何を検査するか
 *
 * 1. src/utils/motorGeneration.js の純関数
 *    - currentMotorGenerationStart: 使用開始日の履歴から最新の日付を選ぶ。行が無ければ null
 *    - isInMotorGeneration: 使用開始日の前日は除外、当日・以降は含める
 * 2. getVenueMotorChampionshipHistory / getMotorGenerationStart を偽の supabase クライアントの上で呼び、
 *    venue_motor_start_dates から現行世代の開始日を決め、その日以降の優勝戦だけを返すこと
 *    （使用開始日が不明なら優勝戦を引かずに generationStart: null で返す。権限エラーは世代不明、
 *    それ以外の取得エラーは fetchFailed）。また、戻り値の形を変えたため、localStorage に30分残る
 *    旧形式（配列）のキャッシュを読まないこと（読むと、画面が .wins.length で落ちる）
 *    （BOA-1406。以前は本文の正規表現で見ていた）
 */

import {
  createFakeSupabase,
  installLocalStorage,
  registerFakeServiceSupabase,
  setFakeSupabase,
} from "./verifyData/fakeServiceSupabase.js";
import {
  currentMotorGenerationStart,
  isInMotorGeneration,
} from "../../src/utils/motorGeneration.js";

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
const { getMotorGenerationStart } =
  await import("../../src/services/motorQueries.js");
const { getVenueMotorChampionshipHistory } =
  await import("../../src/services/motorQueries3.js");

// 1. 世代の開始日
check(
  "使用開始日の行が無ければ null（世代不明）",
  currentMotorGenerationStart([]) === null &&
    currentMotorGenerationStart(null) === null,
);
check(
  "複数の使用開始日（入れ替えの履歴）からは最新を選ぶ",
  currentMotorGenerationStart([
    { start_date: "2025-09-17" },
    { start_date: "2026-09-17" },
    { start_date: "2026-03-01" },
  ]) === "2026-09-17",
);

// 2. 世代の境界（丸亀: 2026-09-17 使用開始の実例）
const start = "2026-09-17";
check(
  "使用開始日の前日の優勝戦は除外する（入れ替え前の別モーター）",
  isInMotorGeneration("2026-09-16-15-12", start) === false,
);
check(
  "使用開始日の当日の優勝戦は含める",
  isInMotorGeneration("2026-09-17-15-12", start) === true,
);
check(
  "使用開始日より後の優勝戦は含める",
  isInMotorGeneration("2026-09-28-15-12", start) === true,
);
check(
  "前年の同じ月日の優勝戦は除外する（年をまたいだ文字列比較）",
  isInMotorGeneration("2025-12-31-15-12", start) === false,
);

// 3. サービス層を偽のクライアントの上で呼ぶ
const V = 15;
const M = 24;
const stage = (race_id, race_stage, venue = V) => ({
  race_id,
  race_stage,
  races: { venue_code: venue },
});
const entry = (
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
const IDS = {
  preGen: "2026-09-16-15-12", // 使用開始日の前日（除外）
  startDay: "2026-09-17-15-12", // 使用開始日の当日（含む）
  prefixed: "2026-09-28-15-12", // 会場固有の接頭が付く優勝戦（含む。このモーターは負けた）
  semi: "2026-09-20-15-11", // 準優勝戦（除外）
  prelim: "2026-09-21-15-12", // 優勝戦で終わらない（除外）
  other: "2026-09-30-16-12", // 他の会場（除外）
  lastYear: "2025-12-31-15-12", // 前年（除外）
  later: "2026-10-05-15-12", // 含む。このモーターが勝った
};
const baseTables = () => ({
  venue_motor_start_dates: [
    { venue_code: V, start_date: "2025-09-17" },
    { venue_code: V, start_date: "2026-09-17" },
    { venue_code: V, start_date: "2026-03-01" },
    { venue_code: 16, start_date: "2027-01-01" }, // 他の会場の行（会場で絞らないと世代が変わる）
  ],
  race_conditions: [
    stage(IDS.preGen, "優勝戦"),
    stage(IDS.startDay, "優勝戦"),
    stage(IDS.prefixed, "ツッキー優勝戦"),
    stage(IDS.semi, "準優勝戦"),
    stage(IDS.prelim, "予選"),
    stage(IDS.other, "優勝戦", 16),
    stage(IDS.lastYear, "優勝戦"),
    stage(IDS.later, "優勝戦"),
  ],
  race_entries: [
    entry(IDS.preGen, 1, 901, "旧A"),
    entry(IDS.startDay, 3, 111, "甲"),
    entry(IDS.startDay, 1, 112, "別モーター", 25), // 別のモーター番号（除外）
    entry(IDS.prefixed, 5, 222, "乙"),
    entry(IDS.semi, 2, 902, "準"),
    entry(IDS.other, 2, 903, "他会場"),
    entry(IDS.lastYear, 2, 904, "前年"),
    entry(IDS.later, 4, 333, "丙"),
  ],
  race_results: [
    { race_id: IDS.preGen, rank1: 1 },
    { race_id: IDS.startDay, rank1: 3 },
    { race_id: IDS.prefixed, rank1: 2 }, // 5号艇は負け
    { race_id: IDS.semi, rank1: 2 },
    { race_id: IDS.other, rank1: 2 },
    { race_id: IDS.lastYear, rank1: 2 },
    { race_id: IDS.later, rank1: 4 },
  ],
});
const win = (raceId, racerId, playerName) => ({
  raceId,
  date: raceId.slice(0, 10),
  racerId,
  playerName,
});
const WINS = [win(IDS.later, 333, "丙"), win(IDS.startDay, 111, "甲")]; // 新しい日付が先
const run = async (tables, errors, fn) => {
  clearCache();
  Object.keys(store).forEach((k) => delete store[k]);
  fake.reset(tables, errors);
  return fn();
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const tablesAsked = () => fake.calls.map((c) => c.table);

// 現行世代（最新の使用開始日）以降の、このモーターが勝った優勝戦だけを新しい日付順に返す
{
  const got = await run(baseTables(), {}, () =>
    getVenueMotorChampionshipHistory(V, M),
  );
  check(
    "優勝履歴: 最新の使用開始日（他会場の行は無視）以降の、このモーターが勝った優勝戦だけを新しい順に返す" +
      "（前日・準優勝戦・予選・他会場・前年・別モーターは出さない。接頭つきの優勝戦は数えるが負けは出さない）",
    same(got, { generationStart: "2026-09-17", wins: WINS }),
  );
  const startReads = fake.calls.filter(
    (c) => c.table === "venue_motor_start_dates",
  );
  check(
    "使用開始日は venue_motor_start_dates を会場で絞って読む",
    startReads.length === 1 &&
      same(startReads[0].filters, [["eq", "venue_code", V]]),
  );
}
// 過去レースのドリルダウン: そのレースより前の優勝に限り、キャッシュを分ける（同じ会場・モーターの続けて呼ぶ）
{
  clearCache();
  fake.reset(baseTables());
  const all = await getVenueMotorChampionshipHistory(V, M);
  const before = await getVenueMotorChampionshipHistory(V, M, IDS.later);
  const after = await getVenueMotorChampionshipHistory(
    V,
    M,
    "2026-09-17-15-12",
  );
  check(
    "優勝履歴: beforeRaceId を渡すとそのレースより前（<）の優勝に限り、渡さない呼び出しのキャッシュを読まない",
    same(all.wins, WINS) &&
      same(before.wins, [WINS[1]]) &&
      same(after.wins, []) &&
      before.generationStart === "2026-09-17",
  );
}
// 世代不明: 別モーターの記録を混ぜないよう、優勝戦を引かずに generationStart: null で返す
{
  const t = baseTables();
  t.venue_motor_start_dates = t.venue_motor_start_dates.filter(
    (r) => r.venue_code !== V,
  );
  const got = await run(t, {}, () => getVenueMotorChampionshipHistory(V, M));
  check(
    "使用開始日が不明なら優勝履歴を出さず（generationStart: null）、優勝戦の取得にも進まない",
    same(got, { generationStart: null, wins: [] }) &&
      !tablesAsked().some((n) => n !== "venue_motor_start_dates"),
  );
}
// 権限エラーは世代不明、それ以外の取得エラーは fetchFailed（保存しない）
{
  const denied = {
    code: "42501",
    message: "permission denied for table venue_motor_start_dates",
  };
  const got = await run(baseTables(), { venue_motor_start_dates: denied }, () =>
    getVenueMotorChampionshipHistory(V, M),
  );
  check(
    "使用開始日の権限エラーは世代不明（null）に倒す（fetchFailed にしない）",
    same(got, { generationStart: null, wins: [] }),
  );
  const startErr = await run(
    baseTables(),
    { venue_motor_start_dates: new Error("boom") },
    () => getMotorGenerationStart(V),
  ).then(
    () => "返した",
    (e) => e.message,
  );
  check(
    "getMotorGenerationStart: 権限以外の取得エラーは握りつぶさず例外にする",
    startErr === "boom",
  );
  clearCache();
  fake.reset(baseTables(), { venue_motor_start_dates: new Error("boom") });
  const failed = await getVenueMotorChampionshipHistory(V, M);
  fake.reset(baseTables());
  const retried = await getVenueMotorChampionshipHistory(V, M);
  check(
    "権限以外の取得エラーは fetchFailed で返し、保存しない（次の呼び出しで取り直せる）",
    same(failed, { generationStart: null, wins: [], fetchFailed: true }) &&
      same(retried.wins, WINS),
  );
}
// getMotorGenerationStart 単体
{
  const got = await run(baseTables(), {}, () =>
    Promise.all([
      getMotorGenerationStart(V),
      getMotorGenerationStart(16),
      getMotorGenerationStart(99),
    ]),
  );
  check(
    "getMotorGenerationStart: 会場ごとに venue_motor_start_dates の最新の日付を返し、行が無い会場は null",
    same(got, ["2026-09-17", "2027-01-01", null]),
  );
}
// 戻り値を配列から {generationStart, wins} に変えた: 旧形式（配列）のキャッシュを読まない
{
  const got = await run(baseTables(), {}, async () => {
    const oldShape = [
      {
        raceId: "2026-09-17-15-12",
        date: "2026-09-17",
        racerId: 111,
        playerName: "旧形式",
      },
    ];
    localStorage.setItem(
      `boatai:venue-motor-championship-history-${V}-${M}`,
      JSON.stringify({ data: oldShape, timestamp: Date.now() }),
    );
    return getVenueMotorChampionshipHistory(V, M);
  });
  check(
    "localStorage に残る旧形式（配列）の優勝履歴のキャッシュを読まない（画面が .wins.length で落ちない）",
    same(got, { generationStart: "2026-09-17", wins: WINS }),
  );
}

if (failures.length > 0) {
  sayErr(`\n${failures.length}件失敗`);
  process.exit(1);
}
say("\nすべて成功");
