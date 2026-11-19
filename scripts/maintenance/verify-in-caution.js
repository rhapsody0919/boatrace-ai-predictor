/**
 * BOA-822 イン崩れ注意度の検証（DB には繋がない）。
 *
 *   (a) 定義の1か所: JS の正（src/constants/inCautionConfig.js）と Python が読む src/data/inCautionConfig.json が同じ値。
 *       値の組と def を固定する（閾値・帯・期間を変えたら def を上げる。/accuracy の公開後の実績は同じ def の行だけを数える）
 *   (b) 表の欠けのガード（scripts/lib/inCaution.js の toInCautionRates）: 最初の日・最後の日・合計の件数
 *   (c) レースの値（computeInCaution）: 出さない理由の全分岐、境目、同点、欠場1艇、件数少なめ、例のレース
 *   (d) JS と Python の勝率差・帯が同じ: Python の pytest と同じ固定の入力
 *       （scripts/ml/analogy/tests/fixtures/in_caution_cases.json）を computeInCaution に通す
 *   (e) 監視（scripts/lib/inCautionHealth.js、api/cron/in-caution-health.js・in-caution-today-health.js）: 表・今日の unified の判定、中止の除外、別のジョブにした配線
 *
 * 使い方: node scripts/maintenance/verify-in-caution.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IN_CAUTION_CONFIG } from "../../src/constants/inCautionConfig.js";
import { computeInCaution, toInCautionRates } from "../lib/inCaution.js";
import {
  evaluateInCautionTable,
  evaluateInCautionToday,
  runInCautionHealth,
} from "../lib/inCautionHealth.js";
import { SCRAPE_JOBS } from "../lib/scrapeJobs/registry.js";
import { runInCautionScenes1 } from "./verifyData/in-caution-scenes.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(
    `${ok ? "✅" : "❌"} ${label}${ok || !detail ? "" : `\n   ${detail}`}`,
  );
  if (!ok) failures++;
};
// キーの順に依らない比較
const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
const same = (a, b) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

// ---------------------------------------------------------------- (a)
{
  const json = JSON.parse(
    fs.readFileSync(path.join(ROOT, "src/data/inCautionConfig.json"), "utf8"),
  );
  check(
    same(IN_CAUTION_CONFIG, json),
    "(a) src/constants/inCautionConfig.js と src/data/inCautionConfig.json が同じ値",
    `JS: ${JSON.stringify(canonical(IN_CAUTION_CONFIG))}\n   JSON: ${JSON.stringify(canonical(json))}`,
  );
  // 値の組を変えたのに def を上げ忘れると、/accuracy の公開後の実績に違う定義の行が混ざる
  const DEF_V1 = {
    def: "gapband-r-v1",
    thresholds: [35, 55],
    bandWidthCents: 50,
    bandMin: -8,
    bandMax: 6,
    from: "2019-04-01",
    minCellN: 100,
    lowSampleN: 300,
  };
  const pick = Object.fromEntries(
    Object.keys(DEF_V1).map((k) => [k, IN_CAUTION_CONFIG[k]]),
  );
  check(
    IN_CAUTION_CONFIG.def !== DEF_V1.def || same(pick, DEF_V1),
    "(a) def が gapband-r-v1 の間は、閾値・帯・期間・件数の下限が v1 の値のまま",
    JSON.stringify(pick),
  );
  check(
    Object.isFrozen(IN_CAUTION_CONFIG) &&
      Object.isFrozen(IN_CAUTION_CONFIG.thresholds) &&
      Object.isFrozen(IN_CAUTION_CONFIG.prelaunch),
    "(a) JS の定数は書き換えられない（freeze）",
  );
}

// ---------------------------------------------------------------- (b)
const PREV = "2026-10-10";
// 全期間の表の形（合計 40万件以上、最初の日が from、最後の日が前日）
function tableRows({
  first = "2019-04-01",
  last = PREV,
  cells = [
    ["other", -5, 34842, 22634],
    ["other", 0, 380000, 170000],
    ["junyu", 4, 236, 28],
    ["yusho", -8, 2, 0],
    ["junyu", -5, 225, 107],
    ["other", 6, 107, 15],
  ],
} = {}) {
  return cells.map(([round_grp, gap_band, n, non_win]) => ({
    round_grp,
    gap_band,
    n: String(n), // bigint は文字列で来ることもある
    non_win: String(non_win),
    first_date: first,
    last_date: last,
  }));
}
{
  const ok = toInCautionRates(tableRows(), PREV);
  check(
    ok.usable &&
      ok.through === PREV &&
      ok.base.n === 34842 + 380000 + 236 + 2 + 225 + 107 &&
      same(ok.cells.get("other|-5"), { n: 34842, nonWin: 22634 }),
    "(b) 全期間の表は使える（合計・セル・through）",
    JSON.stringify({ ...ok, cells: [...ok.cells] }),
  );
  const reasons = [
    toInCautionRates([], PREV),
    toInCautionRates(tableRows({ first: "2026-09-27" }), PREV),
    toInCautionRates(tableRows({ last: "2026-10-07" }), PREV),
    toInCautionRates(tableRows({ cells: [["other", -5, 9000, 5000]] }), PREV),
  ].map((r) => r.usable);
  check(
    same(reasons, [false, false, false, false]),
    "(b) 空・最初の日が from より後（直近14日だけの表）・最後の日が3日以上古い・合計の件数が下限未満は使わない",
    JSON.stringify(reasons),
  );
  check(
    toInCautionRates(tableRows({ last: "2026-10-08" }), PREV).usable === true,
    "(b) 最後の日が前日の2日前までは使う（夜のジョブが1回遅れた日）",
  );
}

// ---------------------------------------------------------------- (c)
const RATES = toInCautionRates(tableRows(), PREV);
const race = (rates, opts = {}) =>
  rates.map((r, i) => ({
    boat_number: i + 1,
    win_rate: r,
    is_absent: (opts.absent ?? []).includes(i + 1),
  }));
const run = (rates, opts = {}) =>
  computeInCaution({
    entries: race(rates, opts),
    raceStage: opts.stage ?? "予選",
    rates: opts.table === undefined ? RATES : opts.table,
  });
const five = [5.0, 5.0, 5.0, 5.0, 5.0];

// ---- 後半の場面（verifyData/in-caution-scenes.js） ----
runInCautionScenes1({ ROOT, check, same, PREV, tableRows, race, run, five });

// ---------------------------------------------------------------- (e)
{
  check(
    evaluateInCautionTable(tableRows(), PREV).ok === true,
    "(e) 監視: 全期間・前日までの表は問題なし",
  );
  const t1 = evaluateInCautionTable(tableRows({ last: "2026-10-09" }), PREV);
  const t2 = evaluateInCautionTable([], PREV);
  check(
    !t1.ok && /2026-10-09/.test(t1.issues[0]) && !t2.ok,
    "(e) 監視: 夜のジョブが1日遅れた（最後の日が前日でない）・表が空は問題（Actions が動かなかった日も拾う）",
    JSON.stringify([t1.issues, t2.issues]),
  );
  const ic = { through: PREV, level: "mid" };
  const rows = (withValue, skips = {}) => [
    ...Array.from({ length: withValue }, (_, i) => ({
      race_id: `r${i}`,
      ic,
      skip: null,
    })),
    ...Object.entries(skips).flatMap(([skip, k]) =>
      Array.from({ length: k }, (_, i) => ({
        race_id: `${skip}${i}`,
        ic: null,
        skip,
      })),
    ),
  ];
  const ok = evaluateInCautionToday(
    rows(150, {
      boat1_absent: 2,
      multi_absent: 1,
      sparse_cell: 1,
      others_no_rate: 1,
    }),
    PREV,
  );
  check(
    ok.ok && ok.summary.expectedSkips === 4 && ok.summary.withValue === 150,
    "(e) 監視: 出さないのが正しい理由（1号艇の欠場・2艇以上の欠場・件数の少ないセル）は割合の分母から除く（150/151 で合格）",
    JSON.stringify(ok),
  );
  const bad = evaluateInCautionToday(
    rows(150, { rates_unavailable: 30 }),
    PREV,
  );
  const zero = evaluateInCautionToday([], PREV);
  const stale = evaluateInCautionToday(
    [{ race_id: "a", ic: { through: "2026-10-08" }, skip: null }],
    PREV,
  );
  check(
    !bad.ok && /rates_unavailable/.test(bad.issues[0]) && !zero.ok && !stale.ok,
    "(e) 監視: 表が読めなかった行が多い・行が0件・through が前日でないは問題",
    JSON.stringify([bad.issues, zero.issues, stale.issues]),
  );
  // F2（2026-10-13 レビュー）: 中止（confirmed かつ結果が無い）は分子・分母の両方から除く
  const withCancel = evaluateInCautionToday(
    [
      ...rows(98),
      { race_id: "c1", ic: null, skip: null, cancelled: true },
      { race_id: "c2", ic, skip: null, cancelled: true },
    ],
    PREV,
  );
  check(
    withCancel.ok &&
      withCancel.summary.cancelled === 2 &&
      withCancel.summary.coverage === 1 &&
      withCancel.summary.withValue === 98,
    "(e) 監視: 中止のレースは値の有無にかかわらず分子・分母から除く（98/98。除かなければ 98/100 で誤報）",
    JSON.stringify(withCancel.summary),
  );
  // 偽の client（表 RPC と、predictions・races・race_results の読み取り）
  const calls = [];
  const tables = {
    predictions: [
      { race_id: "2026-10-13-01-01", ic, skip: null },
      { race_id: "2026-10-13-01-02", ic: null, skip: null },
      { race_id: "2026-10-13-02-01", ic: null, skip: null },
    ],
    races: [
      { race_id: "2026-10-13-01-01", cancellation_status: "tentative" }, // 未確定は除かない
      { race_id: "2026-10-13-01-02", cancellation_status: "confirmed" }, // 中止・結果なし → 除く
      { race_id: "2026-10-13-02-01", cancellation_status: "confirmed" }, // 中止だが結果あり → 除かない（BOA-512）
    ],
    race_results: [
      { race_id: "2026-10-13-01-02", rank1: null },
      { race_id: "2026-10-13-02-01", rank1: 3 },
    ],
  };
  const fakeClient = {
    rpc: async (name, args) => {
      calls.push(["rpc", name, args]);
      return { data: tableRows({ last: "2026-10-12" }), error: null };
    },
    from: (table) => {
      calls.push(["from", table]);
      // eq・not(is null) は実際に絞り込む（読み取りの条件そのものを検査するため）
      let rowsOf = tables[table];
      const q = {
        select: () => q,
        eq: (c, v) => (
          (rowsOf = rowsOf.filter((r) => !(c in r) || r[c] === v)),
          q
        ),
        not: (c, op, v) =>
          op === "is" && v === null
            ? ((rowsOf = rowsOf.filter((r) => r[c] != null)), q)
            : q,
        gte: () => q,
        lt: () => q,
        order: () => q,
        range: async () => ({ data: rowsOf, error: null }),
      };
      return q;
    },
  };
  const at = (hhmm) => () => new Date(`2026-10-13T${hhmm}:00+09:00`);
  const r1 = await runInCautionHealth(
    { client: fakeClient, now: at("04:30") },
    "table",
  );
  const r2 = await runInCautionHealth(
    { client: fakeClient, now: at("05:45") },
    "today",
  );
  check(
    r1.report?.target === "table" &&
      r1.outcome === undefined &&
      JSON.stringify(calls[0]) ===
        JSON.stringify([
          "rpc",
          "get_in_caution_band_rates",
          { p_from: null, p_through: "2026-10-12" },
        ]) &&
      r2.report?.target === "today" &&
      r2.report.summary.cancelled === 1 &&
      r2.report.summary.withValue === 1 &&
      r2.outcome === "error",
    "(e) 監視: 表は前日まで。今日の unified は races の confirmed から結果のあるレースを除いたものを中止として扱う（1件を除き、残り 1/2 で問題）",
    JSON.stringify({ r1: r1.report, r2: r2.report, calls }),
  );
  // F1（2026-10-13 レビュー）: 表と今日の確認を別のジョブにする（成功の記録が失敗の記録を消すため）
  const vercel = JSON.parse(
    fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"),
  );
  const cronsOf = (p) =>
    vercel.crons.filter((c) => c.path === p).map((c) => c.schedule);
  const wiring = [
    [
      "in_caution_health",
      "api/cron/in-caution-health.js",
      "table",
      ["30 19 * * *"],
    ],
    [
      "in_caution_today_health",
      "api/cron/in-caution-today-health.js",
      "today",
      ["45 20 * * *"],
    ],
  ].map(([job, file, target, crons]) => {
    const def = SCRAPE_JOBS[job];
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    return (
      def?.kind === "monitor" &&
      def.failureAlertAfter === 1 &&
      Number(/maxDuration:\s*(\d+)/.exec(src)?.[1]) === def.maxDurationSec &&
      /modeGated:\s*true/.test(src) &&
      src.includes(`job: "${job}"`) &&
      src.includes(`runInCautionHealth(ctx, "${target}")`) &&
      JSON.stringify(cronsOf(`/${file.replace(/\.js$/, "")}`)) ===
        JSON.stringify(crons)
    );
  });
  check(
    wiring.every(Boolean),
    "(e) 配線: 夜の表（in_caution_health、JST 04:30）と今日の unified（in_caution_today_health、05:45）は別のジョブ。どちらも monitor・failureAlertAfter 1・モードのゲート、cron は1本ずつ",
    JSON.stringify(wiring),
  );
}

if (failures > 0) {
  console.error(`\n❌ ${failures} 件の検査が失敗`);
  process.exit(1);
}
console.log("\n✅ すべての検査が通過");
