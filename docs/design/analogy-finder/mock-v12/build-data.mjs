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
const k3 = fs.existsSync(SP + "knn/knn3.json") ? rd("knn/knn3.json") : null;
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
  cube: p4 ? p4.cube : p2.cube,
  cubePeriod: p4 ? "2019-04-01〜2026-09-26" : p2.cube_format.period,
  idx: {
    period: mp.calc2.variants.excl_hole_months.period,
    excluded: mp.calc2.variants.excl_hole_months.excluded_months,
    minN: 300,
    cells: Object.fromEntries(Object.entries(mp.cube.cells).map(([k, v]) => [k, v])),
  },
};
fs.writeFileSync(new URL("data.js", import.meta.url), "const D=" + JSON.stringify(D) + ";\n");
console.log("data.js", fs.statSync(new URL("data.js", import.meta.url)).size, "bytes; start:", !!p3);
