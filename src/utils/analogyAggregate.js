/**
 * アナロジー・ファインダー v16 の類似レース・展開シナリオの集計（BOA-271 spec FR-B・FR-C）。純粋関数。
 *
 * 類似レース（タブ2）はスライダーの件数で数え直す（似ている順の上位 n 件）。入力は /api/analogy/similar の
 * neighbors（scripts/ml/analogy/v16_morning.py の similar-racecard、展示後は scripts/lib/analogyV16Exhibition.js）。
 * 着順の流れ・よく出た3連単はタブ3（scenario の cells の tri）と同じ形 {"1-2-4": 件数} にして共用する。
 */

import { bestOf } from "./bestOf.js";
import { SMALL_SAMPLE_THRESHOLD } from "../components/race/basicInfoStats.js";

/** スライダーの段（spec B-4） */
export const SLIDER_STEPS = [
  10, 20, 30, 50, 75, 100, 150, 200, 300, 400, 600, 800,
];
export const DEFAULT_STEP = 400;
export const MAX_SHOWN = 800;
/** タブ2で「割合はぶれやすい」を出す件数 */
export const FEW_SIMILAR = 30;
export const TECHNIQUES = [
  "逃げ",
  "差し",
  "まくり",
  "まくり差し",
  "抜き",
  "恵まれ",
];

/**
 * 段（spec B-4）: 層の件数（表示する件数、800まで）未満の段と、最後に層の件数
 * @param {number} total 表示できる件数（neighbors の数）
 */
export function sliderSteps(total) {
  if (total >= MAX_SHOWN) return SLIDER_STEPS;
  return [...SLIDER_STEPS.filter((s) => s < total), total].filter((s) => s > 0);
}

/** 既定の段の位置: 400（層がそれより少なければ層の件数＝最後の段） */
export function defaultStepIndex(steps) {
  const i = steps.indexOf(DEFAULT_STEP);
  return i >= 0 ? i : steps.length - 1;
}

/** race_id「2021-10-14-16-12」→ 日付・会場・R（展示後の neighbors は結果から日付・会場・R を省いている） */
export function normalizeNeighbor(n) {
  const m = /^(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})$/.exec(n.race_id ?? "");
  return {
    ...n,
    date: n.date ?? m?.[1] ?? null,
    venue_code: n.venue_code ?? (m ? Number(m[2]) : null),
    race_number: n.race_number ?? (m ? Number(m[3]) : null),
  };
}

const validFinish = (f) =>
  Array.isArray(f) &&
  f.length >= 3 &&
  f.slice(0, 3).every((b) => b >= 1 && b <= 6);

/**
 * 類似レースの決まり方（spec B-8）
 * @param {object[]} neighbors 似ている順の上位 n 件
 * @returns {{n:number, win:number[], hit:{1:number[],2:number[],3:number[]}, tech:Record<string,number>, tri:Record<string,number>}}
 *   n は件数（結果のある件。win・hit・tri の分母）
 */
export function aggregateNeighbors(neighbors) {
  const out = {
    n: 0,
    win: [0, 0, 0, 0, 0, 0],
    hit: {
      1: [0, 0, 0, 0, 0, 0],
      2: [0, 0, 0, 0, 0, 0],
      3: [0, 0, 0, 0, 0, 0],
    },
    tech: {},
    tri: {},
  };
  for (const x of neighbors) {
    if (!validFinish(x.finish)) continue;
    const f = x.finish.slice(0, 3);
    out.n += 1;
    out.win[f[0] - 1] += 1;
    f.forEach((b, i) => {
      for (let t = i + 1; t <= 3; t++) out.hit[t][b - 1] += 1;
    });
    const tq = x.technique ?? "その他";
    out.tech[tq] = (out.tech[tq] ?? 0) + 1;
    const k = f.join("-");
    out.tri[k] = (out.tri[k] ?? 0) + 1;
  }
  return out;
}

/**
 * 33項目（spec B-6・B-7。v16_similar.item_levels のキー）。group は「1件ずつ見比べる」の見出し、
 * exhibition は展示の時点で決まる項目（展示前は出さない）。距離に使うかは inDistance（下）
 */
export const SIMILAR_ITEMS = [
  { key: "venue", group: "race" },
  { key: "race_number_band", group: "race" },
  { key: "race_number", group: "race", dup: true },
  { key: "grade", group: "race" },
  { key: "grade_bin", group: "race", dup: true },
  { key: "round", group: "race" },
  { key: "series_day", group: "race" },
  { key: "is_final_day", group: "race", noDistance: true },
  { key: "class_all6", group: "power" },
  { key: "n_A1", group: "power", dup: true },
  { key: "b1_class", group: "power" },
  { key: "win_gap_band", group: "power" },
  { key: "top_boat", group: "power" },
  { key: "nat_win_6", group: "power" },
  { key: "nat_win_rank_4", group: "power" },
  { key: "b1_nat_win", group: "power" },
  { key: "loc_win_6", group: "power" },
  { key: "recent_win30_6", group: "power" },
  { key: "recent_top3_30_6", group: "power" },
  { key: "st_mean30_6", group: "start" },
  { key: "b1_st_rank_band", group: "start" },
  { key: "motor_2_6", group: "machine" },
  { key: "b1_motor_rank_band", group: "machine" },
  { key: "boat_2_6", group: "machine" },
  { key: "b1_boat_rank_band", group: "machine" },
  { key: "age_6", group: "profile" },
  { key: "weight_6", group: "profile" },
  { key: "n_local", group: "profile" },
  { key: "weather", group: "water", exhibition: true },
  { key: "wind_bin", group: "water", exhibition: true },
  { key: "wind_vector", group: "water", exhibition: true, dup: true },
  { key: "wave_bin", group: "water", exhibition: true },
  { key: "exh_time_diff_6", group: "exhibition", exhibition: true },
];
export const ITEM_GROUPS = [
  "race",
  "power",
  "start",
  "machine",
  "profile",
  "water",
  "exhibition",
];

/** そろえる条件の項目（全件そろうので「何が似ている？」に出さない。spec B-6） */
export function layerItemKeys(conditions) {
  return [
    "b1_class",
    "win_gap_band",
    "top_boat",
    ...(conditions?.round ? ["round"] : []),
    ...(conditions?.grade_g1plus ? ["grade", "grade_bin"] : []),
  ];
}

/** その時点で近さの計算に使う項目か（展示前は展示・天候・水面を使わない。最終日は使わない） */
export const inDistance = (item, exhibitionStage) =>
  !item.noDistance && (exhibitionStage || !item.exhibition);

/** その時点で画面に出す項目（展示前は展示の時点で決まる項目を出さない） */
export const visibleItems = (exhibitionStage) =>
  SIMILAR_ITEMS.filter((it) => exhibitionStage || !it.exhibition);

/**
 * 項目ごとの「同じ」「近いも含む」の割合（spec B-6）。値 −1（どちらかが欠損）は数えない
 * @returns {Record<string, {same:number, near:number, n:number, rate:number|null, nearRate:number|null}>}
 */
export function itemRates(neighbors, items) {
  return Object.fromEntries(
    items.map((it) => {
      const v = neighbors
        .map((x) => x.items?.[it.key])
        .filter((m) => m === 0 || m === 1 || m === 2);
      const same = v.filter((m) => m === 2).length;
      const near = v.filter((m) => m >= 1).length;
      return [
        it.key,
        {
          same,
          near,
          n: v.length,
          rate: v.length ? same / v.length : null,
          nearRate: v.length ? near / v.length : null,
        },
      ];
    }),
  );
}

/**
 * 1件の「同じ{a}・近い{b}・違う{c}」（近さに使う項目、重複の項目は除く）
 * @returns {{same:number, near:number, diff:number, total:number}}
 */
export function neighborCounts(neighbor, exhibitionStage) {
  const out = { same: 0, near: 0, diff: 0, total: 0 };
  for (const it of SIMILAR_ITEMS) {
    if (!inDistance(it, exhibitionStage) || it.dup) continue;
    const m = neighbor.items?.[it.key];
    if (m !== 0 && m !== 1 && m !== 2) continue;
    out.total += 1;
    if (m === 2) out.same += 1;
    else if (m === 1) out.near += 1;
    else out.diff += 1;
  }
  return out;
}

/**
 * 3連単の件数 {"1-2-4": 件数} → 多い順の [[1,2,4], 件数][]（同数は組み合わせの昇順）
 * @param {Record<string, number>} tri
 * @param {{first?: number|null, not1?: boolean}} [filter] 1着の艇で絞る・1号艇以外が勝ったレース
 */
export function trifectaList(tri, { first = null, not1 = false } = {}) {
  return Object.entries(tri ?? {})
    .map(([k, c]) => [k.split("-").map(Number), c])
    .filter(
      ([x, c]) => c > 0 && (!first || x[0] === first) && (!not1 || x[0] !== 1),
    )
    .sort((a, b) => b[1] - a[1] || a[0].join("").localeCompare(b[0].join("")));
}

/**
 * 着順の流れの帯（BOA-816）。p=0 は1着→2着、p=1 は2着→3着の帯で、件数はもう一方の着順を問わない合計。
 * 3連単の一覧と同じ tri・同じ絞り込み（trifectaList）から数えるので、帯の件数＝その帯に入る3連単の件数の合計
 * @returns {[number, number, number, number][]} [p, 前の着の艇, 後の着の艇, 件数]（p・艇番の順）
 */
export function flowLinks(tri, opts = {}) {
  const rows = trifectaList(tri, opts);
  return [0, 1].flatMap((p) => {
    const m = new Map();
    rows.forEach(([x, c]) => {
      const key = `${x[p]}-${x[p + 1]}`;
      m.set(key, (m.get(key) ?? 0) + c);
    });
    return [...m.entries()]
      .map(([key, c]) => [p, ...key.split("-").map(Number), c])
      .sort((u, v) => u[1] - v[1] || u[2] - v[2]);
  });
}

/**
 * 押した帯の内訳（BOA-816、ユーザー決定の案1）。帯に入る3連単を件数の多い順に全部。帯は押したときの絞り込み
 * （first・not1）を持ち、絞り込みが変わったら選んでいないことにする（ファンパネル: 1着を変えたら帯の選択は外す）。
 * 帯がその絞り込みの流れに無ければ null
 * @param {{p:number, a:number, b:number, first:number|null, not1:boolean}|null} band
 * @returns {{rows: [number[], number][], total: number}|null}
 */
export function bandBreakdown(tri, band, { first = null, not1 = false } = {}) {
  if (!band || band.first !== first || band.not1 !== not1) return null;
  const rows = trifectaList(tri, { first, not1 }).filter(
    ([x]) => x[band.p] === band.a && x[band.p + 1] === band.b,
  );
  if (!rows.length) return null;
  return { rows, total: rows.reduce((s, [, c]) => s + c, 0) };
}

/** よく出た3連単の上位の数（spec B-8「上位3つ」） */
export const TOP_TRIFECTA = 3;

/** 平均STの表で、会場の値を薄く出す走数（これ未満は薄く、金枠も付けない） */
export const VENUE_FEW_RUNS = 10;

/**
 * 展開シナリオの「数字で見る（平均STの表）」の金枠（BOA-814）。出走表と同じ決まり（bestOf）で行ごとに6艇を比べる。
 * 平均STは小さいほど良く、表示と同じ3桁で比べる。展示STは2桁で比べ、F は候補から外す（思考アシストの展示STと同じ）。
 * 当てにならない値は比べるが金枠を付けず、次の艇にも繰り下げない:
 * - このコース: 走数が SMALL_SAMPLE_THRESHOLD 未満（全体で埋めた値を含む）
 * - 会場: 薄く出している値（VENUE_FEW_RUNS 未満）
 * 会場の全選手の行はコースごとの基準で艇の比較ではないので付けない
 * @param {{course_filled?: (number|null)[], course_n?: number[], overall?: (number|null)[], venue?: (number|null)[], venue_n?: number[]}} courseSt
 * @param {(number|null)[]|null} exhByBoat 艇ごとの今日の展示ST（F は負）。展示前は null
 * @returns {{course: Set<number>, overall: Set<number>, venue: Set<number>, exh: Set<number>}}
 */
export function hintTableBest(courseSt, exhByBoat) {
  const row = (vals, hidden, digits = 3) =>
    bestOf(
      (vals ?? []).map((value, i) => ({
        boat: i + 1,
        value,
        hidden: hidden ? hidden(i) : false,
      })),
      "min",
      { digits },
    );
  const cn = courseSt?.course_n;
  const vn = courseSt?.venue_n;
  return {
    course: row(
      courseSt?.course_filled,
      cn && ((i) => cn[i] < SMALL_SAMPLE_THRESHOLD),
    ),
    overall: row(courseSt?.overall),
    venue: row(courseSt?.venue, vn && ((i) => vn[i] < VENUE_FEW_RUNS)),
    exh: exhByBoat
      ? row(
          exhByBoat.map((v) => (typeof v === "number" && v < 0 ? null : v)),
          null,
          2,
        )
      : new Set(),
  };
}

/** 3連単の払戻がこれ以上なら万舟（scripts/ml/analogy/v16_scenario.py の MANSHU と同じ） */
export const MANSHU_YEN = 10000;
/** STEP4 の一覧で最初に出す件数と、「もっと見る」で出す上限（BOA-823、承認モック mock-scenario-race-links-v2） */
export const RACE_LIST_FIRST = 5;
export const RACE_LIST_MORE = 20;

/**
 * STEP4 の件数を押したときの元のレースの一覧（BOA-823）。入力は /api/analogy/scenario?races=1 の races
 * （scripts/ml/analogy/v16_scenario.py の scope_races。新しい順、範囲ごとに直近3,000件まで）。
 * 画面と同じ絞り（STEP1 の進入・STEP2 の形・1着の艇・「1号艇以外」）に、押した物（pick）を重ねる。
 * pick: {kind:"first", boat} 1着の艇 ／ {kind:"tech", tech} 決まり手（記録なしは「その他」）／ {kind:"manshu"} 万舟 ／
 *   {kind:"tri", combo:[1,3,2]} 3連単 ／ {kind:"band", p, a, b} 着順の流れの帯（p=0 は1着→2着、1 は2着→3着）
 * @returns {{race_id: string, finish: number[], tech: string|null, payout: number|null, entry: number, forms: string[]}[]}
 */
export function raceListRows(
  races,
  { entry = "all", form = "any", first = null, not1 = false, pick },
) {
  if (!races?.rows) return [];
  const eBit = races.entry_bits.indexOf(entry);
  const fBit = races.form_bits.indexOf(form);
  const hit = (fin, tech, pay) => {
    switch (pick?.kind) {
      case "first":
        return fin[0] === pick.boat;
      case "tech":
        return (TECHNIQUES.includes(tech) ? tech : "その他") === pick.tech;
      case "manshu":
        return pay !== null && pay >= MANSHU_YEN;
      case "tri":
        return pick.combo.every((b, i) => fin[i] === b);
      case "band":
        return fin[pick.p] === pick.a && fin[pick.p + 1] === pick.b;
      default:
        return true;
    }
  };
  return races.rows
    .map(([race_id, e, f, fin, tech, payout]) => ({
      race_id,
      entry: e,
      formBits: f,
      finish: String(fin).split("").map(Number),
      tech,
      payout,
    }))
    .filter(
      (r) =>
        (entry === "all" || (eBit >= 0 && (r.entry >> eBit) & 1)) &&
        (form === "any" || (fBit >= 0 && (r.formBits >> fBit) & 1)) &&
        (!first || r.finish[0] === first) &&
        (!not1 || r.finish[0] !== 1) &&
        hit(r.finish, r.tech, r.payout),
    )
    .map(({ formBits, ...r }) => ({
      ...r,
      forms: races.form_bits.filter((_, i) => (formBits >> i) & 1),
    }));
}
