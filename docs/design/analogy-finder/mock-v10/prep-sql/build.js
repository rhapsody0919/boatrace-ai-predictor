// raw/*.json（Supabase MCP execute_sql の出力をそのまま保存したもの）を合算し、Wilson 95%CI を付けて prep.json を作る。
// 使い方: node build.js  → prep.json を上書き、表の素材を stdout に出す
import fs from "node:fs";
import path from "node:path";

const dir = path.dirname(new URL(import.meta.url).pathname);
const rd = (f) => JSON.parse(fs.readFileSync(path.join(dir, "raw", f), "utf8"));
const CHUNKS = [
  "c1_2019-04-01_2022-09-30.json",
  "c2_2022-10-01_2025-12-02.json",
  "c3_2025-12-03_2026-10-02.json",
];
const chunks = CHUNKS.map((f) => ({ file: f, ...rd(f) }));
const q4 = rd("q4_profiles.json");
const kbDiff = rd("q0_kb_diff.json");

const Z = 1.959964;
const r3 = (x) =>
  x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000;
const r2 = (x) =>
  x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100;
function wilson(x, n) {
  if (!n) return { x, n, p: null, lo: null, hi: null };
  const p = x / n;
  const d = 1 + (Z * Z) / n;
  const c = (p + (Z * Z) / (2 * n)) / d;
  const h = (Z * Math.sqrt((p * (1 - p)) / n + (Z * Z) / (4 * n * n))) / d;
  return { x, n, p: r3(p), lo: r3(c - h), hi: r3(c + h) };
}
const addArr = (a, b) => a.map((v, i) => v + b[i]);
const minD = (a, b) => (a < b ? a : b);
const maxD = (a, b) => (a > b ? a : b);

// ---- Q1 の合算 ----
const units = new Map();
const months = new Map();
for (const ch of chunks) {
  for (const row of ch.q1) {
    const [unit, n, nkb, nmain, dmin, dmax] = row;
    if (unit.startsWith("m:")) {
      const m = months.get(unit) || { n: 0, n_kb: 0, n_main: 0 };
      months.set(unit, {
        n: m.n + n,
        n_kb: m.n_kb + nkb,
        n_main: m.n_main + nmain,
      });
      continue;
    }
    const [, , , , , , r1, wc, waku, cknown, rnull, gnull, tech] = row;
    const u = units.get(unit);
    if (!u) {
      units.set(unit, {
        n,
        n_kb: nkb,
        n_main: nmain,
        dmin,
        dmax,
        r1: [...r1],
        wc: [...wc],
        waku,
        cknown,
        rnull,
        gnull,
        tech: { ...(tech || {}) },
      });
    } else {
      u.n += n;
      u.n_kb += nkb;
      u.n_main += nmain;
      u.dmin = minD(u.dmin, dmin);
      u.dmax = maxD(u.dmax, dmax);
      u.r1 = addArr(u.r1, r1);
      u.wc = addArr(u.wc, wc);
      u.waku += waku;
      u.cknown += cknown;
      u.rnull += rnull;
      u.gnull += gnull;
      for (const [k, v] of Object.entries(tech || {}))
        u.tech[k] = (u.tech[k] || 0) + v;
    }
  }
}
const TECH6 = ["逃げ", "差し", "まくり", "まくり差し", "抜き", "恵まれ"];
function outcome(unit) {
  const u = units.get(unit);
  if (!u) return null;
  const nCourseKnown = u.wc.slice(0, 6).reduce((a, b) => a + b, 0);
  return {
    n: u.n,
    n_kb: u.n_kb,
    n_main: u.n_main,
    period: [u.dmin, u.dmax],
    round_null: u.rnull,
    grade_null: u.gnull,
    b1_win: wilson(u.r1[0], u.n),
    winner_boat: Object.fromEntries(
      u.r1.map((x, i) => [String(i + 1), wilson(x, u.n)]),
    ),
    winner_course: {
      denominator: "1着艇の進入コースが分かるレース",
      n_known: nCourseKnown,
      n_unknown: u.wc[6],
      dist: Object.fromEntries(
        u.wc
          .slice(0, 6)
          .map((x, i) => [String(i + 1), wilson(x, nCourseKnown)]),
      ),
    },
    waku_nari: {
      all_course_known: u.cknown,
      ...wilson(u.waku, u.cknown),
      note: "6艇とも進入コースが分かるレースのうち、course_by_boat = [1,2,3,4,5,6] の割合",
    },
    technique_raw: Object.fromEntries(
      Object.entries(u.tech)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => [k, wilson(v, u.n)]),
    ),
    technique_120_null: u.n - TECH6.reduce((a, k) => a + (u.tech[k] || 0), 0),
  };
}
const venues = Array.from({ length: 24 }, (_, i) => String(i + 1));
const q1 = {
  national: outcome("all"),
  venue: Object.fromEntries(venues.map((v) => [v, outcome("v:" + v)])),
  grade: Object.fromEntries(
    ["ippan", "G3", "G2", "G1", "SG", "NULL"].map((g) => [
      g,
      outcome("g:" + g),
    ]),
  ),
  round: Object.fromEntries(
    ["yosen", "junyu", "yusho", "other", "NULL"].map((r) => [
      r,
      outcome("r:" + r),
    ]),
  ),
  wakamatsu_G1_yusho: outcome("x:20G1yusho"),
  national_yusho: outcome("r:yusho"),
  wakamatsu_all: outcome("v:20"),
};

// ---- 月別件数 ----
const monthly = [...months.entries()]
  .sort(([a], [b]) => (a < b ? -1 : 1))
  .map(([m, v]) => ({ month: m.slice(2), ...v }));
const total = monthly.reduce((a, m) => a + m.n, 0);
const totalTo202609 = monthly
  .filter((m) => m.month <= "2026-09")
  .reduce((a, m) => a + m.n, 0);
const kbTotal = monthly.reduce((a, m) => a + m.n_kb, 0);
const mainTo202609 = monthly
  .filter((m) => m.month <= "2026-09")
  .reduce((a, m) => a + m.n_main, 0);

// ---- Q2 ----
const q2rows = chunks
  .flatMap((c) => c.q2 || [])
  .map((r) => ({
    race_id: r[0],
    race_date: r[1],
    source: r[2],
    top3: [r[3], r[4], r[5]],
    technique_raw: r[6],
    finish_by_boat: r[7],
    finish_code_by_boat: r[8],
    st_by_boat: r[9],
    st_rank_by_boat: r[10],
    course_by_boat: r[11],
  }));

// ---- Q3 ----
const q3acc = new Map();
for (const c of chunks) {
  for (const [k, t, nAll, nHit, nB, ind] of c.q3) {
    const key = `${k}|${t}`;
    const a = q3acc.get(key) || { k, t, n_all: 0, n_hit: 0, n_b: 0, ind: {} };
    a.n_all += nAll;
    a.n_hit += nHit;
    a.n_b += nB;
    for (const [name, arr] of Object.entries(ind))
      a.ind[name] = a.ind[name] ? addArr(a.ind[name], arr) : [...arr];
    q3acc.set(key, a);
  }
}
const INDS = ["b1d", "b1s", "st1_tie", "st1_solo", "ib", "md"];
const q3 = [...q3acc.values()]
  .sort((a, b) => a.k - b.k || a.t - b.t)
  .map((a) => {
    const nC = a.n_all - a.n_hit;
    const indicators = {};
    for (const name of INDS) {
      if ((name === "b1d" || name === "b1s") && a.k === 1) {
        indicators[name] = { excluded: "k=1 は対象外" };
        continue;
      }
      const [iAll, iHit, iB] = a.ind[name];
      const hit = wilson(iHit, a.n_hit);
      const A = wilson(iAll, a.n_all);
      const B = wilson(iB, a.n_b);
      const C = wilson(iAll - iHit, nC);
      indicators[name] = {
        hit,
        A_all: A,
        B_b1_not_win: B,
        C_k_not_in_top: C,
        ratio_vs_A: r2(
          hit.p != null && A.p ? iHit / a.n_hit / (iAll / a.n_all) : null,
        ),
        ratio_vs_B: r2(
          hit.p != null && iB ? iHit / a.n_hit / (iB / a.n_b) : null,
        ),
        ratio_vs_C: r2(
          hit.p != null && iAll - iHit
            ? iHit / a.n_hit / ((iAll - iHit) / nC)
            : null,
        ),
      };
    }
    const nulls = Object.fromEntries(
      ["null_b1_st", "null_st_k", "null_course_k"].map((n) => [
        n,
        { all: a.ind[n][0], hit: a.ind[n][1], b: a.ind[n][2] },
      ]),
    );
    return {
      k: a.k,
      t: a.t,
      t_label: a.t === 1 ? "1着" : "3着以内",
      n_all: a.n_all,
      n_hit: a.n_hit,
      n_b1_not_win: a.n_b,
      n_k_not_in_top: nC,
      indicators,
      nulls,
    };
  });

const prep = {
  _meta: {
    generated_at: new Date().toISOString(),
    data_version:
      "本番 Supabase（読み取りのみ、MCP execute_sql）。Q1〜Q3: 2026-10-03 07:09〜07:20 JST 取得、Q4: 2026-10-03 07:21 JST 取得（DB now()=2026-10-02T22:21Z）",
    population:
      "docs/db-migration/120_analogy_strata.sql の analogy_pool_outcomes 相当（analogy_pool_rows_kb ＋ analogy_pool_rows_main の SELECT をインライン化。120 は本番未適用）。kb=kb_archive_*（〜2025-12-02）、main=本体テーブル（2025-12-03〜）",
    period: ["2019-04-01", "2026-10-02"],
    chunks: CHUNKS,
    sql: [
      "sql/pool_base.sql",
      "sql/pool_base_kb_only.sql",
      "sql/pool_base_main_only.sql",
      "sql/q_all_tail.sql",
      "sql/q4_profiles.sql",
      "render.js",
    ],
    ci: "Wilson 95%（z=1.96）。割合は小数3桁、倍率は小数2桁",
    definitions: {
      winner_boat: "1着の艇番（枠）。進入コースではない",
      winner_course:
        "1着艇の進入コース（kb: kb_archive_boats.course、main: race_results.actual_course_N）。不明は分母から除く",
      waku_nari:
        "6艇とも進入コースが分かるレースで、全艇が艇番どおりのコースに入った割合",
      technique_raw:
        "DB の決まり手の値そのまま（kb: kb_archive_races.technique、main: race_results.winning_technique）。120 の winning_technique は6分類以外を NULL にする（technique_120_null）",
      st: "ST は各艇の start_timing（kb: kb_archive_boats、main: race_start_timings）。返還艇（F・出遅れ。main は着欄 F/L/欠・refund_boats も含む＝120 と同じ）は NULL",
      st_rank:
        "返還艇・ST 不明を除いた艇の中で小さい順、同タイムは同順位（min 順位。例: ST 0.11, 0.13, 0.13, 0.13, 0.14 → 順位 1, 2, 2, 2, 5）。SQL: 1 + (自艇より ST が小さい艇の数)",
      finish_code:
        "着の生コード（kb: kb_archive_boats.finish_raw、main: race_start_timings.official_finish_code、無ければ finish_mark）。01〜06=着、F=フライング、L0/L1=出遅れ、S0/S1/S2=失格（転覆・落水・エンスト・妨害・不完走等）、K0/K1=欠場（母集団からは除外済み）、00=着順なし",
      q3_hit: "艇 k の着順 <= t（t=1: 1着、t=3: 3着以内）",
      b1d: "1号艇が3着以内でない（4着以下・F・出遅れ・失格。母集団は欠場を除くのでこれと同値）。k=1 は対象外",
      b1s: "1号艇の ST 順位（上の st_rank）が4位以下。1号艇の ST が NULL（返還艇・不明）は false として数え、件数を nulls.null_b1_st に出す。k=1 は対象外",
      st1_tie:
        "艇 k の ST 順位が1位（同タイム1位を含む）。艇 k の ST が NULL は false（nulls.null_st_k）",
      st1_solo: "艇 k の ST が単独1位（同タイム1位の艇が他にいない）",
      ib: "艇 k より小さい艇番のどれかが返還艇（F・出遅れ）または着コード S*（失格）。k=1 は常に false",
      md: "艇 k の進入コース < k（枠より内に入った）。コース不明は false（nulls.null_course_k）",
      A: "全国×優勝戦の全レース",
      B: "1号艇以外が1着のレース（rank1<>1）",
      C: "艇 k が t着以内でないレース",
    },
  },
  population_check: {
    total_2019_04_01_to_2026_10_02: total,
    kb: kbTotal,
    main: total - kbTotal,
    total_2019_04_to_2026_09: totalTo202609,
    main_2025_12_03_to_2026_09_30: mainTo202609,
    expected_phase_m_2019_04_to_2026_09: {
      total: 409588,
      kb: 362927,
      main: 46661,
      source:
        "docs/design/analogy-finder/analysis/phase-m-result.md / 120 冒頭コメント",
    },
    kb_diff_breakdown: kbDiff,
    diff_total: totalTo202609 - 409588,
    diff_kb: kbTotal - 362927,
    diff_main: mainTo202609 - 46661,
    monthly,
  },
  q1_outcomes: q1,
  q2_wakamatsu_G1_yusho_races: {
    n: q2rows.length,
    n_kb: q2rows.filter((r) => r.source === "kb").length,
    n_main: q2rows.filter((r) => r.source === "main").length,
    rows: q2rows,
  },
  q3_national_yusho_conditional: q3,
  q4_contribution_profiles: q4,
};
fs.writeFileSync(path.join(dir, "prep.json"), JSON.stringify(prep, null, 1));

// ---- stdout: md 用の素材 ----
const pct = (w) =>
  w && w.p != null
    ? `${w.p.toFixed(3)} [${w.lo.toFixed(3)}, ${w.hi.toFixed(3)}] (${w.x}/${w.n})`
    : "-";
console.log(
  "TOTAL",
  total,
  "kb",
  kbTotal,
  "main",
  total - kbTotal,
  "to2026-09",
  totalTo202609,
  "diff",
  totalTo202609 - 409588,
  "kbdiff",
  kbTotal - 362927,
  "maindiff",
  mainTo202609 - 46661,
);
for (const m of monthly) console.log("M", m.month, m.n, m.n_kb, m.n_main);
const line = (label, o) => {
  if (!o) return console.log("U", label, "none");
  console.log(
    "U",
    label,
    `n=${o.n} kb=${o.n_kb} main=${o.n_main} ${o.period.join("..")} rnull=${o.round_null} gnull=${o.grade_null}`,
  );
  console.log("  b1", pct(o.b1_win));
  console.log(
    "  boat",
    Object.entries(o.winner_boat)
      .map(([k, w]) => `${k}:${pct(w)}`)
      .join(" | "),
  );
  console.log(
    "  course",
    `unk=${o.winner_course.n_unknown}`,
    Object.entries(o.winner_course.dist)
      .map(([k, w]) => `${k}:${pct(w)}`)
      .join(" | "),
  );
  console.log("  waku", pct(o.waku_nari));
  console.log(
    "  tech",
    Object.entries(o.technique_raw)
      .map(([k, w]) => `${k}:${w.p.toFixed(3)}(${w.x})`)
      .join(" "),
  );
};
line("national", q1.national);
for (const v of venues) line("v" + v, q1.venue[v]);
for (const g of Object.keys(q1.grade)) line("g" + g, q1.grade[g]);
for (const r of Object.keys(q1.round)) line("r" + r, q1.round[r]);
line("x20G1yusho", q1.wakamatsu_G1_yusho);
for (const r of q3) {
  console.log(
    "Q3",
    `k=${r.k} t=${r.t} n_all=${r.n_all} n_hit=${r.n_hit} n_B=${r.n_b1_not_win} n_C=${r.n_k_not_in_top}`,
    JSON.stringify(r.nulls),
  );
  for (const [name, v] of Object.entries(r.indicators)) {
    if (v.excluded) continue;
    console.log(
      "   ",
      name,
      "hit",
      pct(v.hit),
      "| A",
      pct(v.A_all),
      "| B",
      pct(v.B_b1_not_win),
      "| C",
      pct(v.C_k_not_in_top),
      "| xA",
      v.ratio_vs_A,
      "xB",
      v.ratio_vs_B,
      "xC",
      v.ratio_vs_C,
    );
  }
}
