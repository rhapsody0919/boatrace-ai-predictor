/**
 * verify-daily-reconcile.js - 日次の照合（N29、daily_reconcile。tasks.md T4b-21）の検証。
 * DBにも取得先にも接続しない（実際のKファイルのフィクスチャ・インメモリのSupabaseクライアント・時計を差し替える）。
 *
 * 確認すること:
 *   (a) 突合: Kファイルと一致するDBは不一致0。順位（rank1〜3・rank4〜6）・払戻（旧15列の勝式別・同着の複数口・特払・不成立）・
 *       払戻明細（race_payouts）・進入コース・結果の有無（DBに無い／Kに無い）・racesに無いレース・確定中止なのにKに結果がある、
 *       をそれぞれ検出する。確定中止は除外して件数を報告する
 *   (b) 分類: 照合不能（Kが未取得・会場が未展開・Kに会場が無い）と、同期待ち（rank4〜6・進入が全てNULL）は、不一致に混ぜない。
 *       同期待ちは、最後の照合で不一致に数える
 *   (c) 日次ジョブ: 対象日は「指定時刻の日付の前日」・off/行なしで何もしない・shadow は通知を出さず処理済みにしない・live は通知して
 *       処理済みにする・照合不能／同期待ちが残る間は incomplete（最後の照合まで）・0件はエラー・履歴（直近14日）・通知は1回きり
 *   (d) 配線: レジストリ・maxDuration・vercel.json の cron（UTC→JST換算。kfile_sync の後）・認証
 *
 * 実行: node scripts/maintenance/verify-daily-reconcile.js
 */
import fs from "node:fs";
import path from "node:path";
import { runScrapeJob } from "../lib/scrapeJobs/cronWrapper.js";
import { SCRAPE_JOBS, validateRegistry } from "../lib/scrapeJobs/registry.js";
import { createMemoryStore } from "../lib/scrapeJobs/testing/memoryStore.js";
import { createFakeSupabaseClient } from "../lib/scrapeJobs/testing/fakeSupabaseClient.js";
import { PAYOUT_COLUMNS_BY_KIND } from "../lib/raceResultAudit.js";
import {
  compareCourses,
  comparePayoutColumns,
  comparePayoutTable,
  normalizeCombination,
  parseKDay,
  reconcileDay,
} from "../lib/dailyReconcile.js";
import {
  FINAL_ATTEMPT_MINUTES_OF_DAY,
  HISTORY_DAYS,
  buildReconcileAlerts,
  loadReconcileInputs,
  runDailyReconcileJob,
  updateHistory,
} from "../lib/dailyReconcileJob.js";

const out = { log: console.log, error: console.error };
console.log = console.warn = console.error = () => {};

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) out.log(`✅ ${label}`);
  else {
    failures++;
    out.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}
const show = (v) => JSON.stringify(v);
const same = (a, b) => show(a) === show(b);
const jst = (text) => new Date(`${text}+09:00`);

const ROOT = path.resolve(new URL("../../", import.meta.url).pathname);
const K_DAY = fs.readFileSync(
  path.join(ROOT, "scripts/lib/__fixtures__/kfile/k260911.txt"),
  "utf8",
); // 2026-09-11 の12会場・144レース（F・欠場を含む）
const K_2019 = fs.readFileSync(
  path.join(ROOT, "scripts/lib/__fixtures__/kbfile/k190415.txt"),
  "utf8",
); // 2019-04-15 蒲郡1R（F4艇・返還・不成立）を含む
const DATE = "2026-09-11";

// ---------------------------------------------------------------------------
// 道具: Kファイルの確定情報から、「Kと一致するDB」を作る
// ---------------------------------------------------------------------------
function dbRowFromFact(fact) {
  const row = { race_id: fact.race_id };
  for (let i = 1; i <= 6; i++)
    row[`rank${i}`] = fact.finisherBoats[i - 1] ?? null;
  for (const [betType, columns] of Object.entries(PAYOUT_COLUMNS_BY_KIND)) {
    const amounts = fact.payouts
      .filter((p) => p.bet_type === betType && p.amount !== null)
      .map((p) => p.amount);
    columns.forEach((c, i) => {
      row[c] = amounts[i] ?? null;
    });
  }
  for (let n = 1; n <= 6; n++)
    row[`actual_course_${n}`] = fact.courses[n] ?? null;
  return row;
}
function payoutRowsFromFact(fact) {
  const seq = {};
  const rows = fact.payouts
    .filter((p) => p.amount !== null)
    .map((p) => {
      seq[p.bet_type] = (seq[p.bet_type] ?? 0) + 1;
      return {
        race_id: fact.race_id,
        bet_type: p.bet_type,
        seq: seq[p.bet_type],
        combination: p.combination,
        payout: p.amount,
        payout_status: p.special === "特払い" ? "special" : "paid",
      };
    });
  for (const kind of fact.noRaceKinds) {
    rows.push({
      race_id: fact.race_id,
      bet_type: kind,
      seq: 1,
      combination: null,
      payout: null,
      payout_status: "no_race",
    });
  }
  return rows;
}
const kDay = parseKDay(K_DAY, DATE);
const facts = [...kDay.facts.values()];
const perfect = () => ({
  races: facts.map((f) => ({
    race_id: f.race_id,
    venue_code: Number(f.race_id.slice(11, 13)),
    cancellation_status: null,
  })),
  results: facts.filter((f) => f.hasRows).map(dbRowFromFact),
  payouts: facts.flatMap(payoutRowsFromFact),
});
const reconcile = (input, extra = {}) =>
  reconcileDay({ date: DATE, kDay, ...input, ...extra });
const kinds = (r) => Object.keys(r.byKind).sort();

// ===========================================================================
// (a) 突合
// ===========================================================================
{
  const r = reconcile(perfect());
  check(
    "突合 Kと一致するDB（144レース・払戻明細つき）: 不一致0・照合144・一致144・照合不能0",
    kDay.completeVenues.size === 12 &&
      facts.length === 144 &&
      r.mismatchRaces === 0 &&
      r.compared === 144 &&
      r.matched === 144 &&
      r.unverifiable.total === 0 &&
      r.excludedCancelled === 0,
    show({ ...r, mismatches: r.mismatches.length }),
  );
}
{
  const withFinisherLoss = facts.find((f) => f.finisherBoats.length >= 5);
  const id = withFinisherLoss.race_id;
  const swap = (mutate) => {
    const input = perfect();
    mutate(
      input,
      input.results.find((r) => r.race_id === id),
    );
    return reconcile(input);
  };
  let r = swap((_, row) => ([row.rank1, row.rank2] = [row.rank2, row.rank1]));
  check(
    "突合 rank1〜3の入れ替わり: rank123 を検出（1レース）",
    same(kinds(r), ["rank123"]) &&
      r.mismatchRaces === 1 &&
      r.mismatches[0].race_id === id,
    show(r.byKind),
  );
  r = swap((_, row) => (row.rank5 = row.rank4));
  check(
    "突合 rank4〜6の誤り（欠場・非完走艇が着順に入る型）: rank456 を検出",
    same(kinds(r), ["rank456"]),
    show(r.byKind),
  );
  r = swap((_, row) => (row.payout_trio += 10));
  check(
    "突合 払戻の誤り（3連単 payout_trio）: payout を検出。DB値・K値を持つ",
    same(kinds(r), ["payout"]) &&
      r.mismatches[0].field === "3tan" &&
      r.mismatches[0].db[0] ===
        withFinisherLoss.payouts.find((p) => p.bet_type === "3tan").amount +
          10 &&
      r.mismatches[0].k[0] ===
        withFinisherLoss.payouts.find((p) => p.bet_type === "3tan").amount,
    show(r.mismatches[0]),
  );
  r = swap((_, row) => (row.payout_trifecta += 10));
  check(
    "突合 旧列名の逆転（payout_trifecta=3連複）: 3連複の払戻の誤りは 3fuku として検出",
    same(kinds(r), ["payout"]) && r.mismatches[0].field === "3fuku",
    show(r.mismatches[0]),
  );
  r = swap((_, row) => (row.payout_win = null));
  check(
    "突合 払戻が空（K側にある）: payout を検出",
    same(kinds(r), ["payout"]) && r.mismatches[0].field === "win",
    show(r.mismatches[0]),
  );
  r = swap(
    (_, row) => (row.actual_course_2 = row.actual_course_2 === 1 ? 2 : 1),
  );
  check(
    "突合 進入コースの誤り: course を検出（項目 actual_course_2）",
    same(kinds(r), ["course"]) && r.mismatches[0].field === "actual_course_2",
    show(r.mismatches[0]),
  );
  r = swap((input) => {
    input.results = input.results.filter((x) => x.race_id !== id);
  });
  check(
    "突合 結果がDBに無い（Kにある）: result_missing を検出",
    same(kinds(r), ["result_missing"]) && r.compared === 143,
    show(r.byKind),
  );
  r = swap((input) => {
    input.races = input.races.filter((x) => x.race_id !== id);
    input.results = input.results.filter((x) => x.race_id !== id);
  });
  check(
    "突合 racesにレースが無い（Kにある）: race_missing_in_db を検出（実データで、住之江・浜名湖・戸田の初日36レースが該当した型）",
    same(kinds(r), ["race_missing_in_db"]),
    show(r.byKind),
  );
  {
    // Kの確定した会場に、DBが結果を持つレースが無い（Kのレースを1件取り除いた版）
    const stub = {
      ...kDay,
      facts: new Map([...kDay.facts].filter(([raceId]) => raceId !== id)),
    };
    const input = perfect();
    const notInK = reconcileDay({ date: DATE, kDay: stub, ...input });
    check(
      "突合 Kの確定した会場に無いレースの結果がDBにある: result_not_in_k を検出",
      same(kinds(notInK), ["result_not_in_k"]) && notInK.mismatchRaces === 1,
      show(notInK.byKind),
    );
  }
}
{
  // 確定中止: 除外して件数を報告。ただし、Kに結果があれば不整合
  const id = facts.find((f) => f.finisherBoats.length >= 3).race_id;
  const input = perfect();
  input.races.find((x) => x.race_id === id).cancellation_status = "confirmed";
  input.results = input.results.filter((x) => x.race_id !== id);
  const r = reconcile(input);
  check(
    "突合 確定中止: 除外して件数を報告するが、Kにそのレースの結果があれば cancelled_but_in_k（走ったのに中止と判定）を不一致に数える",
    r.excludedCancelled === 1 &&
      same(kinds(r), ["cancelled_but_in_k"]) &&
      r.compared === 143,
    show({ ex: r.excludedCancelled, by: r.byKind, c: r.compared }),
  );
  const only = perfect();
  const ghost = "2026-09-11-24-13"; // Kに無い（存在しない）レースを確定中止にしたもの
  only.races.push({
    race_id: ghost,
    venue_code: 24,
    cancellation_status: "confirmed",
  });
  const r2 = reconcile(only);
  check(
    "突合 確定中止でKにも無い: 除外のみ（不一致にしない）",
    r2.excludedCancelled === 1 && r2.mismatchRaces === 0,
    show(r2.byKind),
  );
}
{
  // 払戻: 同着・特払・不成立・拡連複・複勝
  const base = {
    race_id: "x",
    noRaceKinds: [],
    courses: {},
    finisherBoats: [1, 2, 3, 4, 5, 6],
  };
  const p = (bet_type, amount, combination = "1", special = null) => ({
    bet_type,
    combination,
    amount,
    special,
  });
  const row = (over) => ({
    race_id: "x",
    payout_win: null,
    payout_place_1: null,
    payout_place_2: null,
    payout_exacta: null,
    payout_quinella: null,
    payout_wide_1: null,
    payout_wide_2: null,
    payout_wide_3: null,
    payout_trio: null,
    payout_trifecta: null,
    ...over,
  });
  check(
    "払戻 同着（K側が同じ勝式で2口）: DBの1列がKの額のいずれかなら一致。どれとも違えば不一致",
    comparePayoutColumns(row({ payout_trio: 5000 }), {
      ...base,
      payouts: [p("3tan", 5000, "1-2-3"), p("3tan", 7000, "1-3-2")],
    }).length === 0 &&
      comparePayoutColumns(row({ payout_trio: 6000 }), {
        ...base,
        payouts: [p("3tan", 5000, "1-2-3"), p("3tan", 7000, "1-3-2")],
      }).length === 1,
  );
  check(
    "払戻 複勝2口・拡連複3口: 列の並びに依らず、額の集合で一致する（DBの列順は不問）",
    comparePayoutColumns(row({ payout_place_1: 590, payout_place_2: 290 }), {
      ...base,
      payouts: [p("place", 290, "4"), p("place", 590, "6")],
    }).length === 0 &&
      comparePayoutColumns(
        row({ payout_wide_1: 1060, payout_wide_2: 290, payout_wide_3: 390 }),
        {
          ...base,
          payouts: [
            p("wide", 290, "4-6"),
            p("wide", 390, "4-5"),
            p("wide", 1060, "5-6"),
          ],
        },
      ).length === 0 &&
      comparePayoutColumns(row({ payout_wide_1: 290, payout_wide_2: 390 }), {
        ...base,
        payouts: [
          p("wide", 290, "4-6"),
          p("wide", 390, "4-5"),
          p("wide", 1060, "5-6"),
        ],
      }).length === 1,
  );
  check(
    "払戻 特払（K: 特払い70）: DBに70が入っていれば一致、NULLなら不一致（実データで、2026-09-18 江戸川11Rの2連複が該当した型）",
    comparePayoutColumns(row({ payout_quinella: 70 }), {
      ...base,
      payouts: [p("2fuku", 70, null, "特払い")],
    }).length === 0 &&
      comparePayoutColumns(row({}), {
        ...base,
        payouts: [p("2fuku", 70, null, "特払い")],
      }).length === 1,
  );
  const noRace = {
    ...base,
    payouts: [p("3tan", null, null, "不成立")],
    noRaceKinds: ["3tan"],
  };
  check(
    "払戻 不成立: DBがNULLなら一致。返還額100は refund_payout（既存の突合）が扱い、100以外の値が入っていれば payout の不一致",
    comparePayoutColumns(row({}), noRace).length === 0 &&
      comparePayoutColumns(row({ payout_trio: 100 }), noRace).length === 0 &&
      comparePayoutColumns(row({ payout_trio: 530 }), noRace).length === 1,
  );
  const kAudit = parseKDay(K_2019, "2019-04-15");
  const f = kAudit.facts.get("2019-04-15-07-01");
  const polluted = {
    race_id: f.race_id,
    rank1: 3,
    rank2: 1,
    rank3: 2,
    rank4: 4,
    rank5: 5,
    rank6: 6,
    payout_win: 280,
    payout_exacta: 370,
    payout_trio: 100,
    payout_trifecta: 100,
    payout_quinella: 100,
  };
  const r = reconcileDay({
    date: "2019-04-15",
    kDay: kAudit,
    races: [{ race_id: f.race_id, venue_code: 7, cancellation_status: null }],
    results: [polluted],
  });
  check(
    "突合 実ファイル（2019-04-15 蒲郡1R。F4艇・返還・不成立）: 汚れた行の rank456・返還額¥100の払戻（refund_payout）を検出する",
    r.byKind.rank456 === 1 && r.byKind.refund_payout === 3,
    show(r.byKind),
  );
}
{
  // 払戻明細（race_payouts）
  const id = facts.find((f) =>
    f.payouts.some((p) => p.bet_type === "2fuku"),
  ).race_id;
  const fact = kDay.facts.get(id);
  const rows = payoutRowsFromFact(fact);
  check(
    "払戻明細 Kと一致: 不一致なし",
    comparePayoutTable(rows, fact).length === 0,
  );
  const wrong = rows.map((x) =>
    x.bet_type === "3tan" ? { ...x, payout: x.payout + 10 } : x,
  );
  const d = comparePayoutTable(wrong, fact);
  check(
    "払戻明細 払戻が違う: payout_table(paid) を検出",
    d.length === 1 && d[0].kind === "payout_table" && d[0].field === "paid",
    show(d),
  );
  const flipped = rows.map((x) =>
    x.bet_type === "2fuku"
      ? { ...x, combination: x.combination.split("-").reverse().join("-") }
      : x,
  );
  check(
    "払戻明細 順不同の勝式（2連複）の組番は、並びの違い（2-1と1-2）を一致とみなす。順序ありの勝式（3連単）は区別する",
    comparePayoutTable(flipped, fact).length === 0 &&
      normalizeCombination("2fuku", "2-1") === "1-2" &&
      normalizeCombination("3tan", "2-1-3") === "2-1-3" &&
      normalizeCombination("wide", "6-4") === "4-6",
  );
  const missingNoRace = comparePayoutTable(
    [
      ...rows,
      {
        race_id: id,
        bet_type: "wide",
        seq: 9,
        combination: null,
        payout: null,
        payout_status: "no_race",
      },
    ],
    fact,
  );
  check(
    "払戻明細 不成立の勝式の食い違い: payout_table(no_race) を検出",
    missingNoRace.some((x) => x.field === "no_race"),
    show(missingNoRace),
  );
  const input = perfect();
  input.payouts = input.payouts.map((x) =>
    x.race_id === id && x.bet_type === "win"
      ? { ...x, payout: x.payout + 10 }
      : x,
  );
  const r = reconcile(input);
  check(
    "払戻明細 レース単位: 明細のあるレースだけ突合する（明細が無いレースは不一致にしない）",
    same(kinds(r), ["payout_table"]) &&
      r.mismatchRaces === 1 &&
      reconcile({ ...perfect(), payouts: [] }).mismatchRaces === 0,
    show(r.byKind),
  );
}
{
  // 進入コース
  const fact = facts.find((f) =>
    Object.values(f.courses).every((c) => c !== null),
  );
  const row = dbRowFromFact(fact);
  const allNull = Object.fromEntries(
    [1, 2, 3, 4, 5, 6].map((n) => [`actual_course_${n}`, null]),
  );
  check(
    "進入 全て一致は不一致なし。全てNULLは course_unfilled（同期待ち）。一部だけ違えば course",
    compareCourses(row, fact).length === 0 &&
      same(
        compareCourses({ ...row, ...allNull }, fact).map((d) => d.kind),
        ["course_unfilled"],
      ) &&
      same(
        compareCourses({ ...row, actual_course_1: 6 }, fact).map((d) => d.kind),
        ["course"],
      ),
  );
  const absent = facts.find((f) =>
    Object.values(f.courses).some((c) => c === null),
  );
  check(
    "進入 欠場艇（Kの進入が空）: DBもNULLなら一致（欠場艇の列だけNULLは正常）",
    absent !== undefined &&
      compareCourses(dbRowFromFact(absent), absent).length === 0,
  );
}

// ===========================================================================
// (b) 分類: 照合不能・同期待ち
// ===========================================================================
{
  const input = perfect();
  const pendingVenue = 5;
  const stub = {
    facts: new Map(
      [...kDay.facts].filter(
        ([id]) => Number(id.slice(11, 13)) !== pendingVenue,
      ),
    ),
    completeVenues: new Set(
      [...kDay.completeVenues].filter((v) => v !== pendingVenue),
    ),
    pendingVenues: new Set([pendingVenue]),
  };
  const r = reconcileDay({ date: DATE, kDay: stub, ...input });
  check(
    "分類 会場が未展開（プレースホルダ）: 照合不能に数え（kVenuePending）、不一致に混ぜない。照合の対象から外す",
    r.unverifiable.kVenuePending === 12 &&
      r.mismatchRaces === 0 &&
      r.compared === 132 &&
      same(r.kVenuesPending, [5]),
    show({ u: r.unverifiable, c: r.compared, m: r.mismatchRaces }),
  );
  const absentStub = { ...stub, pendingVenues: new Set() };
  const r2 = reconcileDay({ date: DATE, kDay: absentStub, ...input });
  check(
    "分類 Kに会場が無い: 照合不能（kVenueAbsent）。未展開とは別に数える",
    r2.unverifiable.kVenueAbsent === 12 &&
      r2.unverifiable.kVenuePending === 0 &&
      r2.mismatchRaces === 0,
    show(r2.unverifiable),
  );
  const pendingText = parseKDay(
    `STARTK\n05KBGN\n多摩川［成績］      9/11      にっぽん未来プロジェ  第 3日\n\nデータは、この場の全レース終了後に登録されます。\n05KEND\nENDK\n`,
    DATE,
  );
  check(
    "分類 実際のプレースホルダの記法（データは、この場の全レース終了後に登録されます）を、未展開の会場として読む",
    pendingText.pendingVenues.has(5) && pendingText.completeVenues.size === 0,
    show([...pendingText.pendingVenues]),
  );
}
{
  const id = facts.find((f) => f.finisherBoats.length >= 4).race_id;
  const unfilled = (mutate) => {
    const input = perfect();
    mutate(input.results.find((r) => r.race_id === id));
    return input;
  };
  const noRank456 = unfilled((row) =>
    Object.assign(row, { rank4: null, rank5: null, rank6: null }),
  );
  const noCourse = unfilled((row) =>
    Object.assign(
      row,
      Object.fromEntries(
        [1, 2, 3, 4, 5, 6].map((n) => [`actual_course_${n}`, null]),
      ),
    ),
  );
  for (const [label, input, kind] of [
    ["rank4〜6が全てNULL", noRank456, "rank456_unfilled"],
    ["進入が全てNULL", noCourse, "course_unfilled"],
  ]) {
    const before = reconcile(input, { final: false });
    const last = reconcile(input, { final: true });
    check(
      `分類 ${label}（Kファイル同期の前）: 最後の照合の前は「同期待ち」（不一致に数えない・一致にも数えない）、最後の照合では不一致（${kind}）に数える`,
      before.mismatchRaces === 0 &&
        before.syncPending.races === 1 &&
        before.syncPending.byKind[kind] === 1 &&
        before.matched === 143 &&
        last.mismatchRaces === 1 &&
        same(kinds(last), [kind]),
      show({
        before: [before.mismatchRaces, before.syncPending],
        last: last.byKind,
      }),
    );
  }
}
{
  const many = perfect();
  many.results = many.results.map((row) => ({
    ...row,
    payout_win: (row.payout_win ?? 0) + 10,
  }));
  const r = reconcile(many);
  check(
    "レポート: 不一致の明細は上限（30件）まで。超過分は件数のみ。レースID・種類・項目・DB値・K値を持つ",
    r.mismatchCount >= 100 &&
      r.mismatches.length === 30 &&
      r.mismatchesTruncated === r.mismatchCount - 30 &&
      ["race_id", "kind", "field", "db", "k"].every(
        (key) => key in r.mismatches[0],
      ),
    show({ n: r.mismatchCount, len: r.mismatches.length }),
  );
}

// ===========================================================================
// (c) 日次ジョブ
// ===========================================================================
const JOB = "daily_reconcile";
const liveRow = (mode = "live", extra = {}) => ({
  job: JOB,
  mode,
  consecutive_failures: 0,
  ...extra,
});
const okInputs = () => ({ ...perfect(), payoutsAvailable: true });
const runJob = ({
  store,
  deps,
  when,
  client = createFakeSupabaseClient({}),
  politeFetch = async () => {
    throw new Error("取得してはいけません");
  },
}) =>
  runScrapeJob({
    job: JOB,
    run: (ctx) => runDailyReconcileJob(ctx, deps),
    store,
    client,
    politeFetch,
    now: () => when,
    worker: "verify",
  });
const depsFor = ({
  text = K_DAY,
  inputs = okInputs,
  fetched = [],
  loaded = [],
} = {}) => ({
  fetchText: async (date) => {
    fetched.push(date);
    return text;
  },
  load: async (_client, date) => {
    loaded.push(date);
    return inputs();
  },
});

{
  for (const [label, storeOptions] of [
    ["mode=off", { rows: { [JOB]: { job: JOB, mode: "off" } } }],
    ["行なし", {}],
    ["075未適用", { available: false }],
  ]) {
    const store = createMemoryStore(storeOptions);
    const fetched = [];
    const res = await runJob({
      store,
      when: jst("2026-09-12T08:00:00"),
      deps: depsFor({ fetched }),
      client: {
        from() {
          throw new Error("DBへアクセスしてはいけません");
        },
      },
    });
    check(
      `日次ジョブ ${label}: 何もダウンロードせず、DBにもアクセスせず、200で終わる（既定は off）`,
      res.status === 200 &&
        fetched.length === 0 &&
        !store.calls.some((c) => c.name === "acquireLease"),
      show(res),
    );
  }
}
{
  // 対象日: 08:00 JST（2026-09-12）の起動が照合するのは前日（2026-09-11）
  const fetched = [];
  const loaded = [];
  const store = createMemoryStore({ rows: { [JOB]: liveRow() } });
  const res = await runJob({
    store,
    when: jst("2026-09-12T08:00:00"),
    deps: depsFor({ fetched, loaded }),
  });
  const row = store.state.get(JOB);
  check(
    "日次ジョブ live 08:00: 前日(2026-09-11)のKファイルをダウンロードし、DBの前日分を読む。一致すれば通知なしで、対象日(2026-09-12)を処理済みにする",
    res.status === 200 &&
      same(fetched, [DATE]) &&
      same(loaded, [DATE]) &&
      row.last_target_date === "2026-09-12" &&
      row.last_report.summary.matched === 144 &&
      row.last_report.alerts.length === 0 &&
      row.last_report.date === DATE &&
      row.last_report.kStatus === "ok" &&
      row.last_report.payoutTable === "checked",
    show({ status: res.status, report: row.last_report?.summary }),
  );
  const second = await runJob({
    store,
    when: jst("2026-09-12T12:30:00"),
    deps: depsFor({ fetched, loaded }),
  });
  check(
    "日次ジョブ live: 12:30 の補足の起動は、処理済みの対象日を再照合しない（冪等。ダウンロードもしない）",
    second.body.skipped === "already_done" && fetched.length === 1,
    show(second.body),
  );
  // 指定時刻(07:50)の前は前日: 07:40 JST の起動の対象日は前日 → 照合するのは前々日
  const early = createMemoryStore({ rows: { [JOB]: liveRow() } });
  const loadedEarly = [];
  await runJob({
    store: early,
    when: jst("2026-09-12T07:40:00"),
    deps: depsFor({ loaded: loadedEarly }),
  });
  check(
    "日次ジョブ: 指定時刻(07:50)より前の起動は、前日を対象日とし、その前日（前々日）を照合する",
    same(loadedEarly, ["2026-09-10"]),
    show(loadedEarly),
  );
}
{
  // 不一致: live は通知（1回きり）・shadow は通知を出さず処理済みにしない
  const broken = () => {
    const inputs = okInputs();
    const id = facts.find((f) => f.finisherBoats.length >= 3).race_id;
    inputs.results.find((r) => r.race_id === id).payout_trio += 10;
    return inputs;
  };
  const live = createMemoryStore({ rows: { [JOB]: liveRow() } });
  const when = jst("2026-09-12T08:00:00");
  const res = await runJob({
    store: live,
    when,
    deps: depsFor({ inputs: broken }),
  });
  const rep = live.state.get(JOB).last_report;
  check(
    "日次ジョブ live: 不一致1レースで通知(reconcile:日付)を出す。1回きり（until=30分後）。明細にレースID・項目・DB値・K値。照合不能・同期待ちが無ければ incomplete でない",
    res.status === 200 &&
      rep.alerts.length === 1 &&
      rep.alerts[0].key === `reconcile:${DATE}` &&
      rep.alerts[0].until ===
        new Date(when.getTime() + 30 * 60 * 1000).toISOString() &&
      /不一致 1レース/.test(rep.alerts[0].text) &&
      /payout\(3tan\)/.test(rep.alerts[0].text) &&
      rep.mismatches.length === 1 &&
      res.body.incomplete === false &&
      live.state.get(JOB).last_target_date === "2026-09-12",
    show({ alerts: rep.alerts, mm: rep.mismatches }),
  );
  const shadow = createMemoryStore({ rows: { [JOB]: liveRow("shadow") } });
  const sres = await runJob({
    store: shadow,
    when,
    deps: depsFor({ inputs: broken }),
  });
  const srep = shadow.state.get(JOB).last_report;
  check(
    "日次ジョブ shadow: 照合して記録するが、通知は出さない（would_alert に記録）。対象日を処理済みにしない",
    sres.status === 200 &&
      srep.alerts.length === 0 &&
      srep.wouldAlert?.length === 1 &&
      shadow.state.get(JOB).last_target_date === undefined &&
      srep.summary.mismatchRaces === 1,
    show({ alerts: srep.alerts, would: srep.wouldAlert }),
  );
}
{
  // 未公開・未展開・同期待ち: 最後の照合(17:30)まで incomplete、最後の照合で決着
  const pending = () => {
    const inputs = okInputs();
    const id = facts.find((f) => f.finisherBoats.length >= 4).race_id;
    Object.assign(
      inputs.results.find((r) => r.race_id === id),
      { rank4: null, rank5: null, rank6: null },
    );
    return inputs;
  };
  const store = createMemoryStore({ rows: { [JOB]: liveRow() } });
  const r1 = await runJob({
    store,
    when: jst("2026-09-12T08:00:00"),
    deps: depsFor({ inputs: pending }),
  });
  const rep1 = store.state.get(JOB).last_report;
  check(
    "日次ジョブ 同期待ち(08:00): 対象日を処理済みにせず(incomplete)、通知も出さない。履歴にも入れない",
    r1.body.incomplete === true &&
      store.state.get(JOB).last_target_date === undefined &&
      rep1.alerts.length === 0 &&
      rep1.summary.syncPending.races === 1 &&
      rep1.history.length === 0,
    show({ b: r1.body, alerts: rep1.alerts }),
  );
  const r2 = await runJob({
    store,
    when: jst("2026-09-12T17:30:00"),
    deps: depsFor({ inputs: pending }),
  });
  const rep2 = store.state.get(JOB).last_report;
  check(
    "日次ジョブ 同期待ち(17:30 最後の照合): 不一致に数えて通知し、対象日を処理済みにし、履歴に入れる",
    r2.body.incomplete === false &&
      store.state.get(JOB).last_target_date === "2026-09-12" &&
      rep2.alerts.some((a) => a.key === `reconcile:${DATE}`) &&
      rep2.history.length === 1 &&
      rep2.history[0].mismatchRaces === 1 &&
      FINAL_ATTEMPT_MINUTES_OF_DAY === 17 * 60,
    show({ b: r2.body, alerts: rep2.alerts }),
  );

  // Kが未公開（404）
  const unpublished = createMemoryStore({ rows: { [JOB]: liveRow() } });
  const u1 = await runJob({
    store: unpublished,
    when: jst("2026-09-12T08:00:00"),
    deps: depsFor({ text: null }),
  });
  const urep1 = unpublished.state.get(JOB).last_report;
  check(
    "日次ジョブ Kが未公開(404) 08:00: 対象日を処理済みにせず(incomplete)、通知しない。不一致に混ぜない（unpublished）",
    u1.status === 200 &&
      u1.body.kStatus === "unpublished" &&
      u1.body.incomplete === true &&
      unpublished.state.get(JOB).last_target_date === undefined &&
      urep1.alerts.length === 0 &&
      urep1.summary.mismatchRaces === 0,
    show({ b: u1.body, s: urep1?.summary }),
  );
  const u2 = await runJob({
    store: unpublished,
    when: jst("2026-09-12T17:30:00"),
    deps: depsFor({ text: null }),
  });
  const urep2 = unpublished.state.get(JOB).last_report;
  check(
    "日次ジョブ Kが未公開(404) 17:30 最後の照合: 照合不能として通知(reconcile_unverifiable)し、対象日を処理済みにする。履歴に unverifiable を残す",
    u2.body.incomplete === false &&
      unpublished.state.get(JOB).last_target_date === "2026-09-12" &&
      urep2.alerts.some((a) => a.key === `reconcile_unverifiable:${DATE}`) &&
      urep2.history[0].unverifiable === 144 &&
      urep2.history[0].mismatchRaces === 0,
    show({ alerts: urep2.alerts, h: urep2.history }),
  );

  // shadow: Kが未公開のまま最後の照合になっても、通知は出さず（would_alert に記録）、対象日を処理済みにしない
  const shadowUnpublished = createMemoryStore({
    rows: { [JOB]: liveRow("shadow") },
  });
  await runJob({
    store: shadowUnpublished,
    when: jst("2026-09-12T17:30:00"),
    deps: depsFor({ text: null }),
  });
  const srep = shadowUnpublished.state.get(JOB).last_report;
  check(
    "日次ジョブ shadow・Kが未公開の最後の照合: 通知は出さず（would_alert に記録）、対象日を処理済みにしない",
    srep.alerts.length === 0 &&
      srep.wouldAlert?.some(
        (a) => a.key === `reconcile_unverifiable:${DATE}`,
      ) &&
      shadowUnpublished.state.get(JOB).last_target_date === undefined,
    show({ alerts: srep.alerts, would: srep.wouldAlert }),
  );

  // 一部の会場が未展開のK
  const partial = K_DAY.replace(
    /(05KBGN[\s\S]*?)(?=\n05KEND)/,
    "05KBGN\n多摩川［成績］      9/11      にっぽん未来プロジェ  第 3日\n\nデータは、この場の全レース終了後に登録されます。",
  );
  const ps = createMemoryStore({ rows: { [JOB]: liveRow() } });
  const p1 = await runJob({
    store: ps,
    when: jst("2026-09-12T08:00:00"),
    deps: depsFor({ text: partial }),
  });
  check(
    "日次ジョブ 一部の会場が未展開: 展開済みの会場だけ照合し、未展開は照合不能。対象日は処理済みにしない（次の起動で再照合）",
    p1.body.incomplete === true &&
      p1.body.unverifiable === 12 &&
      p1.body.mismatchRaces === 0 &&
      p1.body.compared === 132,
    show(p1.body),
  );
}
{
  // 0件エラー: 照合するレースがあるのに、Kファイルからレースを1件も抽出できない
  const store = createMemoryStore({ rows: { [JOB]: liveRow() } });
  const res = await runJob({
    store,
    when: jst("2026-09-12T08:00:00"),
    deps: depsFor({ text: "STARTK\nENDK\n" }),
  });
  check(
    "日次ジョブ 0件: 照合するレースがあるのにKファイルから1レースも解析できなければ、成功にせず失敗（500）にし、対象日を処理済みにしない",
    res.status === 500 &&
      store.state.get(JOB).last_target_date === undefined &&
      /0件/.test(store.state.get(JOB).last_error ?? ""),
    show({ status: res.status, err: store.state.get(JOB).last_error }),
  );
  // その日にレースが無い（全会場の休催）: 照合するものが無い
  const none = createMemoryStore({ rows: { [JOB]: liveRow() } });
  const fetched = [];
  const nres = await runJob({
    store: none,
    when: jst("2026-09-12T08:00:00"),
    deps: depsFor({
      inputs: () => ({
        races: [],
        results: [],
        payouts: [],
        payoutsAvailable: true,
      }),
      fetched,
    }),
  });
  check(
    "日次ジョブ その日にレースが無い: 照合不要（ダウンロードしない・成功・処理済み）",
    nres.status === 200 &&
      fetched.length === 0 &&
      none.state.get(JOB).last_report.kStatus === "not_needed" &&
      none.state.get(JOB).last_target_date === "2026-09-12",
    show(nres.body),
  );
  // 払戻明細のテーブルが無いDB（079未適用）: 明細の突合を省く
  const noTable = createMemoryStore({ rows: { [JOB]: liveRow() } });
  const inputs = () => {
    const i = okInputs();
    i.payouts = i.payouts.map((x) => ({ ...x, payout: x.payout + 999 })); // 明細があれば不一致になる値
    return { ...i, payoutsAvailable: false };
  };
  const tres = await runJob({
    store: noTable,
    when: jst("2026-09-12T08:00:00"),
    deps: depsFor({ inputs }),
  });
  check(
    "日次ジョブ race_payouts が無いDB: 払戻明細の突合を省き（payoutTable=unavailable）、旧列の突合は行う",
    tres.status === 200 &&
      noTable.state.get(JOB).last_report.payoutTable === "unavailable" &&
      noTable.state.get(JOB).last_report.summary.mismatchRaces === 0,
    show(noTable.state.get(JOB).last_report?.payoutTable),
  );
}
{
  // 履歴: 直近14日・同じ日は置き換え。通知の判定
  let h = [];
  for (let d = 1; d <= 20; d++)
    h = updateHistory(h, {
      date: `2026-09-${String(d).padStart(2, "0")}`,
      compared: 100,
    });
  h = updateHistory(h, { date: "2026-09-20", compared: 1 });
  check(
    "履歴: 直近14日だけ残し、同じ日は置き換える（日付の昇順）",
    HISTORY_DAYS === 14 &&
      h.length === 14 &&
      h[0].date === "2026-09-07" &&
      h.at(-1).compared === 1 &&
      h.filter((x) => x.date === "2026-09-20").length === 1,
    show(h.map((x) => x.date)),
  );
  const clean = reconcile(perfect());
  check(
    "通知の判定: 不一致0・照合不能0なら通知なし",
    buildReconcileAlerts(clean, { final: true, now: new Date() }).length === 0,
  );
  const bad = perfect();
  bad.results[0].rank1 = 6;
  bad.results[0].rank2 = 5;
  check(
    "通知の判定: 不一致1レースで通知する（閾値=1レース）。照合不能は最後の照合のみ通知",
    buildReconcileAlerts(reconcile(bad), { final: false, now: new Date() })
      .length === 1,
  );
}
{
  // DBの読み取り（loadReconcileInputs）
  const client = createFakeSupabaseClient({
    tables: {
      races: [
        {
          race_id: "2026-09-11-05-01",
          race_date: "2026-09-11",
          venue_code: 5,
          cancellation_status: null,
        },
        {
          race_id: "2026-09-12-05-01",
          race_date: "2026-09-12",
          venue_code: 5,
          cancellation_status: null,
        },
      ],
      race_results: [
        { race_id: "2026-09-11-05-01", rank1: 1 },
        { race_id: "2026-09-12-05-01", rank1: 2 },
      ],
      race_payouts: [
        {
          race_id: "2026-09-11-05-01",
          bet_type: "win",
          seq: 1,
          combination: "1",
          payout: 100,
          payout_status: "paid",
        },
        {
          race_id: "2026-09-12-05-01",
          bet_type: "win",
          seq: 1,
          combination: "2",
          payout: 200,
          payout_status: "paid",
        },
      ],
    },
  });
  const inputs = await loadReconcileInputs(client, "2026-09-11");
  check(
    "DB読み取り: 対象日のracesと結果・払戻明細だけを読む（他の日は読まない）",
    inputs.races.length === 1 &&
      inputs.results.length === 1 &&
      inputs.payouts.length === 1 &&
      inputs.payoutsAvailable === true,
    show(inputs),
  );
  const noPayouts = createFakeSupabaseClient({
    tables: { races: [], race_results: [] },
    failOn: {
      "race_payouts:select":
        "Could not find the table 'public.race_payouts' in the schema cache",
    },
  });
  const np = await loadReconcileInputs(noPayouts, "2026-09-11");
  check(
    "DB読み取り: race_payouts が無いDB（079未適用）は payoutsAvailable=false",
    np.payoutsAvailable === false,
  );
  let thrown = null;
  try {
    await loadReconcileInputs(
      createFakeSupabaseClient({ failOn: { "races:select": "接続エラー" } }),
      "2026-09-11",
    );
  } catch (error) {
    thrown = error;
  }
  check(
    "DB読み取り: 失敗は例外（空＝正常と誤判定しない）",
    thrown !== null && /接続エラー/.test(thrown.message),
  );
  let other = null;
  try {
    await loadReconcileInputs(
      createFakeSupabaseClient({
        tables: { races: [], race_results: [] },
        failOn: { "race_payouts:select": "タイムアウト" },
      }),
      "2026-09-11",
    );
  } catch (error) {
    other = error;
  }
  check(
    "DB読み取り: race_payouts の読み取りの別の失敗（テーブル不在以外）は例外（不在と取り違えない）",
    other !== null && /タイムアウト/.test(other.message),
  );
}

// ===========================================================================
// (d) 配線
// ===========================================================================
{
  const def = SCRAPE_JOBS.daily_reconcile;
  check(
    "レジストリ: daily_reconcile は日次・07:50指定・mbrace.or.jp・maxDuration120・整合性の検査が通る",
    def?.kind === "daily" &&
      def.targetTimeJst === "07:50" &&
      same(def.hosts, ["mbrace.or.jp"]) &&
      def.maxDurationSec === 120 &&
      validateRegistry().length === 0,
    show(validateRegistry()),
  );
  const apiSource = fs.readFileSync(
    path.join(ROOT, "api/cron/daily-reconcile.js"),
    "utf8",
  );
  check(
    "api/cron/daily-reconcile.js: maxDuration はレジストリと同じ120（リテラル）・共通ラッパ経由・job名",
    /maxDuration:\s*120/.test(apiSource) &&
      /createScrapeCronHandler/.test(apiSource) &&
      /job:\s*"daily_reconcile"/.test(apiSource),
  );
  const vercel = JSON.parse(
    fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"),
  );
  const jstMinutes = (schedule) => {
    const [min, hour] = schedule.split(" ");
    return ((Number(hour) + 9) % 24) * 60 + Number(min);
  };
  const crons = vercel.crons.filter(
    (c) => c.path === "/api/cron/daily-reconcile",
  );
  const kfile = vercel.crons
    .filter((c) => c.path === "/api/cron/kfile-sync")
    .map((c) => jstMinutes(c.schedule))
    .sort((a, b) => a - b);
  check(
    "vercel.json: daily-reconcile の cron は3本（UTC 23:00・03:30・08:30 = JST 08:00・12:30・17:30）",
    same(
      crons.map((c) => c.schedule),
      ["0 23 * * *", "30 3 * * *", "30 8 * * *"],
    ) &&
      same(
        crons.map((c) => jstMinutes(c.schedule)),
        [480, 750, 1050],
      ),
    show(crons),
  );
  check(
    "vercel.json: 各回が kfile_sync（07:00・12:00 JST）の後で、指定時刻(07:50)より後。最後の回(17:30)だけが「最後の照合」の時刻(17:00)以降",
    same(kfile, [420, 720]) &&
      jstMinutes(crons[0].schedule) > kfile[0] &&
      jstMinutes(crons[1].schedule) > kfile[1] &&
      crons.every((c) => jstMinutes(c.schedule) > 7 * 60 + 50) &&
      crons
        .map((c) => jstMinutes(c.schedule) >= FINAL_ATTEMPT_MINUTES_OF_DAY)
        .join() === "false,false,true",
  );
  const handler = (await import("../../api/cron/daily-reconcile.js")).default;
  const res = { statusCode: null, body: null };
  res.status = (s) => ((res.statusCode = s), res);
  res.json = (b) => ((res.body = b), res);
  const prevSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "verify-secret";
  await handler({ headers: {} }, res);
  process.env.CRON_SECRET = prevSecret;
  check(
    "api/cron/daily-reconcile.js: 認証なしのリクエストは401",
    res.statusCode === 401,
  );
}

if (failures > 0) {
  out.error(`\n${failures}件の検証が失敗しました`);
  process.exit(1);
}
out.log("\nverify-daily-reconcile: すべて通りました");
