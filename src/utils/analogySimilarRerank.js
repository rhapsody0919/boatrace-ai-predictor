/**
 * アナロジー・ファインダー v16 の類似レースを、展示の後に並べ直す（BOA-271 tasks T4-1。plan「展示後の段」）。純粋関数。
 *
 * 朝のバッチ（scripts/ml/analogy/v16_morning.py）が、出走表の時点の距離で選んだ候補（層の中の近い順に最大
 * 30,000件。T2-4）の候補ファイルを作る。展示後の表し方（knn8）は、出走表の表し方（knn7）に「展示・天候・風・波」の
 * 列を足したもので、標準化・カテゴリ・重みは同じなので、
 *   展示後の距離² ＝ 出走表の距離²（d2_racecard、会場のペナルティ前）＋ 足した列の距離² ＋ λ_展示×（会場が違う）
 * になる。足した列は、候補の生の値（exhibition_raw。float32 の最短表記。展示タイムの差と順位は展示タイムから作る）と今日の値を
 * 同じ式で z 化・重み付けする。
 *
 * float32 の約束: Python は z 化と重み付けを float32 で行う（v16_similar.build_z・weight_vector）ので、
 * 今日の値も Math.fround でそろえる。Python との一致は scripts/ml/analogy/testdata/v16-rerank.json で検査する。
 */

import { meanFloat32, rankMinAscending } from "./analogyRaceFeatures.js";

const f32 = Math.fround;

/** 欠損（null・undefined・NaN）→ NaN */
const num = (v) =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? NaN : Number(v);

/**
 * 今日の展示後の値を、候補ファイルの列（exhibition.columns）と同じ並びの重み付きの値にする
 * @param {{columns: {feature:string, slot:number, kind:string, cat?:number}[], weights:number[],
 *   norm: Record<string, {mean:number, sd:number}>}} header 候補ファイルの exhibition
 * @param {{boats: Record<string, (number|null)[]>, race: Record<string, number|null>}} today
 *   boats は exh_time・exh_time_diff・exh_time_rank の艇番順の値、race は weather_code・wind_x・wind_y・
 *   wind_speed・wave_height（src/utils/analogyRaceFeatures.js の buildLiveFeatures と同じ値）
 * @returns {number[]}
 */
export function exhibitionVector(header, today) {
  return header.columns.map((col, j) => {
    const w = f32(header.weights[j]);
    if (col.kind === "race_cat") {
      const v = num(today.race[col.feature]);
      const code = Number.isNaN(v) ? -1 : v;
      return code === col.cat ? w : 0;
    }
    const raw =
      col.kind === "boat_num"
        ? num(today.boats[col.feature]?.[col.slot - 1])
        : num(today.race[col.feature]);
    const { mean, sd } = header.norm[col.feature];
    const z = f32(f32(f32(raw) - f32(mean)) / f32(sd));
    return Number.isNaN(z) ? 0 : f32(z * w);
  });
}

/**
 * 6艇の展示タイム（艇番順、float32、欠損は NaN）→ exh_time・exh_time_diff・exh_time_rank（features.py と同じ:
 * 差はレース内の float32 の平均との差、順位は小さいほど上の min 順位）
 */
export function exhibitionBoats(exh) {
  const mean = meanFloat32(exh);
  return {
    exh_time: exh,
    exh_time_diff: exh.map((v) => f32(v - mean)),
    exh_time_rank: rankMinAscending(exh),
  };
}

/** 候補ファイルの exhibition_raw（列ごとの配列）から、c 件目の候補の展示の値を exhibitionVector の today の形で */
export function candidateValues(raw, c) {
  const race = Object.fromEntries(
    Object.entries(raw.race).map(([k, vs]) => [k, vs[c]]),
  );
  const exh = (raw.boats.exh_time?.[c] ?? []).map((v) =>
    v === null ? NaN : f32(v),
  );
  return { race, boats: exhibitionBoats(exh) };
}

/**
 * 候補を展示後の距離で並べ直し、上位 k 件を返す。
 * exact: 候補の外のレースが上位 k 件に入りえないことが言えるか。候補が層の全件なら必ず厳密。そうでなければ、
 *   候補の外のレースの展示後の距離² ≥ 出走表の距離²（ペナルティ込み）≥ 候補の最後の出走表の距離²（ペナルティ込み）
 *   から λ の差の分を引いた値、を下限として、それが k 件目の展示後の距離²以上なら厳密
 * @param {object} file 候補ファイル（similar/{race_id}.json）
 * @param {object} today exhibitionVector の today
 * @param {number} [k]
 * @returns {{neighbors: {race_id:string, d2:number}[], exact: boolean}}
 */
export function rerankSimilar(file, today, k = 800) {
  const ex = file.exhibition;
  const raw = file.exhibition_raw;
  const q = exhibitionVector(ex, today);
  const lam = ex.lambda;
  const scored = file.candidates.map((race_id, c) => {
    const v = exhibitionVector(ex, candidateValues(raw, c));
    let d2 = file.d2_racecard[c];
    for (let j = 0; j < q.length; j++) d2 += (v[j] - q[j]) ** 2;
    if (!file.venue_match[c]) d2 += lam;
    return { race_id, d2, c };
  });
  scored.sort((a, b) => a.d2 - b.d2 || a.c - b.c);
  const neighbors = scored
    .slice(0, k)
    .map(({ race_id, d2 }) => ({ race_id, d2 }));
  const n = file.candidates.length;
  let exact = n >= file.n_layer;
  if (!exact) {
    const last = n - 1;
    const lastRacecard =
      file.d2_racecard[last] +
      (file.venue_match[last] ? 0 : file.lambda_racecard);
    const bound = lastRacecard - Math.max(0, file.lambda_racecard - lam);
    exact = bound >= neighbors[neighbors.length - 1].d2;
  }
  return { neighbors, exact };
}

// ---- 展示で決まる5項目の「同じ・近い」（v16_similar.item_levels の weather・wind_bin・wind_vector・wave_bin・
// exh_time_diff_6 と同じ基準）。2 同じ・1 近い・0 違う・−1 欠損
export const EXHIBITION_ITEMS = [
  "weather",
  "wind_bin",
  "wind_vector",
  "wave_bin",
  "exh_time_diff_6",
];

const missing = (v) => v === null || v === undefined || Number.isNaN(v);
const level = (same, near, isNull) => (isNull ? -1 : same ? 2 : near ? 1 : 0);
const band3 = (v, a, b) => (missing(v) ? -1 : v <= a ? 0 : v <= b ? 1 : 2);
const bandAdj = (x, q) =>
  level(x === q, Math.abs(x - q) === 1, x === -1 || q === -1);

/**
 * @param {{race: Record<string, number|null>, exh_time: (number|null)[]}} today
 * @param {{race: Record<string, number|null>, exh_time: (number|null)[]}} cand
 * @returns {Record<string, number>}
 */
export function exhibitionItemLevels(today, cand) {
  const wc = cand.race.weather_code;
  const qw = today.race.weather_code;
  const rain = (v) => v === 2 || v === 3;
  const dry = (v) => v === 0 || v === 1;
  const wd = Math.sqrt(
    (cand.race.wind_x - today.race.wind_x) ** 2 +
      (cand.race.wind_y - today.race.wind_y) ** 2,
  );
  const diffs = (exh) =>
    exhibitionBoats(exh.map((v) => (missing(v) ? NaN : f32(v)))).exh_time_diff;
  const dq = diffs(today.exh_time);
  const dc = diffs(cand.exh_time);
  // Python は float32 の配列のまま nanmean し、しきい値も float32 に落として比べる（6要素は順に足すのと同じ）
  let sum = 0;
  let n = 0;
  dc.forEach((v, i) => {
    const d = f32(Math.abs(f32(v - dq[i])));
    if (!Number.isNaN(d)) {
      sum = f32(sum + d);
      n += 1;
    }
  });
  const m = n ? f32(sum / n) : NaN;
  return {
    weather: level(
      wc === qw,
      (rain(wc) && rain(qw)) || (dry(wc) && dry(qw)),
      missing(wc) || missing(qw),
    ),
    wind_bin: bandAdj(
      band3(cand.race.wind_speed, 2, 4),
      band3(today.race.wind_speed, 2, 4),
    ),
    wind_vector: level(wd <= 1.5, wd <= 2.5, missing(wd)),
    wave_bin: bandAdj(
      band3(cand.race.wave_height, 2, 5),
      band3(today.race.wave_height, 2, 5),
    ),
    exh_time_diff_6: level(m <= f32(0.03), m <= f32(0.05), Number.isNaN(m)),
  };
}
