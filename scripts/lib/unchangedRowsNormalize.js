/**
 * numeric(p,s) 列の scale（2026-09-19時点の本番スキーマ information_schema.columns の実測値）。
 * 列が numeric 型でも、ここに無い列は文字列・数値を区別する厳密比較になる（＝変更ありに倒れる）。
 */
export const NUMERIC_SCALES = {
  races: {
    first_boat_avg_st: 3,
    first_boat_motor_2rate: 2,
    first_boat_win_rate: 3,
    motor_2rate_stddev: 2,
    win_rate_avg: 3,
    win_rate_stddev: 3,
  },
  race_entries: {
    weight_kg: 1,
    boat_2rate: 2,
    boat_3rate: 2,
    global_2rate: 2,
    global_3rate: 2,
    local_2rate: 2,
    local_3rate: 2,
    local_win_rate: 3,
    motor_2rate: 2,
    motor_3rate: 2,
    win_rate: 3,
  },
  // 選手別の日次集計（aggregate-racer-stats.js、BOA-600。2026-10-01 本番スキーマの実測値）
  racer_aggregated_stats: {
    avg_st: 3,
    avg_st_last_30: 3,
    st_stddev: 3,
    flying_rate: 4,
  },
  race_conditions: {
    temperature: 1,
    water_temperature: 1,
    wind_speed: 1,
  },
  exhibition_data: {
    adjustment_weight: 1,
    exhibition_time: 2,
    prev_start_timing: 2,
    start_timing: 2,
    tilt: 1,
    today_weight: 1,
  },
  race_start_timings: {
    start_timing: 3,
    race_seconds: 1,
  },
  // 前検タイム（docs/db-migration/090_motor_pretest_stats.sql）
  motor_pretest_stats: {
    motor_2rate: 1,
    boat_2rate: 1,
    pretest_time: 2,
  },
  // K/Bファイル長期バックフィルのアーカイブ表（docs/db-migration/074_kb_archive_tables.sql）
  kb_archive_boats: {
    boat_2rate: 2,
    exhibition_time: 2,
    local_2rate: 2,
    local_win_rate: 2,
    motor_2rate: 2,
    national_2rate: 2,
    national_win_rate: 2,
    race_seconds: 1,
    start_timing: 2,
  },
  // BOATCASTのオリジナル展示（docs/db-migration/091_boatcast_original_exhibition.sql）
  race_original_exhibition_values: {
    value: 2,
  },
  // コース×級別のベースライン（docs/db-migration/094_course_baselines.sql、phase a FR-1）。
  // ここに登録しないと NUMERIC_SCALES[table] ?? {} で空になり、NUMERIC列が
  // 文字列と数値で比較されて毎日全行が「変更あり」と判定される（plan.md §5.1）
  st_course_baseline: {
    avg_st: 3,
    stable_rate: 2,
    late_rate: 2,
    breakout_rate: 2,
  },
  // 逃げシミュレーション（同上、phase a FR-6）
  nige_second_by_course: {
    second_rate: 2,
    exacta_rate: 2,
  },
  // 「本日のデータ一覧」の事前集計（docs/db-migration/098_morning_data_digest.sql、BOA-402）
  venue_course_technique_baseline: {
    nige_rate: 2,
    makuri_rate: 2,
    nigashi_rate: 2,
  },
  racer_course_technique_stats: {
    nige_rate: 2,
    nige_expected: 2,
    makuri_rate: 2,
    makuri_expected: 2,
    nigashi_rate: 2,
    nigashi_expected: 2,
    nige_rate_90d: 2,
    makuri_rate_90d: 2,
    nigashi_rate_90d: 2,
  },
  // morning_digest_rows は日付ごとに delete→insert する設計のため upsertChangedRows を
  // 使わないが、将来差分更新に変えたときに登録漏れで毎日全行更新になるのを防ぐため先に入れておく
  morning_digest_rows: {
    metric_value: 2,
    metric_expected: 2,
    metric_skill_delta: 2,
    metric_venue_baseline: 2,
    metric_predicted: 2,
    metric_wilson_lower: 2,
    rate_90d: 2,
    motor_2rate: 2,
    volatility_percentile: 2,
  },
  // 買い目オッズ（BOA-404、docs/db-migration/011_prediction_odds.sql）。DECIMAL(8,1)
  prediction_odds: {
    trifecta_odds_standard: 1,
    trio_odds_standard: 1,
    trifecta_odds_safe_bet: 1,
    trio_odds_safe_bet: 1,
    trifecta_odds_upset_focus: 1,
    trio_odds_upset_focus: 1,
  },
  // 得点率の日ごとの写し（BOA-1210、docs/db-migration/192_racer_series_points_daily.sql）。NUMERIC(4,2)
  racer_series_points_daily: {
    score_rate: 2,
  },
};

/**
 * timestamptz 列（比較時に時刻として正規化する列）。DBは「2026-09-19T01:34:00+00:00」形式で返し、
 * 書き込み側は「2026-09-19T01:34:00.000Z」等の形式で持つため、文字列のまま比較すると
 * 同じ時刻でも永久に「変更あり」になる。ここに無い timestamptz 列は厳密比較（＝変更ありに倒れる）。
 */
export const TIMESTAMP_COLUMNS = {
  race_conditions: ["weather_observed_at"],
};

/**
 * timestamptz の比較用正規化。同じ瞬間なら表記（タイムゾーン・桁数）に依らず同じ値になる。
 * 時刻として解釈できない値は、文字列のまま返して厳密比較に任せる（＝変更ありに倒れる）。
 *
 * @param {unknown} value
 */
export function normalizeTimestamp(value) {
  if (value === undefined || value === null) return null;
  const ms = Date.parse(
    value instanceof Date ? value.toISOString() : String(value),
  );
  return Number.isFinite(ms) ? ms : value;
}

/**
 * PostgreSQL の numeric 丸め（0から遠い側への四捨五入）を再現する。
 * PostgREST へ送られる JSON 数値は String(x) と同じ10進表現のため、その文字列に
 * 指数を足して桁シフトすることで、2進浮動小数の誤差（1.005 → 1.00 になる等）を避ける。
 */
export function roundToScale(value, scale) {
  const abs = Math.abs(value);
  const text = String(abs);
  // 指数表記（1e-7, 1e21等）は文字列シフトができないため toFixed に委ねる
  // （本スキーマの値域では現れない。万一現れても判定が変更ありに倒れるだけ）
  if (/e/i.test(text)) return Number(value.toFixed(scale));
  const shifted = Math.round(Number(`${text}e${scale}`));
  const rounded = Number(`${shifted}e-${scale}`);
  return value < 0 && rounded !== 0 ? -rounded : rounded;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((k) => value[k] !== undefined)
        .map((k) => [k, canonicalize(value[k])]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

/**
 * 比較用の正規化。undefined/null/NaN/Infinity は null に揃える（JSON化すると null になるため、
 * DBへ書かれる値と一致させる）。numeric 列（scale 指定あり）は数値化して丸める。
 * jsonb/配列は、キー順に依存しない正準形（JSON文字列）にする。
 *
 * @param {unknown} value
 * @param {number|undefined} scale numeric列のscale。undefinedなら数値の丸めをしない
 */
export function normalizeValue(value, scale) {
  if (value === undefined || value === null) return null;
  if (scale !== undefined) {
    if (typeof value === "string") {
      if (value.trim() === "") return value; // 数値化できない文字列は厳密比較に任せる
      const n = Number(value);
      return Number.isFinite(n) ? roundToScale(n, scale) : value;
    }
    if (typeof value === "number") {
      return Number.isFinite(value) ? roundToScale(value, scale) : null;
    }
    return value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object") return JSON.stringify(canonicalize(value));
  return value;
}
