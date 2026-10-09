/**
 * アナロジー・ファインダー v16 の展開シナリオの定義（BOA-271。plan「定義」）。純粋関数。
 *
 * Python の scripts/ml/analogy/v16_defs.py・v16_facts.py と同じ定義（BOA-635 と共用）。一致は
 * scripts/ml/analogy/testdata/v16-defs-cases.json（Python で作った固定データ）で verify-analogy-facts.js が検査する。
 * - スリットの7形: round(ST×100) の整数で比べる（.5 は上へ。JS の Math.round と同じ）。F の ST は負
 * - 進入の型: 1号艇が1コース以外は inlost（前付けより優先）。前付け＝艇番より内のコースに入った艇
 * - 手がかりの8条件: 平均ST を 1/1000秒に丸めて比べる
 */

export const SLIT_FORMS = ["flat", "wall", "d2", "d3", "kado", "d1", "dash"];
export const HINTS = [
  "kado4",
  "kado4_02",
  "in_slow02",
  "in_fastest",
  "d2_slow01",
  "d3_slow01",
  "dash03",
  "flat03",
];
// spec A-9 の風速区分（類似レースの風速の区分とは別）
export const WIND_BANDS = [
  ["0-1", 0, 1],
  ["2-3", 2, 3],
  ["4-5", 4, 5],
  ["6+", 6, Infinity],
];

const isMissing = (v) => v === null || v === undefined || Number.isNaN(v);

/** 6桁で丸めてから .5 を上へ（Python の v16_defs._round_half_up と同じ） */
const roundHalfUp = (x) => Math.floor(Math.round(x * 1e6) / 1e6 + 0.5);

/** ST（秒）→ 1/100秒の整数 */
export const stCent = (st) => roundHalfUp(st * 100);

/** F の ST は負（出どころを問わず −abs） */
export const signedSt = (st, isFlying) => (isFlying ? -Math.abs(st) : st);

/** 展示の F がこれ以下（1/100秒。F.05 まで）なら .00 として形を判定する（Python の v16_defs.FLY_SHALLOW_MAX。Q-F6） */
export const FLY_SHALLOW_MAX = 5;

/**
 * 今日の展示の形（2026-10-06 ユーザー決定 Q-F6）。F.01〜.05 は .00 として判定し、F.06 以上か出遅れの艇がいれば
 * 判定しない（excluded）。Python の v16_defs.exh_form_st と同じ
 * @param {(number|null)[]} stByCourse コース順の展示 ST（F は負）
 * @param {boolean} [hasLate] 展示で出遅れの艇がいる
 * @returns {{forms: string[], excluded: boolean}}
 */
export function exhibitionForms(stByCourse, hasLate = false) {
  const deep =
    hasLate ||
    stByCourse.some((v) => !isMissing(v) && stCent(v) < -FLY_SHALLOW_MAX);
  if (deep) return { forms: [], excluded: true };
  const f = slitForms(
    stByCourse.map((v) => (!isMissing(v) && stCent(v) < 0 ? 0 : v)),
  );
  return { forms: SLIT_FORMS.filter((k) => f[k]), excluded: false };
}

/**
 * コース順の ST（F は負）→ 7形の当否。1艇でも欠ければすべて false。形は重なりうる
 * @param {(number|null)[]} stByCourse
 * @returns {Record<string, boolean>}
 */
export function slitForms(stByCourse) {
  if (stByCourse.length !== 6 || stByCourse.some(isMissing))
    return Object.fromEntries(SLIT_FORMS.map((f) => [f, false]));
  const c = stByCourse.map(stCent);
  const max = (a) => Math.max(...a);
  const min = (a) => Math.min(...a);
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  const inner = c.slice(0, 3);
  return {
    flat: max(c) - min(c) <= 6,
    wall: max(inner) - min(inner) <= 2,
    // 凹み: 両隣より0.05秒以上遅い（2026-10-06 ユーザー決定、BOA-777。Python の v16_defs と同じ）
    d2: c[1] - Math.max(c[0], c[2]) >= 5,
    d3: c[2] - Math.max(c[1], c[3]) >= 5,
    kado: min(inner) - c[3] >= 3,
    d1: c[0] - c[1] >= 5,
    dash: sum(inner) - sum(c.slice(3)) >= 15,
  };
}

/** 前付けした艇（艇番より内のコースに入った艇。艇番の昇順） */
export function maedukeBoats(courseByBoat) {
  return courseByBoat.flatMap((c, i) =>
    !isMissing(c) && c < i + 1 ? [i + 1] : [],
  );
}

/**
 * 進入の型（"all" を除く7つ）。進入が1艇でも分からなければ null
 * @param {(number|null)[]} courseByBoat 艇番順のコース
 */
export function entryType(courseByBoat) {
  if (courseByBoat.length !== 6 || courseByBoat.some(isMissing)) return null;
  if (courseByBoat[0] !== 1) return "inlost";
  if (courseByBoat.every((c, i) => c === i + 1)) return "waku";
  const m = maedukeBoats(courseByBoat).join(",");
  return { 6: "mae6", 5: "mae5", "5,6": "mae56" }[m] ?? "maeOther";
}

// 波高の区分（cm。Python の v16_facts.WAVE_BANDS。Q-F3）
export const WAVE_BANDS = [
  ["0-2", 0, 2],
  ["3-5", 3, 5],
  ["6+", 6, Infinity],
];

/** 波高（cm）→ 区分。無ければ null */
export function waveBand(waveHeight) {
  if (isMissing(waveHeight)) return null;
  const hit = WAVE_BANDS.find(
    ([, lo, hi]) => waveHeight >= lo && waveHeight <= hi,
  );
  return hit ? hit[0] : null;
}

/** 風速（m）→ spec A-9 の区分。無ければ null */
export function windBand(windSpeed) {
  if (isMissing(windSpeed)) return null;
  const hit = WIND_BANDS.find(
    ([, lo, hi]) => windSpeed >= lo && windSpeed <= hi,
  );
  return hit ? hit[0] : null;
}

/**
 * コース順の平均ST（秒）→ 手がかりの8条件。1艇でも欠ければすべて false
 * @param {(number|null)[]} avgStByCourse
 */
export function hintConditions(avgStByCourse) {
  if (avgStByCourse.length !== 6 || avgStByCourse.some(isMissing))
    return Object.fromEntries(HINTS.map((h) => [h, false]));
  const c = avgStByCourse.map((v) => roundHalfUp(v * 1000));
  const inner = c.slice(0, 3);
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  return {
    kado4: c[3] < Math.min(...inner),
    kado4_02: Math.min(...inner) - c[3] >= 20,
    in_slow02: c[0] - c[1] >= 20,
    in_fastest: c[0] < Math.min(...c.slice(1)),
    d2_slow01: c[1] - Math.max(c[0], c[2]) >= 10,
    d3_slow01: c[2] - Math.max(c[1], c[3]) >= 10,
    dash03: sum(inner) - sum(c.slice(3)) >= 30,
    flat03: Math.max(...c) - Math.min(...c) <= 30,
  };
}

// ---------------------------------------------------------------- 画面（タブ3）の判定

/** 手がかりの条件ごとに見る形（Python の v16_scenario.HINT_FORM） */
export const HINT_FORM = {
  kado4: "kado",
  kado4_02: "kado",
  in_slow02: "d1",
  in_fastest: "d1",
  d2_slow01: "d2",
  d3_slow01: "d3",
  dash03: "dash",
  flat03: "flat",
};
/** ①の型の並び（mae の下に4つ） */
export const ENTRY_TYPES = ["all", "waku", "mae", "inlost"];
export const MAE_SUB = ["mae6", "mae5", "mae56", "maeOther"];
/** 攻める艇（Python の v16_defs.ATTACK_BOAT） */
export const ATTACK_BOAT = { kado: 4, d3: 4, dash: 4, d2: 3, d1: 2 };
/** タブ3で割合を出さない件数（spec C-1・C-5）、③で薄くする件数（spec C-4） */
export const MIN_SCENARIO = 30;
export const SMALL_ATTACK = 50;

/**
 * ④の艇ごとの [件数, 1着, 2着, 3着]（BOA-806）。2〜6号艇は「構成＋その艇の級」の範囲（API の boats）の値、
 * 無ければ（VA・VG・NA、または BOA-806 より前の版）1号艇の範囲の cells の値。朝のバッチは艇ごとのファイルに
 * 進入の型×形の全セルを書くので、ファイルはあるのにセルだけ無いことは起きない前提
 * @param {object} cells scenario.cells
 * @param {object|null|undefined} boats API の boats（{"2": {data: {cells}}|null, ...}）
 * @returns {number[][]} 6艇分
 */
export function boatCells(cells, boats, entry, form) {
  const c = cells[entry].forms[form];
  return [1, 2, 3, 4, 5, 6].map(
    (b) =>
      (b > 1 && boats?.[b]?.data?.cells?.[entry]?.[form]) || [
        c.n,
        c.first_boat[b - 1],
        c.second_boat[b - 1],
        c.third_boat[b - 1],
      ],
  );
}

/** 艇ごとの件数が1艇でも違うか（違うときだけ、艇ごとの件数と「6艇を足しても100%にならない」を出す） */
export const boatCountsDiffer = (rows) => rows.some((r) => r[0] !== rows[0][0]);

/**
 * 今日の当てはまる手がかりの行（spec C-2）。率は②の数えるレース（scenario.hints）で数える。
 * kind: "up"（札を付ける。当てはまった30件以上・率が高い・ぶれ幅が重ならない）／"down"（むしろなりにくい）／
 * "unclear"（札なしで率だけ）
 * @param {object} scenarioHints scenario.hints（{course|overall: {条件: {形: {hit:[x,n], miss:[x,n]}}}}）
 * @param {Record<string, boolean>} todayHits today.hints.course か overall
 * @param {"course"|"overall"} version
 * @param {(x:number, n:number) => [number, number]|null} interval Wilson 区間
 */
export function hintRows(scenarioHints, todayHits, version, interval) {
  return HINTS.filter((h) => todayHits?.[h]).map((id) => {
    const form = HINT_FORM[id];
    const c = scenarioHints?.[version]?.[id]?.[form];
    const hit = c?.hit ?? [0, 0];
    const miss = c?.miss ?? [0, 0];
    const ph = hit[1] ? hit[0] / hit[1] : null;
    const pm = miss[1] ? miss[0] / miss[1] : null;
    let kind = "unclear";
    if (ph !== null && pm !== null && hit[1] >= MIN_SCENARIO) {
      const [hl, hh] = interval(hit[0], hit[1]);
      const [ml, mh] = interval(miss[0], miss[1]);
      const apart = hl > mh || ml > hh;
      if (apart) kind = ph > pm ? "up" : "down";
    }
    return { id, form, hit, miss, ph, pm, kind };
  });
}

/** ②の札: 形ごとに1つ（当てはまったときの率が一番高い "up" の条件。screens「細部の約束」） */
export function hintBadgeByForm(rows) {
  const out = {};
  for (const r of rows) {
    if (r.kind !== "up") continue;
    if (!out[r.form] || r.ph > out[r.form].ph) out[r.form] = r;
  }
  return out;
}

/** 6艇の値 → min 順位（大きいほど良い hib。欠損は null） */
export function minRanks(values, hib) {
  return values.map((v) => {
    if (v === null || v === undefined || Number.isNaN(v)) return null;
    return (
      1 +
      values.filter(
        (o) =>
          o !== null &&
          o !== undefined &&
          !Number.isNaN(o) &&
          (hib ? o > v : o < v),
      ).length
    );
  });
}

/** 6艇中の順位 → ③の区分（1〜2位 top・3〜4位 mid・5〜6位 low） */
export const rankBand = (rank) =>
  rank === null || rank === undefined
    ? null
    : rank <= 2
      ? "top"
      : rank <= 4
        ? "mid"
        : "low";

/**
 * 上位と下位の差が2標準誤差を超えるか（spec C-4「この範囲では、上位と下位の差ははっきりしない」の逆）
 * @param {[number, number]} a
 * @param {[number, number]} b
 */
export function clearDiff(a, b) {
  if (!a || !b || !a[1] || !b[1]) return false;
  const p1 = a[0] / a[1];
  const p2 = b[0] / b[1];
  const se = Math.sqrt((p1 * (1 - p1)) / a[1] + (p2 * (1 - p2)) / b[1]);
  return Math.abs(p1 - p2) > 2 * se;
}

/** 形の絵の例（コース順の ST の差。承認版モックの SLIT_EX） */
export const SLIT_EXAMPLE = {
  flat: [0, 0.01, 0, 0.02, 0.01, 0.02],
  wall: [0.01, 0, 0.01, 0.05, 0.07, 0.06],
  d2: [0, 0.05, 0, 0.01, 0.02, 0.02],
  d3: [0, 0.01, 0.05, 0, 0.02, 0.03],
  kado: [0.03, 0.04, 0.03, 0, 0.02, 0.03],
  d1: [0.05, 0, 0.01, 0.01, 0.02, 0.02],
  dash: [0.05, 0.06, 0.05, 0, 0.01, 0],
};
