/**
 * アナロジー・ファインダー v16「差がつく材料」（タブ1、BOA-271 spec FR-A）の純粋関数。
 *
 * 入力は /api/analogy/facts の応答（today・facts・exhibition。形は scripts/ml/analogy/v16_facts.py・
 * v16_morning.py の today_payload）。文は作らず、画面が i18n のキーで組み立てる値を返す。
 * 定義は Python の v16_defs.py と同じ（6艇中の順位: 1位・6位は同じ値を含む、2〜5位は min 順位）。
 * 固定データでの一致は scripts/maintenance/verify-analogy-facts.js が検査する。
 */
import { wilsonInterval } from "./wilson.js";
import { waveBand, windBand } from "./analogyScenario.js";

/** 着順（画面の 1・2・3）→ facts のキー */
export const TARGET_KEY = { 1: "win", 2: "top2", 3: "top3" };

/**
 * 項目（承認版モックの並び。六角形の軸の順）。hib＝大きいほど良い。
 * good・bad は「6艇で一番{good}とき」の言い方（i18n の analogy.facts.words.*）
 */
export const FACT_ITEMS = [
  { key: "nat_win", hib: true, good: "high", bad: "low" },
  { key: "loc_win", hib: true, good: "high", bad: "low" },
  { key: "recent_win30", hib: true, good: "high", bad: "low" },
  { key: "motor_2", hib: true, good: "high", bad: "low" },
  { key: "boat_2", hib: true, good: "high", bad: "low" },
  { key: "st_mean30", hib: false, good: "early", bad: "late" },
  { key: "exh_time", hib: false, good: "fast", bad: "slow" },
  { key: "series_score", hib: true, good: "high", bad: "low" },
];

/** 判定（spec A-7）: 差がこれ以上なら「差が大きい」 */
export const LARGE_GAP = 0.05;
/** 既定の範囲が全国になる VC の件数（spec「数えるレース」） */
export const MIN_VC_RACES = 300;
export const ROUNDS_FINAL = ["yusho", "junyu"];

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * 6艇の値 → 艇ごとの順位の集合（Python の v16_defs.rank_positions と同じ）。
 * 1位は最良と同じ値の艇すべて、6位は最悪と同じ値の艇すべて、2〜5位は min 順位。欠損の艇は空
 * @param {(number|null)[]} values
 * @param {boolean} hib
 * @returns {number[][]}
 */
export function rankPositions(values, hib) {
  const s = values.map((v) => (isNum(v) ? (hib ? v : -v) : null));
  const ok = s.filter((v) => v !== null);
  if (ok.length === 0) return values.map(() => []);
  const best = Math.max(...ok);
  const worst = Math.min(...ok);
  const close = (a, b) => Math.abs(a - b) <= 1e-8 + 1e-5 * Math.abs(b);
  return s.map((v) => {
    if (v === null) return [];
    const out = new Set();
    if (close(v, best)) out.add(1);
    if (close(v, worst)) out.add(6);
    const rk = 1 + s.filter((o) => o !== null && o > v).length;
    if (rk >= 2 && rk <= 5) out.add(rk);
    return [...out].sort((a, b) => a - b);
  });
}

/**
 * 今日のその艇の位置（カードの枠・六角形の実線）。最良と同じなら1、最悪と同じなら6、ほかは min 順位。
 * same は同じ値の艇の数
 * @returns {{bucket:number, same:number, value:number, min:number, max:number}|null}
 */
export function todayPosition(values, hib, boat) {
  const v = values[boat - 1];
  if (!isNum(v)) return null;
  const ok = values.filter(isNum);
  const pos = rankPositions(values, hib)[boat - 1];
  const bucket = pos.includes(1) ? 1 : pos.includes(6) ? 6 : pos[0];
  return {
    bucket,
    same: ok.filter((x) => x === v).length,
    value: v,
    min: Math.min(...ok),
    max: Math.max(...ok),
  };
}

/** [当たり, 母数] → 割合（母数0は null） */
export const rateOf = (pair) => (pair && pair[1] ? pair[0] / pair[1] : null);

/**
 * 判定の3段階（spec A-7）
 * @returns {{level:"large"|"small"|"unclear"|"none", diff:number, reversed:boolean}}
 */
export function judgeGap(best, worst) {
  if (!best || !worst || !best[1] || !worst[1])
    return { level: "none", diff: 0, reversed: false };
  const [bl, bh] = wilsonInterval(best[0], best[1]);
  const [wl, wh] = wilsonInterval(worst[0], worst[1]);
  const diff = best[0] / best[1] - worst[0] / worst[1];
  if (bl <= wh && wl <= bh) return { level: "unclear", diff, reversed: false };
  return {
    level: Math.abs(diff) >= LARGE_GAP ? "large" : "small",
    diff,
    reversed: diff < 0,
  };
}

/**
 * 今日の値（項目ごとの6艇の値）。展示タイムは展示後の段（exhibition）から
 * @param {object} today facts の today
 * @param {object|null} exhibition facts の exhibition（展示後だけ）
 */
export function todayValues(today, exhibition) {
  const out = {};
  for (const { key } of FACT_ITEMS) {
    if (key === "exh_time") {
      if (exhibition?.exh_time) out[key] = exhibition.exh_time;
    } else if (today?.items?.[key]) out[key] = today.items[key].values;
  }
  return out;
}

/**
 * カードの行（並び済み）。範囲の facts に無い項目（優勝戦の NCR の今節の平均着順点など）は出さない
 * @param {object} scopeFacts facts[範囲キー]
 * @param {number} boat 選んだ艇
 * @param {1|2|3} target
 * @param {boolean} exhibitionStage 展示後か（展示前は展示タイムを出さない）
 */
export function factRows(scopeFacts, boat, target, exhibitionStage) {
  const t = TARGET_KEY[target];
  const by = scopeFacts?.by?.[String(boat)] ?? {};
  return FACT_ITEMS.filter(
    (it) => (exhibitionStage || it.key !== "exh_time") && by[it.key],
  )
    .map((it) => {
      const all = [1, 2, 3, 4, 5, 6].map(
        (r) => by[it.key]?.[String(r)]?.[t] ?? null,
      );
      const rates = all.map(rateOf);
      return {
        ...it,
        all,
        rates,
        judge: judgeGap(all[0], all[5]),
        spread:
          rates[0] !== null && rates[5] !== null ? rates[0] - rates[5] : 0,
      };
    })
    .sort(
      (a, b) =>
        clearRank(a) - clearRank(b) || Math.abs(b.spread) - Math.abs(a.spread),
    );
}

const clearRank = (r) =>
  r.judge.level === "large" || r.judge.level === "small" ? 0 : 1;

/** 範囲全体のその艇の率（大きい数字・棒の点線） */
export function usualOf(scopeFacts, boat, target) {
  return scopeFacts?.usual?.[String(boat)]?.[TARGET_KEY[target]] ?? null;
}

/**
 * 今日の一文の値（spec A-7）。今日の値が無い項目、件数0は null
 * @returns {{bucket, same, value, min, max, hit:[number,number], rate:number, lo:number, hi:number}|null}
 */
export function todayLine(row, values, boat, scopeFacts, target) {
  if (!values) return null;
  const pos = todayPosition(values, row.hib, boat);
  if (!pos) return null;
  const hit =
    scopeFacts?.by?.[String(boat)]?.[row.key]?.[String(pos.bucket)]?.[
      TARGET_KEY[target]
    ];
  if (!hit || !hit[1]) return null;
  const [lo, hi] = wilsonInterval(hit[0], hit[1]);
  return { ...pos, hit, rate: hit[0] / hit[1], lo, hi };
}

/** 六角形の点線（その範囲で、その艇が来たときの平均の順位）。値が無い軸は null */
export function typicalRanks(scopeFacts, boat, target, items) {
  const typ = scopeFacts?.typ?.[String(boat)] ?? {};
  return items.map((it) => typ[it.key]?.[TARGET_KEY[target]] ?? null);
}

/** 今節の平均着順点のカードの注記（spec A-4 Q-D・Q7、R1〜R4）: "final"（優勝戦・準優勝戦の日）・"early"・null */
export function seriesScoreNote(today) {
  if (ROUNDS_FINAL.includes(today?.round)) return "final";
  const runs = today?.series_runs_before_today;
  if (
    Array.isArray(runs) &&
    runs.length === 6 &&
    Math.min(...runs) < 3 &&
    Math.max(...runs) >= 1
  )
    return "early";
  return null;
}

/** 今日が優勝戦・準優勝戦の日は、今節の平均着順点の今日の一文を出さない（Q7） */
export const hidesSeriesScoreLine = (today) =>
  ROUNDS_FINAL.includes(today?.round);

/** 6艇とも同じ級別なら、その級別（級別の1行。spec「数えるレース」） */
export function uniformClass(today) {
  const c = today?.classes;
  return Array.isArray(c) && c.length === 6 && c.every((x) => x === c[0])
    ? c[0]
    : null;
}

/**
 * 範囲キーの種類（VC・NC・NCR・VA・VG・NA）
 * @param {string} key
 */
export const scopeKind = (key) => String(key).split(":")[0];

/**
 * 範囲の既定（spec「数えるレース」）: VC。VC が300件未満なら NC（fallback を返す）。級別が欠けて VC が無ければ VA
 * @param {Record<string,string>} keys その艇の範囲キー {VC, NC, NCR, VA, ...}
 * @param {(key:string)=>number|null} countOf 範囲の件数
 * @returns {{key:string, fellBack:boolean, vcCount:number|null}}
 */
export function defaultScope(keys, countOf) {
  if (!keys?.VC)
    return { key: keys?.NC ?? keys?.VA, fellBack: false, vcCount: null };
  const n = countOf(keys.VC);
  // VC の集計が応答に無い（朝のバッチで作れなかった）ときも全国で数える
  if (n === null && keys.NC)
    return { key: keys.NC, fellBack: false, vcCount: null };
  if (n !== null && n < MIN_VC_RACES && keys.NC)
    return { key: keys.NC, fellBack: true, vcCount: n };
  return { key: keys.VC, fellBack: false, vcCount: n };
}

/**
 * 範囲キーを、画面の名前の部品にする（文は analogyFormat.js の scopeName が i18n で組み立てる）
 * @returns {{kind:string, venue:number|null, combo:number[]|null, boat:number|null, cls:string|null, round:string|null}}
 */
export function parseScopeKey(key) {
  const p = String(key).split(":");
  const kind = p[0];
  const sel = (s) => ({ boat: Number(s[0]), cls: s.slice(1) });
  const combo = (s) => s.split("-").map(Number);
  if (kind === "VC")
    return {
      kind,
      venue: Number(p[1]),
      combo: combo(p[2]),
      ...sel(p[3]),
      round: null,
    };
  if (kind === "NC")
    return { kind, venue: null, combo: combo(p[1]), ...sel(p[2]), round: null };
  if (kind === "NCR")
    return { kind, venue: null, combo: combo(p[1]), ...sel(p[2]), round: p[3] };
  return {
    kind,
    venue: p[1] ? Number(p[1]) : null,
    combo: null,
    boat: null,
    cls: null,
    round: null,
  };
}

/** 波でも分けたときに、今日の区分がこの件数未満なら風だけに戻す（Q-F3） */
export const MIN_WIND_WAVE = 300;

/**
 * 今日の風・波の欄の数え方（spec A-9、2026-10-05 ユーザー決定 Q-F3）
 * - "wave": 波高が風速と別の情報を持つ会場（facts の VA の wave_mode.use_wave）で、今日の風×波の区分が300件以上
 * - "waveFew": 同じ会場だが、今日の風×波の区分が300件未満なので風だけで数える（waveN にその件数）
 * - "wind": 風だけで数える。sameAsWind は、集計が「この会場の波高は風速とほぼ同じ値」と判定したとき（wave_mode が
 *   あって use_wave=false）だけ true（注記を出す）。波でも分ける会場で今日の波高が無いとき、Q-F3 より前の集計
 *   （wave_mode が無い）のときは false
 * @param {object|null} vaFacts facts の VA の集計（wind・wind_wave・wave_mode）
 * @param {object|null} exhibition 今日の展示（wind_speed・wave_height）
 * @returns {{mode: "wave"|"waveFew"|"wind", rows: object, n: number, waveN?: number, sameAsWind?: boolean, wind: string, wave: string|null}|null}
 */
export function windWaveView(vaFacts, exhibition) {
  const wind = exhibition?.wind_band ?? windBand(exhibition?.wind_speed);
  const rows = wind ? vaFacts?.wind?.[wind] : null;
  if (!rows) return null;
  const wave = waveBand(exhibition?.wave_height);
  const n = rows["1"]?.win?.[1] ?? 0;
  const mode = vaFacts.wave_mode;
  if (!mode?.use_wave || !wave || !vaFacts.wind_wave)
    return {
      mode: "wind",
      rows,
      n,
      sameAsWind: Boolean(mode) && !mode.use_wave,
      wind,
      wave,
    };
  const cell = vaFacts.wind_wave[wind]?.[wave];
  const waveN = cell?.["1"]?.win?.[1] ?? 0;
  if (waveN >= MIN_WIND_WAVE)
    return { mode: "wave", rows: cell, n: waveN, wind, wave };
  return { mode: "waveFew", rows, n, waveN, wind, wave };
}
