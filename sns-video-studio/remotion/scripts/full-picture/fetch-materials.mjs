/**
 * 全貌動画の材料 JSON を1つ作る（龍神側。毎日の実行で鍵が要るのはここだけ）。
 * 公開 API（https://www.boat-ai.jp/api/...）の応答を、場面の作り手が使う形でそのまま1つにまとめる。計算はしない
 * （計算は場面ごとの build が画面と同じ関数で行う）。取れなかった材料は missing に記録し、全体は止めない。
 *
 * 使い方: node scripts/full-picture/fetch-materials.mjs <raceId> <出力.json> [--stage racecard|exhibition] [--from-case <dir>]
 *   --stage exhibition: 展示の後の材料 db.exhibition（fetchExhibitionMaterials）も足す
 *   --from-case: 撮影済みの全貌の case（~/full-picture/cases/{raceId}）の analysis/source から facts・similar・scenario を使う
 *   （試作で、撮影した画面と同じ時点の材料にそろえるため）
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import process from "node:process";

export const MATERIALS_VERSION = "full-picture-materials/1";
const BASE = process.env.FULL_PICTURE_API_BASE ?? "https://www.boat-ai.jp";
const VENUES = Array.from({ length: 24 }, (_, i) => i + 1);
/** 材料の無い応答の status（api/_lib/analogyV16.js の resolveStatus・similar の empty_layer） */
export const NO_DATA = ["not_saved", "absent", "empty_layer"];

// Supabase の匿名読み取り（画面と同じ公開キー。書き込みはしない）。画面が API を通さずに読む場面（3 軸・6 機力）の材料
// 環境変数は呼ぶときに読む（daily.mjs は読み込んだ後に .env.local の匿名キーを入れる）
async function sbGet(table, query) {
  const SB_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const SB_KEY = process.env.VITE_SUPABASE_ANON_KEY;
  if (!SB_URL || !SB_KEY) throw new Error("Supabase の URL・匿名キーが無い（VITE_SUPABASE_URL・VITE_SUPABASE_ANON_KEY）");
  const out = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, {
      signal: AbortSignal.timeout(30000),
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Range: `${from}-${from + 999}` },
    });
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}
async function sbIn(table, select, col, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const list = ids.slice(i, i + 100).map((x) => `"${x}"`).join(",");
    out.push(...(await sbGet(table, `select=${select}&${col}=in.(${encodeURIComponent(list)})`)));
  }
  return out;
}
const daysBefore = (date, n) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

/**
 * 1号艇の選手の成績の元（選手ページ「会場別成績」730日と同じ表・列）。
 * 画面は見た日から数えるが、ここはレースの日から数え、このレースより前の走だけにする（同じ材料なら同じ値）
 */
async function racerRows(racerId, raceId, date) {
  const entries = await sbGet(
    "race_entries",
    `select=race_id,boat_number&racer_id=eq.${racerId}&and=(race_id.gte.${daysBefore(date, 730)},race_id.lt.${raceId})`,
  );
  const ids = [...new Set(entries.map((e) => e.race_id))];
  const [races, results, st] = await Promise.all([
    sbIn("races", "race_id,venue_code,race_grade", "race_id", ids),
    sbIn("race_results", "race_id,rank1,rank2,rank3,payout_win,payout_place_1,payout_place_2,race_status", "race_id", ids),
    sbIn("race_start_timings", "race_id,boat_number,finish_mark", "race_id", ids),
  ]);
  return { racerId, entries, races, results, st: st.filter((r) => entries.some((e) => e.race_id === r.race_id && e.boat_number === r.boat_number)) };
}

/**
 * 展示の後の材料で、艇ごとに出す欄（exhibition_data の列。オリジナル展示は時刻で間に合わないので取らない）。
 * MEASURED は展示で必ず入る値で、null は欠け（missing に記録）。MARK は表示が無いと null（F・L の印、プロペラ・部品の交換なし。
 * docs/db-migration/082・scripts/lib/preRaceRows.js）なので、null を欠けにしない
 */
export const EXHIBITION_MEASURED_FIELDS = ["exhibition_course", "start_timing", "exhibition_time", "tilt", "today_weight"];
export const EXHIBITION_MARK_FIELDS = ["start_flag", "parts_changed", "propeller_change"];
const EXHIBITION_BOAT_FIELDS = [...EXHIBITION_MEASURED_FIELDS, ...EXHIBITION_MARK_FIELDS];
/** 風・波（race_conditions の発走前の値） */
export const CONDITION_FIELDS = ["weather", "wind_direction", "wind_speed", "wave_height"];

/** races.start_time（締切 JST の HH:MM[:SS]）を UTC の時刻にする。無ければ null */
const deadlineUtc = (date, startTime) => (startTime ? Date.parse(`${date}T${startTime.length === 5 ? `${startTime}:00` : startTime}+09:00`) : null);

/**
 * 展示の後の材料（stage=exhibition のときだけ）。読み取りだけ・新しい集計はしない。
 * 艇は1〜6号艇を必ず並べ、行・値が無い欄は null にして missing に「db.exhibition.boats.{艇}[.{欄}]」で記録する（欠けを隠さない。
 * 欠場の艇は理由を「欠場」にする）。
 * 各艇には出走表の F 数（race_entries.f_count、このレースの行）と、今節の着順の並び（meet_finishes）も足す。今節の走は
 * facts の racers.boats[].meet_runs（api/_lib/racerEntryExhibition.js。節の初日からこのレースより前、中止・締切前を外した
 * 今節タブと同じ定義）をそのまま使い、着順は race_start_timings の finish_mark（公式の表記）・finish_rank を写す。
 * 風・波は締切より前の観測だけを使う（race_conditions は結果の取り込みで発走時点の値に上書きされる。その場合は null）。
 * 決まり手の過去の分布は会場の既存の集計表をそのまま写す（venue_technique_period_stats＝会場の90・365日、
 * winning_technique_stats＝1着の枠番別の90日。どちらもレースの日でなく最新の集計で、last_updated を残す）。
 * 艇ごとの選手のコース別の成績（racerCourseStats）と、会場のコース別の決まり手（venueCourseBaseline）も既存の表を写す
 * @param {string} raceId
 * @param {string} date
 * @param {number} venueCode
 * @param {string|null} startTime races.start_time
 * @param {{source: string, reason: string}[]} missing 追記する
 * @param {{boats?: {boat_number: number, meet_runs?: {race_id: string, boat_number: number}[]}[]}|null} [racers] facts の racers
 * @param {string|null} [raceGrade] races.race_grade（SG/G1/G2/G3/ippan）
 */
export async function fetchExhibitionMaterials(raceId, date, venueCode, startTime, missing, racers = null, raceGrade = null) {
  const fail = (source) => (e) => {
    missing.push({ source, reason: e instanceof Error ? e.message : String(e) });
    return null;
  };
  // 4つは互いに依らないので並べて読む（選手のコース別の成績だけは艇の行の racer_id・進入を使うので、その後に読む）
  const [boats, conditions, technique, venueCourse] = await Promise.all([
    exhibitionBoats(raceId, racers, missing)
      // 選手の成績の表が読めなくても艇の材料は残し、足す欄を null にする
      .then((bs) => racerCourseStats(bs, date, missing, racers).catch((e) => (fail("db.exhibition.boats.racer")(e), bs.map(withoutRacerStats))))
      .catch(fail("db.exhibition.boats")),
    preRaceConditions(raceId, date, startTime, missing).catch(fail("db.exhibition.conditions")),
    venueTechnique(date, venueCode, missing).catch(fail("db.exhibition.technique")),
    venueCourseBaseline(date, venueCode, raceGrade, missing).catch(fail("db.exhibition.venueCourse")),
  ]);
  return { notes: EXHIBITION_NOTES, boats, conditions, technique, venueCourse };
}

/** 出力に書く注意（材料を読む側が日付の無い表を当日の値と取り違えないため） */
export const EXHIBITION_NOTES = [
  "racer_course_technique_stats・venue_course_technique_baseline・racer_aggregated_stats は最新の値だけを持ち、過去の日の版が無い。レースの日より後の集計なら missing に「レースの日より後の集計」と記録する（過去のレースで取り直したとき、このレースの結果を含みうる）",
  "racer_period_stats はレースの日より前に締めた（calc_to < レースの日）最新の期を使う",
  "entry_tendency は facts の racers.boats[].course_entry（画面・場面と同じ定義）。集計がこのレース以後の出走を含むと API が出さないので null",
  "course は進入コース。exhibition_course（展示の進入）があればそれ、無ければ枠番で引き、course_source に書く",
];

/** racer_period_stats の cN_* のうち写す欄（N は進入コース） */
export const PERIOD_COURSE_FIELDS = ["entries", "avg_st", "avg_start_rank", "f", "l0", "l1", "p1", "p2", "p3"];
/** racer_course_technique_stats の写す欄（地力窓と直近90日。expected は写さない） */
export const COURSE_TECHNIQUE_FIELDS = ["window_start", "window_end", "window_days", "runs", "nige_count", "nige_rate", "makuri_count", "makuri_rate", "nigashi_count", "nigashi_rate", "runs_90d", "nige_rate_90d", "makuri_rate_90d", "nigashi_rate_90d", "last_updated"];
/** 会場のコース別の決まり手（venue_course_technique_baseline）の写す欄 */
export const VENUE_COURSE_FIELDS = ["course", "runs", "nige_rate", "makuri_rate", "nigashi_rate", "window_start", "window_end", "last_updated"];
const COURSES = [1, 2, 3, 4, 5, 6];
const withoutRacerStats = (b) => ({ ...b, course: b.exhibition_course ?? b.boat_number, course_source: b.exhibition_course != null ? "exhibition_course" : "boat_number", course_technique: null, period_course: null, entry_tendency: null });
const lateReason = (table, date) => `${table} はレースの日（${date}）より後の集計（このレースの結果を含みうる）`;

/**
 * 艇ごとに、その艇の選手のその進入コースの成績を足す（既存の表を写すだけ）。
 * course_technique: racer_course_technique_stats（racer_id, course）の行
 * period_course: racer_period_stats の calc_to < レースの日 の最新の期の cN_*（期の年・番号・calc_to を添える）
 * entry_tendency: racer_aggregated_stats（venue_code=0＝全国）の course_entry_tendency の、その枠の {n, courses} と since。
 *   facts の racers.boats[].course_entry（api/_lib/racerEntryExhibition.js）をそのまま使う。集計がこのレース以後の出走を
 *   含む（after_race）と API が値を出さないので null にし、「レースの日より後の集計」と記録する（画面・場面と同じ定義）
 * @param {object[]} boats exhibitionBoats の出力（racer_id を持つ）
 * @param {{boats?: {boat_number: number, course_entry?: object|null, after_race?: boolean}[]}|null} racers facts の racers
 */
async function racerCourseStats(boats, date, missing, racers) {
  const ids = [...new Set(boats.map((b) => b.racer_id).filter((x) => x != null))];
  const periodSelect = ["racer_id", "period_year", "period_no", "calc_to", ...COURSES.flatMap((c) => PERIOD_COURSE_FIELDS.map((f) => `c${c}_${f}`))].join(",");
  // 期は半年ごと。直近の期だけ要るので、締めが400日より前の期は読まない（選手ごとに全期を読まない）
  const [technique, periods] = ids.length
    ? await Promise.all([
        sbGet("racer_course_technique_stats", `select=racer_id,course,${COURSE_TECHNIQUE_FIELDS.join(",")}&racer_id=in.(${ids.join(",")})`),
        sbGet("racer_period_stats", `select=${periodSelect}&racer_id=in.(${ids.join(",")})&and=(calc_to.lt.${date},calc_to.gte.${daysBefore(date, 400)})&order=calc_to.desc`),
      ])
    : [[], []];
  return boats.map((b) => {
    const at = (key) => `db.exhibition.boats.${b.boat_number}.${key}`;
    const out = withoutRacerStats(b);
    const { course } = out;
    if (b.racer_id == null) {
      for (const k of ["course_technique", "period_course", "entry_tendency"]) missing.push({ source: at(k), reason: "この艇の選手が分からない（race_entries.racer_id が無い）" });
      return out;
    }
    const t = technique.find((r) => r.racer_id === b.racer_id && r.course === course);
    if (!t) missing.push({ source: at("course_technique"), reason: `racer_course_technique_stats にこの選手の${course}コースの行が無い` });
    else {
      out.course_technique = Object.fromEntries(COURSE_TECHNIQUE_FIELDS.map((f) => [f, t[f] ?? null]));
      if (t.window_end >= date || t.last_updated > date) missing.push({ source: at("course_technique"), reason: lateReason("racer_course_technique_stats", date) });
    }
    // 期は calc_to の降順で読んでいるので、選手ごとの最初の行が最新
    const p = periods.find((r) => r.racer_id === b.racer_id);
    if (!p) missing.push({ source: at("period_course"), reason: "racer_period_stats にレースの日より前に締めた期が無い" });
    else {
      out.period_course = { period_year: p.period_year, period_no: p.period_no, calc_to: p.calc_to, course, ...Object.fromEntries(PERIOD_COURSE_FIELDS.map((f) => [f, p[`c${course}_${f}`] ?? null])) };
      if (out.period_course.entries == null) missing.push({ source: at("period_course"), reason: `racer_period_stats の c${course}_entries が無い` });
    }
    const fb = racers?.boats?.find((x) => x.boat_number === b.boat_number) ?? null;
    const entry = fb?.course_entry ?? null;
    const frame = entry?.all?.[String(b.boat_number)] ?? null;
    if (!racers?.boats) missing.push({ source: at("entry_tendency"), reason: "facts に racers が無い" });
    else if (!fb) missing.push({ source: at("entry_tendency"), reason: "facts の racers にこの艇が無い" });
    else if (fb.after_race) missing.push({ source: at("entry_tendency"), reason: lateReason("racer_aggregated_stats", date) });
    else if (!entry) missing.push({ source: at("entry_tendency"), reason: "racer_aggregated_stats にこの選手の全国の行が無い" });
    else if (!frame) missing.push({ source: at("entry_tendency"), reason: `course_entry_tendency にこの選手の${b.boat_number}号艇の進入が無い` });
    if (frame) {
      out.entry_tendency = {
        boat_number: b.boat_number,
        n: frame.n ?? null,
        courses: frame.courses ?? null,
        venue: entry.venue?.[String(b.boat_number)] ?? null,
        since: entry.since ?? null,
        calculated_at: entry.calculated_at ?? null,
      };
    }
    return out;
  });
}

/**
 * 会場のコース別の決まり手（venue_course_technique_baseline）。レースのグレードの6コースと、グレードを問わない ALL の6コース
 * （グレードの母数が小さいとき朝の一覧は ALL を使う。scripts/daily/generate-morning-digest.js）。race_grade が無ければ ippan で引く
 */
async function venueCourseBaseline(date, venueCode, raceGrade, missing) {
  const grade = raceGrade ?? "ippan";
  if (!raceGrade) missing.push({ source: "db.exhibition.venueCourse.race_grade", reason: "races に race_grade が無く ippan で引いた" });
  const rows = await sbGet("venue_course_technique_baseline", `select=race_grade,${VENUE_COURSE_FIELDS.join(",")}&venue_code=eq.${venueCode}&race_grade=in.(${grade},ALL)&order=race_grade,course`);
  const pick = (g) =>
    COURSES.map((c) => {
      const r = rows.find((x) => x.race_grade === g && x.course === c);
      if (!r) missing.push({ source: `db.exhibition.venueCourse.${g}.${c}`, reason: "venue_course_technique_baseline にこの会場・グレード・コースの行が無い" });
      return r ? Object.fromEntries(VENUE_COURSE_FIELDS.map((f) => [f, r[f] ?? null])) : null;
    });
  const out = { race_grade: grade, courses: pick(grade), all: pick("ALL") };
  if (rows.some((r) => r.window_end >= date || r.last_updated > date)) missing.push({ source: "db.exhibition.venueCourse", reason: lateReason("venue_course_technique_baseline", date) });
  return out;
}

async function exhibitionBoats(raceId, racers, missing) {
  const runsOf = (n) => racers?.boats?.find((b) => b.boat_number === n)?.meet_runs ?? null;
  const runIds = [...new Set([1, 2, 3, 4, 5, 6].flatMap((n) => (runsOf(n) ?? []).map((r) => r.race_id)))];
  const [rows, entries, finishes] = await Promise.all([
    sbGet("exhibition_data", `select=boat_number,${EXHIBITION_BOAT_FIELDS.join(",")},is_absent,updated_at&race_id=eq.${raceId}`),
    sbGet("race_entries", `select=boat_number,racer_id,f_count&race_id=eq.${raceId}`),
    runIds.length ? sbIn("race_start_timings", "race_id,boat_number,finish_mark,finish_rank", "race_id", runIds) : [],
  ]);
  if (!racers?.boats) missing.push({ source: "db.exhibition.boats.meet_finishes", reason: "facts に今節の走（racers）が無い" });
  return [1, 2, 3, 4, 5, 6].map((n) => {
    const r = rows.find((x) => x.boat_number === n);
    if (!r) missing.push({ source: `db.exhibition.boats.${n}`, reason: "exhibition_data にこの艇の行が無い" });
    const boat = { boat_number: n, is_absent: r?.is_absent ?? null, updated_at: r?.updated_at ?? null };
    for (const f of EXHIBITION_BOAT_FIELDS) boat[f] = r?.[f] ?? null;
    for (const f of EXHIBITION_MEASURED_FIELDS) {
      if (r && boat[f] === null) missing.push({ source: `db.exhibition.boats.${n}.${f}`, reason: r.is_absent ? "欠場" : "値が無い" });
    }
    const entry = entries.find((x) => x.boat_number === n);
    boat.racer_id = entry?.racer_id ?? null;
    boat.f_count = entry?.f_count ?? null;
    if (boat.f_count === null) missing.push({ source: `db.exhibition.boats.${n}.f_count`, reason: entry ? "値が無い" : "race_entries にこの艇の行が無い" });
    const runs = runsOf(n);
    // 今節の各走の着順（race_id の順＝時系列）。結果の行が無い走は着順を null にして件数を記録する
    boat.meet_finishes = runs
      ? [...runs]
          .sort((a, b) => a.race_id.localeCompare(b.race_id))
          .map((run) => {
            const st = finishes.find((x) => x.race_id === run.race_id && x.boat_number === run.boat_number);
            return { race_id: run.race_id, finish_mark: st?.finish_mark ?? null, finish_rank: st?.finish_rank ?? null };
          })
      : null;
    if (racers?.boats && !runs) missing.push({ source: `db.exhibition.boats.${n}.meet_finishes`, reason: "facts の racers にこの艇が無い" });
    const noMark = boat.meet_finishes?.filter((x) => x.finish_mark === null).length ?? 0;
    if (noMark) missing.push({ source: `db.exhibition.boats.${n}.meet_finishes`, reason: `着順の無い走が${noMark}件` });
    return boat;
  });
}

/**
 * 風・波は、観測時刻が締切より前と確かめられたときだけ出す。観測時刻が無い（scrape-to-json の経路は NULL にする。
 * scripts/daily/generate-predictions.js）・締切が無い・締切の後（結果の値）のときは null にして理由を記録する
 */
async function preRaceConditions(raceId, date, startTime, missing) {
  const [c] = await sbGet("race_conditions", `select=${CONDITION_FIELDS.join(",")},weather_observed_at&race_id=eq.${raceId}`);
  const observed = c?.weather_observed_at ? Date.parse(c.weather_observed_at) : null;
  const deadline = deadlineUtc(date, startTime);
  const preRace = observed !== null && deadline !== null && observed < deadline;
  const out = Object.fromEntries(CONDITION_FIELDS.map((f) => [f, preRace ? (c[f] ?? null) : null]));
  out.observedAt = c?.weather_observed_at ?? null;
  const why = !c
    ? "race_conditions にこのレースの行が無い"
    : CONDITION_FIELDS.every((f) => c[f] == null)
      ? "race_conditions に気象の値が無い（未取得）"
      : observed === null
        ? "観測時刻が無く、発走前の値か確かめられない"
        : deadline === null
          ? "締切の時刻が無く、発走前の値か確かめられない"
          : !preRace
            ? `観測 ${c.weather_observed_at} が締切の後（発走前の値でない）`
            : null;
  if (why) missing.push({ source: "db.exhibition.conditions", reason: why });
  else for (const f of CONDITION_FIELDS) if (out[f] === null) missing.push({ source: `db.exhibition.conditions.${f}`, reason: "値が無い" });
  return out;
}

/** 表は最新の集計だけを持つ（過去の日の版は無い）。レースの日より後に集計した表なら、そのことを記録する（過去のレースで取り直したとき） */
async function venueTechnique(date, venueCode, missing) {
  const [byPeriod, byBoat] = await Promise.all([
    sbGet("venue_technique_period_stats", `select=period_days,winning_technique,race_count,total_races,period_from,period_to,last_updated&venue_code=eq.${venueCode}&order=period_days,winning_technique`),
    sbGet("winning_technique_stats", `select=boat_number,winning_technique,count_90days,total_races,percentage,last_updated&venue_code=eq.${venueCode}&order=boat_number,winning_technique`),
  ]);
  for (const [key, table, rows] of [["byPeriod", "venue_technique_period_stats", byPeriod], ["byBoat", "winning_technique_stats", byBoat]]) {
    if (!rows.length) missing.push({ source: `db.exhibition.technique.${key}`, reason: `${table} にこの会場の行が無い` });
    else if (rows.some((r) => r.last_updated > date)) missing.push({ source: `db.exhibition.technique.${key}`, reason: `${table} はレースの日（${date}）より後の集計（このレースの結果を含みうる）` });
  }
  return { byPeriod, byBoat };
}

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

/** 撮影済みの case の source（{url, data} の包み）から応答を取り出す */
function fromCase(dir, name) {
  const p = join(dir, "analysis", "source", `${name}.json`);
  if (!existsSync(p)) return null;
  const j = JSON.parse(readFileSync(p, "utf8"));
  return j.data ?? j;
}

/**
 * @param {string} raceId 例 2026-10-19-19-10
 * @param {{stage?: string, caseDir?: string|null}} opts
 */
export async function fetchMaterials(raceId, { stage = "racecard", caseDir = null } = {}) {
  const [y, m, d, venue] = raceId.split("-");
  const date = `${y}-${m}-${d}`;
  const missing = [];
  const api = {};
  const take = async (key, path, caseName = null) => {
    try {
      const seeded = caseDir && caseName ? fromCase(caseDir, caseName) : null;
      const got = seeded ?? (await getJson(path));
      // 材料の無い応答（保存前・対象外・類似レースの層が空）は null にして missing に記録する（契約の形にしない）
      if (NO_DATA.includes(got?.status)) {
        api[key] = null;
        missing.push({ source: key, reason: `応答の status が ${got.status}` });
      } else api[key] = got;
    } catch (e) {
      api[key] = null;
      missing.push({ source: key, reason: e instanceof Error ? e.message : String(e) });
    }
  };
  await take("facts", `/api/analogy/facts/${raceId}?stage=${stage}&include=racers`, "facts");
  await take("similar", `/api/analogy/similar/${raceId}?stage=${stage}`, "similar");
  await take("scenario", `/api/analogy/scenario/${raceId}?stage=${stage}&boats=1`, "scenario");
  // 範囲キー（思考アシストの「級の並びが同じ」「全国」、相手の下段の「会場」）は facts の today.scope_keys["1"]
  const keys = api.facts?.today?.scope_keys?.["1"] ?? {};
  for (const [k, scope] of [["scenarioNC", keys.NC], ["scenarioNCR", keys.NCR], ["scenarioNA", keys.NA], ["scenarioVA", keys.VA]]) {
    if (!scope) {
      missing.push({ source: k, reason: "facts に範囲キーが無い" });
      continue;
    }
    const caseName = k === "scenarioNA" ? "national" : k === "scenarioVA" ? "venue" : null;
    await take(k, `/api/analogy/scenario/${raceId}?stage=${stage}&scope=${encodeURIComponent(scope)}`, caseName);
  }
  // 出走表・気象・同じ日の結果（この日の水面傾向）。同じ会場の分だけ残す
  try {
    // 撮影済みの case の schedule には結果が入っていない版があるので、ここは常に API から取る
    const pred = await getJson(`/api/predictions/${date}`);
    api.races = (pred.races ?? []).filter((r) => String(r.venueCode).padStart(2, "0") === venue);
    if (!api.races.some((r) => r.raceId === raceId)) missing.push({ source: "races", reason: "出走表にこのレースが無い" });
  } catch (e) {
    api.races = null;
    missing.push({ source: "races", reason: e instanceof Error ? e.message : String(e) });
  }
  // 会場の過去90日（コース別1着率・枠番別の連対率）。全国平均は24会場の合計（画面の getNationalAverageOutcomeDistribution と同じ値）
  api.outcome = {};
  for (const v of VENUES) {
    try {
      api.outcome[v] = await getJson(`/api/outcome-distribution?venue_code=${v}`);
    } catch (e) {
      api.outcome[v] = null;
      missing.push({ source: `outcome.${v}`, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  // Supabase（匿名読み取り）
  const db = {};
  const race = api.races?.find((r) => r.raceId === raceId);
  const racer1 = race?.entries?.find((e) => e.number === 1)?.racerId;
  try {
    db.racer1 = racer1 ? await racerRows(racer1, raceId, date) : null;
    if (!racer1) missing.push({ source: "db.racer1", reason: "出走表に1号艇の選手が無い" });
  } catch (e) {
    db.racer1 = null;
    missing.push({ source: "db.racer1", reason: e instanceof Error ? e.message : String(e) });
  }
  // モーター（場面6）: 前検（この節）・会場のモーター成績（このレースの日より前の最新）・今節の展示タイム（6選手、このレースより前）
  try {
    const motors = (race?.entries ?? []).map((e) => e.motorNumber).filter((x) => x != null);
    const meetStart = api.facts?.racers?.meet_start ?? date;
    const racerIds = (race?.entries ?? []).map((e) => e.racerId).filter((x) => x != null);
    const [pretest, stats, meetEntries] = await Promise.all([
      sbGet("motor_pretest_stats", `select=race_date,motor_number,pretest_time,pretest_rank&venue_code=eq.${Number(venue)}&and=(race_date.gte.${daysBefore(meetStart, 1)},race_date.lte.${date})&motor_number=in.(${motors.join(",")})`),
      sbGet("venue_motor_stats", `select=motor_number,scraped_date,race_count,final_count,championship_count,first_place_count,top2_rate&venue_code=eq.${Number(venue)}&scraped_date=lte.${date}&motor_number=in.(${motors.join(",")})&order=scraped_date.desc`),
      sbGet("race_entries", `select=race_id,boat_number,racer_id&racer_id=in.(${racerIds.join(",")})&and=(race_id.gte.${meetStart},race_id.lt.${raceId})`),
    ]);
    const exIds = [...new Set(meetEntries.map((e) => e.race_id))];
    const ex = exIds.length ? await sbIn("exhibition_data", "race_id,boat_number,exhibition_time", "race_id", exIds) : [];
    db.motor = { meetStart, pretest, stats, meetEntries, exhibition: ex.filter((x) => meetEntries.some((e) => e.race_id === x.race_id && e.boat_number === x.boat_number)) };
  } catch (e) {
    db.motor = null;
    missing.push({ source: "db.motor", reason: e instanceof Error ? e.message : String(e) });
  }
  // レースの締切（races.start_time、出走表の締切予定時刻 JST）とグレード。冒頭の場面・題名・本文の見出しに使う（BOA-989）
  let raceRow = null;
  try {
    const [r] = await sbGet("races", `select=start_time,race_grade&race_id=eq.${raceId}`);
    raceRow = { startTime: r?.start_time ?? null, grade: r?.race_grade ?? null };
    if (!r?.start_time) missing.push({ source: "race.startTime", reason: "races に締切の時刻が無い" });
  } catch (e) {
    missing.push({ source: "race", reason: e instanceof Error ? e.message : String(e) });
  }
  // 展示の後の材料（進入・展示 ST・チルト・部品交換・展示タイム・風と波・決まり手の過去の分布）。展示の前の出力は変えない
  if (stage === "exhibition") db.exhibition = await fetchExhibitionMaterials(raceId, date, Number(venue), raceRow?.startTime ?? null, missing, api.facts?.racers ?? null, raceRow?.grade ?? null);
  return { schemaVersion: MATERIALS_VERSION, raceId, date, venueCode: Number(venue), stage, race: raceRow, api, db, missing };
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args.splice(i, 2)[1] : null;
  };
  const stage = opt("--stage") ?? "racecard";
  const caseDir = opt("--from-case");
  const [raceId, out] = args;
  if (!raceId || !out) {
    console.error("使い方: node fetch-materials.mjs <raceId> <出力.json> [--stage racecard|exhibition] [--from-case <dir>]");
    process.exit(2);
  }
  const m = await fetchMaterials(raceId, { stage, caseDir });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(m));
  for (const x of m.missing) console.warn(`[取れなかった材料] ${x.source}: ${x.reason}`);
  console.log(`${out}: 取れなかった材料 ${m.missing.length}件`);
}
