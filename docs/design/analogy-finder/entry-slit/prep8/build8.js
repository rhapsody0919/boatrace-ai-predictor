// prep8: 進入の型（waku・inlost・mae6・mae5・mae56・maeOther）× スリット7形 の1〜3着・決まり手・万舟。
// raw/p8_*.json を合算・検算して prep8.json・prep8.md を作る。検算が合わなければ例外で止まる。使い方: node build8.js
import fs from "node:fs";
import path from "node:path";
const dir = path.dirname(new URL(import.meta.url).pathname);
const rd = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
const fail = (m) => {
  throw new Error("検算エラー: " + m);
};
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

const T7 = ["逃げ", "差し", "まくり", "まくり差し", "抜き", "恵まれ", "その他"];
const SCOPES = [
  ["v20", "若松"],
  ["v20G1", "若松×G1"],
  ["all", "全国"],
];
const BASE = ["waku", "inlost", "mae6", "mae5", "mae56", "maeOther"];
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
const FORMS = [
  ["any", "形を問わない"],
  ["flat", "横一線"],
  ["wall", "内3艇そろう"],
  ["d2", "2コース凹み"],
  ["d3", "カド受け凹み"],
  ["kado", "カド一撃"],
  ["d1", "イン凹み"],
  ["dash", "ダッシュ勢先行"],
];
const empty = () => ({
  n: 0,
  r1: Array(6).fill(0),
  r2: Array(6).fill(0),
  r3: Array(6).fill(0),
  tc: Array(7).fill(0),
  man: 0,
  payn: 0,
});
const addInto = (o, x) => {
  o.n += x.n;
  for (const k of ["r1", "r2", "r3", "tc"])
    x[k].forEach((v, i) => {
      o[k][i] += v;
    });
  o.man += x.man;
  o.payn += x.payn;
};

// 1) セルの合算（長期＋本体）
const base = {};
const bySrc = { kb: {}, main: {} };
const excl = {};
for (const [src, f] of [
  ["kb", "raw/p8_kb.json"],
  ["main", "raw/p8_main.json"],
]) {
  const j = rd(f);
  for (const row of j.cells.split(";")) {
    const [s, et, fm, n, r1, r2, r3c, tc, man, payn] = row.split("|");
    const x = {
      n: +n,
      r1: r1.split(",").map(Number),
      r2: r2.split(",").map(Number),
      r3: r3c.split(",").map(Number),
      tc: tc.split(",").map(Number),
      man: +man,
      payn: +payn,
    };
    const k = `${s}|${et}|${fm}`;
    addInto((base[k] ||= empty()), x);
    addInto((bySrc[src][k] ||= empty()), x);
  }
  for (const row of j.excl.split(";")) {
    const [s, ...v] = row.split("|");
    const e = (excl[s] ||= {
      n_pool: 0,
      ret: 0,
      course_unknown: 0,
      n_ok: 0,
      st_missing: 0,
      dh2: 0,
      dh3: 0,
      pay_missing: 0,
      by_source: {},
    });
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
    keys.forEach((key, i) => {
      e[key] += +v[i];
    });
    e.by_source[src] = Object.fromEntries(keys.map((key, i) => [key, +v[i]]));
  }
}
const cell = (s, et, fm) => {
  const o = empty();
  const parts =
    et === "all"
      ? BASE
      : et === "mae"
        ? ["mae6", "mae5", "mae56", "maeOther"]
        : [et];
  for (const p of parts)
    if (base[`${s}|${p}|${fm}`]) addInto(o, base[`${s}|${p}|${fm}`]);
  return o;
};

// 2) 検算
const p7 = rd("prep7.json");
const P7N = { all: 401243, v20: 16879, v20G1: 812 };
const checks = [];
for (const [s] of SCOPES) {
  const e = excl[s];
  if (e.n_ok !== P7N[s]) fail(`${s} 対象レース数 ${e.n_ok} ≠ prep7 ${P7N[s]}`);
  if (
    e.n_pool !== p7.scopes[s].exclusions.n_pool ||
    e.ret !== p7.scopes[s].exclusions.ret
  )
    fail(`${s} 母集団・返還艇除外が prep7 と違う`);
  if (e.st_missing !== 0)
    fail(`${s} ST 不明があり any と形の分母がずれる（想定外）`);
  for (const [fm] of FORMS) {
    const all = cell(s, "all", fm),
      w = cell(s, "waku", fm),
      il = cell(s, "inlost", fm),
      m = cell(s, "mae", fm);
    if (w.n + il.n + m.n !== all.n) fail(`${s}|${fm} waku+inlost+mae ≠ all`);
    const ms = sum(
      ["mae6", "mae5", "mae56", "maeOther"].map((x) => cell(s, x, fm).n),
    );
    if (ms !== m.n) fail(`${s}|${fm} mae の内訳の合計 ≠ mae`);
    for (const [et] of ETS) {
      const o = cell(s, et, fm);
      for (const k of ["r1", "r2", "r3"])
        if (sum(o[k]) !== o.n)
          fail(`${s}|${et}|${fm} ${k} の合計 ${sum(o[k])} ≠ n ${o.n}`);
      if (sum(o.tc) !== o.n) fail(`${s}|${et}|${fm} 決まり手の合計 ≠ n`);
      if (o.man > o.payn || o.payn > o.n)
        fail(`${s}|${et}|${fm} 万舟・払戻の件数が不正`);
    }
    // prep7 との照合
    if (fm === "any") {
      if (all.n !== P7N[s]) fail(`${s} all×any ≠ prep7`);
      if (w.n !== p7.scopes[s].a_waku.waku.n)
        fail(`${s} waku×any ≠ prep7 a_waku`);
      if (il.n !== p7.scopes[s].c_b1_course1.no.n)
        fail(`${s} inlost×any ≠ prep7 c=no`);
      // 1着艇番も prep7 と一致すること
      if (
        JSON.stringify(w.r1) !==
        JSON.stringify(p7.scopes[s].a_waku.waku.winner_boat)
      )
        fail(`${s} waku の1着艇番が prep7 と違う`);
      if (
        JSON.stringify(all.r1) !==
        JSON.stringify(p7.scopes[s].overall.winner_boat)
      )
        fail(`${s} 全体の1着艇番が prep7 と違う`);
    } else {
      if (w.n !== p7.scopes[s].cross.af.waku.forms[fm].n)
        fail(
          `${s} waku×${fm} ${w.n} ≠ prep7 cross ${p7.scopes[s].cross.af.waku.forms[fm].n}`,
        );
      if (il.n !== p7.scopes[s].cross.cf.no.forms[fm].n)
        fail(`${s} inlost×${fm} ≠ prep7 cross cf.no`);
      if (all.n !== p7.scopes[s].slit.forms[fm].n)
        fail(`${s} all×${fm} ≠ prep7 slit`);
    }
  }
  // 前付けの組（prep7 b_maeduke）は「枠なり以外」全体が分母で 1号艇1コース以外も含むので、mae6 等とは一致しない。照合はしない。
}
checks.push(
  "各範囲・各形で waku+inlost+mae=all、mae6+mae5+mae56+maeOther=mae",
  "各セルで 1着・2着・3着の艇番の合計＝n、決まり手の合計＝n、万舟≤払戻あり≤n",
  "all×any の n が prep7 の対象レース数（全国 401,243／若松 16,879／若松×G1 812）と一致。母集団・返還艇除外の件数も prep7 と一致",
  "waku×各形の n が prep7 の cross.af.waku と一致、inlost×各形が prep7 の cross.cf.no と一致、all×各形が prep7 の slit と一致",
  "waku×any と all×any の1着艇番 1〜6 が prep7 と一致",
  "件数30未満のセルは、一覧に入ったレース数が n と一致（＝漏れなく全件が一覧に入っている）",
);

// 3) 30未満のセルの一覧
const VENUE = { 20: "若松" };
const parseRows = (f) =>
  rd(f)
    .rows.split(";")
    .map((r) => {
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
        venue: VENUE[venue] || venue,
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
const listRows = [
  ...parseRows("raw/p8_list_kb.json"),
  ...parseRows("raw/p8_list_main.json"),
].sort((a, b) =>
  a.date === b.date ? b.race_number - a.race_number : a.date < b.date ? 1 : -1,
);
const inCell = (r, s, et, fm) =>
  (s === "v20" || r.grade === "G1") &&
  (et === "all" ||
    r.entry_type === et ||
    (et === "mae" && r.entry_type.startsWith("mae"))) &&
  (fm === "any" || r.forms.includes(fm));

// 4) 出力
const T = (o) => Object.fromEntries(T7.map((t, i) => [t, o.tc[i]]));
const out = { _meta: {}, example: null, scopes: {} };
let nSmall = 0;
for (const [s, label] of SCOPES) {
  const S = (out.scopes[s] = { label, exclusions: excl[s], cells: {} });
  for (const [et, etl] of ETS) {
    S.cells[et] = { label: etl, forms: {} };
    for (const [fm, fl] of FORMS) {
      const o = cell(s, et, fm),
        kb = bySrc.kb,
        c = {
          label: fl,
          n: o.n,
          n_kb: 0,
          n_main: 0,
          first_boat: o.r1,
          second_boat: o.r2,
          third_boat: o.r3,
          technique: T(o),
          manshu: o.man,
          payout_known: o.payn,
          manshu_rate: wilson(o.man, o.payn),
          b1_win: wilson(o.r1[0], o.n),
        };
      const parts =
        et === "all"
          ? BASE
          : et === "mae"
            ? ["mae6", "mae5", "mae56", "maeOther"]
            : [et];
      for (const p of parts) {
        c.n_kb += (kb[`${s}|${p}|${fm}`] || { n: 0 }).n;
        c.n_main += (bySrc.main[`${s}|${p}|${fm}`] || { n: 0 }).n;
      }
      if (o.n < 30) {
        nSmall++;
        const rows = listRows.filter((r) => inCell(r, s, et, fm));
        if (rows.length !== o.n)
          fail(`${s}|${et}|${fm} 一覧 ${rows.length}件 ≠ n ${o.n}`);
        c.races = rows
          .slice(0, 30)
          .map(({ entry_type, ...r }) => ({ ...r, entry_type }));
      }
      S.cells[et].forms[fm] = c;
    }
  }
}

// 5) 例のレース
const ex = rd("raw/p8_example.json");
const cst = [1, 2, 3, 4, 5, 6].map((cc) =>
  Math.round(ex.st_by_boat[ex.actual_course_by_boat.indexOf(cc)] * 100),
);
const mx = Math.max(...cst),
  mn = Math.min(...cst),
  least = (...a) => Math.min(...a),
  greatest = (...a) => Math.max(...a);
const c = [null, ...cst];
const exForms = [
  ["flat", mx - mn <= 6],
  ["wall", greatest(c[1], c[2], c[3]) - least(c[1], c[2], c[3]) <= 2],
  ["d2", c[2] - least(c[1], c[3]) >= 5],
  ["d3", c[3] - least(c[2], c[4]) >= 5],
  ["kado", least(c[1], c[2], c[3]) - c[4] >= 3],
  ["d1", c[1] - c[2] >= 5],
  ["dash", c[1] + c[2] + c[3] - (c[4] + c[5] + c[6]) >= 15],
]
  .filter(([, v]) => v)
  .map(([f]) => f);
const acb = ex.actual_course_by_boat;
const maeBoats = [1, 2, 3, 4, 5, 6].filter((k) => acb[k - 1] < k).join("");
const exEt =
  acb[0] !== 1
    ? "inlost"
    : acb.join() === "1,2,3,4,5,6"
      ? "waku"
      : maeBoats === "6"
        ? "mae6"
        : maeBoats === "5"
          ? "mae5"
          : maeBoats === "56"
            ? "mae56"
            : "maeOther";
const tan = ex.payouts.find((p) => p.t === "3tan");
if (tan.p !== ex.pay3tan_payout_trio_col)
  fail("例のレース: race_payouts 3tan と race_results.payout_trio が違う");
if (
  `${ex.rank1}-${ex.rank2}-${ex.rank3}` !== "4-1-5" ||
  ex.winning_technique !== "差し"
)
  fail("例のレース: 結果が 4-1-5 差し でない");
out.example = {
  race_id: ex.race_id,
  date: ex.race_date,
  venue: "若松",
  race_number: ex.race_number,
  grade: ex.race_grade,
  title: ex.race_title,
  stage: ex.race_stage,
  boats: [1, 2, 3, 4, 5, 6].map((b) => ({
    boat: b,
    exhibition_course: ex.exh_course_by_boat[b - 1],
    exhibition_st: ex.exh_st_by_boat[b - 1],
    exhibition_start_flag: ex.exh_start_flag[b - 1],
    actual_course: acb[b - 1],
    actual_st: ex.st_by_boat[b - 1],
    finish:
      [ex.rank1, ex.rank2, ex.rank3, ex.rank4, ex.rank5, ex.rank6].indexOf(b) +
      1,
  })),
  st_by_course_x100: cst,
  entry_type: exEt,
  exhibition_entry_type_same: ex.exh_course_by_boat.join() === acb.join(),
  forms: exForms,
  result: `${ex.rank1}-${ex.rank2}-${ex.rank3}`,
  technique: ex.winning_technique,
  payout_3tan: tan.p,
  popularity_3tan: tan.pop,
  payout_3fuku: ex.payouts.find((p) => p.t === "3fuku").p,
  note: "2026-09-27 は集計の母集団（〜2026-09-26）の外。3号艇は展示で start_flag=F（展示ST 0.09 はフライングの値とみられる。展示のFは本番の返還ではない）。本番は返還なし。race_results.popularity_trifecta=6 は3連複の人気（列名と券種が逆）で、3連単の人気は race_payouts の 34",
};

out._meta = {
  data_version:
    "本番 Supabase（読み取りのみ、MCP execute_sql）2026-10-03 23:00〜23:20 JST 取得",
  population:
    "prep7 と同じ: 120 の analogy_pool_outcomes 相当、2019-04-01〜2026-09-26。返還艇（F・出遅れ。本体は着欄 F/L/欠・refund_boats も）がいるレースと進入不明のレースを除く。対象 全国 401,243R／若松 16,879R／若松×G1 812R（G1 だけ。SG は含まない＝prep7 の v20G1 と同じ）",
  course_and_st:
    "prep7 と同じ。長期 kb_archive_boats.course・start_timing、本体 race_results.actual_course_1..6・race_start_timings.start_timing。ST は round(st×100) をコース順に並べる",
  entry_type:
    "1レースは必ず1つ: inlost＝1号艇が1コース以外（前付けの有無より優先）／waku＝全艇枠なり／それ以外（1号艇1コース・枠なり以外）は前付けした艇（艇番より内のコースに入った艇）で mae6＝6号艇だけ・mae5＝5号艇だけ・mae56＝5号艇と6号艇の2艇だけ・maeOther＝それ以外（2〜4号艇の前付けを含む組、3艇以上など）。mae＝mae6+mae5+mae56+maeOther、all＝全部",
  maeduke_note:
    "1号艇が1コースで枠なりでない場合、前付けした艇は必ず1艇以上いる（2〜6コースを2〜6号艇で並べ替えたとき、恒等でなければ艇番より内に入る艇が必ずいる）。外に押し出された艇は前付けに数えない。prep7 の b_maeduke（枠なり以外全体が分母、1号艇1コース以外も含む）とは分母が違う",
  slit_rule:
    "prep7 と同じ BOA-635 spec の1段目（横一線 max−min≤6／内3艇そろう max(c1..c3)−min≤2／2コース凹み c2−min(c1,c3)≥5／カド受け凹み c3−min(c2,c4)≥5／カド一撃 min(c1,c2,c3)−c4≥3／イン凹み c1−c2≥5／ダッシュ勢先行 (c1+c2+c3)−(c4+c5+c6)≥15）。形は重なりうる（1レースが複数の形に入るので、形の n を足しても any にならない）。any＝形を問わない全レース（ST 不明は0件なので any の分母と形の分母は同じ母集団）",
  finish_order:
    "1〜3着の艇番は prep7 と同じ取り方（長期は kb_archive_boats.finish_rank＝k の艇の max(boat_number)、本体は race_results.rank1..3）。母集団は 2着・3着の艇がいるレースだけ",
  dead_heat:
    "3着同着（finish_rank=3 が2艇）は長期だけで 全国109R・若松3R・若松×G1 0R。この場合 3着は艇番の大きい1艇だけを数え（prep7 の SQL の max(boat_number) のまま）、3着の合計が n と一致するようにしている。2着同着は母集団に 0R（2着同着だと3着の艇がいないので120 の条件で外れる）。本体は rank 列が1艇ずつなので同着を判別できない（0R 扱い）",
  technique:
    "逃げ・差し・まくり・まくり差し・抜き・恵まれ の6つと、それ以外・NULL を「その他」。長期 kb_archive_races.technique、本体 race_results.winning_technique",
  payout_3tan:
    "万舟＝3連単の払戻 ≥ 10,000円。分母（payout_known）＝払戻 > 0 が取れたレース。長期: kb_archive_races.payout_3tan。本体: race_results.payout_trio（列名と券種が逆。payout_trifecta は3連複。race_payouts の 3tan と 3,634R 全件で payout_trio が一致し、payout_trifecta は0件一致。docs/design/analogy-finder/plan.md の注記とも一致）。欠損: 対象レースでは長期 0R・本体 全国4R（若松・若松×G1 は0R）。kb_archive_races 全体では payout_3tan NULL が年20〜40R あるが、すべて返還・不成立等で母集団の外。取れない期間は無い。race_payouts は 2025-12-02〜で 3,634R しかないので使っていない（照合だけ）",
  races_list:
    "件数30未満のセル（若松の inlost×flat・wall、若松×G1 の waku 以外のほぼ全部。計 " +
    nSmall +
    " セル）に races を付けた。新しい順（日付・R番号の降順）最大30件。項目: race_id（長期 kb_archive_races.race_id、本体 races.race_id。どちらも YYYY-MM-DD-VV-RR）、日付、会場、グレード、開催名（長期 kb_archive_venue_days.title、本体 race_conditions.race_title。本体の 2025-12〜2026-01 は空のものあり）、ステージ、1-2-3着、決まり手、3連単払戻、各艇の進入コース（1〜6号艇の順）、当てはまる形",
  check: checks,
  sql: [
    "sql/p8_pool_kb.sql",
    "sql/p8_pool_main.sql",
    "sql/p8_common_tail.sql",
    "sql/p8_cells_tail.sql",
    "sql/p8_executed_cells_kb.sql",
    "sql/p8_executed_cells_main.sql",
    "sql/p8_list_tail.sql",
    "sql/p8_list_tail_kb.sql",
    "sql/p8_executed_list_kb.sql",
    "sql/p8_executed_list_main.sql",
    "sql/p8_example.sql",
    "sql/p8_payout_check.sql",
  ],
};
fs.writeFileSync(path.join(dir, "prep8.json"), JSON.stringify(out, null, 1));

// md
const f3 = (x) => (x == null ? "-" : x.toFixed(3));
const ci = (w) =>
  w && w.p != null ? `${f3(w.p)} [${f3(w.lo)}–${f3(w.hi)}] ${w.x}/${w.n}` : "-";
const L = [];
const P = (...x) => L.push(...x);
const VER = "本番 2026-10-03 23:00〜23:20 JST 取得";
P("# 進入の型 × スリットの形（prep8）", "");
for (const [k, v] of Object.entries(out._meta))
  if (typeof v === "string") P(`- **${k}**: ${v}`);
P(
  "- **check**（build8.js、すべて通過）:",
  ...checks.map((c2) => `  - ${c2}`),
  "",
  "1〜3着は艇番1〜6の件数、決まり手は 逃げ・差し・まくり・まくり差し・抜き・恵まれ・その他 の件数。万舟率は「割合 [Wilson 95%CI] 万舟/払戻あり」",
  "",
);
const E = out.example;
P(
  "## 例のレース: 2026-09-27 若松12R",
  "",
  `${E.title} ${E.stage}（${E.grade}）。結果 **${E.result}** ${E.technique}、3連単 ${E.payout_3tan}円（${E.popularity_3tan}番人気）。進入の型 **${E.entry_type}**（展示の進入と本番の進入は${E.exhibition_entry_type_same ? "同じ" : "違う"}）、スリットの形 **${E.forms.join("・") || "なし"}**（コース順 ST×100: ${E.st_by_course_x100.join(", ")}）`,
  "",
  "| 艇 | 展示の進入 | 展示ST | 本番の進入 | 本番ST | 着 |",
  "|---|---|---|---|---|---|",
  ...E.boats.map(
    (b) =>
      `| ${b.boat} | ${b.exhibition_course} | ${b.exhibition_start_flag ? b.exhibition_start_flag : ""}${b.exhibition_st} | ${b.actual_course} | ${b.actual_st} | ${b.finish} |`,
  ),
  "",
  E.note,
  "",
  `出典: prep8.json \`example\`（sql/p8_example.sql）／${VER}`,
  "",
);
for (const [s, S] of Object.entries(out.scopes)) {
  const e = S.exclusions;
  P(
    `## ${S.label}`,
    "",
    `母集団 ${e.n_pool}R → 返還艇ありを除く ${e.ret}R → 対象 ${e.n_ok}R（長期 ${e.by_source.kb.n_ok}・本体 ${e.by_source.main.n_ok}）。3着同着 ${e.dh3}R、払戻不明 ${e.pay_missing}R`,
    "",
  );
  P(
    "### 進入の型ごと（形を問わない）",
    "",
    "| 型 | n | 出現率 | 1着 1〜6 | 2着 1〜6 | 3着 1〜6 | 決まり手 | 万舟率 |",
    "|---|---|---|---|---|---|---|---|",
  );
  for (const [et, C] of Object.entries(S.cells)) {
    const o = C.forms.any;
    P(
      `| ${C.label} | ${o.n} | ${f3(o.n / e.n_ok)} | ${o.first_boat.join(", ")} | ${o.second_boat.join(", ")} | ${o.third_boat.join(", ")} | ${Object.values(o.technique).join(", ")} | ${ci(o.manshu_rate)} |`,
    );
  }
  P("", `出典: prep8.json \`scopes.${s}.cells.<型>.forms.any\`／${VER}`, "");
  P(
    "### 進入の型 × 形",
    "",
    "| 型 | 形 | n | 1着 1〜6 | 2着 1〜6 | 3着 1〜6 | 決まり手 | 万舟率 |",
    "|---|---|---|---|---|---|---|---|",
  );
  for (const [, C] of Object.entries(S.cells))
    for (const [fm, o] of Object.entries(C.forms))
      if (fm !== "any")
        P(
          `| ${C.label} | ${o.label} | ${o.n}${o.n < 30 ? "（30未満）" : ""} | ${o.first_boat.join(", ")} | ${o.second_boat.join(", ")} | ${o.third_boat.join(", ")} | ${Object.values(o.technique).join(", ")} | ${ci(o.manshu_rate)} |`,
        );
  P("", `出典: prep8.json \`scopes.${s}.cells\`／${VER}`, "");
  const smalls = Object.entries(S.cells).flatMap(([et, C]) =>
    Object.entries(C.forms)
      .filter(([, o]) => o.races)
      .map(([fm, o]) => [et, C.label, fm, o]),
  );
  if (smalls.length) {
    P(`### 件数30未満のセルのレース一覧（${smalls.length}セル、新しい順）`, "");
    for (const [, cl, , o] of smalls) {
      P(
        `#### ${cl} × ${o.label}（${o.n}R）`,
        "",
        "| race_id | グレード | 開催・ステージ | 1-2-3 | 決まり手 | 3連単 | 進入（1〜6号艇） | 形 |",
        "|---|---|---|---|---|---|---|---|",
      );
      for (const r of o.races)
        P(
          `| ${r.race_id} | ${r.grade} | ${r.title || "-"} ${r.stage || ""} | ${r.finish_1_2_3} | ${r.technique || "-"} | ${r.payout_3tan ?? "-"} | ${r.course_by_boat.join("")} | ${r.forms.join("・") || "-"} |`,
        );
      P("");
    }
    P(
      `出典: prep8.json \`scopes.${s}.cells.<型>.forms.<形>.races\`（sql/p8_executed_list_*.sql）／${VER}`,
      "",
    );
  }
}
fs.writeFileSync(path.join(dir, "prep8.md"), L.join("\n"));
for (const [s, S] of Object.entries(out.scopes))
  console.log(
    s,
    S.exclusions.n_ok,
    Object.entries(S.cells)
      .map(
        ([et, C]) =>
          `${et}:${C.forms.any.n}/man${f3(C.forms.any.manshu_rate.p)}`,
      )
      .join(" "),
  );
console.log(
  "small cells",
  nSmall,
  "example",
  E.entry_type,
  E.forms,
  E.result,
  E.payout_3tan,
);
