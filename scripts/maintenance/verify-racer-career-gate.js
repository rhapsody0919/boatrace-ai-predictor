#!/usr/bin/env node
/**
 * verify-racer-career-gate.js - 選手の集計の表（マイグレーション 190）と、公式の期別成績（racer_period_stats、fan）の照合の関門。
 * manual（本番の読み取りが要る）。kb 層の CLI と main 層の全選手の計算の後に、Claude が実行する。
 *
 *   node --env-file=.env.local scripts/maintenance/verify-racer-career-gate.js [--from=2019-05-01] [--to=2025-11-01] [--out=path.json]
 *
 * 照らすもの（選手×期。期は racer_period_stats.calc_from。2つの層を足してから比べる）:
 *   出走（starts）・1着（first_count）・2着（second_count）・勝率（win_rate）  ← racer_term_stats
 *   優勝（wins）・優出（finals）                                             ← racer_championships（race_date が期の中）
 *   進入コース別の着のコード（c1〜c6 の p1〜p6・f・l0・l1・k0・k1・s0・s1・s2）   ← racer_course_stats
 * 出走・勝率・優出の定義は src/pure/racerCareerStats.js（BOA-1193）の純関数を使う（この関門で二重に書かない）。
 * 優出は isCareerFinalAppearance（S0・K0・L0 を含め、NULL は数えない。kb の選手×期 20,916行で公式と全件一致、2026-11-02）。
 *
 * 既定の期は 2019-05-01〜2025-11-01（kb だけの13期と、kb と本体をまたぐ 2025年11月の期）。2018-11 の期は kb に 2019-04 しか無いので照らさない。
 * 一致しない選手の一覧を出し、1つでもあれば終了コード 1。接続は claude_ro（scripts/db/ro-query.js と同じ。READ ONLY・最後に ROLLBACK）。
 */
import { writeFileSync } from "node:fs";
import pg from "pg";
import { checkRoUrl, RO_ROLE } from "../lib/roQuery.js";
import { COUNT_COLUMNS, RULE_VERSION } from "../lib/racerCareerJob.js";
import { isDirectRun } from "../lib/isDirectRun.js";

/** 件数の列 → 着のコード（other_code は知らないコードなので純関数に渡さない） */
export const CODE_OF_COLUMN = Object.freeze({
  p1: "01",
  p2: "02",
  p3: "03",
  p4: "04",
  p5: "05",
  p6: "06",
  f: "F",
  l0: "L0",
  l1: "L1",
  k0: "K0",
  k1: "K1",
  s0: "S0",
  s1: "S1",
  s2: "S2",
  code00: "00",
});
/** 公式の進入コース別の列（c{n}_{列}）で照らす件数 */
export const COURSE_COLUMNS = Object.freeze([
  "p1",
  "p2",
  "p3",
  "p4",
  "p5",
  "p6",
  "f",
  "l0",
  "l1",
  "k0",
  "k1",
  "s0",
  "s1",
  "s2",
]);
/** BOA-1193（#2066）の src/pure/racerCareerStats.js の名前。関門はこの4つを使う */
export const CAREER_FUNCTION_NAMES = Object.freeze([
  "isCareerStart",
  "careerFinishPoints",
  "careerWinRate",
  "isCareerFinalAppearance",
]);

/**
 * BOA-1193 の純関数を読み込む。名前が違えば、何が要るかを出して止める。
 *   isCareerStart(finishRaw) → bool、careerFinishPoints(grade, isFinal, finishRaw) → 点 | null、
 *   careerWinRate(rows: {grade, stage, finish_raw}[]) → 小数2桁 | null、isCareerFinalAppearance(finishRaw) → bool
 * @returns {Promise<Record<string, Function>>}
 */
export async function loadCareerFunctions() {
  let mod;
  try {
    mod = await import("../../src/pure/racerCareerStats.js");
  } catch (error) {
    throw new Error(
      `src/pure/racerCareerStats.js が読めない（BOA-1193 のマージ待ち）: ${error.message}`,
    );
  }
  const missing = CAREER_FUNCTION_NAMES.filter((n) => typeof mod[n] !== "function");
  if (missing.length > 0)
    throw new Error(
      `src/pure/racerCareerStats.js に ${missing.join("・")} が無い（あるのは ${Object.keys(mod).join(", ")}）。この関門の読み込みを BOA-1193 の名前に合わせる`,
    );
  return mod;
}

/**
 * 計算の記録のうち、今の判定の規則の版（RULE_VERSION）と違う層。規則を変えた後に計算し直していない層を
 * 照合すると、規則の差を「公式とのずれ」と取り違えるので、関門の前に止める。
 * @param {Array<{era: string, rule_version: string|null}>} meta
 * @returns {string[]}
 */
export function staleRuleEras(meta, ruleVersion = RULE_VERSION) {
  return meta.filter((m) => m.rule_version !== ruleVersion).map((m) => m.era);
}

const termOf = (date) => {
  const [y, m] = String(date).slice(0, 7).split("-").map(Number);
  if (m >= 5 && m <= 10) return `${y}-05-01`;
  return m >= 11 ? `${y}-11-01` : `${y - 1}-11-01`;
};

/**
 * 照合（純関数。テストは verify-racer-career-tables.js）。
 * @param {{termRows: object[], courseRows: object[], champRows: object[], official: object[],
 *   career: {isCareerStart: Function, careerFinishPoints: Function, careerWinRate: Function, isCareerFinalAppearance: Function}}} input
 */
export function compareCareerToOfficial({
  termRows,
  courseRows,
  champRows,
  official,
  career,
}) {
  const key = (racer, term) => `${racer}|${String(term).slice(0, 10)}`;
  const ours = new Map();
  const ensure = (k) => {
    if (!ours.has(k))
      ours.set(k, {
        buckets: new Map(),
        first: 0,
        second: 0,
        other: 0,
        course: {},
        champ: [],
      });
    return ours.get(k);
  };
  // 件数のまま持ち、グレード×優勝戦か×着のコードごとに純関数で出走を数える。勝率は選手×期ごとに1走1行に広げて
  // careerWinRate に渡す（丸めを BOA-1193 と同じにするため。広げるのは1選手×1期の数百行だけ）。
  // 点が決まらない走（グレードが unknown・点が null）は勝率に入れず、unknownRuns として数える（0点にしない）
  const FINAL_STAGE = "優勝戦";
  const OTHER_STAGE = "予選";
  const tallyOf = (o) => {
    let starts = 0;
    let unknownRuns = 0;
    const rows = [];
    for (const [b, n] of o.buckets) {
      const [grade, isFinal, code] = b.split("|");
      if (!career.isCareerStart(code)) continue;
      starts += n;
      const pts = grade === "unknown" ? null : career.careerFinishPoints(grade, isFinal === "1", code);
      if (pts === null || pts === undefined) {
        unknownRuns += n;
        continue;
      }
      const row = { grade, stage: isFinal === "1" ? FINAL_STAGE : OTHER_STAGE, finish_raw: code };
      for (let i = 0; i < n; i++) rows.push(row);
    }
    return { starts, unknownRuns, winRate: rows.length === 0 ? null : career.careerWinRate(rows) };
  };
  for (const r of termRows) {
    const o = ensure(key(r.racer_id, r.term_start));
    for (const [col, code] of Object.entries(CODE_OF_COLUMN)) {
      const n = Number(r[col] ?? 0);
      if (n === 0) continue;
      const b = `${r.race_grade}|${r.is_final === true ? 1 : 0}|${code}`;
      o.buckets.set(b, (o.buckets.get(b) ?? 0) + n);
    }
    o.first += Number(r.p1 ?? 0);
    o.second += Number(r.p2 ?? 0);
    o.other += Number(r.other_code ?? 0);
  }
  for (const r of courseRows) {
    const o = ensure(key(r.racer_id, r.term_start));
    const c = (o.course[r.course] ??= Object.fromEntries(
      COURSE_COLUMNS.map((x) => [x, 0]),
    ));
    for (const col of COURSE_COLUMNS) c[col] += Number(r[col] ?? 0);
  }
  for (const r of champRows)
    ensure(key(r.racer_id, termOf(r.race_date))).champ.push(r.finish_code);

  const fields = [
    "starts",
    "first_count",
    "second_count",
    "win_rate",
    "finals",
    "wins",
    "course",
  ];
  const perTerm = {};
  const mismatches = [];
  let compared = 0;
  const seen = new Set();
  const unknownRuns = [];
  for (const off of official) {
    const term = String(off.calc_from).slice(0, 10);
    const t = (perTerm[term] ??= {
      racers: 0,
      mismatched: 0,
      byField: Object.fromEntries(fields.map((f) => [f, 0])),
    });
    const k = key(off.racer_id, term);
    seen.add(k);
    const o = ours.get(k) ?? {
      buckets: new Map(),
      first: 0,
      second: 0,
      other: 0,
      course: {},
      champ: [],
    };
    const tally = tallyOf(o);
    const starts = tally.starts;
    if (tally.unknownRuns > 0)
      unknownRuns.push({ racer_id: off.racer_id, term, unknown_runs: tally.unknownRuns });
    const got = {
      starts,
      first_count: o.first,
      second_count: o.second,
      win_rate: tally.winRate,
      finals: o.champ.filter((c) => career.isCareerFinalAppearance(c)).length,
      wins: o.champ.filter((c) => c === "01").length,
    };
    const want = {
      starts: Number(off.starts ?? 0),
      first_count: Number(off.first_count ?? 0),
      second_count: Number(off.second_count ?? 0),
      win_rate:
        off.win_rate === null || Number(off.starts ?? 0) === 0
          ? null
          : Number(off.win_rate),
      finals: Number(off.finals ?? 0),
      wins: Number(off.wins ?? 0),
    };
    const diff = {};
    for (const f of Object.keys(got)) {
      const a = got[f] === null ? null : Number(got[f]);
      const b = want[f];
      const same =
        f === "win_rate"
          ? (a === null && b === null) ||
            (a !== null &&
              b !== null &&
              Math.round(a * 100) === Math.round(b * 100))
          : a === b;
      if (!same) diff[f] = { ours: a, official: b };
    }
    for (let c = 1; c <= 6; c++) {
      const mine = o.course[c] ?? {};
      for (const col of COURSE_COLUMNS) {
        const a = Number(mine[col] ?? 0);
        const b = Number(off[`c${c}_${col}`] ?? 0);
        if (a !== b)
          (diff.course ??= {})[`c${c}_${col}`] = { ours: a, official: b };
      }
    }
    compared += 1;
    t.racers += 1;
    if (Object.keys(diff).length > 0) {
      t.mismatched += 1;
      for (const f of Object.keys(diff)) t.byField[f] += 1;
      mismatches.push({
        racer_id: off.racer_id,
        term,
        other_code: o.other,
        diff,
      });
    }
  }
  // 公式に無い選手×期で、こちらに出走がある（公式の名簿の外を数えている）
  const extra = [];
  for (const [k, o] of ours) {
    if (seen.has(k)) continue;
    if (tallyOf(o).starts > 0) extra.push(k);
  }
  return { compared, perTerm, mismatches, extra, unknownRuns };
}

function parseArgs(argv) {
  const opts = { from: "2019-05-01", to: "2025-11-01", out: null };
  for (const a of argv) {
    if (a.startsWith("--from=")) opts.from = a.slice(7);
    else if (a.startsWith("--to=")) opts.to = a.slice(5);
    else if (a.startsWith("--out=")) opts.out = a.slice(6);
    else throw new Error(`知らないオプション: ${a}`);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const career = await loadCareerFunctions();
  const client = new pg.Client({
    connectionString: checkRoUrl(process.env.SUPABASE_RO_DB_URL),
    ssl: { rejectUnauthorized: false },
    application_name: "verify-racer-career-gate",
  });
  await client.connect();
  let termRows;
  let courseRows;
  let champRows;
  let official;
  try {
    await client.query("BEGIN READ ONLY");
    const who = (await client.query("SELECT current_user AS u")).rows[0].u;
    if (who !== RO_ROLE)
      throw new Error(`接続ロールが ${who}（${RO_ROLE} でない）`);
    await client.query("SET LOCAL statement_timeout = '120s'");
    const meta = (
      await client.query(
        "SELECT era, computed_at, rule_version, report->>'full_computed_at' AS full_at FROM racer_career_meta ORDER BY era",
      )
    ).rows;
    console.log(`計算の記録: ${JSON.stringify(meta)}`);
    if (
      !meta.some((m) => m.era === "kb") ||
      !meta.some((m) => m.era === "main" && m.full_at)
    )
      throw new Error(
        "kb 層か main 層（全選手）がまだ計算されていない（racer-career-backfill.js を先に実行する）",
      );
    const stale = staleRuleEras(meta);
    if (stale.length > 0)
      throw new Error(
        `${stale.join("・")} 層の rule_version が今の ${RULE_VERSION} と違う（規則を変えた後に racer-career-backfill.js で計算し直す）`,
      );
    const cols = [
      "racer_id",
      "term_start::text AS term_start",
      ...COUNT_COLUMNS,
    ];
    termRows = (
      await client.query(
        `SELECT ${cols.join(", ")}, race_grade, is_final FROM racer_term_stats WHERE term_start BETWEEN $1::date AND $2::date`,
        [opts.from, opts.to],
      )
    ).rows;
    courseRows = (
      await client.query(
        `SELECT racer_id, course, term_start::text AS term_start, ${COURSE_COLUMNS.join(", ")} FROM racer_course_stats WHERE term_start BETWEEN $1::date AND $2::date`,
        [opts.from, opts.to],
      )
    ).rows;
    champRows = (
      await client.query(
        `SELECT racer_id, race_date::text AS race_date, finish_code FROM racer_championships
        WHERE race_date >= $1::date AND race_date < ($2::date + interval '6 months')`,
        [opts.from, opts.to],
      )
    ).rows;
    const courseCols = [];
    for (let c = 1; c <= 6; c++)
      for (const col of COURSE_COLUMNS) courseCols.push(`c${c}_${col}`);
    official = (
      await client.query(
        `SELECT racer_id, calc_from::text AS calc_from, starts, first_count, second_count, win_rate, finals, wins, ${courseCols.join(", ")}
         FROM racer_period_stats WHERE calc_from BETWEEN $1::date AND $2::date`,
        [opts.from, opts.to],
      )
    ).rows;
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
  const res = compareCareerToOfficial({
    termRows,
    courseRows,
    champRows,
    official,
    career,
  });
  console.log(`照らした選手×期: ${res.compared}`);
  for (const [term, t] of Object.entries(res.perTerm).sort())
    console.log(
      `  ${term}: ${t.racers - t.mismatched}/${t.racers} 一致  不一致の内訳 ${JSON.stringify(t.byField)}`,
    );
  console.log(
    `点が決まらない走（unknown_runs）がある選手×期: ${res.unknownRuns.length}${res.unknownRuns.length ? `（例 ${JSON.stringify(res.unknownRuns.slice(0, 10))}）` : ""}`,
  );
  console.log(
    `公式に無い選手×期で出走があるもの: ${res.extra.length}${res.extra.length ? `（例 ${res.extra.slice(0, 10).join(", ")}）` : ""}`,
  );
  for (const m of res.mismatches.slice(0, 30))
    console.log(`  不一致: ${JSON.stringify(m)}`);
  if (res.mismatches.length > 30)
    console.log(`  …ほか ${res.mismatches.length - 30} 件`);
  if (opts.out) writeFileSync(opts.out, `${JSON.stringify(res, null, 2)}\n`);
  if (res.compared === 0)
    throw new Error("照らす行が0件（racer_period_stats か期の指定を確かめる）");
  process.exitCode =
    res.mismatches.length === 0 && res.extra.length === 0 ? 0 : 1;
}

if (isDirectRun(import.meta.url)) {
  main().catch((error) => {
    console.error(`失敗: ${error.message}`);
    process.exit(1);
  });
}
