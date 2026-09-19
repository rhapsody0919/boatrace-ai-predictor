/**
 * 公式ページの「水面気象情報」の解析（BOA-358）
 *
 * beforeinfo ページ（発走前）と raceresult ページ（レース確定後）は、同じ構造の
 * 「水面気象情報」ブロック（`.weather1`）を持つ。update-race-info.js（発走60分前）・
 * scrape-exhibition-data.js（展示取得のたび）・scrape-results.js（結果確定時）が
 * 同じ解析・同じ列変換を使えるよう、ここに集約する（二重実装しない）。
 *
 * ブロックの構造（2026-09-19の実ページで確認。fixturesは scripts/lib/__fixtures__/weather/）:
 *   <p class="weather1_title">水面気象情報(全角空白)16:34現在</p>
 *       beforeinfo のタイトルは2書式ある（2026-09-19に実ページで確認）:
 *         「HH:MM現在」: 観測時刻が載る（1Rの発走前等。例: 16:34現在）
 *         「N R時点」  : Nレース目の時点の気象。2R以降のページ（確認できたのは、レース終了後に
 *                        取得したもの）には「(N-1)R時点」が載り、その値は (N-1) レースの
 *                        raceresult の気象と完全に一致する（17-02の「1R時点」＝17-01の結果ページ）。
 *                        つまり、発走前のbeforeinfoの気象は、公式が更新するまで前のレースの値
 *       raceresult のタイトルは「水面気象情報」のみ（時刻なし）。その値は、そのレース自身の時点の確定値
 *   .weather1_bodyUnit.is-direction   → ラベル「気温」+ データ「23.0℃」
 *   .weather1_bodyUnit.is-weather     → ラベル位置に天候名「曇り」（データなし）
 *   .weather1_bodyUnit.is-wind        → ラベル「風速」+ データ「0m」
 *   .weather1_bodyUnit.is-windDirection → <p class="... is-wind17">（風向アイコン。1〜16が16方位、17は無風）
 *   .weather1_bodyUnit.is-waterTemperature → ラベル「水温」+ データ「24.0℃」
 *   .weather1_bodyUnit.is-wave        → ラベル「波高」+ データ「1cm」
 * raceresultでは各テキストの前後に改行・空白が入る（trimで吸収する）。
 */

const WIND_DIRECTIONS = [
  null,
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

/** 風向アイコンの番号（1〜16）を方位名に変換する。範囲外（17=無風等）は null */
export function convertWindDirection(dir) {
  if (dir == null || dir < 1 || dir > 16) return null;
  return WIND_DIRECTIONS[dir];
}

function parseNumberWithUnit(text, unit) {
  if (!text) return null;
  const value = parseFloat(text.replace(unit, ""));
  return Number.isFinite(value) ? value : null;
}

// 全角の数字・「Ｒ」・「：」を半角にそろえる（実ページは半角だが、書式の揺れに備える）
const toHalfWidth = (text) =>
  text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/Ｒ/g, "R")
    .replace(/：/g, ":");

/**
 * 「水面気象情報」のタイトルから、観測の時点を取得する（beforeinfoのみ。raceresultは両方 null）。
 * 「HH:MM現在」なら time、「N R時点」なら race（前のレースの番号）に入る。
 * @returns {{time: string|null, race: number|null}} time の例: "10:34"
 */
export function scrapeObservedPoint($) {
  const title = toHalfWidth($(".weather1_title").first().text());
  const timeMatch = title.match(/(\d{1,2}):(\d{2})\s*現在/);
  if (timeMatch) {
    return {
      time: `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`,
      race: null,
    };
  }
  const raceMatch = title.match(/(\d{1,2})\s*R\s*時点/);
  if (raceMatch) return { time: null, race: parseInt(raceMatch[1], 10) };
  return { time: null, race: null };
}

/**
 * 水面気象情報ブロックを解析する（beforeinfo・raceresult 共通）。
 * ブロックが無い・項目が欠けている場合は、その項目を null にする。
 *
 * @param {CheerioAPI} $
 * @returns {{weather: string|null, airTemp: number|null, windDirection: number|null,
 *   windVelocity: number|null, waterTemp: number|null, waveHeight: number|null,
 *   observedTime: string|null, observedRace: number|null}}
 *   windDirection は風向アイコンの番号（convertWindDirection で方位名に変換する）
 */
export function scrapeConditions($) {
  const block = $(".weather1").first();

  // 項目名（気温・風速・水温・波高）をキーに、データ（「23.0℃」等）を取り出す。
  // 位置（何番目か）に依存しない
  const dataByLabel = {};
  block.find(".weather1_bodyUnitLabel").each((_, el) => {
    const label = $(el).find(".weather1_bodyUnitLabelTitle").text().trim();
    const data = $(el).find(".weather1_bodyUnitLabelData").text().trim();
    if (label && data) dataByLabel[label] = data;
  });

  // 天候名は、is-weather ユニットのラベル位置に入っている（データ側は無い）
  const weather =
    block
      .find(".weather1_bodyUnit.is-weather .weather1_bodyUnitLabelTitle")
      .first()
      .text()
      .trim() || null;

  let windDirection = null;
  const windClass = (
    block.find(".weather1_bodyUnit.is-windDirection p").first().attr("class") ||
    ""
  )
    .split(/\s+/)
    .find((c) => /^is-wind\d+$/.test(c));
  if (windClass) windDirection = parseInt(windClass.replace("is-wind", ""), 10);

  const observed = scrapeObservedPoint($);
  return {
    weather,
    airTemp: parseNumberWithUnit(dataByLabel["気温"], "℃"),
    windDirection,
    windVelocity: parseNumberWithUnit(dataByLabel["風速"], "m"),
    waterTemp: parseNumberWithUnit(dataByLabel["水温"], "℃"),
    waveHeight: parseNumberWithUnit(dataByLabel["波高"], "cm"),
    observedTime: observed.time,
    observedRace: observed.race,
  };
}

/** 気象の項目が1つでも解析できているか（ブロックが無い・空のページを判別する） */
export function hasAnyWeather(conditions) {
  if (!conditions) return false;
  return (
    conditions.weather != null ||
    conditions.airTemp != null ||
    conditions.windVelocity != null ||
    conditions.waterTemp != null ||
    conditions.waveHeight != null
  );
}

const JST_OFFSET = "+09:00";
/** 観測時刻が「今」より何分先まで許容するか（時計のずれの許容。これを超える未来は不正） */
const MAX_FUTURE_MINUTES = 10;

/**
 * 気象の観測時刻を、timestamptz（ISO文字列）にする。
 *   - 「HH:MM現在」（observedTime）: レース日（JST）と組み合わせる。日付は常にレース日 `date`。
 *     ボートレースは日をまたいで開催されないため、「HH:MM」が前日・翌日になることは無い
 *     （日をまたぐ組み立てはしない）
 *   - 「N R時点」（observedRace）: 公式が時刻を載せないため、そのレースの発走予定時刻
 *     （startTimeOfRace(N)）を観測時刻とする（結果ページの値と同じ扱い）
 * 次の不正な値は弾く（値を書かない）:
 *   - after_start: 観測が発走予定時刻以降。beforeinfoは発走後も「その日の最新の観測」を
 *     表示し続けるため、過去レースを取得すると、そのレースの時点とは別の気象になる
 *     （2026-09-19、1Rのページが夕方16:34の観測を表示していた）。発走前に取得した値だけを採る
 *   - future: 観測が「今」より MAX_FUTURE_MINUTES 分を超えて未来。日付・時計の取り違え
 *   - no_time: 時刻も「N R時点」も無い、または「N R時点」のレースの発走予定時刻が分からない
 *
 * @param {{observedTime?: string|null, observedRace?: number|null}} observed scrapeConditions() の戻り値
 * @param {string} date YYYY-MM-DD（レース日、JST）
 * @param {{now?: Date, startTime?: Date|null, startTimeOfRace?: (raceNo: number) => Date|null}} [options]
 *   startTime: このレースの発走予定時刻。startTimeOfRace: 同じ会場のNレース目の発走予定時刻
 * @returns {{observedAt: string|null, problem: null|"no_time"|"after_start"|"future"}}
 */
export function resolveObservedAt(
  observed,
  date,
  { now = new Date(), startTime = null, startTimeOfRace = null } = {},
) {
  let observedDate = null;
  if (observed?.observedTime) {
    observedDate = new Date(`${date}T${observed.observedTime}:00${JST_OFFSET}`);
  } else if (observed?.observedRace != null && startTimeOfRace) {
    observedDate = startTimeOfRace(observed.observedRace);
  }
  if (!observedDate || Number.isNaN(observedDate.getTime())) {
    return { observedAt: null, problem: "no_time" };
  }
  const observedMs = observedDate.getTime();
  if (startTime && observedMs >= startTime.getTime()) {
    return { observedAt: null, problem: "after_start" };
  }
  if (observedMs - now.getTime() > MAX_FUTURE_MINUTES * 60 * 1000) {
    return { observedAt: null, problem: "future" };
  }
  return { observedAt: observedDate.toISOString(), problem: null };
}

/**
 * 当日のスケジュール（getRaceSchedule() の返り値）から、会場・レース番号で発走予定時刻を引く関数を作る。
 * 「N R時点」の気象の観測時刻（Nレース目の発走予定時刻）の解決に使う。
 *
 * @param {Array<{venue_code: number, race_no: number, start_time: Date}>} schedule
 * @returns {(venueCode: number, raceNo: number) => Date|null}
 */
export function buildStartTimeLookup(schedule) {
  const startTimes = new Map(
    schedule.map((r) => [`${r.venue_code}-${r.race_no}`, r.start_time]),
  );
  return (venueCode, raceNo) =>
    startTimes.get(`${venueCode}-${raceNo}`) ?? null;
}

/**
 * 解析結果を race_conditions の気象列に変換する（列名・丸めは update-race-info.js の従来の変換と同じ）。
 * wave_height は SMALLINT のため四捨五入する。
 *
 * @param {ReturnType<typeof scrapeConditions>} conditions
 * @param {string|null} observedAt resolveObservedAt() の observedAt
 */
export function toWeatherColumns(conditions, observedAt) {
  return {
    weather: conditions?.weather ?? null,
    wind_direction: convertWindDirection(conditions?.windDirection ?? null),
    wind_speed: conditions?.windVelocity ?? null,
    wave_height:
      conditions?.waveHeight != null ? Math.round(conditions.waveHeight) : null,
    temperature: conditions?.airTemp ?? null,
    water_temperature: conditions?.waterTemp ?? null,
    weather_observed_at: observedAt ?? null,
  };
}

/**
 * 取得したページの解析結果から、race_conditions へ書く気象の行を作る（純粋関数。展示取得と
 * update-race-info の両方が使う）。
 *   - 気象が1項目も解析できないページ（ブロックが無い・取得失敗）: 行を作らない。書くと、
 *     既にある良い値を null で上書きしてしまう
 *   - 発走予定時刻以降の観測（after_start）: 行を作らない。そのレースの時点の気象ではない
 *   - 観測時刻が分からない・不正（no_time・future）: 気象の値は最新の公式値なので行を作るが、
 *     weather_observed_at は明示的に null にする（古い観測時刻を残して鮮度を誤って示さない）
 * 理由は stats に数える（呼び出し側が「0件を成功扱いにしない」ためのログに使う）。
 *
 * @param {Array<{raceId: string, venueCode: number, startTime: Date|null, conditions: ReturnType<typeof scrapeConditions>|null}>} fetched
 * @param {string} date YYYY-MM-DD（レース日、JST）
 * @param {{now?: Date, startTimeLookup?: ReturnType<typeof buildStartTimeLookup>|null}} [options]
 * @returns {{rows: Object[], stats: {fetched: number, parsed: number, noWeather: number, no_time: number, after_start: number, future: number}}}
 *   parsed: 行を作った件数（no_time・future を含む）
 */
export function buildWeatherRows(
  fetched,
  date,
  { now = new Date(), startTimeLookup = null } = {},
) {
  const stats = {
    fetched: fetched.length,
    parsed: 0,
    noWeather: 0,
    no_time: 0,
    after_start: 0,
    future: 0,
  };
  const rows = [];
  for (const { raceId, venueCode, startTime, conditions } of fetched) {
    if (!hasAnyWeather(conditions)) {
      stats.noWeather++;
      continue;
    }
    const { observedAt, problem } = resolveObservedAt(conditions, date, {
      now,
      startTime,
      startTimeOfRace: startTimeLookup
        ? (raceNo) => startTimeLookup(venueCode, raceNo)
        : null,
    });
    if (problem) stats[problem]++;
    if (problem === "after_start") continue;
    stats.parsed++;
    rows.push({ race_id: raceId, ...toWeatherColumns(conditions, observedAt) });
  }
  return { rows, stats };
}

/**
 * レース結果ページ（raceresult）の気象から、race_conditions へ書く行を作る（純粋関数）。
 * 結果ページの気象は「レース時点の確定値」（beforeinfoの最終観測と一致）だが、公式が観測時刻を
 * 載せないため、観測時刻には発走予定時刻を入れる。発走予定時刻が無い（過去分の補完等）場合は
 * NULL（＝観測時刻不明。beforeinfo由来の古い観測時刻を残さない）。
 *
 * @param {Array<{raceId: string, startTime: Date|null, conditions: ReturnType<typeof scrapeConditions>|null}>} fetched
 * @returns {{rows: Object[], stats: {fetched: number, parsed: number, noWeather: number}}}
 */
export function buildResultWeatherRows(fetched) {
  const rows = [];
  let noWeather = 0;
  for (const { raceId, startTime, conditions } of fetched) {
    if (!hasAnyWeather(conditions)) {
      noWeather++;
      continue;
    }
    rows.push({
      race_id: raceId,
      ...toWeatherColumns(
        conditions,
        startTime ? startTime.toISOString() : null,
      ),
    });
  }
  return {
    rows,
    stats: { fetched: fetched.length, parsed: rows.length, noWeather },
  };
}

/** buildWeatherRows の stats を、ログ用の1行にする */
export function formatWeatherStats(stats) {
  const skipped = [
    stats.noWeather > 0 && `気象なし${stats.noWeather}`,
    stats.after_start > 0 && `発走後の観測${stats.after_start}`,
  ].filter(Boolean);
  const unknownTime = stats.no_time + stats.future;
  const notes = [
    skipped.length > 0 && `反映せず: ${skipped.join("・")}`,
    unknownTime > 0 && `観測時刻不明で反映: ${unknownTime}`,
  ].filter(Boolean);
  const detail = notes.length > 0 ? `（${notes.join("、")}）` : "";
  return `取得${stats.fetched}レース / 反映${stats.parsed}レース${detail}`;
}
