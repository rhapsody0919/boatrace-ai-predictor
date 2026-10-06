// prep10: 展開シナリオの範囲 allA1Y（全国・6艇とも A1・優勝戦）。build9.js の B（prep9b）と同じ作り。
// raw/p10_*.json を検算して prep10.json/md を作る。検算が合わなければ例外で止まる。使い方: node build10.js
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
  const SCOPES = [["allA1Y", "全国×6艇ともA1×優勝戦"]];
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
    ["kb", "raw/p10_kb.json"],
    ["main", "raw/p10_main.json"],
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
  const p9b = rd("prep9b.json");
  const PARENT = { allA1Y: "allA1" };
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
        // 親の範囲（prep9b の allA1）の部分集合であること
        const par = p9b.scopes[PARENT[s]].cells[et].forms[fm];
        if (o.n > par.n)
          fail(`${key} n ${o.n} > prep9b ${PARENT[s]} の n ${par.n}`);
        for (let b = 0; b < 6; b++)
          if (o.r1[b] > par.first_boat[b])
            fail(`${key} 1着艇番 > prep9b ${PARENT[s]}`);
      }
    }
  }
  // 取りこぼし確認の SQL（別の SQL）の all_a1 × 優勝戦 の件数が、セル集計の母集団と一致すること
  const ck = {};
  for (const src of ["kb", "main"]) {
    const j = rd(`raw/p10_check_${src}.json`).r;
    const g = (a1, y, f) =>
      (j.xtab.find((x) => x.all_a1 === a1 && x.yusho === y && x.fd12 === f) || { n: 0 }).n;
    ck[src] = {
      a1_yusho_fd12: g(true, true, true),
      a1_yusho_not_fd12: g(true, true, false),
      a1_fd12_not_yusho: g(true, false, true),
      all_yusho_fd12: g(true, true, true) + g(false, true, true),
      all_yusho_not_fd12: g(true, true, false) + g(false, true, false),
      all_fd12_not_yusho: g(true, false, true) + g(false, false, true),
      a1_mismatch: j.a1_mismatch,
    };
    const nY = ck[src].a1_yusho_fd12 + ck[src].a1_yusho_not_fd12;
    if (nY !== excl.allA1Y.by_source[src].n_pool)
      fail(`${src} 取りこぼし確認の all_a1×優勝戦 ${nY} ≠ セル集計の母集団 ${excl.allA1Y.by_source[src].n_pool}`);
    if (sum(j.a1_mismatch.map((m) => m.n)) !== ck[src].a1_yusho_not_fd12 + ck[src].a1_fd12_not_yusho)
      fail(`${src} 不一致の内訳の合計 ≠ 不一致の件数`);
  }
  checks.push(
    "各範囲で 母集団 − 返還艇 − 進入不明 ＝ 対象、all×any の n＝対象、ST 不明 0R",
    "各範囲・各形で waku+inlost+mae=all、mae6+mae5+mae56+maeOther=mae",
    "各セルで 1・2・3着の艇番の合計＝n、決まり手の合計＝n、万舟≤払戻あり≤n",
    "各セルで tri の合計＝n、tri から数えた1・2・3着の艇番＝first/second/third_boat、win_tech の行の合計＝first_boat、列の合計＝technique",
    "各セルの n と1着艇番の件数が、親の範囲（prep9b の allA1）の同じセル以下（部分集合）",
    "取りこぼし確認の SQL（sql/p10_executed_check_*.sql、別の SQL）で数えた『6艇ともA1×優勝戦』の件数が、セル集計の母集団（長期・本体それぞれ）と一致。不一致の内訳の合計＝不一致の件数",
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
    ...parseRows("raw/p10_list_kb.json"),
    ...parseRows("raw/p10_list_main.json"),
  ].sort((a, b) =>
    a.date === b.date
      ? b.race_number - a.race_number || a.venue_code - b.venue_code
      : a.date < b.date
        ? 1
        : -1,
  );
  const inCell = (r, s, et, fm) =>
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
const E = excl.allA1Y;
const mm = (src) =>
  ck[src].a1_mismatch
    .filter((m) => !m.yusho)
    .map((m) => `${m.stage} ${m.n}`)
    .join("・");
const mm2 = (src) =>
  ck[src].a1_mismatch
    .filter((m) => m.yusho)
    .map((m) => `${m.stage}（${m.race_number_set}R）${m.n}`)
    .join("・");
const missA1 = ck.kb.a1_fd12_not_yusho + ck.main.a1_fd12_not_yusho;
out._meta = {
  data_version:
    "本番 Supabase（読み取りのみ、MCP execute_sql）2026-10-04 JST 取得",
  population: `prep9b の allA1（全国・6艇とも出走時の級別が A1）を、さらに優勝戦に絞ったもの。期間・除外・級別の取り方は prep9b と同じ（2019-04-01〜2026-09-26）。優勝戦の母集団 ${E.n_pool}R（長期 ${E.by_source.kb.n_pool}・本体 ${E.by_source.main.n_pool}）→ 返還艇ありを除く ${E.ret}R・進入不明 ${E.course_unknown}R → 対象 ${E.n_ok}R（長期 ${E.by_source.kb.n_ok}・本体 ${E.by_source.main.n_ok}）`,
  yusho_rule:
    "優勝戦＝prep8 から pool で使っている round 列が 'yusho'。round の決め方: ステージ名（NFKC 正規化）に『準々』『準優進出』→ other、『準優勝戦』→ junyu、『優勝戦』→ yusho をこの順で当てる。ステージ名で yusho/junyu にならないとき、長期は kb_archive_races.stage_kind（final→yusho、semifinal→junyu、qualifier→yosen、other→other）を使う。本体（races＋race_conditions.race_stage）は stage_kind に当たる列が無いので、ステージ名に『優勝戦』を含むもの（『準優勝戦』『準々優勝戦』を除く）だけが優勝戦。長期でステージ名が『優勝』（戦なし）のものは stage_kind='final' で yusho になる",
  yusho_check: `取りこぼしの確認: 各節の最終日の12R（fd12）と照合した。fd12 は 長期＝kb_archive_venue_days.is_final_day かつ 12R、本体＝12R かつ（race_conditions.is_final_day または race_series.end_date がその日。本体の is_final_day は NULL の日があるため race_series で補った）。照合は pool の段階（返還艇・進入不明を除く前）で行った（sql/p10_executed_check_*.sql、raw/p10_check_*.json）。6艇とも A1 のレースでは、優勝戦かつ fd12 が 長期 ${ck.kb.a1_yusho_fd12}・本体 ${ck.main.a1_yusho_fd12}、fd12 なのに優勝戦にしていない（取りこぼし候補）が 長期 ${ck.kb.a1_fd12_not_yusho}・本体 ${ck.main.a1_fd12_not_yusho}（計 ${missA1}R。足したときの ${((100 * missA1) / (E.n_pool + missA1)).toFixed(1)}%）、優勝戦にしたが fd12 でないのが 長期 ${ck.kb.a1_yusho_not_fd12}・本体 ${ck.main.a1_yusho_not_fd12}。取りこぼし候補のステージ名は 長期 ${mm("kb")}、本体 ${mm("main")}。どれもステージ名に『優勝戦』が無く stage_kind も other の、名前の違う決勝（賞金女王決定戦・王座決定戦・王将位決定戦・決勝戦・ファイナル・〇〇優）で、中身は優勝戦に当たるものが多い。今回は他の prep・knn と round をそろえるため含めていない（含めると母集団が ${missA1}R 増える）。優勝戦にしたが fd12 でないのは 長期 ${mm2("kb")}、本体 ${mm2("main")}で、いずれも11R の優勝戦（その日の12R が別の優勝戦。GP 最終日の GP シリーズ優勝戦など）。優勝戦としては正しい。参考: 級別を問わない全体では、優勝戦かつ fd12 が 長期 ${ck.kb.all_yusho_fd12}・本体 ${ck.main.all_yusho_fd12}、fd12 なのに優勝戦にしていない が 長期 ${ck.kb.all_fd12_not_yusho}・本体 ${ck.main.all_fd12_not_yusho}、優勝戦にしたが fd12 でない が 長期 ${ck.kb.all_yusho_not_fd12}・本体 ${ck.main.all_yusho_not_fd12}`,
  class_column:
    "prep9b と同じ（長期 kb_archive_boats.class、本体 race_entries.grade。出走時の級別）",
  entry_type:
    "prep8 と同じ（inlost / waku / mae6・mae5・mae56・maeOther、mae＝前付けの4つの合計、all＝全部）",
  slit_rule:
    "prep8 と同じ BOA-635 1段目の7形（形は重なりうる）。any＝形を問わない",
  finish_order:
    "prep8 と同じ。長期 kb_archive_boats.finish_rank、本体 race_results.rank1..3",
  dead_heat: `3着同着（長期だけ）は ${E.dh3}R。prep8 と同じく3着は艇番の大きい1艇（3着の合計＝n）。2着同着は ${E.dh2}R`,
  technique:
    "prep8 と同じ 逃げ・差し・まくり・まくり差し・抜き・恵まれ・その他",
  payout_3tan:
    "prep8 と同じ。万舟＝3連単の払戻 ≥ 10,000円、分母＝払戻 > 0。長期 kb_archive_races.payout_3tan、本体 race_results.payout_trio（列名と券種が逆。payout_trifecta は3連複）。払戻不明 " +
    E.pay_missing +
    "R",
  tri: "prep8b と同じ。3連単の着順（1着-2着-3着の艇番）ごとの件数、件数0は省く",
  win_tech: "prep8b と同じ。1着艇番×決まり手、6×7 すべて持つ",
  races_list: `件数30未満のセル（${nSmall} セル、0件のセルを含む）に races を付けた。prep8 と同じ項目、新しい順（日付・R番号の降順、同日同Rは会場コード順）最大30件。会場は会場コードから名前に直した`,
  small_cells_note: `対象 ${E.n_ok}R のうち全艇枠なりが ${out.scopes.allA1Y.cells.waku.forms.any.n}R、1号艇が1コース以外は ${out.scopes.allA1Y.cells.inlost.forms.any.n}R。前付けの型・形ごとのセルはほとんど30未満。本体（2025-12〜）の分は ${E.by_source.main.n_ok}R だけで、ほぼ長期の数字`,
  run_setting:
    "executed_* の SQL は先頭で SET enable_nestloop = off（と statement_timeout）にして実行した。round='yusho' で絞ると kb_a の件数見積もりが1行になり、kr の CTE を入れ子ループで全件なめ直して時間切れになったため（EXPLAIN で確認）。結合方法が変わるだけで結果は変わらない",
  check: checks,
  sql: [
    "gen_p10.js（prep9b の SQL から文字列置換で作る）",
    "sql/p10_pool_kb.sql",
    "sql/p10_pool_main.sql",
    "sql/p10_common_tail.sql",
    "sql/p10_cells_tail.sql",
    "sql/p10_executed_cells_kb.sql",
    "sql/p10_executed_cells_main.sql",
    "sql/p10_list_tail.sql",
    "sql/p10_executed_list_kb.sql",
    "sql/p10_executed_list_main.sql",
    "sql/p10_check_tail.sql",
    "sql/p10_executed_check_kb.sql",
    "sql/p10_executed_check_main.sql",
  ],
};
  fs.writeFileSync(path.join(dir, "prep10.json"), JSON.stringify(out, null, 1));

  // md
  const L = [];
  const P = (...x) => L.push(...x);
  const VER = "本番 2026-10-04 JST 取得";
  P("# 展開シナリオ: 6艇ともA1×優勝戦（prep10）", "");
  for (const [k, v] of Object.entries(out._meta))
    if (typeof v === "string") P(`- **${k}**: ${v}`);
  P(
    "- **check**（build10.js、すべて通過）:",
    ...checks.map((c2) => `  - ${c2}`),
    "",
    "1〜3着は艇番1〜6の件数、決まり手は 逃げ・差し・まくり・まくり差し・抜き・恵まれ・その他 の件数。1号艇1着率・万舟率は「割合 [Wilson 95%CI] x/n」。tri・win_tech は prep10.json にある（md では上位5つの3連単だけ出す）",
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
    P("", `出典: prep10.json \`scopes.${s}.cells\`／${VER}`, "");
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
        `出典: prep10.json \`scopes.${s}.cells.<型>.forms.<形>.races\`（sql/p10_executed_list_*.sql）／${VER}`,
        "",
      );
    }
  }
  fs.writeFileSync(path.join(dir, "prep10.md"), L.join("\n"));
  return { out, nSmall, nCells };
})();

for (const [s, S] of Object.entries(B.out.scopes))
  console.log(
    s,
    S.exclusions.n_ok,
    Object.entries(S.cells)
      .map(([et, C]) => `${et}:${C.forms.any.n}`)
      .join(" "),
  );
console.log("cells", B.nCells, "small", B.nSmall, "検算すべて通過");
