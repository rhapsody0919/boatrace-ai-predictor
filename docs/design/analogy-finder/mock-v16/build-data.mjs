// モック Version 10 のデータを、prep/prep2/prep3（実データ）と model-prep（本番モデル 2026-10-02）から作る。
// 使い方: node build-data.mjs → data.js（const D = {...}）
import fs from "node:fs";
const SP = new URL("..", import.meta.url).pathname;
const rd = (p) => JSON.parse(fs.readFileSync(SP + p, "utf8"));
const p2 = rd("prep/prep2.json");
const mp = rd("model-prep/model-prep.json");
const p3 = fs.existsSync(SP + "prep/prep3.json") ? rd("prep/prep3.json") : null;
const p4 = fs.existsSync(SP + "prep/prep4.json") ? rd("prep/prep4.json") : null;
const p5 = fs.existsSync(SP + "prep/prep5.json") ? rd("prep/prep5.json") : null;
const k2 = fs.existsSync(SP + "knn/knn2.json") ? rd("knn/knn2.json") : null;
// v16: 優勝戦・準優勝戦はラウンドもそろえた版（knn5・knn6）があればそちらを使う
const k3 = fs.existsSync(SP + "knn/knn5.json") ? rd("knn/knn5.json") : fs.existsSync(SP + "knn/knn3.json") ? rd("knn/knn3.json") : null;
const p6 = fs.existsSync(SP + "prep/prep6.json") ? rd("prep/prep6.json") : null;
const sc = fs.existsSync(SP + "model-prep/share-cube2.json") ? rd("model-prep/share-cube2.json") : (fs.existsSync(SP + "model-prep/share-cube.json") ? rd("model-prep/share-cube.json") : null);
const bpj = fs.existsSync(SP + "model-prep/boat-profile2.json") ? rd("model-prep/boat-profile2.json") : (fs.existsSync(SP + "model-prep/boat-profile.json") ? rd("model-prep/boat-profile.json") : null);
// 艇番の中で中心化した材料（枠を除く）。向きは言葉にする
const DIRW = { raceNumber: ["R番号", "後半", "前半"], class: ["級別", "上", "下"], national: ["6艇の中で全国勝率", "高い", "低い"], local: ["6艇の中で当地勝率", "高い", "低い"], recent: ["6艇の中で直近30走の1着率", "高い", "低い"], boat1: ["1号艇の全国勝率", "高い", "低い"], exhibitionTime: ["6艇の中で展示タイム", "遅い", "速い"], pastSt: ["6艇の中で過去の平均ST", "遅い", "早い"], motor: ["6艇の中でモーター2連率", "高い", "低い"], boat: ["6艇の中でボート2連率", "高い", "低い"], wind: ["風", "強い", "弱い"], wave: ["波", "高い", "低い"], seriesDay: ["節の日目", "後半", "前半"], age: ["年齢", "高い", "若い"], weight: ["体重", "重い", "軽い"], branch: ["地元", "地元", "地元以外"] };
const VJ = { yosen: "予選", junyu: "準優勝戦", yusho: "優勝戦", other: "その他", ippan: "一般" };
const dirText = (g, d0) => { let d = d0;
  if (!d) return "";
  if (d.top3) { const big = Math.max(...[...d.top3, ...d.bottom3].map((x) => Math.abs(x.mean_shap))); if (big < 0.01) return "どれでもほとんど変わらない"; const nm = (x) => VJ[x.value] || x.value; return `上がる: ${d.top3.filter((x) => x.mean_shap > 0.005).map(nm).join("・") || "—"}／下がる: ${d.bottom3.filter((x) => x.mean_shap < -0.005).map(nm).join("・") || "—"}`; }
  const w = DIRW[g]; if (!w) return "";
  if (d.features) { const PREF = { national: "nat_win_diff", local: "loc_win_diff", recent: "recent_win30_diff", exhibitionTime: "exh_time_diff", pastSt: "st_mean30_diff", motor: "motor_2_diff", boat: "boat_2_diff" }; const f = d.features[PREF[g]] || Object.values(d.features)[0]; d = { spearman: f.spearman, bands: f.bands }; }
  const sp = d.spearman;
  const b = d.bands, span = b ? Math.abs(b["高"].mean_shap - b["低"].mean_shap) : 0;
  if (b && b["中"] && b["中"].mean_shap - Math.max(b["低"].mean_shap, b["高"].mean_shap) >= 0.01) return `${w[0]}が中くらいで見込みが上がる（まっすぐな向きではない）`;
  if (Math.abs(sp) < 0.3 || span < 0.01) return "向きははっきりしない";
  if (g === "branch") return sp > 0 ? "地元だと見込みが上がる" : "地元以外だと見込みが上がる";
  return `${w[0]}が${sp > 0 ? w[1] : w[2]}ほど見込みが上がる`;
};
const r4b = (x) => Math.round(x * 1e4) / 1e4;
const bpOf = (j) => j ? {
  period: `${j.population.period[0]}〜${j.population.period[1]}（${j.population.excluded_months.join("・")} を除く、${j.population.n_races.toLocaleString()}レース）`,
  themes: j.themes,
  nat: Object.fromEntries(Object.entries(j.national).map(([m, bs]) => [m, Object.fromEntries(Object.entries(bs).map(([b, v]) => [b, { t: Object.fromEntries(Object.entries(v.theme_share).map(([k, [x, sd]]) => [k, [x, sd]])), g: Object.fromEntries(Object.entries(v.group_share).map(([k, [x]]) => [k, x])) }]))])),
  dir: Object.fromEntries(Object.entries(j.direction).map(([m, bs]) => [m, Object.fromEntries(Object.entries(bs).map(([b, gs]) => [b, Object.fromEntries(Object.entries(gs).map(([g, d]) => [g, g === "boat1" && b !== "1" ? "1号艇の強さによる上下（向きは艇番や着順によって違う）" : dirText(g, d)]))]))])),
  mag: Object.fromEntries(Object.entries(j.national).map(([m, bs]) => [m, Object.fromEntries(Object.entries(bs).map(([b, v]) => [b, v.theme_mag_sum_logodds]))])),
  cube: Object.fromEntries(Object.entries(j.cube).map(([k, v]) => [k, v.shares ? { n: v.n, s: Object.fromEntries(Object.entries(v.shares).map(([m, bs]) => [m, Object.fromEntries(Object.entries(bs).map(([b, x]) => [b, Object.fromEntries(Object.entries(x.theme).map(([t, [sh, sd]]) => [t, [sh, r4b(sd)]]))]))])) } : { n: v.n }])),
  ex: Object.fromEntries(Object.entries(j.example_race).map(([m, arr]) => [m, Object.fromEntries(arr.map((x) => [x.boat, { t: Object.fromEntries(Object.entries(x.theme).map(([k, v]) => [k, r4b(v)])), g: Object.fromEntries(Object.entries(x.group).map(([k, v]) => [k, r4b(v)])), sum: r4b(x.theme_sum) }]))])),
} : null;
const k4 = fs.existsSync(SP + "knn/knn6.json") ? rd("knn/knn6.json") : fs.existsSync(SP + "knn/knn4.json") ? rd("knn/knn4.json") : null;
const rfj = fs.existsSync(SP + "rank-facts/rank-facts2.json") ? rd("rank-facts/rank-facts2.json") : (fs.existsSync(SP + "rank-facts/rank-facts.json") ? rd("rank-facts/rank-facts.json") : null);
// 今日と同じ順位だったときの着内率（数えた値）。[x, n] だけ持ち、割合と区間は画面で出す
const xn = (o) => o ? [o.x, o.n] : [0, 0];
const rfOf = (j) => j ? {
  period: j.pool_period, materials: j.materials,
  scopes: Object.fromEntries(Object.entries(j.scopes).map(([s, v]) => [s, {
    n: v.n_races,
    usual: Object.fromEntries(Object.entries(v.usual).map(([b, ts]) => [b, Object.fromEntries(Object.entries(ts).map(([t2, o]) => [t2, xn(o)]))])),
    by: Object.fromEntries(Object.entries(v.by_rank).map(([b, ms]) => [b, Object.fromEntries(Object.entries(ms).map(([m, rs]) => [m, Object.fromEntries(Object.entries(rs).map(([r, ts]) => [r, Object.fromEntries(Object.entries(ts).map(([t2, o]) => [t2, xn(o)]))]))]))])),
    same: v.same_as_today ? Object.fromEntries(Object.entries(v.same_as_today).map(([bb, o]) => [bb, Object.fromEntries(Object.entries(o).map(([stg, q]) => [stg, { n: q.n, win: { x: q.win.x }, top2: { x: q.top2.x }, top3: { x: q.top3.x } }]))])) : null,
    typ: v.typical ? Object.fromEntries(Object.entries(v.typical).map(([b, ms]) => [b, Object.fromEntries(Object.entries(ms).map(([m, o]) => [m, Object.fromEntries(Object.entries(o).map(([t2, q]) => [t2, q && q.median != null ? Math.round(q.mean * 100) / 100 : null]))]))])) : null,
  }])),
  ex: Object.fromEntries(j.example_race.boats.map((b) => [b.boat, b])),
} : null;
// 層の全体（比べる相手）。knn5 は層の全件を並べているので、その全件から数える
const layerOf = (k) => {
  const bf = {}, tech = {};
  for (let b = 1; b <= 6; b++) bf[b] = { win: 0, top2: 0, top3: 0 };
  k.neighbors.forEach((n) => { const o = n.rank123; if (!o || o.length < 3) return; o.forEach((b, i) => { if (i < 1) bf[b].win++; if (i < 2) bf[b].top2++; bf[b].top3++; }); const tq = n.result.technique; tech[tq] = (tech[tq] || 0) + 1; });
  return { n: k.neighbors.length, boat_finish: bf, technique: tech, cond: "ラウンド・勝率差の帯・1号艇の級別・勝率トップ" };
};
const k3l = k3 && k3.pool && k3.pool.layer_n && k3.pool.layer_n === k3.neighbors.length ? layerOf(k3) : fs.existsSync(SP + "knn/knn3-layer.json") ? rd("knn/knn3-layer.json") : null;
// 条件ごとのテーマ単位の割合。environment6 は 6テーマの「環境」。[割合, 全国との差, 差のSD]
const shareOf = (c) => c ? {
  period: fs.existsSync(SP + "model-prep/share-cube2.json") ? "2025-10-03〜2026-09-26（2025-12・2026-01 を除く）" : "2025-10-03〜2026-10-02（2025-12・2026-01 を除く）",
  cells: Object.fromEntries(Object.entries(c.cells).map(([k, v]) => [k, v.shares ? { n: v.n, s: Object.fromEntries(Object.entries(v.shares).map(([m, bs]) => [m, Object.fromEntries(Object.entries(bs).map(([b, th]) => [b, Object.fromEntries(Object.entries(th).map(([t, [sh]]) => [t === "environment6" ? "environment" : t, [sh, v.vs_national[m][b][t][0], v.vs_national[m][b][t][2]]]))]))])) } : { n: v.n }])),
} : null;
const knnOf = (k) => k ? {
    pool: k.pool, method: { lambda_mult: k.method.lambda_mult, excluded: k.method.excluded_from_distance },
    today: k.query.item_disp,
    items: k.similarity.map((x) => ({ key: x.key, label: x.label, rule: x.rule, near: x.near_rule, inDist: x.in_distance, pool: x.pool_rate, poolNear: x.pool_near_or_same_rate, stratum: x.layer_rate ?? null })),
    nb: k.neighbors.map((n) => ({ r: n.rank, id: n.race_id, d: n.date, v: n.venue_name, rn: n.race_number, g: n.grade, rd: n.round, dist: n.distance, ss: n.same_series, m: n.item_match, t: n.item_disp, res: n.result, o: n.rank123 })),
  } : null;

const r4 = (x) => (x == null ? null : Math.round(x * 1e4) / 1e4);
const c1 = mp.calc1;
const FV = c1.feature_values;
const ent = c1.actual_result.entries;
const cond = c1.actual_result.conditions[0];

// 要素（グループ）ごとに、6艇の実際の値の文（艇番の配列）
const rk = (g, f) => FV[g][f].rank_in_race;
const vals = (g, f) => FV[g][f].values;
const fmt = {
  boatNumber: (b) => `${b + 1}号艇（${b + 1}枠）`,
  venue: () => "若松",
  raceNumber: () => "12R",
  class: (b) => ent[b].grade,
  national: (b) => `全国勝率 ${vals("national", "nat_win")[b].toFixed(2)}（6艇中${rk("national", "nat_win")[b]}位）`,
  local: (b) => `当地勝率 ${vals("local", "loc_win")[b].toFixed(2)}（${rk("local", "loc_win")[b]}位）`,
  recent: (b) => `直近30走の1着率 ${Math.round(vals("recent", "recent_win30")[b] * 100)}%（${rk("recent", "recent_win30")[b]}位）`,
  boat1: () => `1号艇 ${ent[0].grade}・全国勝率 ${ent[0].win_rate.toFixed(2)}`,
  exhibitionTime: (b) => `展示タイム ${vals("exhibitionTime", "exh_time")[b].toFixed(2)}（${rk("exhibitionTime", "exh_time")[b]}位）`,
  pastSt: (b) => `過去30走の平均ST ${vals("pastSt", "st_mean30")[b].toFixed(2).replace(/^0/, "")}（${rk("pastSt", "st_mean30")[b]}位）`,
  motor: (b) => `モーター2連率 ${vals("motor", "motor_2")[b].toFixed(1)}%（${rk("motor", "motor_2")[b]}位）`,
  boat: (b) => `ボート2連率 ${vals("boat", "boat_2")[b].toFixed(1)}%（${rk("boat", "boat_2")[b]}位）`,
  weather: () => cond.weather,
  wind: () => `${cond.wind_direction} ${cond.wind_speed}m`,
  wave: () => `${cond.wave_height}cm`,
  grade: () => "G1",
  round: () => "優勝戦",
  seriesDay: () => `${cond.series_day}日目（最終日）`,
  age: (b) => `${vals("age", "age")[b]}歳`,
  weight: (b) => `${vals("weight", "weight")[b].toFixed(1)}kg`,
  branch: (b) => (vals("branch", "is_local")[b] ? "地元" : "地元以外"),
};
const facts = Object.fromEntries(Object.entries(fmt).map(([g, f]) => [g, [0, 1, 2, 3, 4, 5].map(f)]));

const T = { 1: "win", 2: "top2", 3: "top3" };
const race = {};
for (const [t, m] of Object.entries(T)) {
  const M = c1.models[m];
  const boats = M.themes7.boats.map((b) => ({
    th: Object.fromEntries(Object.entries(b.themes_logodds).map(([k, v]) => [k, r4(v)])),
    gr: Object.fromEntries(Object.entries(b.groups_logodds).map(([k, v]) => [k, r4(v)])),
    sh: Object.fromEntries(Object.entries(b.boat_theme_share).map(([k, v]) => [k, r4(v)])),
  }));
  // 6テーマの「環境」は環境の9列を1テーマとして中心化した値（7テーマの2つの和と一致する。中心化は線形）
  const boats6 = M.themes6.boats.map((b) => ({
    th: Object.fromEntries(Object.entries(b.themes_logodds).map(([k, v]) => [k, r4(v)])),
    sh: Object.fromEntries(Object.entries(b.boat_theme_share).map(([k, v]) => [k, r4(v)])),
  }));
  // 割合はテーマ単位（テーマ内の特徴量を符号つきで足し、中心化した値の |値|）。C の補助・艇ごとの棒と同じ定義
  // （第2回の検証 指摘1。特徴量単位の |SHAP| の和は打ち消し前の量で、テーマの順位が入れ替わる）
  const themeShares = (bs) => {
    const keys = Object.keys(bs[0].th);
    const tot = keys.reduce((s, k) => s + bs.reduce((a, b) => a + Math.abs(b.th[k]), 0), 0);
    return Object.fromEntries(keys.map((k) => [k, r4(bs.reduce((a, b) => a + Math.abs(b.th[k]), 0) / tot)]));
  };
  const boatShares = (bs) => bs.forEach((b) => {
    const s = Object.values(b.th).reduce((a, v) => a + Math.abs(v), 0);
    b.sh = Object.fromEntries(Object.entries(b.th).map(([k, v]) => [k, r4(Math.abs(v) / s)]));
  });
  boatShares(boats); boatShares(boats6);
  race[t] = { sh7: themeShares(boats), sh6: themeShares(boats6), boats, boats6 };
}

const D = {
  meta: {
    raceId: c1.race_id, modelVersion: c1.model_version,
    result: "4-1-5（差し）",
    racecard: c1.racecard,
    built: new Date().toISOString(),
  },
  facts,
  race,
  start: p3, // 出発点（若松の艇番別の着順率、前日まで）
  sim: { conditions: p2.conditions, depth: p2.depth, layer: p2.layer, kByT: p2.k_by_t, t1: p2.t1_indicators },
  // 4条件の全16通り＋任意3条件（自動で条件を外さない形。prep5、前日まで）
  sets: p5 ? p5.subsets : null,
  list1111: p5 ? p5.list_1111 : null,
  // k-NN（knn_p、出走表時点、寄与度用モデル 2026-10-02 の重要度で重み付け）の近い順 800件。scratchpad/knn/knn2.json
  knn: knnOf(k2),
  knn3: knnOf(k3),
  share: shareOf(sc),
  knn3layer: k3l,
  bp: bpOf(bpj),
  knn4: knnOf(k4),
  rf: rfOf(rfj),
  // 数えた事実（120 の母集団、前日まで）: 若松の風速0〜1m、G1以上の優勝戦。艇ごとの win/top2/top3
  cond: p6 ? { wkWind01: p6.wakamatsu_wind["0-1"], g1Yusho: p6.g1plus_yusho } : null,
  cube: p4 ? p4.cube : p2.cube,
  cubePeriod: p4 ? "2019-04-01〜2026-09-26" : p2.cube_format.period,
  _idx_unused: {
    period: mp.calc2.variants.excl_hole_months.period,
    excluded: mp.calc2.variants.excl_hole_months.excluded_months,
    minN: 300,
    cells: Object.fromEntries(Object.entries(mp.cube.cells).map(([k, v]) => [k, v])),
  },
};
delete D._idx_unused; delete D.share; delete D.list1111;
fs.writeFileSync(new URL("data.js", import.meta.url), "const D=" + JSON.stringify(D) + ";\n");
console.log("data.js", fs.statSync(new URL("data.js", import.meta.url)).size, "bytes; start:", !!p3);
