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
 *   (d) 配線: レジストリ・maxDuration・vercel.json の cron（UTC→JST換算。kfile_sync の後）・認証。
 *       api/cron/daily-reconcile.js は本文の字を読まず、export（config・default）と、共通ラッパ（createScrapeCronHandler）へ渡した
 *       引数を見る（その1本が import する cronWrapper.js だけを、本物へ渡しつつ引数を記録する物へ差し替える）
 *
 * 実行: node scripts/maintenance/verify-daily-reconcile.js
 */
import fs from "node:fs";
import path from "node:path";

import { SCRAPE_JOBS, validateRegistry } from "../lib/scrapeJobs/registry.js";


import { PAYOUT_COLUMNS_BY_KIND } from "../lib/raceResultAudit.js";
import { parseKDay, reconcileDay } from "../lib/dailyReconcile.js";
import { FINAL_ATTEMPT_MINUTES_OF_DAY } from "../lib/dailyReconcileJob.js";
import { runDailyReconcileScenes1 } from "./verifyData/daily-reconcile-scenes-1.js";
import { runDailyReconcileScenes2 } from "./verifyData/daily-reconcile-scenes-2.js";
import { runDailyReconcileScenes3, runDailyReconcileScenes4 } from "./verifyData/daily-reconcile-scenes-3.js";

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

// ---- 後半の場面（verifyData/daily-reconcile-scenes-1.js・daily-reconcile-scenes-2.js・daily-reconcile-scenes-3.js） ----
runDailyReconcileScenes1({ check, show, same, K_2019, DATE, dbRowFromFact, payoutRowsFromFact, kDay, facts, perfect, reconcile, kinds });
await runDailyReconcileScenes2({ check, show, same, jst, K_DAY, DATE, facts, perfect });
await runDailyReconcileScenes3({ out, check, show, jst, perfect, reconcile });

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
  // api/cron/daily-reconcile.js が import する cronWrapper.js だけを、本物の createScrapeCronHandler を呼びつつ引数と戻りを記録する物へ差し替える
  const SPY = "__verifyDailyReconcileCronHandlers", wrapper = JSON.stringify(new URL("../lib/scrapeJobs/cronWrapper.js", import.meta.url).href);
  const spy = `import * as real from ${wrapper}; export * from ${wrapper}; export function createScrapeCronHandler(options) { const handler = real.createScrapeCronHandler(options); (globalThis.${SPY} ??= []).push({ options, handler }); return handler; }`;
  (await import("node:module")).register(`data:text/javascript,${encodeURIComponent(`export async function resolve(s, c, next) { const r = await next(s, c); return r.url === ${wrapper} && c.parentURL?.endsWith("/api/cron/daily-reconcile.js") ? { url: ${JSON.stringify(`data:text/javascript,${encodeURIComponent(spy)}`)}, shortCircuit: true } : r; }`)}`);
  const api = await import("../../api/cron/daily-reconcile.js"), made = globalThis[SPY] ?? [];
  check(
    "api/cron/daily-reconcile.js: config.maxDuration はレジストリと同じ120・共通ラッパ（createScrapeCronHandler）を job 名 daily_reconcile で1回通し、その戻りを default export にする",
    api.config?.maxDuration === 120 && api.config.maxDuration === def.maxDurationSec && made.length === 1 &&
      made[0].options.job === "daily_reconcile" && typeof made[0].options.run === "function" && api.default === made[0].handler,
    show({ config: api.config, jobs: made.map((m) => m.options.job) }),
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
  const handler = api.default;
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

// ---- 後半の場面（verifyData/daily-reconcile-scenes-3.js） ----
runDailyReconcileScenes4({ out, check, show, jst, perfect, reconcile });
