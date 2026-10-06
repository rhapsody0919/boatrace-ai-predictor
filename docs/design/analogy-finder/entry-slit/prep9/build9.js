// prep9: (A) 展示のスリットの形と本番のスリットの形の一致（prep9a）、(B) 展開シナリオの範囲に「6艇ともA1」を足す（prep9b）。
// raw/p9a.json・raw/p9b_*.json を検算して prep9a.json/md・prep9b.json/md を作る。検算が合わなければ例外で止まる。使い方: node build9.js
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const dir = path.dirname(new URL(import.meta.url).pathname);
const rd = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
const fail = (m) => {
  throw new Error("検算エラー: " + m);
};
const md5 = (s) => crypto.createHash("md5").update(s, "utf8").digest("hex");
const Z = 1.959964,
  r3 = (x) => Math.round(x * 1000) / 1000;
const wilson = (x, n) => {
  if (!n) return { x, n, p: null, lo: null, hi: null };
  const p = x / n,
    d = 1 + (Z * Z) / n,
    c = (p + (Z * Z) / (2 * n)) / d,
    h = (Z * Math.sqrt((p * (1 - p)) / n + (Z * Z) / (4 * n * n))) / d;
  return { x, n, p: r3(p), lo: r3(c - h), hi: r3(c + h) };
};
const sum = (a) => a.reduce((p, v) => p + v, 0);
const f3 = (x) => (x == null ? "-" : x.toFixed(3));
const ci = (w) =>
  w && w.p != null ? `${f3(w.p)} [${f3(w.lo)}–${f3(w.hi)}] ${w.x}/${w.n}` : "-";

const FORMS7 = [
  ["flat", "横一線"],
  ["wall", "内3艇そろう"],
  ["d2", "2コース凹み"],
  ["d3", "カド受け凹み"],
  ["kado", "カド一撃"],
  ["d1", "イン凹み"],
  ["dash", "ダッシュ勢先行"],
];
const FORMS8 = [...FORMS7, ["none", "どの形にも当たらない"]];
const formsOf = (c) => {
  // c: コース順 ST×100（1〜6コース）。p8_common_tail.sql と同じ判定
  const [c1, c2, c3, c4, c5, c6] = c;
  const mn = Math.min,
    mx = Math.max;
  return [
    ["flat", mx(...c) - mn(...c) <= 6],
    ["wall", mx(c1, c2, c3) - mn(c1, c2, c3) <= 2],
    ["d2", c2 - mn(c1, c3) >= 5],
    ["d3", c3 - mn(c2, c4) >= 5],
    ["kado", mn(c1, c2, c3) - c4 >= 3],
    ["d1", c1 - c2 >= 5],
    ["dash", c1 + c2 + c3 - (c4 + c5 + c6) >= 15],
  ]
    .filter(([, v]) => v)
    .map(([f]) => f);
};
const p7 = rd("prep7.json");

// ============================== A: prep9a ==============================
const A = (() => {
  const raw = rd("raw/p9a.json");
  const checks = [];
  // 母集団の件数の流れ
  const flow =
    raw.n_base_exh_course6_actual_course6 -
    raw.n_drop_exh_course_dup -
    raw.n_drop_exh_st_missing -
    raw.n_drop_returned -
    raw.n_drop_actual_st_missing;
  if (flow !== raw.n_ok) fail(`A 母集団の流れ ${flow} ≠ n_ok ${raw.n_ok}`);
  if (raw.n_base_exh_course6_actual_course6 !== p7.exhibition_vs_actual.n_ok)
    fail("A 展示の進入・本番の進入がそろうレース数が prep7 の 4 と違う");
  if (raw.n_races_with_result !== p7.exhibition_vs_actual.n_races_with_result)
    fail("A 結果があるレース数が prep7 の 4 と違う");
  const fh = Object.entries(raw.f_hist);
  if (sum(fh.map(([, c]) => c)) !== raw.n_ok)
    fail("A 展示 F の艇数ヒストグラムの合計 ≠ n_ok");
  if (sum(fh.map(([k, c]) => +k * c)) !== raw.n_f_boats)
    fail("A 展示 F の艇数 ≠ ヒストグラムから数えた値");
  if (raw.f_hist["0"] !== raw.n_ok - raw.n_ok_has_f)
    fail("A F なしのレース数が合わない");
  checks.push(
    "母集団: 展示の進入・本番の進入がそろう 2,324R（prep7 の 4 と一致）− 展示の進入の重複 − 展示 ST 欠け − 返還艇あり − 本番 ST 欠け ＝ 対象",
    "展示 F の艇数ヒストグラムの合計＝対象レース数、F 艇数の合計＝n_f_boats",
  );
  const V = {};
  for (const row of raw.rows.split(";")) {
    const [v, n, e8, a8, cr] = row.split("|");
    const E = e8.split(",").map(Number),
      Ac = a8.split(",").map(Number),
      C = cr.split(",").map(Number);
    if (E.length !== 8 || Ac.length !== 8 || C.length !== 64)
      fail(`A ${v} の列数が不正`);
    const X = Array.from({ length: 8 }, (_, i) => C.slice(i * 8, i * 8 + 8));
    V[v] = { n: +n, E, Ac, X };
  }
  if (V.raw.n !== raw.n_ok || V.signed.n !== raw.n_ok)
    fail("A raw・signed の n ≠ 対象レース数");
  if (V.noF.n !== raw.n_ok - raw.n_ok_has_f)
    fail("A noF の n ≠ 対象 − F ありのレース");
  if (JSON.stringify(V.raw.Ac) !== JSON.stringify(V.signed.Ac))
    fail("A 本番の形の件数が raw と signed で違う（同じ母集団のはず）");
  for (const [v, o] of Object.entries(V)) {
    for (let i = 0; i < 8; i++) {
      const rs = sum(o.X[i]),
        cs = sum(o.X.map((r) => r[i]));
      if (rs < o.E[i])
        fail(
          `A ${v} 展示の形 ${FORMS8[i][0]} の行の合計 ${rs} < 展示の件数 ${o.E[i]}`,
        );
      if (cs < o.Ac[i])
        fail(
          `A ${v} 本番の形 ${FORMS8[i][0]} の列の合計 ${cs} < 本番の件数 ${o.Ac[i]}`,
        );
      for (let j = 0; j < 8; j++)
        if (o.X[i][j] > Math.min(o.E[i], o.Ac[j]))
          fail(`A ${v} cross[${i}][${j}] が行・列の件数を超える`);
      if (o.E[i] > o.n || o.Ac[i] > o.n) fail(`A ${v} 形の件数 > n`);
    }
    // none（どの形にも当たらない）は他の形と重ならないので、none 行の合計＝展示 none の件数ちょうどではなく ≥（本番側が重なる）。
    // 本番 none 列は本番で形が無いレースなので、展示の各行に1回ずつしか入らない＝ none 列の合計 ≥ 本番 none の件数（展示側が重なる）
  }
  checks.push(
    "raw・signed の n＝対象レース数、noF の n＝対象 − 展示 F ありのレース",
    "本番の形の件数は raw と signed で一致（同じレース・同じ本番 ST）",
    "クロス表: 各行の合計 ≥ 展示でその形だった件数、各列の合計 ≥ 本番でその形だった件数（形が重なるため ≥）、各セル ≤ min(行の件数, 列の件数)",
  );
  // 例のレース（期間外なので raw/p8_example.json から同じ判定）
  const ex = rd("raw/p8_example.json");
  const ec = ex.exh_course_by_boat,
    est = ex.exh_st_by_boat,
    ef = ex.exh_start_flag.map((f) => f === "F");
  const byCourse = (vals, courses) =>
    [1, 2, 3, 4, 5, 6].map((cc) => vals[courses.indexOf(cc)]);
  const exRaw = byCourse(
    est.map((s) => Math.round(s * 100)),
    ec,
  );
  const exSigned = byCourse(
    est.map((s, i) => Math.round(s * 100) * (ef[i] ? -1 : 1)),
    ec,
  );
  const actC = byCourse(
    ex.st_by_boat.map((s) => Math.round(s * 100)),
    ex.actual_course_by_boat,
  );
  const example = {
    race_id: ex.race_id,
    note: "2026-09-27 は集計期間（〜2026-09-26）の外。raw/p8_example.json（sql/p8_example.sql、本番 2026-10-03 23:20 JST 取得）から、集計と同じ判定で出した",
    exhibition_course_by_boat: ec,
    exhibition_st_by_boat: est,
    exhibition_start_flag: ex.exh_start_flag,
    exh_st_by_course_x100_raw: exRaw,
    exh_forms_raw: formsOf(exRaw),
    exh_st_by_course_x100_signed: exSigned,
    exh_forms_signed: formsOf(exSigned),
    exh_forms_noF: null,
    noF_note: "展示 F（3号艇）がいるので noF では対象外",
    actual_st_by_course_x100: actC,
    actual_forms: formsOf(actC),
  };
  if (example.exh_forms_raw.join() !== "d3,d1")
    fail(
      "A 例のレース: raw の形が依頼者の手計算（カド受け凹み・イン凹み）と違う",
    );
  checks.push(
    "例のレース: raw（F をそのまま）の形がカド受け凹み・イン凹みで、依頼文の手計算と一致",
  );

  // 出力
  const VARS = [
    ["raw", "F の艇の展示 ST をそのまま（F.09 → 0.09）"],
    ["signed", "F の艇の展示 ST を負にする（F.09 → −0.09）"],
    ["noF", "展示 F がいるレースを除く"],
  ];
  const out = { _meta: {}, population: {}, variants: {}, example };
  out.population = {
    n_races_with_result: raw.n_races_with_result,
    n_exh_course6_actual_course6: raw.n_base_exh_course6_actual_course6,
    drop_exh_course_dup: raw.n_drop_exh_course_dup,
    drop_exh_st_missing: raw.n_drop_exh_st_missing,
    drop_returned: raw.n_drop_returned,
    drop_actual_st_missing: raw.n_drop_actual_st_missing,
    n_ok: raw.n_ok,
    n_ok_exh_all_waku: raw.n_ok_exh_waku,
    n_ok_has_exh_f: raw.n_ok_has_f,
    n_exh_f_boats: raw.n_f_boats,
    exh_f_boats_per_race_hist: raw.f_hist,
    date_range: [raw.dmin, raw.dmax],
  };
  for (const [v, vl] of VARS) {
    const o = V[v];
    const forms = {};
    FORMS8.forEach(([f, fl], i) => {
      const same = o.X[i][i];
      const sameRate = wilson(same, o.E[i]);
      const base = wilson(o.Ac[i], o.n);
      forms[f] = {
        label: fl,
        exh_n: o.E[i],
        exh_share: wilson(o.E[i], o.n),
        same_in_actual: same,
        same_rate: sameRate,
        actual_base_rate: base,
        lift:
          sameRate.p != null && base.p
            ? r3(same / o.E[i] / (o.Ac[i] / o.n))
            : null,
        prep7_all_actual_rate:
          f === "none" ? null : p7.scopes.all.slit.forms[f].share,
      };
    });
    const cross = {};
    FORMS8.forEach(([f], i) => {
      cross[f] = Object.fromEntries(FORMS8.map(([g], j) => [g, o.X[i][j]]));
    });
    out.variants[v] = {
      label: vl,
      n: o.n,
      actual_forms_n: Object.fromEntries(FORMS8.map(([f], i) => [f, o.Ac[i]])),
      forms,
      cross,
    };
  }
  out._meta = {
    data_version:
      "本番 Supabase（読み取りのみ、MCP execute_sql）2026-10-04 JST 取得",
    population:
      "prep7 の「4 展示の進入と本番の進入」と同じ（本体 2025-12-03〜2026-09-26、中止でなく結果あり、展示の進入 exhibition_data.exhibition_course が6艇とも1〜6、本番の進入 race_results.actual_course_1..6 がそろう＝2,324R）から、展示の進入の重複・展示 ST（exhibition_data.start_timing）の欠け・返還艇あり・本番 ST（race_start_timings.start_timing）の欠けを除いたもの。実データは 2026-04-10〜（展示の進入の列がそこから入っている）",
    returned:
      "本番の返還艇（is_flying・is_late_start・着 F/L/欠・refund_boats）の ST は prep7 と同じく NULL 扱いで、そのレースは本番の形を判定できないので除いた（42R）。展示の進入・ST の6艇がそろわないのは 2R（展示 L の艇。L は ST が NULL）",
    exh_form:
      "展示の進入コース順に展示 ST を並べ、round(st×100) の整数で BOA-635 の1段目の7形を判定（prep7・prep8 と同じ式）。本番の形は prep7 と同じ（本番の進入コース順に本番 ST）",
    exh_f:
      "展示 F の扱い: exhibition_data.start_flag='F' の艇の start_timing は、F でも正の数で入っている（docs/db-migration/082_exhibition_data_beforeinfo_fields.sql のコメント「F表記でも正の数（F.01→0.01）」、2,604艇すべて 0.01〜0.40 で負は0件）。値の意味は『スタートラインを何秒早く越えたか』なので、位置関係としては負（F.09 は 0.00 より 0.09 前）。そのまま使うと F の艇が実際とは逆に『遅れた』扱いになる。3通りで数えた: raw＝そのまま（依頼文の手計算と同じ）、signed＝F の艇を負にする（位置関係として正しい）、noF＝展示 F がいるレースを除く。展示 F は対象 2,280R のうち 1,242R（54%）にいる（1レースに F が2艇以上も 716R）ので、noF は母集団が半分以下になり、F の出やすい場（攻めた展示）が抜けた偏った集合になる",
    exh_f_recommend:
      "推奨は signed（全レースを使え、F の位置関係も正しい）。raw は F の艇を『凹み』に数えてしまうので、凹み系（d1・d2・d3）の展示件数が水増しされる（例のレースも raw だとカド受け凹みに入るが、signed では 3号艇が一番前に出た形になり、カド受け凹みに入らない）",
    none: "none＝7形のどれにも当たらない（7形は重なりうるので、none を足すと全レースがどこかの行・列に入る）",
    reading:
      "same_rate＝展示でその形だったレースのうち本番も同じ形だった割合。actual_base_rate＝同じ母集団で本番がその形だった割合（比べる相手）。lift＝same_rate ÷ actual_base_rate（1 より大きいほど展示の形が本番の形の手がかりになる）。prep7_all_actual_rate は参考に prep7 全国（2019-04〜2026-09、401,243R）の本番の形の割合",
    check: checks,
    sql: ["sql/p9a_exh_slit.sql", "sql/p8_example.sql（例のレース）"],
  };
  fs.writeFileSync(path.join(dir, "prep9a.json"), JSON.stringify(out, null, 1));

  // md
  const L = [];
  const P = (...x) => L.push(...x);
  const VER = "本番 2026-10-04 JST 取得";
  P("# 展示のスリットの形 → 本番のスリットの形（prep9a）", "");
  for (const [k, v] of Object.entries(out._meta))
    if (typeof v === "string") P(`- **${k}**: ${v}`);
  P(
    "- **check**（build9.js、すべて通過）:",
    ...checks.map((c) => `  - ${c}`),
    "",
  );
  const po = out.population;
  P(
    "## 母集団",
    "",
    `結果がある ${po.n_races_with_result}R → 展示の進入・本番の進入がそろう ${po.n_exh_course6_actual_course6}R → 展示の進入の重複 ${po.drop_exh_course_dup}R・展示 ST 欠け ${po.drop_exh_st_missing}R・返還艇あり ${po.drop_returned}R・本番 ST 欠け ${po.drop_actual_st_missing}R を除く → 対象 **${po.n_ok}R**（${po.date_range[0]}〜${po.date_range[1]}）。展示が全艇枠なり ${po.n_ok_exh_all_waku}R。展示 F がいるレース ${po.n_ok_has_exh_f}R（F の艇 ${po.n_exh_f_boats}艇。1レースの F の艇数: ${Object.entries(
      po.exh_f_boats_per_race_hist,
    )
      .map(([k, c]) => `${k}艇 ${c}R`)
      .join("・")}）`,
    "",
    `出典: prep9a.json \`population\`（sql/p9a_exh_slit.sql）／${VER}`,
    "",
  );
  const E = out.example;
  P(
    "## 例のレース: 2026-09-27 若松12R",
    "",
    "| 艇 | 展示の進入 | 展示ST |",
    "|---|---|---|",
    ...E.exhibition_course_by_boat.map(
      (c, i) =>
        `| ${i + 1} | ${c} | ${E.exhibition_start_flag[i] || ""}${E.exhibition_st_by_boat[i]} |`,
    ),
    "",
    `- raw（F をそのまま）: コース順 ST×100 = ${E.exh_st_by_course_x100_raw.join(", ")} → **${E.exh_forms_raw.map((f) => FORMS8.find((x) => x[0] === f)[1]).join("・") || "なし"}**（依頼文の手計算と一致）`,
    `- signed（F を負に）: ${E.exh_st_by_course_x100_signed.join(", ")} → **${E.exh_forms_signed.map((f) => FORMS8.find((x) => x[0] === f)[1]).join("・") || "なし"}**`,
    `- noF: ${E.noF_note}`,
    `- 本番: コース順 ST×100 = ${E.actual_st_by_course_x100.join(", ")} → **${E.actual_forms.map((f) => FORMS8.find((x) => x[0] === f)[1]).join("・") || "なし"}**`,
    "",
    E.note,
    "",
  );
  for (const [v, VV] of Object.entries(out.variants)) {
    P(
      `## ${v}: ${VV.label}（${VV.n}R）`,
      "",
      "| 形 | 展示でその形 | そのうち本番も同じ形 [Wilson 95%] | 本番でその形（この母集団、比べる相手） | lift | 参考: prep7 全国の本番 |",
      "|---|---|---|---|---|---|",
    );
    for (const [, o] of Object.entries(VV.forms))
      P(
        `| ${o.label} | ${o.exh_n}（${f3(o.exh_share.p)}） | ${ci(o.same_rate)} | ${ci(o.actual_base_rate)} | ${o.lift == null ? "-" : o.lift.toFixed(2)} | ${o.prep7_all_actual_rate ? f3(o.prep7_all_actual_rate.p) : "-"} |`,
      );
    P(
      "",
      "クロス表（行＝展示の形、列＝本番の形、形が重なるので行・列の合計はレース数より多い）",
      "",
      `| 展示＼本番 | ${FORMS8.map(([, l]) => l).join(" | ")} | 展示の件数 |`,
      `|---|${FORMS8.map(() => "---").join("|")}|---|`,
      ...FORMS8.map(
        ([f, l]) =>
          `| ${l} | ${FORMS8.map(([g]) => VV.cross[f][g]).join(" | ")} | ${VV.forms[f].exh_n} |`,
      ),
      `| 本番の件数 | ${FORMS8.map(([g]) => VV.actual_forms_n[g]).join(" | ")} | ${VV.n} |`,
      "",
      `出典: prep9a.json \`variants.${v}\`／${VER}`,
      "",
    );
  }
  fs.writeFileSync(path.join(dir, "prep9a.md"), L.join("\n"));
  return out;
})();

// ============================== B: prep9b ==============================
const B = (() => {
  const T7 = [
    "逃げ",
    "差し",
    "まくり",
    "まくり差し",
    "抜き",
    "恵まれ",
    "その他",
  ];
  const SCOPES = [
    ["v20A1", "若松×6艇ともA1"],
    ["allA1", "全国×6艇ともA1"],
  ];
  const BASE = ["waku", "inlost", "mae6", "mae5", "mae56", "maeOther"];
  const MAE = ["mae6", "mae5", "mae56", "maeOther"];
  const ETS = [
    ["waku", "全艇枠なり"],
    ["inlost", "1号艇が1コース以外"],
    ["mae", "前付けあり（1号艇は1コース）"],
    ["mae6", "前付け 6号艇だけ"],
    ["mae5", "前付け 5号艇だけ"],
    ["mae56", "前付け 5・6号艇"],
    ["maeOther", "前付け その他"],
    ["all", "全部"],
  ];
  const FORMS = [["any", "形を問わない"], ...FORMS7];
  const partsOf = (et) => (et === "all" ? BASE : et === "mae" ? MAE : [et]);
  const empty = () => ({
    n: 0,
    r1: Array(6).fill(0),
    r2: Array(6).fill(0),
    r3: Array(6).fill(0),
    tc: Array(7).fill(0),
    man: 0,
    payn: 0,
    tri: {},
    wt: Array.from({ length: 6 }, () => Array(7).fill(0)),
  });
  const addInto = (o, x) => {
    o.n += x.n;
    for (const k of ["r1", "r2", "r3", "tc"])
      x[k].forEach((v, i) => (o[k][i] += v));
    o.man += x.man;
    o.payn += x.payn;
    for (const [k, c] of Object.entries(x.tri)) o.tri[k] = (o.tri[k] || 0) + c;
    x.wt.forEach((r, i) => r.forEach((v, j) => (o.wt[i][j] += v)));
  };
  const checks = [];
  const base = {},
    bySrc = { kb: {}, main: {} },
    excl = {};
  for (const [src, f] of [
    ["kb", "raw/p9b_kb.json"],
    ["main", "raw/p9b_main.json"],
  ]) {
    const j = rd(f);
    if (md5(j.cells) !== j.md5_cells)
      fail(`${f} cells の md5 が SQL の値と違う（写し間違い）`);
    if (md5(j.tw) !== j.md5_tw)
      fail(`${f} tw の md5 が SQL の値と違う（写し間違い）`);
    const cellObj = {};
    for (const row of j.cells.split(";")) {
      const [s, et, fm, n, r1, r2, r3c, tc, man, payn] = row.split("|");
      if (!BASE.includes(et)) fail(`想定外の型 ${et}`);
      const o = empty();
      Object.assign(o, {
        n: +n,
        r1: r1.split(",").map(Number),
        r2: r2.split(",").map(Number),
        r3: r3c.split(",").map(Number),
        tc: tc.split(",").map(Number),
        man: +man,
        payn: +payn,
      });
      cellObj[`${s}|${et}|${fm}`] = o;
    }
    for (const row of j.tw.split(";")) {
      const [s, et, fm, tri, wt] = row.split("|");
      const o = cellObj[`${s}|${et}|${fm}`];
      if (!o) fail(`${f} tw のセル ${s}|${et}|${fm} が cells に無い`);
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
    if (j.tw.split(";").length !== Object.keys(cellObj).length)
      fail(`${f} tw と cells のセル数が違う`);
    for (const [k, o] of Object.entries(cellObj)) {
      addInto((base[k] ||= empty()), o);
      addInto((bySrc[src][k] ||= empty()), o);
    }
    for (const row of j.excl.split(";")) {
      const [s, ...v] = row.split("|");
      const keys = [
        "n_pool",
        "ret",
        "course_unknown",
        "n_ok",
        "st_missing",
        "dh2",
        "dh3",
        "pay_missing",
      ];
      const e = (excl[s] ||= {
        ...Object.fromEntries(keys.map((k) => [k, 0])),
        by_source: {},
      });
      keys.forEach((key, i) => (e[key] += +v[i]));
      e.by_source[src] = Object.fromEntries(keys.map((key, i) => [key, +v[i]]));
    }
  }
  checks.push(
    "raw に写した cells・tw・一覧の文字列の md5 が、SQL が返した md5 と一致（写し間違いなし）",
  );
  const cell = (s, et, fm) => {
    const o = empty();
    for (const p of partsOf(et))
      if (base[`${s}|${p}|${fm}`]) addInto(o, base[`${s}|${p}|${fm}`]);
    return o;
  };
  const p8 = rd("prep8.json");
  const PARENT = { v20A1: "v20", allA1: "all" };
  for (const [s] of SCOPES) {
    const e = excl[s];
    if (e.n_pool - e.ret - e.course_unknown !== e.n_ok)
      fail(`${s} 母集団 − 返還艇 − 進入不明 ≠ 対象`);
    if (e.st_missing !== 0)
      fail(`${s} ST 不明があり any と形の分母がずれる（想定外）`);
    for (const [fm] of FORMS) {
      const all = cell(s, "all", fm),
        w = cell(s, "waku", fm),
        il = cell(s, "inlost", fm),
        m = cell(s, "mae", fm);
      if (w.n + il.n + m.n !== all.n) fail(`${s}|${fm} waku+inlost+mae ≠ all`);
      if (sum(MAE.map((x) => cell(s, x, fm).n)) !== m.n)
        fail(`${s}|${fm} mae の内訳の合計 ≠ mae`);
      if (fm === "any" && all.n !== e.n_ok) fail(`${s} all×any ≠ 対象レース数`);
      for (const [et] of ETS) {
        const o = cell(s, et, fm),
          key = `${s}|${et}|${fm}`;
        for (const k of ["r1", "r2", "r3"])
          if (sum(o[k]) !== o.n) fail(`${key} ${k} の合計 ≠ n`);
        if (sum(o.tc) !== o.n) fail(`${key} 決まり手の合計 ≠ n`);
        if (o.man > o.payn || o.payn > o.n)
          fail(`${key} 万舟・払戻の件数が不正`);
        if (sum(Object.values(o.tri)) !== o.n) fail(`${key} tri の合計 ≠ n`);
        const pos = [0, 1, 2].map(() => Array(6).fill(0));
        for (const [k, c] of Object.entries(o.tri))
          for (let i = 0; i < 3; i++) pos[i][+k[i] - 1] += c;
        if (JSON.stringify(pos) !== JSON.stringify([o.r1, o.r2, o.r3]))
          fail(`${key} tri から数えた1〜3着 ≠ first/second/third`);
        if (JSON.stringify(o.wt.map(sum)) !== JSON.stringify(o.r1))
          fail(`${key} win_tech の行の合計 ≠ first_boat`);
        if (
          JSON.stringify(T7.map((_, j) => sum(o.wt.map((r) => r[j])))) !==
          JSON.stringify(o.tc)
        )
          fail(`${key} win_tech の列の合計 ≠ technique`);
        // 親の範囲（prep8）の部分集合であること
        const par = p8.scopes[PARENT[s]].cells[et].forms[fm];
        if (o.n > par.n)
          fail(`${key} n ${o.n} > prep8 ${PARENT[s]} の n ${par.n}`);
        for (let b = 0; b < 6; b++)
          if (o.r1[b] > par.first_boat[b])
            fail(`${key} 1着艇番 > prep8 ${PARENT[s]}`);
      }
    }
  }
  if (excl.v20A1.n_ok > excl.allA1.n_ok) fail("v20A1 > allA1");
  checks.push(
    "各範囲で 母集団 − 返還艇 − 進入不明 ＝ 対象、all×any の n＝対象、ST 不明 0R",
    "各範囲・各形で waku+inlost+mae=all、mae6+mae5+mae56+maeOther=mae",
    "各セルで 1・2・3着の艇番の合計＝n、決まり手の合計＝n、万舟≤払戻あり≤n",
    "各セルで tri の合計＝n、tri から数えた1・2・3着の艇番＝first/second/third_boat、win_tech の行の合計＝first_boat、列の合計＝technique",
    "各セルの n と1着艇番の件数が、親の範囲（v20A1 は prep8 の v20、allA1 は prep8 の all）の同じセル以下（部分集合）",
    "件数30未満のセルは、一覧に入ったレース数が n と一致（＝漏れなく全件が一覧に入っている）",
  );

  // 30未満のセルの一覧
  const VENUE = {
    1: "桐生",
    2: "戸田",
    3: "江戸川",
    4: "平和島",
    5: "多摩川",
    6: "浜名湖",
    7: "蒲郡",
    8: "常滑",
    9: "津",
    10: "三国",
    11: "びわこ",
    12: "住之江",
    13: "尼崎",
    14: "鳴門",
    15: "丸亀",
    16: "児島",
    17: "宮島",
    18: "徳山",
    19: "下関",
    20: "若松",
    21: "芦屋",
    22: "福岡",
    23: "唐津",
    24: "大村",
  };
  const parseRows = (f) => {
    const j = rd(f);
    if (md5(j.rows) !== j.md5_rows)
      fail(`${f} rows の md5 が SQL の値と違う（写し間違い）`);
    const rows = j.rows.split(";");
    if (rows.length !== j.n) fail(`${f} 行数 ≠ n`);
    return rows.map((r) => {
      const [
        race_id,
        date,
        venue,
        grade,
        title,
        stage,
        rno,
        order,
        tech,
        pay,
        course,
        forms,
        et,
      ] = r.split("|");
      return {
        race_id,
        date,
        venue: VENUE[+venue] || venue,
        venue_code: +venue,
        grade,
        title: title || null,
        stage: stage || null,
        race_number: +rno,
        finish_1_2_3: order,
        technique: tech || null,
        payout_3tan: pay ? +pay : null,
        course_by_boat: course.split(",").map(Number),
        forms: forms ? forms.split(",") : [],
        entry_type: et,
      };
    });
  };
  const listRows = [
    ...parseRows("raw/p9b_list_kb.json"),
    ...parseRows("raw/p9b_list_main.json"),
  ].sort((a, b) =>
    a.date === b.date
      ? b.race_number - a.race_number || a.venue_code - b.venue_code
      : a.date < b.date
        ? 1
        : -1,
  );
  const inCell = (r, s, et, fm) =>
    (s === "allA1" || r.venue_code === 20) &&
    (et === "all" ||
      r.entry_type === et ||
      (et === "mae" && r.entry_type.startsWith("mae"))) &&
    (fm === "any" || r.forms.includes(fm));

  const T = (o) => Object.fromEntries(T7.map((t, i) => [t, o.tc[i]]));
  const out = { _meta: {}, scopes: {} };
  let nSmall = 0,
    nCells = 0;
  for (const [s, label] of SCOPES) {
    const S = (out.scopes[s] = { label, exclusions: excl[s], cells: {} });
    for (const [et, etl] of ETS) {
      S.cells[et] = { label: etl, forms: {} };
      for (const [fm, fl] of FORMS) {
        const o = cell(s, et, fm);
        const c = {
          label: fl,
          n: o.n,
          n_kb: sum(
            partsOf(et).map((p) => (bySrc.kb[`${s}|${p}|${fm}`] || { n: 0 }).n),
          ),
          n_main: sum(
            partsOf(et).map(
              (p) => (bySrc.main[`${s}|${p}|${fm}`] || { n: 0 }).n,
            ),
          ),
          first_boat: o.r1,
          second_boat: o.r2,
          third_boat: o.r3,
          technique: T(o),
          manshu: o.man,
          payout_known: o.payn,
          manshu_rate: wilson(o.man, o.payn),
          b1_win: wilson(o.r1[0], o.n),
          tri: Object.fromEntries(
            Object.keys(o.tri)
              .sort()
              .map((k) => [`${k[0]}-${k[1]}-${k[2]}`, o.tri[k]]),
          ),
          win_tech: Object.fromEntries(
            o.wt.map((r, i) => [
              String(i + 1),
              Object.fromEntries(T7.map((t, j) => [t, r[j]])),
            ]),
          ),
        };
        if (c.n_kb + c.n_main !== c.n) fail(`${s}|${et}|${fm} n_kb+n_main ≠ n`);
        if (o.n < 30) {
          nSmall++;
          const rows = listRows.filter((r) => inCell(r, s, et, fm));
          if (rows.length !== o.n)
            fail(`${s}|${et}|${fm} 一覧 ${rows.length}件 ≠ n ${o.n}`);
          c.races = rows
            .slice(0, 30)
            .map(({ venue_code, entry_type, ...r }) => ({ ...r, entry_type }));
        }
        S.cells[et].forms[fm] = c;
        nCells++;
      }
    }
  }
  const knn = { v20A1: 1134, allA1: 25290 };
  out._meta = {
    data_version:
      "本番 Supabase（読み取りのみ、MCP execute_sql）2026-10-04 JST 取得",
    population:
      "prep8 と同じ（120 の analogy_pool_outcomes 相当、2019-04-01〜2026-09-26。返還艇がいるレースと進入不明のレースを除く）に、『6艇とも出走時の級別が A1』を足したもの。v20A1＝若松（会場20）、allA1＝全国。グレード・ステージは問わない",
    class_column:
      "出走時の級別: 長期 kb_archive_boats.class（2019-04〜2025-12-02、値は A1/A2/B1/B2 のみ・NULL なし）、本体 race_entries.grade（2025-12-03〜、値は A1/A2/B1/B2 のみ・NULL なし。列名は grade だがレースのグレードではなく選手の級別）。どちらも出走表のその時点の級別（期ごとの級別）で、現在の級別ではない。母集団の6艇すべてで A1 のレース（bool_and）",
    count_vs_knn: `knn の母集団（scratchpad/knn/work2、tab1 の wkA1・natA1）では 若松 ${knn.v20A1}R・全国 ${knn.allA1}R。今回の除外前（120 の母集団で6艇とも A1）は 若松 ${excl.v20A1.n_pool}R（長期 ${excl.v20A1.by_source.kb.n_pool}・本体 ${excl.v20A1.by_source.main.n_pool}）・全国 ${excl.allA1.n_pool}R（長期 ${excl.allA1.by_source.kb.n_pool}・本体 ${excl.allA1.by_source.main.n_pool}）。若松は knn と一致し、返還艇あり ${excl.v20A1.ret}R を除いて ${excl.v20A1.n_ok}R。全国は knn より ${knn.allA1 - excl.allA1.n_pool}R 少なく、返還艇あり ${excl.allA1.ret}R を除いて ${excl.allA1.n_ok}R。全国の差 ${knn.allA1 - excl.allA1.n_pool}R（0.03%）の原因は確かめていない（knn は別の取得・前処理を経た pickle で、級別の取り方〔cls_ord==4〕も別実装。差が小さいので今回の集計には影響しない）`,
    entry_type:
      "prep8 と同じ（inlost / waku / mae6・mae5・mae56・maeOther、mae＝前付けの4つの合計、all＝全部）",
    slit_rule:
      "prep8 と同じ BOA-635 1段目の7形（形は重なりうる）。any＝形を問わない",
    finish_order:
      "prep8 と同じ。長期 kb_archive_boats.finish_rank、本体 race_results.rank1..3",
    dead_heat: `3着同着（長期だけ）は 全国×A1 ${excl.allA1.dh3}R・若松×A1 ${excl.v20A1.dh3}R。prep8 と同じく3着は艇番の大きい1艇（3着の合計＝n）。2着同着は0R`,
    technique:
      "prep8 と同じ 逃げ・差し・まくり・まくり差し・抜き・恵まれ・その他",
    payout_3tan:
      "prep8 と同じ。万舟＝3連単の払戻 ≥ 10,000円、分母＝払戻 > 0。長期 kb_archive_races.payout_3tan、本体 race_results.payout_trio（列名と券種が逆。payout_trifecta は3連複）。払戻不明 " +
      excl.allA1.pay_missing +
      "R",
    tri: "prep8b と同じ。3連単の着順（1着-2着-3着の艇番）ごとの件数、件数0は省く",
    win_tech: "prep8b と同じ。1着艇番×決まり手、6×7 すべて持つ",
    races_list: `件数30未満のセル（${nSmall} セル）に races を付けた。prep8 と同じ項目、新しい順（日付・R番号の降順、同日同Rは会場コード順）最大30件。会場は会場コードから名前に直した`,
    small_cells_note:
      "若松×A1 は 1,117R しかなく、前付け・1号艇が1コース以外のセルはほとんど30未満。本体（2025-12〜）の分は若松 110R だけで、ほぼ長期の数字",
    check: checks,
    sql: [
      "gen_p9b.js（prep8・prep8b の SQL から文字列置換で作る）",
      "sql/p9b_pool_kb.sql",
      "sql/p9b_pool_main.sql",
      "sql/p9b_common_tail.sql",
      "sql/p9b_cells_tail.sql",
      "sql/p9b_executed_cells_kb.sql",
      "sql/p9b_executed_cells_main.sql",
      "sql/p9b_list_tail.sql",
      "sql/p9b_executed_list_kb.sql",
      "sql/p9b_executed_list_main.sql",
      "sql/p9b_executed_md5_main.sql",
    ],
  };
  fs.writeFileSync(path.join(dir, "prep9b.json"), JSON.stringify(out, null, 1));

  // md
  const L = [];
  const P = (...x) => L.push(...x);
  const VER = "本番 2026-10-04 JST 取得";
  P("# 展開シナリオ: 6艇ともA1（prep9b）", "");
  for (const [k, v] of Object.entries(out._meta))
    if (typeof v === "string") P(`- **${k}**: ${v}`);
  P(
    "- **check**（build9.js、すべて通過）:",
    ...checks.map((c2) => `  - ${c2}`),
    "",
    "1〜3着は艇番1〜6の件数、決まり手は 逃げ・差し・まくり・まくり差し・抜き・恵まれ・その他 の件数。1号艇1着率・万舟率は「割合 [Wilson 95%CI] x/n」。tri・win_tech は prep9b.json にある（md では上位5つの3連単だけ出す）",
    "",
  );
  const top5 = (tri) =>
    Object.entries(tri)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k, c]) => `${k} ${c}`)
      .join("・");
  for (const [s, S] of Object.entries(out.scopes)) {
    const e = S.exclusions;
    P(
      `## ${S.label}`,
      "",
      `母集団 ${e.n_pool}R → 返還艇ありを除く ${e.ret}R・進入不明 ${e.course_unknown}R → 対象 ${e.n_ok}R（長期 ${e.by_source.kb.n_ok}・本体 ${e.by_source.main.n_ok}）。3着同着 ${e.dh3}R、払戻不明 ${e.pay_missing}R`,
      "",
      "| 型 | 形 | n | 1号艇1着率 | 1着 1〜6 | 2着 1〜6 | 3着 1〜6 | 決まり手 | 万舟率 | 3連単 上位5 |",
      "|---|---|---|---|---|---|---|---|---|---|",
    );
    for (const [, C] of Object.entries(S.cells))
      for (const [, o] of Object.entries(C.forms))
        P(
          `| ${C.label} | ${o.label} | ${o.n}${o.n < 30 ? "（30未満）" : ""} | ${ci(o.b1_win)} | ${o.first_boat.join(", ")} | ${o.second_boat.join(", ")} | ${o.third_boat.join(", ")} | ${Object.values(o.technique).join(", ")} | ${ci(o.manshu_rate)} | ${top5(o.tri)} |`,
        );
    P("", `出典: prep9b.json \`scopes.${s}.cells\`／${VER}`, "");
    const smalls = Object.entries(S.cells).flatMap(([, C]) =>
      Object.entries(C.forms)
        .filter(([, o]) => o.races && o.n > 0)
        .map(([, o]) => [C.label, o]),
    );
    if (smalls.length) {
      P(
        `### 件数30未満のセルのレース一覧（${smalls.length}セル、0件のセルは省略、新しい順）`,
        "",
      );
      for (const [cl, o] of smalls) {
        P(
          `#### ${cl} × ${o.label}（${o.n}R）`,
          "",
          "| race_id | 会場 | グレード | 開催・ステージ | 1-2-3 | 決まり手 | 3連単 | 進入（1〜6号艇） | 形 |",
          "|---|---|---|---|---|---|---|---|---|",
          ...o.races.map(
            (r) =>
              `| ${r.race_id} | ${r.venue} | ${r.grade} | ${r.title || "-"} ${r.stage || ""} | ${r.finish_1_2_3} | ${r.technique || "-"} | ${r.payout_3tan ?? "-"} | ${r.course_by_boat.join("")} | ${r.forms.join("・") || "-"} |`,
          ),
          "",
        );
      }
      P(
        `出典: prep9b.json \`scopes.${s}.cells.<型>.forms.<形>.races\`（sql/p9b_executed_list_*.sql）／${VER}`,
        "",
      );
    }
  }
  fs.writeFileSync(path.join(dir, "prep9b.md"), L.join("\n"));
  return { out, nSmall, nCells };
})();

console.log(
  "A n_ok",
  A.population.n_ok,
  "example raw",
  A.example.exh_forms_raw,
  "signed",
  A.example.exh_forms_signed,
  "actual",
  A.example.actual_forms,
);
for (const [v, VV] of Object.entries(A.variants))
  console.log(
    " ",
    v,
    VV.n,
    Object.entries(VV.forms)
      .map(
        ([f, o]) =>
          `${f}:${o.same_in_actual}/${o.exh_n}=${f3(o.same_rate.p)} base${f3(o.actual_base_rate.p)}`,
      )
      .join(" "),
  );
for (const [s, S] of Object.entries(B.out.scopes))
  console.log(
    "B",
    s,
    S.exclusions.n_ok,
    Object.entries(S.cells)
      .map(([et, C]) => `${et}:${C.forms.any.n}`)
      .join(" "),
  );
console.log("B cells", B.nCells, "small", B.nSmall, "検算すべて通過");
