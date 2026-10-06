// prep8b: prep8 の各セル（範囲×進入の型×形）に、3連単の着順の組み合わせ（tri）と 1着艇番×決まり手（win_tech）を足す。
// raw/p8b_*.json（長期・本体）を合算し、prep8.json と検算して prep8b.json を作る。合わなければ例外で止まる。使い方: node build8b.js
import fs from "node:fs";
import path from "node:path";
const dir = path.dirname(new URL(import.meta.url).pathname);
const rd = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
const fail = (m) => {
  throw new Error("検算エラー: " + m);
};
const sum = (a) => a.reduce((p, v) => p + v, 0);
const T7 = ["逃げ", "差し", "まくり", "まくり差し", "抜き", "恵まれ", "その他"];
const BASE = ["waku", "inlost", "mae6", "mae5", "mae56", "maeOther"];
const MAE = ["mae6", "mae5", "mae56", "maeOther"];

// 1) 基本の型ごとに長期＋本体を合算。tri: {"123": n}、wt: 6×7
const base = {};
const get = (k) =>
  (base[k] ||= {
    tri: {},
    wt: Array.from({ length: 6 }, () => Array(7).fill(0)),
  });
for (const f of ["raw/p8b_kb.json", "raw/p8b_main.json"]) {
  for (const row of rd(f).cells.split(";")) {
    const [s, et, fm, tri, wt] = row.split("|");
    if (!BASE.includes(et)) fail(`想定外の型 ${et}`);
    const o = get(`${s}|${et}|${fm}`);
    for (const p of tri.split(",")) {
      const [k, c] = p.split(":");
      if (!/^[1-6]{3}$/.test(k) || new Set(k).size !== 3)
        fail(`着順の形が不正 ${k}`);
      o.tri[k] = (o.tri[k] || 0) + +c;
    }
    for (const p of wt.split(",")) {
      const [k, c] = p.split(":");
      const b = +k[0],
        t = +k[1];
      if (!(b >= 1 && b <= 6 && t >= 1 && t <= 7 && k.length === 2))
        fail(`決まり手の形が不正 ${k}`);
      o.wt[b - 1][t - 1] += +c;
    }
  }
}
const cell = (s, et, fm) => {
  const parts = et === "all" ? BASE : et === "mae" ? MAE : [et];
  const o = { tri: {}, wt: Array.from({ length: 6 }, () => Array(7).fill(0)) };
  for (const p of parts) {
    const x = base[`${s}|${p}|${fm}`];
    if (!x) continue;
    for (const [k, c] of Object.entries(x.tri)) o.tri[k] = (o.tri[k] || 0) + c;
    x.wt.forEach((r, i) => r.forEach((v, j) => (o.wt[i][j] += v)));
  }
  return o;
};

// 2) prep8 と検算しながら出力
const p8 = rd("prep8.json");
const out = { _meta: {}, scopes: {} };
let nCells = 0,
  nTriKeys = 0;
for (const [s, S] of Object.entries(p8.scopes)) {
  out.scopes[s] = { cells: {} };
  for (const [et, C] of Object.entries(S.cells)) {
    out.scopes[s].cells[et] = { forms: {} };
    for (const [fm, P] of Object.entries(C.forms)) {
      const o = cell(s, et, fm);
      const key = `${s}|${et}|${fm}`;
      const triVals = Object.values(o.tri);
      if (sum(triVals) !== P.n)
        fail(`${key} tri の合計 ${sum(triVals)} ≠ n ${P.n}`);
      const pos = [0, 1, 2].map(() => Array(6).fill(0));
      for (const [k, c] of Object.entries(o.tri))
        for (let i = 0; i < 3; i++) pos[i][+k[i] - 1] += c;
      [
        ["first_boat", 0],
        ["second_boat", 1],
        ["third_boat", 2],
      ].forEach(([f, i]) => {
        if (JSON.stringify(pos[i]) !== JSON.stringify(P[f]))
          fail(`${key} tri から数えた ${f} ${pos[i]} ≠ prep8 ${P[f]}`);
      });
      const rowSum = o.wt.map(sum);
      if (JSON.stringify(rowSum) !== JSON.stringify(P.first_boat))
        fail(
          `${key} win_tech の行の合計 ${rowSum} ≠ first_boat ${P.first_boat}`,
        );
      const colSum = T7.map((_, j) => sum(o.wt.map((r) => r[j])));
      if (
        JSON.stringify(colSum) !== JSON.stringify(T7.map((t) => P.technique[t]))
      )
        fail(`${key} win_tech の列の合計 ${colSum} ≠ technique`);
      const tri = Object.fromEntries(
        Object.keys(o.tri)
          .sort()
          .map((k) => [`${k[0]}-${k[1]}-${k[2]}`, o.tri[k]]),
      );
      const win_tech = Object.fromEntries(
        o.wt.map((r, i) => [
          String(i + 1),
          Object.fromEntries(T7.map((t, j) => [t, r[j]])),
        ]),
      );
      out.scopes[s].cells[et].forms[fm] = { tri, win_tech };
      nCells++;
      nTriKeys += Object.keys(tri).length;
    }
  }
}
// raw に prep8 に無いセルが無いこと
for (const k of Object.keys(base)) {
  const [s, et, fm] = k.split("|");
  if (!p8.scopes[s]?.cells[et]?.forms[fm])
    fail(`raw のセル ${k} が prep8 に無い`);
}

out._meta = {
  data_version: "本番 Supabase（読み取りのみ、MCP execute_sql）2026-10-03 取得",
  base: "prep8.json と同じ母集団・除外・進入の型（waku/inlost/mae/mae6/mae5/mae56/maeOther/all）・スリットの形（any+7形）・範囲（v20/v20G1/all）。u（sql/p8_common_tail.sql）までは prep8 と同じ SQL",
  tri: "3連単の着順（1着-2着-3着の艇番）ごとの件数。件数0の組み合わせは省く。3着同着（長期だけ 全国109R・若松3R）は prep8 と同じく3着＝艇番の大きい1艇",
  win_tech:
    '1着の艇番（"1"〜"6"）× 決まり手（逃げ・差し・まくり・まくり差し・抜き・恵まれ・その他＝それ以外と NULL）の件数。0 も含めて 6×7 すべて持つ',
  check: [
    "各セルで tri の合計＝prep8 の n",
    "各セルで tri から数えた1・2・3着の艇番の件数＝prep8 の first_boat・second_boat・third_boat",
    "各セルで win_tech の行（艇番）の合計＝first_boat、列（決まり手）の合計＝technique",
    "raw の全セルが prep8 にある（prep8 の全 " + nCells + " セルを検算）",
    "本体: tri は1回目、win_tech は2回目の取得。2回目の tri の md5 が1回目と一致、1回目の win_tech（密な形）も2回目と全セル一致",
  ],
  sql: [
    "sql/p8b_cells_tail.sql",
    "sql/p8b_executed_cells_kb.sql",
    "sql/p8b_executed_cells_main.sql",
    "sql/p8b_executed_cells_main_run1.sql",
  ],
};
fs.writeFileSync(path.join(dir, "prep8b.json"), JSON.stringify(out));
console.log("cells", nCells, "tri keys", nTriKeys, "検算すべて通過");
for (const s of Object.keys(out.scopes)) {
  const a = out.scopes[s].cells.all.forms.any;
  console.log(
    s,
    "all×any 組み合わせ",
    Object.keys(a.tri).length,
    "件数",
    sum(Object.values(a.tri)),
  );
}
