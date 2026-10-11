// prep2: 例のレース（2026-09-27-20-12）の類似レース（層別 S*）と、会場×グレード×ラウンドの cube。
// raw/p2_*.json・raw/p2_cube_*.txt（Supabase MCP execute_sql の出力をそのまま保存）から prep2.json と prep2.md を作る。
// 使い方: node build2.js
import fs from "node:fs";
import path from "node:path";

const dir = path.dirname(new URL(import.meta.url).pathname);
const rd = (f) => JSON.parse(fs.readFileSync(path.join(dir, "raw", f), "utf8"));
const Z = 1.959964;
const r3 = (x) => Math.round(x * 1000) / 1000;
function wilson(x, n) {
  if (!n) return { x, n, p: null, lo: null, hi: null };
  const p = x / n,
    d = 1 + (Z * Z) / n;
  const c = (p + (Z * Z) / (2 * n)) / d;
  const h = (Z * Math.sqrt((p * (1 - p)) / n + (Z * Z) / (4 * n * n))) / d;
  return { x, n, p: r3(p), lo: r3(c - h), hi: r3(c + h) };
}
const add = (a, b) => a.map((v, i) => v + b[i]);

const target = rd("p2_target.json");
const counts = rd("p2_counts.json");
const Lkb = rd("p2_layer_kb.json");
const Lm = rd("p2_layer_main.json");
const prep = JSON.parse(fs.readFileSync(path.join(dir, "prep.json"), "utf8"));

// ---- 1. 条件 ----
const E = target.race.entries; // [boat, grade, win_rate, motor, absent]
const w1 = E[0][2];
const wMaxOther = Math.max(...E.slice(1).map((e) => e[2]));
const gap = Math.round((w1 - wMaxOther) * 100) / 100;
const BANDS = [
  { band: 0, lo: null, hi: -1.91, label: "−1.91 未満" },
  { band: 1, lo: -1.91, hi: -1.14, label: "−1.91 以上 −1.14 未満" },
  { band: 2, lo: -1.14, hi: -0.49, label: "−1.14 以上 −0.49 未満" },
  { band: 3, lo: -0.49, hi: 0.19, label: "−0.49 以上 0.19 未満" },
  { band: 4, lo: 0.19, hi: null, label: "0.19 以上" },
  { band: 5, lo: null, hi: null, label: "勝率が取れない" },
];
const gapBand =
  gap >= 0.19 ? 4 : gap >= -0.49 ? 3 : gap >= -1.14 ? 2 : gap >= -1.91 ? 1 : 0;
const topBoat = [...E].sort((a, b) => b[2] - a[2] || a[0] - b[0])[0][0];
const m1 = E[0][3];
const motorRank = 1 + E.slice(1).filter((e) => e[3] && e[3] > m1).length;
const motorBand = motorRank <= 2 ? 0 : motorRank <= 4 ? 1 : 2;
const conditions = {
  race_id: target.race.race_id,
  race_date: target.race.race_date,
  venue_code: 20,
  venue_name: "若松",
  race_number: 12,
  gap_band: gapBand,
  gap_band_range: BANDS[gapBand],
  b1_win_rate: w1,
  max_other_win_rate: wMaxOther,
  b1_win_gap: gap,
  all_gap_bands: BANDS,
  b1_class: E[0][1],
  top_boat: topBoat,
  top_boat_win_rate: E[topBoat - 1][2],
  extras: {
    round: "yusho",
    round_source: `race_conditions.race_stage = '${target.race.race_stage}'`,
    grade: "G1",
    grade_source: `races.race_grade = '${target.race.race_grade}'`,
    b1_motor_2rate: m1,
    b1_motor_rank: motorRank,
    b1_motor_band: motorBand,
    motor_band_label: "5〜6位（帯2）",
    motor_by_boat: E.map((e) => e[3]),
  },
  win_rate_by_boat: E.map((e) => e[2]),
  class_by_boat: E.map((e) => e[1]),
};

// ---- 2. 深さ ----
const n = add(counts.kb.n, counts.main.n);
const autoDepth = n[3] >= 200 ? 4 : n[2] >= 200 ? 3 : n[1] >= 200 ? 2 : 1;
const plus = Object.fromEntries(
  ["plus_round", "plus_grade", "plus_motor", "plus_all3"].map((k) => [
    k,
    add(counts.kb[k], counts.main[k]),
  ]),
);
const depth = {
  cutoff: "2026-09-26",
  pool: {
    from: counts.kb.pool_min,
    to: counts.main.pool_max,
    n: counts.kb.n_pool + counts.main.n_pool,
    n_kb: counts.kb.n_pool,
    n_main: counts.main.n_pool,
  },
  layers: [
    {
      depth: 1,
      conditions: "勝率差の帯=1",
      n: n[0],
      n_kb: counts.kb.n[0],
      n_main: counts.main.n[0],
    },
    {
      depth: 2,
      conditions: "＋1号艇の級別=A1",
      n: n[1],
      n_kb: counts.kb.n[1],
      n_main: counts.main.n[1],
    },
    {
      depth: 3,
      conditions: "＋会場=若松(20)",
      n: n[2],
      n_kb: counts.kb.n[2],
      n_main: counts.main.n[2],
    },
    {
      depth: 4,
      conditions: "＋勝率1位の艇=4",
      n: n[3],
      n_kb: counts.kb.n[3],
      n_main: counts.main.n[3],
    },
  ],
  auto_depth: autoDepth,
  m: 200,
  add_optional: Object.fromEntries(
    Object.entries(plus).map(([k, v]) => [
      k,
      { by_depth: v, at_auto_depth: v[autoDepth - 1] },
    ]),
  ),
};

// ---- 3. 層 ----
const sumObj = (a, b) => {
  const o = { ...a };
  for (const [k, v] of Object.entries(b)) o[k] = (o[k] || 0) + v;
  return o;
};
const L = {
  n: Lkb.n + Lm.n,
  n_kb: Lkb.n,
  n_main: Lm.n,
  dmin: Lkb.n ? Lkb.dmin : Lm.dmin,
  dmax: Lm.n ? Lm.dmax : Lkb.dmax,
  tech: sumObj(Lkb.tech, Lm.tech),
  winner_boat: sumObj(Lkb.winner_boat, Lm.winner_boat),
  winner_course: sumObj(Lkb.winner_course, Lm.winner_course),
  trifecta: sumObj(Lkb.trifecta, Lm.trifecta),
};
if (L.n !== n[autoDepth - 1])
  throw new Error(
    `層の件数が深さの件数と合わない: ${L.n} vs ${n[autoDepth - 1]}`,
  );
const distW = (o, den) =>
  Object.fromEntries(
    Object.entries(o)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => [k, wilson(v, den)]),
  );
const tri = Object.entries(L.trifecta).sort(
  (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
);
const tenth = tri[9][1];
const layer = {
  depth: autoDepth,
  conditions: "勝率差の帯=1・1号艇=A1・会場=若松",
  n: L.n,
  n_kb: L.n_kb,
  n_main: L.n_main,
  period: [L.dmin, L.dmax],
  technique: distW(L.tech, L.n),
  winner_boat: Object.fromEntries(
    [1, 2, 3, 4, 5, 6].map((b) => [b, wilson(L.winner_boat[b] || 0, L.n)]),
  ),
  winner_course: Object.fromEntries(
    ["1", "2", "3", "4", "5", "6", "NULL"].map((c) => [
      c,
      wilson(L.winner_course[c] || 0, L.n),
    ]),
  ),
  trifecta_top10: tri
    .slice(0, 10)
    .map(([k, v]) => ({ combo: k, ...wilson(v, L.n) })),
  trifecta_ties_at_10th: tri.filter(([, v]) => v === tenth).map(([k]) => k),
  trifecta_distinct: tri.length,
};

// ---- 4. 艇k×着順 ----
const kt = Lkb.kt.map((row, i) => {
  const m = Lm.kt[i];
  if (row[0] !== m[0] || row[1] !== m[1]) throw new Error("kt の並びが違う");
  const ind = row[4]
    ? Object.fromEntries(
        Object.keys(row[4]).map((k) => [k, add(row[4][k], m[4][k])]),
      )
    : null;
  return {
    k: row[0],
    t: row[1],
    n_hit: row[2] + m[2],
    n_b: row[3] + m[3],
    ind,
  };
});
const nB = kt[0].n_b; // 1号艇以外が1着
const INDS = ["b1d", "b1s", "st1_tie", "st1_solo", "ib", "md"];
const nonB1 = [
  ...Lkb.non_b1_wins.map((r) => ["kb", ...r]),
  ...Lm.non_b1_wins.map((r) => ["main", ...r]),
];
if (nonB1.length !== nB)
  throw new Error(
    `1号艇以外1着の一覧の件数 ${nonB1.length} と n_b ${nB} が合わない`,
  );
const k_by_t = kt.map((r) => ({
  k: r.k,
  t: r.t,
  t_label: ["1着", "2着以内", "3着以内"][r.t - 1],
  n_hit: r.n_hit,
  share: wilson(r.n_hit, L.n),
}));
const t1 = kt
  .filter((r) => r.t === 1)
  .map((r) => {
    const hitN = r.n_hit;
    const cmpLabel =
      r.k === 1 ? "C（1号艇が1着でない＝B と同じ集合）" : "B（1号艇以外が1着）";
    const indicators = {};
    for (const name of INDS) {
      if ((name === "b1d" || name === "b1s") && r.k === 1) {
        indicators[name] = { excluded: "k=1 は対象外" };
        continue;
      }
      const [all, hit, b] = r.ind[name];
      const cmpX = r.k === 1 ? all - hit : b; // k=1: C = 艇1が1着でない＝B
      const cmpN = r.k === 1 ? L.n - hitN : nB;
      const h = wilson(hit, hitN),
        c = wilson(cmpX, cmpN);
      indicators[name] = {
        hit: h,
        compare: c,
        ratio:
          hit && cmpX
            ? Math.round((hit / hitN / (cmpX / cmpN)) * 100) / 100
            : null,
      };
    }
    const list =
      hitN < 30 && r.k >= 2
        ? nonB1
            .filter((x) => Number(x[3].split("-")[0]) === r.k)
            .map((x) => {
              const codes = x[5].split(","),
                stRank = x[6].split(","),
                course = x[7].split(",");
              return {
                source: x[0],
                race_date: x[1],
                venue_code: 20,
                race_number: x[2],
                top3: x[3],
                technique_raw: x[4],
                b1_finish: codes[0],
                b1_st_rank: stRank[0],
                k_finish: codes[r.k - 1],
                k_st_rank: stRank[r.k - 1],
                k_course: course[r.k - 1],
                all_finish: x[5],
                all_st_rank: x[6],
                all_course: x[7],
              };
            })
        : null;
    if (list && list.length !== hitN)
      throw new Error(
        `k=${r.k} の一覧 ${list.length} と n_hit ${hitN} が合わない`,
      );
    return {
      k: r.k,
      n_hit: hitN,
      compare: cmpLabel,
      compare_n: r.k === 1 ? L.n - hitN : nB,
      indicators,
      races_if_n_hit_lt_30: list,
    };
  });

// ---- 6. 実際の結果 ----
const R = target.result;
const result = {
  top3: R.rank.slice(0, 3).join("-"),
  finish_order_by_rank: R.rank,
  technique: R.winning_technique,
  by_boat: R.st.map(([b, st, f, l, mark, code, ec]) => ({
    boat: b,
    finish: code,
    start_timing: st,
    is_flying: f,
    is_late_start: l,
    entry_course: R.actual_course[b - 1],
    st_rank: 1 + R.st.filter((o) => o[1] < st).length,
  })),
  payout_3tan_yen: R["payout_trio_col(=3連単, 120 の注記)"],
  note: "ST順位は6艇の ST で min 順位（返還艇なし）。payout_3tan は race_results.payout_trio（120 の注記どおり列名と券種が逆）",
};

// ---- cube ----
const parseCells = (f) =>
  fs
    .readFileSync(path.join(dir, "raw", f), "utf8")
    .trim()
    .split(";")
    .map((s) => {
      const [v, g, r, nn, dmin, dmax, r1, tc] = s.split("|");
      return {
        v,
        g,
        r,
        n: +nn,
        dmin,
        dmax,
        r1: r1.split(",").map(Number),
        tc: tc.split(",").map(Number),
      };
    });
const cells = [
  ...parseCells("p2_cube_kb.txt"),
  ...parseCells("p2_cube_main.txt"),
];
const cube = {};
for (const c of cells) {
  for (const vk of [c.v, "0"])
    for (const gk of c.g === "NULL" ? ["all"] : [c.g, "all"])
      for (const rk of c.r === "NULL" ? ["all"] : [c.r, "all"]) {
        const key = `${vk}|${gk}|${rk}`;
        const o = cube[key];
        if (!o) cube[key] = [c.n, c.dmin, c.dmax, ...c.r1, ...c.tc];
        else {
          o[0] += c.n;
          if (c.dmin < o[1]) o[1] = c.dmin;
          if (c.dmax > o[2]) o[2] = c.dmax;
          for (let i = 0; i < 6; i++) o[3 + i] += c.r1[i];
          for (let i = 0; i < 7; i++) o[9 + i] += c.tc[i];
        }
      }
}
// 検算: prep.json の全国・会場・グレード・ラウンドと一致するか
const q1 = prep.q1_outcomes;
const checks = [
  ["0|all|all", q1.national],
  ...Object.entries(q1.venue).map(([v, o]) => [`${v}|all|all`, o]),
  ...["ippan", "G3", "G2", "G1", "SG"].map((g) => [`0|${g}|all`, q1.grade[g]]),
  ...["yosen", "junyu", "yusho", "other"].map((r) => [
    `0|all|${r}`,
    q1.round[r],
  ]),
  ["20|G1|yusho", q1.wakamatsu_G1_yusho],
];
const T6 = ["逃げ", "差し", "まくり", "まくり差し", "抜き", "恵まれ"];
for (const [key, o] of checks) {
  const c = cube[key];
  const ok =
    c &&
    c[0] === o.n &&
    c[1] === o.period[0] &&
    c[2] === o.period[1] &&
    [1, 2, 3, 4, 5, 6].every((b, i) => c[3 + i] === o.winner_boat[b].x) &&
    T6.every((t, i) => c[9 + i] === (o.technique_raw[t]?.x || 0));
  if (!ok)
    throw new Error(
      `cube の検算が合わない: ${key} ${JSON.stringify(c)} vs n=${o.n}`,
    );
}
const cubeKeys = Object.keys(cube).sort();

const out = {
  _meta: {
    generated_at: new Date().toISOString(),
    data_version:
      "本番 Supabase（読み取りのみ、MCP execute_sql）。2026-10-03 07:33〜07:50 JST 取得",
    population:
      "120 の analogy_pool_outcomes 相当（prep.json と同じ定義。kb〜2025-12-02・本体 2025-12-03〜）。4条件の列（b1_class・b1_win_gap・top_boat）と1号艇のモーター順位は 120 の式をインライン化（sql/pool_base2*.sql）",
    procedure:
      "120 の get_analogy_similar と同じ: スナップショットが無いので analogy_race_conditions と同じ作り方で条件を作り、そのレースの日より前（〜2026-09-26）の母集団で深さ1〜4の件数を数え、analogy_auto_depth（m=200）で深さを選ぶ",
    sql: [
      "sql/pool_base2.sql",
      "sql/p2_counts_tail.sql",
      "sql/p2_layer_tail.sql",
      "sql/executed_p2_layer_kb.sql",
      "sql/executed_p2_layer_main.sql",
      "sql/p2_target.sql",
      "sql/p2_cube_tail.sql",
      "sql/executed_p2_cube_kb.sql",
      "sql/executed_p2_cube_main.sql",
    ],
    ci: "Wilson 95%（z=1.96）。割合は小数3桁",
  },
  conditions,
  depth,
  layer,
  k_by_t,
  t1_indicators: t1,
  actual_result: result,
  cube_format: {
    key: "venue|grade|round。venue 0=全国、1〜24=会場。grade all/ippan/G3/G2/G1/SG（grade NULL のレース 808R は all にだけ入る）。round all/yosen/junyu/yusho/other（round NULL は 0R）",
    value:
      "[n, dmin, dmax, 1着艇番1, 2, 3, 4, 5, 6, 逃げ, 差し, まくり, まくり差し, 抜き, 恵まれ, その他(6分類以外・NULL)]。1号艇の1着率 = [3]/[0]",
    period: "2019-04-01〜2026-10-02（例のレース自身 2026-09-27 も含む）",
    n_keys: cubeKeys.length,
    omitted: "n=0 の組み合わせはキーを作っていない",
    check:
      "prep.json の全国・会場24・グレード5・ラウンド4・若松×G1×優勝戦の n・期間・1着艇番・決まり手（6分類）と一致することを build2.js で検算済み",
  },
  cube: Object.fromEntries(cubeKeys.map((k) => [k, cube[k]])),
};
fs.writeFileSync(path.join(dir, "prep2.json"), JSON.stringify(out));
console.log("ok", "keys", cubeKeys.length, "depth", autoDepth, n, "layer", L.n);
