/**
 * アナロジー・ファインダーのレースごとの寄与度（BOA-271 FR-1b、ADR 案（#1134「レースごとの寄与度」））: DB の行からモデルの入力を作る純粋関数。
 *
 * - 出走表時点の36列は学習側の日次ジョブが `analogy_race_features.features`（real[]）に書いたものを読むだけ
 * - 直前情報8列（LIVE_FEATURES）は、展示タイムと気象から scripts/ml/analogy/features.py と同じ式で作る
 *
 * float32 の約束（ADR 案（#1134「レースごとの寄与度」） 決定5）: 学習は float32 の値で木を作るので、分岐の閾値が名目値の
 * すぐ近くにある。Python（pandas）と1ビットでも違うと分岐が変わるため、次をそろえる。
 * - DB から読んだ値はすべて Math.fround する
 * - レース内の差は、float32 の Kahan 和で求めた平均（pandas の groupby().transform("mean") の float32）を引く
 * - 順位は float32 の値で付け、同値は min（pandas の rank(method="min")）
 * Python との一致は scripts/ml/analogy/treeshap-parity.js で検査している。
 */

/** 直前情報8列（展示ありのモデル `win` にだけある列） */
export const LIVE_FEATURES = [
  "exh_time",
  "exh_time_diff",
  "exh_time_rank",
  "weather_code",
  "wind_x",
  "wind_y",
  "wind_speed",
  "wave_height",
];

// features.py の WEATHER_CODE・DIR16 と同じ
const WEATHER_CODE = { 晴: 0, 曇り: 1, 雨: 2, 雪: 3, 霧: 4, 台風: 5 };
const DIR16 = [
  "北",
  "北北東",
  "北東",
  "東北東",
  "東",
  "東南東",
  "南東",
  "南南東",
  "南",
  "南南西",
  "南西",
  "西南西",
  "西",
  "西北西",
  "北西",
  "北北西",
];
const DIR_ANGLE = Object.fromEntries(DIR16.map((d, i) => [d, i * 22.5]));
// numpy の deg2rad と同じ（x * (π/180)）
const DEG2RAD = Math.PI / 180;

const lookup = (table, key) =>
  typeof key === "string" && Object.hasOwn(table, key) ? table[key] : undefined;

/** 空文字は欠損（学習は CSV を経由するので、空文字は pandas で NaN になる） */
const blankToNull = (v) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "")
    ? null
    : v;

/** DB の値（number・数値の文字列・null）→ float32 の値。欠損と数値でないものは NaN */
export function toFloat32(v) {
  const b = blankToNull(v);
  if (b === null) return NaN;
  const n = typeof b === "number" ? b : Number(b);
  return Math.fround(n);
}

/** pandas の float32 の groupby mean と同じ値（NaN を除いた Kahan 和を float32 で計算し、件数で割る） */
export function meanFloat32(values) {
  let sum = 0;
  let comp = 0;
  let n = 0;
  for (const v of values) {
    if (Number.isNaN(v)) continue;
    n += 1;
    const y = Math.fround(v - comp);
    const t = Math.fround(sum + y);
    comp = Math.fround(Math.fround(t - sum) - y);
    sum = t;
  }
  return n === 0 ? NaN : Math.fround(sum / n);
}

/** 小さいほど上の順位（同値は min、NaN は NaN）。pandas の rank(ascending=True, method="min") */
export function rankMinAscending(values) {
  return values.map((v) =>
    Number.isNaN(v)
      ? NaN
      : 1 + values.reduce((c, u) => c + (!Number.isNaN(u) && u < v ? 1 : 0), 0),
  );
}

/**
 * 風の成分。features.py の encode_race_level と同じ式（風向の角度×風速。無風は0）。
 * 無風は「風向が無風」または「風向が空で風速0」。風向が空で風速>0・風速が空・未知の風向は NaN（学習側と合意、ADR 案（#1134「レースごとの寄与度」））
 */
export function windComponents(windDirection, windSpeed) {
  const dir = blankToNull(windDirection);
  const ws = toFloat32(windSpeed);
  if (dir === "無風" || (dir === null && ws === 0))
    return { wind_x: 0, wind_y: 0 };
  const ang = lookup(DIR_ANGLE, dir) ?? NaN;
  const rad = ang * DEG2RAD;
  return {
    wind_x: Math.fround(ws * Math.sin(rad)),
    wind_y: Math.fround(ws * Math.cos(rad)),
  };
}

/**
 * 直前情報8列を艇ごとに作る。
 * @param {object} p
 * @param {number[]} p.boatNumbers レースの艇番（この順で返す。並びは艇番の昇順にすること＝pandas の平均の足し順）
 * @param {{boat_number:number, exhibition_time:unknown}[]} p.exhibition exhibition_data の行（無い艇は欠損）
 * @param {{weather:unknown, wind_direction:unknown, wind_speed:unknown, wave_height:unknown}} p.conditions race_conditions の行
 * @returns {Record<string, number>[]} 艇ごとの {列名: float32 の値}
 */
export function buildLiveFeatures({ boatNumbers, exhibition, conditions }) {
  const sorted = [...boatNumbers].sort((a, b) => a - b);
  if (sorted.some((b, i) => b !== boatNumbers[i])) {
    throw new Error(
      "buildLiveFeatures: boatNumbers は艇番の昇順で渡してください",
    );
  }
  const exhByBoat = new Map(
    (exhibition ?? []).map((r) => [Number(r.boat_number), r.exhibition_time]),
  );
  const exh = boatNumbers.map((b) => toFloat32(exhByBoat.get(b)));
  const mean = meanFloat32(exh);
  const rank = rankMinAscending(exh);
  const c = conditions ?? {};
  const weather = lookup(WEATHER_CODE, blankToNull(c.weather)) ?? NaN;
  const wind = windComponents(c.wind_direction, c.wind_speed);
  const windSpeed = toFloat32(c.wind_speed);
  const wave = toFloat32(c.wave_height);
  return boatNumbers.map((_, i) => ({
    exh_time: exh[i],
    exh_time_diff: Math.fround(exh[i] - mean),
    exh_time_rank: rank[i],
    weather_code: weather,
    wind_x: wind.wind_x,
    wind_y: wind.wind_y,
    wind_speed: windSpeed,
    wave_height: wave,
  }));
}

/**
 * モデルの入力（featureNames の並びの float32 の値、欠損は NaN）を作る。
 * @param {string[]} featureNames モデルの列の並び（per_race_meta.json の feature_names＝booster.feature_name()）
 * @param {string[]} racecardNames `analogy_race_features.features` の列の並び（win_racecard の feature_names）
 * @param {(number|string|null)[]} racecardValues その艇の `features`（real[]）
 * @param {Record<string, number>|null} live buildLiveFeatures のその艇の値（出走表時点の段は null）
 */
export function modelInput(featureNames, racecardNames, racecardValues, live) {
  if (racecardValues.length !== racecardNames.length) {
    throw new Error(
      `modelInput: features の長さ ${racecardValues.length} が列の数 ${racecardNames.length} と違います`,
    );
  }
  const pos = new Map(racecardNames.map((n, i) => [n, i]));
  return Float64Array.from(featureNames, (name) => {
    if (pos.has(name)) return toFloat32(racecardValues[pos.get(name)]);
    if (live && Object.hasOwn(live, name)) return live[name];
    throw new Error(
      `modelInput: 列 ${name} の値がありません（出走表時点の列にも直前情報にも無い）`,
    );
  });
}
