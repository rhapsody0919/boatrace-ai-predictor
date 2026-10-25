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
import { buildRacerScopedRaceRows } from "../../../../src/services/racerScopedRaceRows.js";
import {
  recordsBeforeRace,
  SMALL_SAMPLE_THRESHOLD,
  buildConditionRows,
  CONDITION_ROWS,
  buildMeetResults,
  getRecentRaces,
  computeFrameEntryDistribution,
} from "../../../../src/components/race/basicInfoStats.js";
import { computeWakuNariRate } from "../../../../src/components/race/courseGridStats.js";
import { buildRacerRaceHistoryRows } from "../../../../src/services/racerRaceHistoryRows.js";
import { aggregateRacerConditionStats, RACER_CONDITION_MIN_RUNS } from "../../../../src/utils/racerConditionStats.js";
import { computeAccidentStats, currentPeriodRange } from "../../../../src/utils/accidentRate.js";
import { groupLosingTechniqueRows } from "../../../../src/utils/losingTechnique.js";
import { shapeOriginalExhibition, ORIGINAL_EXHIBITION_KINDS } from "../../../../src/utils/originalExhibition.js";
import { computeStConsideration } from "../../../../src/utils/stConsideration.js";
import { indexBaseline, getBaselineCell, expectedBreakoutCount } from "../../../../src/utils/courseBaseline.js";
import { toWakuRacerStats } from "../../../../src/utils/racerStats.js";
import { attackDefenseColumn, isDefaultAttackDistribution } from "../../../../src/utils/attackDefenseCells.js";
import { placeRatesByBoat, techniqueBreakdown, nationalWinRateByBoat, groupWinningTechniqueRows, poolTechniqueCounts } from "../../../../src/utils/venuePlaceRates.js";

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
/** RPC の匿名の呼び出し（画面の supabase.rpc と同じ。読み取りの関数だけを呼ぶ） */
async function sbRpc(name, args) {
  const SB_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const SB_KEY = process.env.VITE_SUPABASE_ANON_KEY;
  if (!SB_URL || !SB_KEY) throw new Error("Supabase の URL・匿名キーが無い（VITE_SUPABASE_URL・VITE_SUPABASE_ANON_KEY）");
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    signal: AbortSignal.timeout(30000),
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`rpc ${name}: HTTP ${res.status}`);
  return res.json();
}
/** extra: 足す絞り込み（例 `racer_id=in.(1,2)`） */
async function sbIn(table, select, col, ids, extra = null) {
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const list = ids.slice(i, i + 100).map((x) => `"${x}"`).join(",");
    out.push(...(await sbGet(table, `select=${select}&${col}=in.(${encodeURIComponent(list)})${extra ? `&${extra}` : ""}`)));
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
 * @param {object|null} [outcome] この会場の /api/outcome-distribution の応答（会場ページの会場特徴カードと同じ元。api.outcome[会場]）
 */
export async function fetchExhibitionMaterials(raceId, date, venueCode, startTime, missing, racers = null, raceGrade = null, outcome = null) {
  const fail = (source) => (e) => {
    missing.push({ source, reason: e instanceof Error ? e.message : String(e) });
    return null;
  };
  // オリジナル展示はレースの単位で1回読み、艇ごとの欄とレースの欄の両方に使う
  const original = originalExhibition(raceId, date, startTime, missing).catch((e) => (fail("db.exhibition.originalExhibition")(e), null));
  // 互いに依らないので並べて読む（選手のコース別の成績だけは艇の行の racer_id・進入を使うので、その後に読む）
  const [boats, conditions, technique, courseOut, losingTechnique, originalRace] = await Promise.all([
    exhibitionBoats(raceId, racers, missing)
      // 選手の成績の表が読めなくても艇の材料は残し、足す欄を null にする
      // 画面と同じ定義の値（超展開データ・ST考察・条件別・今節・進入・事故率）も、互いに依らないので並べて読み、艇ごとに合わせる
      .then((bs) =>
        Promise.all([
          racerCourseStats(bs, date, missing, racers).catch((e) => (fail("db.exhibition.boats.racer")(e), bs.map(withoutRacerStats))),
          racerScreenStats(bs, raceId, date, venueCode, missing).catch((e) => (fail("db.exhibition.boats.screen")(e), bs.map(() => SCREEN_STATS_NULL))),
          original,
          racerFinals(bs, raceId, date, missing).catch((e) => (fail("db.exhibition.boats.finals")(e), bs.map(() => FINALS_NULL))),
        ]).then(([withRacer, screen, orig, finals]) => withRacer.map((b, i) => ({ ...b, ...screen[i], original_exhibition: orig?.byBoat?.[b.boat_number] ?? null, ...finals[i] }))),
      )
      .catch(fail("db.exhibition.boats")),
    preRaceConditions(raceId, date, startTime, missing).catch(fail("db.exhibition.conditions")),
    venueTechnique(date, venueCode, missing).catch(fail("db.exhibition.technique")),
    venueCourseBaseline(date, venueCode, raceGrade, missing).catch((e) => (fail("db.exhibition.venueCourse")(e), fail("db.exhibition.nationalCourse")(e), null)),
    venueLosingTechnique(date, venueCode, missing).catch(fail("db.exhibition.losingTechnique")),
    original.then((o) => o?.race ?? null),
  ]);
  // 会場×枠の決まり手は technique の winning_technique_stats の行を使う（同じ表を2回読まない）。全会場の表は2500行を超えるので、
  // 選手ごとの読みと並べると30秒の時間切れになった（2026-10-26 実測）。後に読む
  const boatOut = await boatTendency(date, outcome, technique?.byBoat ?? null, missing).catch((e) => (fail("db.exhibition.venueBoat")(e), fail("db.exhibition.nationalBoat")(e), null));
  return {
    notes: EXHIBITION_NOTES,
    boats,
    conditions,
    technique,
    venueCourse: courseOut?.venueCourse ?? null,
    nationalCourse: courseOut?.nationalCourse ?? null,
    venueBoat: boatOut?.venueBoat ?? null,
    nationalBoat: boatOut?.nationalBoat ?? null,
    losingTechnique,
    originalExhibition: originalRace,
  };
}

/** 出力に書く注意（材料を読む側が日付の無い表を当日の値と取り違えないため） */
export const EXHIBITION_NOTES = [
  "racer_course_technique_stats・venue_course_technique_baseline・racer_aggregated_stats は最新の値だけを持ち、過去の日の版が無い。レースの日より後の集計なら missing に「レースの日より後の集計」と記録する（過去のレースで取り直したとき、このレースの結果を含みうる）",
  "racer_period_stats はレースの日より前に締めた（calc_to < レースの日）最新の期を使う",
  "entry_tendency は facts の racers.boats[].course_entry（画面・場面と同じ定義）。集計がこのレース以後の出走を含むと API が出さないので null",
  "course は進入コース。exhibition_course（展示の進入）があればそれ、無ければ枠番で引き、course_source に書く",
  "attack_defense は画面の超展開データ（AttackDefenseTable）と同じ値。キーは枠番（実進入コースではない）。回数は全期間の決まり手の内訳の割合×直近365日の勝ち（負け）数を丸めたもので、分母は直近365日のその枠の出走数。予想（standard の最新）の時点の写し。展示の進入が枠と違う艇は exhibition_course_differs=true（値は枠番のまま）",
  "attack_defense の state: value=選手の値、reference=勝ちが2〜4で参考（画面は※）、national_default=勝ちが2未満で画面は全国平均の%（選手の値ではないので value は null）、national_default_distribution=全期間の勝ちが5未満で決まり手の内訳が全国の既定（value は null）、none=画面が「-」",
  "st_consideration は画面の ST考察と同じ値。このレースより前の730日の走のうち、実進入コースが course（枠番＝画面と同じ枠なり想定）の走。stable_rate・late_rate は%で画面と同じ1桁。late_rate（出遅率）は最速より0.10以上遅い率で、公式の出遅れ（L）ではない。baseline は同コース・同級別の平均（st_course_baseline、最新の集計でレースの日の版ではない）で、画面の差は1桁に丸めた値どうしの差",
  "st_stability は画面に無い値。st_consideration と同じ走から、そのコースの直近30走（欠場を除く）の窓をとり、F・L 以外の ST の母標準偏差（秒、有効2走以上）と、公式の出遅れ（L、L0・L1 の区別なし）の回数。公式の L は本番で全体でも31件と少なく、ほとんどの選手で0。L の艇は実進入コースが付かないことが多く（確定済みの約4割）、その L は数えない",
  "condition_rows は基本情報タブの「条件別」の表（buildConditionRows）と同じ値。キーは national・local（当地）・ippan・sgg1・firstDay・finalDay・wave5（波5cm以上、江戸川を除く）・fHolding（F持ち時）・fClean（F無し時）。率は%の1桁、avg_st は2桁（画面の桁）。n=0 の行は画面が畳む",
  "condition_stats は選手ページの「レース条件別の成績」（aggregateRacerConditionStats）と同じ値。windStrong＝風5m以上、waveRough＝波5cm以上（江戸川を除く）。5走未満の条件は画面に出ないので rows に無い。overall は天候・風・波のどれかが取れた走",
  "meet_results は今節タブの「日別の走り」の表（buildMeetResults・getRecentRaces）と同じ行。決まり手は1着の走だけ、race_stage はレースの種別の公式の表記",
  "entry_distribution は直前情報タブ「この枠からの進入コース」（computeFrameEntryDistribution）。inward_rate が前づけ%、waku_rate が枠なり%、waku_nari は枠情報タブの枠なり進入率（全枠、computeWakuNariRate）",
  "accident は基本情報タブの今期の事故率（RPC get_racer_accident_records・computeAccidentStats）。to はレースの日で、その日の走は含めない。不良航法・待機行動違反は成績に無いので含めず、公式より低いことがある",
  "original_exhibition はオリジナル展示（BOATCAST、getRaceOriginalExhibition と同じ表と整形）。status: value・no_value（この会場の項目だが値が無い）・not_offered（この会場に無い項目）。会場で項目と計測区間が違うので、会場の中で比べる",
  "losingTechnique は会場の負けの決まり手（losing_technique_stats、90日・会場×枠。LosingTechniqueChart と同じまとめ）。最新の集計だけを持つ",
  "条件別・今節・進入・事故率は選手の730日の走をレースの日から数え、このレースより前の走だけを使う（画面は見た日から730日）",
  "final_race_record は画面に無い値。本人の優勝戦（race_conditions.race_stage・kb_archive_races.stage が '優勝戦' の完全一致）の走で、このレースより前（race_id < 対象）。窓は本体（2025-12-03〜）と kb_archive（〜2025-12-02）を合わせる。kb_archive は匿名キーで読めない（074 で anon から REVOKE）ので、読めなければ本体の窓だけで数え、complete=false と windows の read=false で分ける。不成立（race_status='no_race'。is_no_race は使わない）・中止（races.cancellation_status）・結果なし（rank1 が無い、kb は has_result=false）のレースは除く（excluded_races）。欠場（finish_mark '欠'・race_entries.is_absent、kb は K0・K1）は走数に入れない（absent_runs）。F・L（返還）は走数に入れ1着にしない（fl_runs）。失格・転覆等も走数に入れ1着にしない。1着は rank1＝艇番か finish_mark '1'（kb は '01'）。率は%の1桁",
  "nationalCourse は全国×実進入コースの逃げ率・まくり率・逃がし率（venueCourse と同じ表・同じ窓・同じグレードと ALL）。表に全国の行は無い（venue_code は1〜24）ので、24会場の行の率×runs/100 を整数の回数に戻して（RPC compute_venue_course_technique_baseline が数えた回数。戻した回数が率と食い違えば missing）足し、RPC と同じく小数2桁の%に丸める。行の無い会場・グレードはその会場の走が0。venues は足した会場の数",
  "venueBoat は会場ページの会場特徴カード（VenueCharacteristicsCard・もっと詳しく VenueCharacteristicsDetails）と同じ値。1着率・2連率・3連率は outcome_distribution（90日）の3連単の件数から placeRatesByBoat（%の1桁）、top_technique は winning_technique_stats の percentage が最大の行（カードの主な決まり手）、techniques は techniqueBreakdown（その枠の1着の回数の中の割合。share は%の1桁で、画面は整数）。キーは枠番",
  "nationalBoat の win_rate は会場特徴カードの全国平均の目盛り（getNationalAverageOutcomeDistribution と同じ nationalWinRateByBoat。24会場の outcome_distribution の件数のプール）。決まり手の内訳は画面に無い値で、24会場の winning_technique_stats の回数を枠番×決まり手で足した（poolTechniqueCounts）。会場・全国とも90日・最新の集計だけを持つ",
  "period_finals は racer_period_stats の finals（優出回数）・wins（優勝回数）。latest は calc_to < レースの日 の最新の期（前期）、last4 は同じ条件の新しい順の4期の合計（4期そろわなければ periods_count が4未満）。period_year・period_no は期の表記、数えた期間は calc_from〜calc_to",
];

/** racer_period_stats の cN_* のうち写す欄（N は進入コース） */
export const PERIOD_COURSE_FIELDS = ["entries", "avg_st", "avg_start_rank", "f", "l0", "l1", "p1", "p2", "p3"];
/** racer_course_technique_stats の写す欄（地力窓と直近90日。expected は写さない） */
export const COURSE_TECHNIQUE_FIELDS = ["window_start", "window_end", "window_days", "runs", "nige_count", "nige_rate", "makuri_count", "makuri_rate", "nigashi_count", "nigashi_rate", "runs_90d", "nige_rate_90d", "makuri_rate_90d", "nigashi_rate_90d", "last_updated"];
/** 会場のコース別の決まり手（venue_course_technique_baseline）の写す欄 */
export const VENUE_COURSE_FIELDS = ["course", "runs", "nige_rate", "makuri_rate", "nigashi_rate", "window_start", "window_end", "last_updated"];
/** venue_course_technique_baseline の race_grade（表の CHECK vctb_grade_values と同じ） */
export const BASELINE_GRADES = ["SG", "G1", "G2", "G3", "ippan", "ALL"];
const COURSES = [1, 2, 3, 4, 5, 6];
const withoutRacerStats = (b) => ({ ...b, course: b.exhibition_course ?? b.boat_number, course_source: b.exhibition_course != null ? "exhibition_course" : "boat_number", course_technique: null, period_course: null, entry_tendency: null });
const SCREEN_STATS_NULL = { attack_defense: null, st_consideration: null, st_stability: null, condition_rows: null, condition_stats: null, meet_results: null, entry_distribution: null, accident: null };
/** ST の安定度の窓（そのコースの直近の走数） */
export const ST_STABILITY_WINDOW = 30;
const round = (v, d) => (v === null || v === undefined ? null : Number(Number(v).toFixed(d)));
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
 * 選手の、このレースより前の730日の走。画面と同じ2つの行を、同じ取得から作る（表・列は画面の取得と同じ）。
 * - scoped: レース詳細の基本情報・枠情報・直前情報・今節のタブの行（getRacerScopedRaceStats の整形 buildRacerScopedRaceRows）
 * - history: 選手ページのレース条件別の成績の行（getRacerRaceHistory の整形 buildRacerRaceHistoryRows）
 * 画面は見た日から730日だが、ここはレースの日から数える（racerRows と同じ）。
 * race_conditions の読みの失敗は画面と同じく scoped に null で渡し（波・初日・最終日の行を「未取得」にする）、
 * history は作らない（null）
 */
async function racerRecords(racerId, raceId, date, missing) {
  const entries = await sbGet(
    "race_entries",
    `select=race_id,boat_number,grade,f_count&racer_id=eq.${racerId}&and=(race_id.gte.${daysBefore(date, 730)},race_id.lt.${raceId})&order=race_id,boat_number`,
  );
  const ids = [...new Set(entries.map((e) => e.race_id))];
  if (!ids.length) return { scoped: [], history: [] };
  const [raceRows, resultRows, startTimingRows, exhibitionRows, conditionRows] = await Promise.all([
    sbIn("races", "race_id,race_date,venue_code,race_grade", "race_id", ids),
    sbIn("race_results", "race_id,rank1,rank2,rank3,rank4,rank5,rank6,race_status,actual_course_1,actual_course_2,actual_course_3,actual_course_4,actual_course_5,actual_course_6,winning_technique,payout_win,payout_place_1,payout_place_2", "race_id", ids),
    sbIn("race_start_timings", "race_id,boat_number,start_timing,is_flying,finish_mark,entry_course", "race_id", ids),
    // 展示タイム1位・展示順位には同レースの全艇の展示が要る（画面と同じ）
    // 読めなくても ST考察・条件別は残す（展示タイム・展示順位だけが null になる。/code-review 2026-10-26 #1）
    sbIn("exhibition_data", "race_id,boat_number,exhibition_time", "race_id", ids).catch((e) => (orNull(missing, `db.exhibition.boats.exhibition.racer.${racerId}`)(e), [])),
    sbIn("race_conditions", "race_id,race_stage,race_title,weather,wind_speed,wave_height,series_day,is_final_day", "race_id", ids).catch(orNull(missing, `db.exhibition.boats.conditions.racer.${racerId}`)),
  ]);
  const scoped = recordsBeforeRace(buildRacerScopedRaceRows({ entries, raceRows, resultRows, startTimingRows, exhibitionRows, conditionRows }), raceId);
  const history = conditionRows
    ? buildRacerRaceHistoryRows({ entries, raceRows, resultRows, exhibitionRows, conditionRows, stRows: startTimingRows })
    : null;
  return { scoped, history };
}

/**
 * ST の安定度（画面に無い。2026-10-25 hq 依頼）。records（ST考察と同じ行）のうち実進入コースが course の、欠場でない
 * 直近 ST_STABILITY_WINDOW 走の窓をとり、F・L・ST の無い走を除いた ST の母標準偏差（scripts/lib/racerStStats.js の
 * st_stddev と同じ母標準偏差・2値以上）と、窓の中の公式の出遅れ（L）の回数。窓を先に取り、除外の後に走を集め直さない
 * （docs/knowledge/data-definitions.md の平均ST（直近30走）と同じ）
 * @param {object[]} records buildRacerScopedRaceRows の行（raceId の昇順）
 * @param {number} course
 */
export function stStability(records, course) {
  const window = records.filter((r) => r.actualCourse === course && !r.absent).slice(-ST_STABILITY_WINDOW);
  const sts = window.filter((r) => r.stForRank !== null && r.stForRank !== undefined && r.finishMark !== "L").map((r) => Number(r.stForRank));
  const mean = sts.reduce((a, b) => a + b, 0) / (sts.length || 1);
  const sd = sts.length >= 2 ? Math.sqrt(sts.reduce((a, x) => a + (x - mean) ** 2, 0) / sts.length) : null;
  return {
    course,
    course_basis: "boat_number",
    window_runs: window.length,
    valid_runs: sts.length,
    st_stddev: round(sd, 3),
    official_l_count: window.filter((r) => r.finishMark === "L").length,
    since: window[0]?.raceId?.slice(0, 10) ?? null,
  };
}

/** 率（%）は1桁、平均 ST は2桁（画面の表と同じ桁。src/components/race/RaceBasicInfoTab.jsx の formatMetricValue） */
const pct1 = (v) => round(v, 1);
const st2 = (v) => round(v, 2);

/**
 * 基本情報タブの「条件別」の表（buildConditionRows、画面と同じ関数）の全行。画面は指標（勝率・2連対率・3連対率・平均ST）を
 * 切り替えるので、4つの指標で呼んで行ごとにまとめる。n は走数、avg_st_n は ST を計測できた走数（平均ST の母数）。
 * base_n は初日・最終日・波・F持ち時・F無し時の行だけ（その条件を判定できた走数。画面は「他行と比べない」と添える）。
 * 行が unavailable（race_conditions が読めない）なら null（画面も出さない）。期間は画面の表と同じく全期間（730日）
 */
export function conditionRowsOf(records, venueCode) {
  const by = Object.fromEntries(["winRate", "top2Rate", "top3Rate", "avgSt"].map((m) => [m, buildConditionRows(records, { venueCode, metric: m })]));
  return Object.fromEntries(
    CONDITION_ROWS.map((row, i) => {
      const w = by.winRate[i];
      if (w.unavailable) return [row.key, null];
      return [
        row.key,
        {
          n: w.n,
          base_n: w.baseN,
          excluded_n: w.excludedN ?? null,
          win_rate: pct1(w.value),
          top2_rate: pct1(by.top2Rate[i].value),
          top3_rate: pct1(by.top3Rate[i].value),
          avg_st: st2(by.avgSt[i].value),
          avg_st_n: by.avgSt[i].n,
        },
      ];
    }),
  );
}

/**
 * 今節タブの「日別の走り」の表と同じ行（buildMeetResults で同じ節の走を切り出し、getRecentRaces で表の行にする）。
 * 決まり手は画面と同じく1着の走だけ（他の着は null）。レースの種別は race_conditions.race_stage の公式の表記
 */
export function meetResultsOf(records, raceId, venueCode) {
  const meet = buildMeetResults(records, { raceId, venueCode });
  return getRecentRaces(meet, meet.length).map((r) => ({
    race_id: r.raceId,
    date: r.date,
    race_no: r.raceNo,
    boat_number: r.boatNumber,
    entry_course: r.entryCourse,
    start_timing: r.startTiming,
    is_flying: r.isFlying,
    finish_rank: r.finishRank,
    finish_mark: r.finishMark,
    absent: r.absent,
    winning_technique: r.finishRank === 1 ? (r.winningTechnique ?? null) : null,
    race_stage: r.raceStage ?? null,
    race_title: r.raceTitle ?? null,
    exhibition_time: r.exhibitionTime,
    exhibition_rank: r.exhibitionRank,
  }));
}

/**
 * 直前情報タブ「この枠からの進入コース」（EntryCourseDistributionCard の computeFrameEntryDistribution）と、
 * 枠情報タブの枠なり進入率（RaceWakuInfoTab の computeWakuNariRate。全枠の走）。どちらも画面と同じ関数。
 * inward_rate が前づけ%（枠番より内のコースに入った割合）。画面と同じくレースの後も出す（このレースより前の走だけ）
 */
export function entryDistributionOf(records, frame, raceId) {
  const d = computeFrameEntryDistribution(records, frame, raceId);
  const wakuNari = computeWakuNariRate(recordsBeforeRace(records, raceId));
  return {
    frame,
    n: d.n,
    counts: d.counts,
    waku_rate: pct1(d.wakuRate),
    inward_rate: pct1(d.inwardRate),
    outward_rate: pct1(d.outwardRate),
    waku_nari: { rate: pct1(wakuNari.rate), n: wakuNari.n },
  };
}

/**
 * 選手ページの「レース条件別の成績」（RacerConditionStats の aggregateRacerConditionStats、画面と同じ関数）。
 * 率は%の1桁（関数は0〜1の割合）。rows は画面と同じく RACER_CONDITION_MIN_RUNS 走以上の条件だけ（無い条件は欠け）
 */
export function conditionStatsOf(history) {
  const agg = aggregateRacerConditionStats(history);
  const rate = (r) => ({ n: r.n, win_rate: pct1(r.winRate === null ? null : r.winRate * 100), top2_rate: pct1(r.top2Rate === null ? null : r.top2Rate * 100), top3_rate: pct1(r.top3Rate === null ? null : r.top3Rate * 100) });
  return {
    since: history[0]?.raceId?.slice(0, 10) ?? null,
    overall: rate(agg.overall),
    rows: Object.fromEntries(agg.rows.map((r) => [r.key, { group: r.group, label: r.label, ...rate(r) }])),
  };
}

/**
 * 基本情報タブの今期の事故率（computeAccidentStats、画面と同じ関数）。RPC の行が無い選手は出走0（画面と同じ）
 */
export function accidentOf(rows, racerId, range) {
  const a = computeAccidentStats(rows.find((r) => r.racer_id === racerId) ?? { starts: 0, incidents: [] }, range);
  return { from: range.from, to: range.to, starts: a.starts, points: a.points, rate: a.rate, need: a.need, counts: a.counts, status: a.status, settled: a.settled, show_badge: a.showBadge };
}

/**
 * 超展開データの1セルを材料の形にする（画面の「-」・全国平均の%・参考の※を state で分ける）。
 * screen_value は画面に出る文字（照合用）。value は選手の値として使ってよいものだけ（全国平均・内訳の無い回数は null）
 * @param {string|{type: string, value: string}} v getCellValue の戻り値
 * @param {"value"|"national_default_distribution"|"no_distribution"} source そのセルの回数の元が選手の内訳か
 */
export function adCell(v, source = "value") {
  const screen_value = typeof v === "object" && v !== null ? v.value : (v ?? null);
  if (v === "-" || v === null || v === undefined) return { value: null, state: "none", screen_value };
  if (typeof v === "object" && v.type === "default") return { value: null, state: "national_default", screen_value };
  if (source !== "value") return { value: null, state: source, screen_value };
  if (typeof v === "object" && v.type === "reference") return { value: v.value, state: "reference", screen_value };
  return { value: v, state: "value", screen_value };
}

/**
 * 1艇の超展開データ（画面と同じ関数）。回数の元が選手の内訳でないセルは value を null にする:
 * - 攻め（1号艇の逃げ、2〜6号艇）: その枠の勝ちが1以上で、決まり手の内訳が全国の既定（全期間の勝ち5未満）。勝ち0の「0/N」は実の値
 * - 守り（1号艇の差され等）: 負けが1以上で、負けの内訳が無い（全期間の負け5未満で集計が {} を入れる）。画面は「0/N」と出す
 */
export function attackDefenseOf(s, b, predictedAt) {
  const col = attackDefenseColumn(s);
  const attackIsDefault = isDefaultAttackDistribution(s.attackDistribution);
  const def = s.defenseDistribution?.[String(b.boat_number)];
  const noDefense = !def || Object.keys(def).length === 0;
  const losses = col.total - col.wins;
  const sourceOf = (key) => {
    if (b.boat_number !== 1 || key === "nige") return attackIsDefault && col.wins > 0 ? "national_default_distribution" : "value";
    return noDefense && losses > 0 ? "no_distribution" : "value";
  };
  const cells = Object.fromEntries(Object.entries(col.cells).map(([k, v]) => [k, adCell(v, sourceOf(k))]));
  return {
    basis: "boat_number",
    role: b.boat_number === 1 ? "defense" : "attack",
    wins: col.wins,
    total: col.total,
    cells,
    exhibition_course_differs: b.exhibition_course != null && b.exhibition_course !== b.boat_number,
    predicted_at: predictedAt ?? null,
  };
}

/** 優勝戦の成績の窓の元（本体・長期のアーカイブ）と、本体の窓の始まり（アーカイブは前日まで。scripts/lib/officialFinishCode.js） */
export const FINAL_RECORD_SOURCES = ["races", "kb_archive"];
export const FINAL_STAGE = "優勝戦";
/** classifyFinalRide の分類 */
export const FINAL_RIDE_KINDS = ["win", "run", "fl", "absent"];
export const FINAL_MAIN_FROM = "2025-12-03";
const FINAL_KB_TO = "2025-12-02";
const FINALS_NULL = { final_race_record: null, period_finals: null };
/** 優出・優勝回数の4期を読む範囲（期は半年。締めから公表までの間を見て900日。全期を読まない） */
const PERIOD_FINALS_DAYS = 900;

/**
 * 1走の分類（純関数）。absent=欠場（走数に入れない）、fl=F・L（返還。走数に入れ1着にしない）、win=1着、run=それ以外の走。
 * 本体: finish_mark（'1'〜'6'・F・L・欠・妨・転 等）と、rank1（finish_mark が無い走の1着の判定）と race_entries.is_absent。
 * kb: finish_raw（01〜06・F・L0・L1・K0・K1・S0〜S2）。null はその艇の結果が無いので欠場と同じに扱う
 */
export function classifyFinalRide({ source, finish, rank1 = null, boatNumber, isAbsent = false }) {
  if (source === "kb_archive") {
    if (finish == null || /^K/.test(finish)) return "absent";
    if (finish === "F" || /^L/.test(finish)) return "fl";
    return finish === "01" ? "win" : "run";
  }
  if (finish === "欠" || isAbsent === true) return "absent";
  if (finish === "F" || finish === "L") return "fl";
  return finish === "1" || (finish == null && rank1 === boatNumber) ? "win" : "run";
}

/**
 * 優勝戦の成績（純関数）。rides は除外の済んだ走（{race_id, boat_number, kind}）。走数・1着数は欠場を除いた走。
 * before はこの race_id より前の走だけを数えたこと、windows は数えた元（races は FINAL_MAIN_FROM から、kb_archive は FINAL_KB_TO まで）
 * @param {{race_id: string, boat_number: number, kind: string, source: string}[]} rides
 */
export function finalRaceRecordOf(rides, { windows, excludedRaces, before }) {
  const ran = rides.filter((r) => r.kind !== "absent");
  const b1 = ran.filter((r) => r.boat_number === 1);
  const wins = (rs) => rs.filter((r) => r.kind === "win").length;
  const rate = (w, n) => (n ? pct1((w / n) * 100) : null);
  return {
    stage: FINAL_STAGE,
    before,
    windows,
    complete: windows.every((w) => w.read),
    runs: ran.length,
    wins: wins(ran),
    win_rate: rate(wins(ran), ran.length),
    boat1_runs: b1.length,
    boat1_wins: wins(b1),
    boat1_win_rate: rate(wins(b1), b1.length),
    fl_runs: ran.filter((r) => r.kind === "fl").length,
    absent_runs: rides.length - ran.length,
    excluded_races: excludedRaces,
    rides: [...rides].sort((a, b) => a.race_id.localeCompare(b.race_id)).map(({ race_id, boat_number, kind, source }) => ({ race_id, boat_number, kind, source })),
  };
}

/**
 * 優出・優勝回数（racer_period_stats の finals・wins、純関数）。periods は1選手の calc_to < レースの日 の期（calc_to の降順）
 */
export function periodFinalsOf(periods) {
  const pick = (p) => ({ period_year: p.period_year, period_no: p.period_no, calc_from: p.calc_from, calc_to: p.calc_to, starts: p.starts ?? null, finals: p.finals ?? null, wins: p.wins ?? null });
  const last4 = periods.slice(0, 4).map(pick);
  const sum = (k) => (!last4.length || last4.some((p) => p[k] === null) ? null : last4.reduce((a, p) => a + p[k], 0));
  return {
    latest: last4[0] ?? null,
    last4: { periods_count: last4.length, from: last4.at(-1)?.calc_from ?? null, to: last4[0]?.calc_to ?? null, finals: sum("finals"), wins: sum("wins"), periods: last4.map((p) => ({ period_year: p.period_year, period_no: p.period_no })) },
  };
}

/**
 * 艇ごとに、本人の優勝戦の成績（final_race_record）と優出・優勝回数（period_finals）を返す（画面に無い値。2026-10-26 hq 依頼、FT01）。
 * 本体は優勝戦のレース（race_conditions）→ その6選手の出走（race_entries）→ 結果・中止・着順の順に読む。
 * kb_archive は匿名で読めない（074）。読めなければ本体の窓だけで数え、レースの単位で1件記録する
 * @returns {Promise<object[]>} boats と同じ順
 */
async function racerFinals(boats, raceId, date, missing) {
  const ids = [...new Set(boats.map((b) => b.racer_id).filter((x) => x != null))];
  if (!ids.length) return boats.map(() => FINALS_NULL);
  const racerIn = `racer_id=in.(${ids.join(",")})`;
  const main = async () => {
    // 優勝戦の一覧は1000行を超えうるので race_id の順で読む（並べ替えないとページの境で抜け・重なる。/code-review 2026-10-26 #1）
    const stageRows = await sbGet("race_conditions", `select=race_id&race_stage=eq.${FINAL_STAGE}&and=(race_id.gte.${FINAL_MAIN_FROM},race_id.lt.${raceId})&order=race_id`);
    const entries = stageRows.length ? await sbIn("race_entries", "race_id,boat_number,racer_id,is_absent", "race_id", stageRows.map((r) => r.race_id), racerIn) : [];
    const rids = [...new Set(entries.map((e) => e.race_id))];
    const [results, races, st] = rids.length
      ? await Promise.all([sbIn("race_results", "race_id,rank1,race_status", "race_id", rids), sbIn("races", "race_id,cancellation_status", "race_id", rids), sbIn("race_start_timings", "race_id,boat_number,finish_mark", "race_id", rids)])
      : [[], [], []];
    return entries.map((e) => {
      const rr = results.find((x) => x.race_id === e.race_id);
      const cancelled = races.find((x) => x.race_id === e.race_id)?.cancellation_status;
      const excluded = rr?.race_status === "no_race" ? "no_race" : cancelled ? "cancelled" : !rr || rr.rank1 == null ? "no_result" : null;
      const finish = st.find((x) => x.race_id === e.race_id && x.boat_number === e.boat_number)?.finish_mark ?? null;
      return { racer_id: e.racer_id, race_id: e.race_id, boat_number: e.boat_number, source: "races", excluded, kind: excluded ? null : classifyFinalRide({ source: "races", finish, rank1: rr.rank1, boatNumber: e.boat_number, isAbsent: e.is_absent }) };
    });
  };
  const kb = async () => {
    // アーカイブもこのレースより前に限る（2025-12-02 より前のレースで取り直したとき。/code-review 2026-10-26 #2）
    const stageRows = await sbGet("kb_archive_races", `select=race_id,has_result&stage=eq.${FINAL_STAGE}&race_date=lte.${FINAL_KB_TO}&race_id=lt.${raceId}&order=race_id`);
    const rows = stageRows.length ? await sbIn("kb_archive_boats", "race_id,boat_number,racer_id,finish_raw", "race_id", stageRows.map((r) => r.race_id), racerIn) : [];
    return rows.map((b) => {
      const excluded = stageRows.find((r) => r.race_id === b.race_id)?.has_result ? null : "no_result";
      return { racer_id: b.racer_id, race_id: b.race_id, boat_number: b.boat_number, source: "kb_archive", excluded, kind: excluded ? null : classifyFinalRide({ source: "kb_archive", finish: b.finish_raw }) };
    });
  };
  const [mainRides, kbRides, periods] = await Promise.all([
    main().catch(orNull(missing, "db.exhibition.boats.final_race_record")),
    kb().catch((e) => (missing.push({ source: "db.exhibition.boats.final_race_record.kb_archive", reason: `kb_archive が読めない（${e instanceof Error ? e.message : String(e)}。匿名キーは 074 で REVOKE 済み）。本体の窓（${FINAL_MAIN_FROM}〜）だけで数えた` }), null)),
    sbGet("racer_period_stats", `select=racer_id,period_year,period_no,calc_from,calc_to,starts,finals,wins&${racerIn}&and=(calc_to.lt.${date},calc_to.gte.${daysBefore(date, PERIOD_FINALS_DAYS)})&order=racer_id,calc_to.desc`).catch(orNull(missing, "db.exhibition.boats.period_finals")),
  ]);
  const windows = [
    { source: "races", from: FINAL_MAIN_FROM, to: null, read: mainRides !== null },
    { source: "kb_archive", from: null, to: FINAL_KB_TO, read: kbRides !== null },
  ];
  return boats.map((b) => {
    const at = (key) => `db.exhibition.boats.${b.boat_number}.${key}`;
    if (b.racer_id == null) {
      for (const k of ["final_race_record", "period_finals"]) missing.push({ source: at(k), reason: "この艇の選手が分からない（race_entries.racer_id が無い）" });
      return FINALS_NULL;
    }
    const out = { ...FINALS_NULL };
    if (mainRides !== null) {
      const mine = [...mainRides, ...(kbRides ?? [])].filter((r) => r.racer_id === b.racer_id);
      const excludedRaces = Object.fromEntries(["no_result", "no_race", "cancelled"].map((k) => [k, mine.filter((r) => r.excluded === k).length]));
      out.final_race_record = finalRaceRecordOf(mine.filter((r) => !r.excluded), { windows, excludedRaces, before: raceId });
    } else missing.push({ source: at("final_race_record"), reason: "本体の優勝戦の走が読めない" });
    if (periods) {
      const mine = periods.filter((p) => p.racer_id === b.racer_id);
      out.period_finals = periodFinalsOf(mine);
      if (!mine.length) missing.push({ source: at("period_finals"), reason: "racer_period_stats にレースの日より前に締めた期が無い" });
      else if (out.period_finals.last4.periods_count < 4) missing.push({ source: at("period_finals.last4"), reason: `レースの日より前に締めた期が${out.period_finals.last4.periods_count}期だけ` });
      else if (out.period_finals.last4.finals === null) missing.push({ source: at("period_finals.last4"), reason: "finals・wins の無い期がある" });
    } else missing.push({ source: at("period_finals"), reason: "racer_period_stats が読めない" });
    return out;
  });
}

/** 読みの失敗を欠けとして記録し、null を返す（1つの元の失敗で他の欄を消さない） */
const orNull = (missing, source) => (e) => {
  missing.push({ source, reason: e instanceof Error ? e.message : String(e) });
  return null;
};

/**
 * 艇ごとに、画面と同じ定義の値を返す（2026-10-25 hq 依頼、FT01。画面と投稿の数字が食い違わないため、新しい集計を作らない）。
 * attack_defense: 超展開データ（src/utils/attackDefenseCells.js の attackDefenseColumn。画面と同じ関数）。元は予想（standard の最新）の
 *   feature_contributions.racerStats（画面の getRaceRacerStats と同じ問い合わせ）
 * st_consideration: ST考察（src/utils/stConsideration.js の computeStConsideration。course は枠番＝画面の枠なり想定）と
 *   同コース・同級別の平均（st_course_baseline。級別はこのレースの出走表の値、無ければ選手の直近の走の値＝画面と同じ）
 * st_stability: stStability（画面に無い分だけ新しく計算）
 * condition_rows・meet_results・entry_distribution・condition_stats・accident は conditionRowsOf などの説明を参照
 * 元（予想・平均・出走表・選手ごとの走・事故の RPC）は別々に読み、1つが読めなくてもその元に依る欄だけを null にする
 * @returns {Promise<object[]>} boats と同じ順
 */
async function racerScreenStats(boats, raceId, date, venueCode, missing) {
  const ids = [...new Set(boats.map((b) => b.racer_id).filter((x) => x != null))];
  const range = currentPeriodRange(date);
  const [pred, baselineRows, entryGrades, recordsList, accidentRows] = await Promise.all([
    sbGet("predictions", `select=racerStats:feature_contributions->racerStats,predicted_at&race_id=eq.${raceId}&model_id=eq.standard&order=predicted_at.desc&limit=1`).catch(orNull(missing, "db.exhibition.boats.attack_defense")),
    sbGet("st_course_baseline", "select=course,grade,window_start,window_end,runs,stable_rate,late_rate,breakout_rate&order=course,grade").catch(orNull(missing, "db.exhibition.boats.st_consideration.baseline")),
    sbGet("race_entries", `select=boat_number,grade&race_id=eq.${raceId}`).catch(orNull(missing, "db.exhibition.boats.st_consideration.grade")),
    Promise.all(ids.map((id) => racerRecords(id, raceId, date, missing).catch(orNull(missing, `db.exhibition.boats.st_consideration.racer.${id}`)))),
    // 事故率（画面の getRacerAccidentRecords と同じ RPC・同じ期間。to はレースの日で、その日の走は含めない）
    ids.length && range
      ? sbRpc("get_racer_accident_records", { p_racer_ids: [...ids].sort((a, b) => a - b), p_from: range.from, p_to: range.to }).catch(orNull(missing, "db.exhibition.boats.accident"))
      : Promise.resolve(range ? [] : (missing.push({ source: "db.exhibition.boats.accident", reason: "レースの日から今期の期間が決まらない" }), null)),
  ]);
  const recordsById = new Map(ids.map((id, i) => [id, recordsList[i]]));
  const racerStats = toWakuRacerStats(pred?.[0]?.racerStats) ?? [];
  const baselineIndex = baselineRows?.length ? indexBaseline(baselineRows) : null;
  if (pred && !pred[0]) missing.push({ source: "db.exhibition.boats.attack_defense", reason: "predictions に standard の予想が無い（超展開データの元）" });
  if (baselineRows && !baselineIndex) missing.push({ source: "db.exhibition.boats.st_consideration.baseline", reason: "st_course_baseline が空" });
  return boats.map((b) => {
    const at = (key) => `db.exhibition.boats.${b.boat_number}.${key}`;
    const out = { ...SCREEN_STATS_NULL };
    const s = racerStats.find((x) => x.boatNumber === b.boat_number);
    if (pred?.[0] && !s) missing.push({ source: at("attack_defense"), reason: "予想の racerStats にこの艇が無い" });
    if (s) {
      out.attack_defense = attackDefenseOf(s, b, pred[0].predicted_at);
      const notOwn = Object.entries(out.attack_defense.cells).filter(([, c]) => c.value === null && c.state !== "none").map(([k, c]) => `${k}(${c.state})`);
      if (notOwn.length) missing.push({ source: at("attack_defense"), reason: `選手の内訳から出た値でないので null: ${notOwn.join(",")}` });
    }
    if (b.racer_id == null) {
      missing.push({ source: at("st_consideration"), reason: "この艇の選手が分からない（race_entries.racer_id が無い）" });
      return out;
    }
    if (accidentRows) out.accident = accidentOf(accidentRows, b.racer_id, range);
    else missing.push({ source: at("accident"), reason: "事故の RPC が読めない・今期の期間が決まらない（db.exhibition.boats.accident）" });
    const got = recordsById.get(b.racer_id);
    if (!got) {
      // 読めなかった（orNull が選手の単位で記録済み）。欄ごとにも記録する（/code-review 2026-10-26 #2）
      for (const k of ["st_consideration", "st_stability", "condition_rows", "condition_stats", "meet_results", "entry_distribution"]) missing.push({ source: at(k), reason: "選手の走が読めない" });
      return out;
    }
    const records = got.scoped;
    const course = b.boat_number;
    const grade = entryGrades?.find((x) => x.boat_number === b.boat_number)?.grade ?? records[records.length - 1]?.grade ?? null;
    const st = computeStConsideration(records, { course });
    const cell = getBaselineCell(baselineIndex, course, grade);
    out.st_consideration = {
      course,
      course_basis: "boat_number",
      grade,
      since: daysBefore(date, 730),
      n: st.n,
      small_sample: st.n > 0 && st.n < SMALL_SAMPLE_THRESHOLD,
      stable_rate: round(st.stableRate, 1),
      late_rate: round(st.lateRate, 1),
      breakout_count: st.breakoutCount,
      avg_st: round(st.avgSt, 3),
      flying_count: st.flyingCount,
      baseline: cell
        ? {
            stable_rate: round(cell.stable_rate, 1),
            late_rate: round(cell.late_rate, 1),
            breakout_rate: cell.breakout_rate ?? null,
            expected_breakout: round(expectedBreakoutCount(cell.breakout_rate ?? null, st.n), 1),
            runs: cell.runs ?? null,
            window_start: cell.window_start ?? null,
            window_end: cell.window_end ?? null,
          }
        : null,
    };
    if (st.n === 0) missing.push({ source: at("st_consideration"), reason: `このレースより前の730日に${course}コースの ST が無い` });
    if (!cell && baselineIndex) missing.push({ source: at("st_consideration.baseline"), reason: `st_course_baseline に${course}コース・${grade ?? "級別不明"}の行が無い` });
    out.st_stability = stStability(records, course);
    if (out.st_stability.st_stddev === null) missing.push({ source: at("st_stability.st_stddev"), reason: `直近${ST_STABILITY_WINDOW}走の有効な ST が2走未満（${out.st_stability.valid_runs}走）` });
    out.condition_rows = conditionRowsOf(records, venueCode);
    for (const k of ["local", "wave5", "fHolding", "fClean"]) {
      const r = out.condition_rows[k];
      if (r === null) missing.push({ source: at(`condition_rows.${k}`), reason: "race_conditions が読めず、画面もこの行を出さない（未取得）" });
      else if (r.n === 0) missing.push({ source: at(`condition_rows.${k}`), reason: "この条件の走が0（画面は行を畳む）" });
    }
    out.meet_results = meetResultsOf(records, raceId, venueCode);
    out.entry_distribution = entryDistributionOf(records, b.boat_number, raceId);
    if (out.entry_distribution.n === 0) missing.push({ source: at("entry_distribution"), reason: `このレースより前の730日に${b.boat_number}号艇で実進入の付いた走が無い` });
    if (got.history) {
      out.condition_stats = conditionStatsOf(got.history);
      for (const k of ["windStrong", "waveRough"]) {
        if (!out.condition_stats.rows[k]) missing.push({ source: at(`condition_stats.${k}`), reason: `この条件の走が${RACER_CONDITION_MIN_RUNS}走未満（画面は行を出さない）` });
      }
    }
    return out;
  });
}

/**
 * 会場の負けの決まり手（losing_technique_stats、90日・会場×枠）。画面（LosingTechniqueChart、getLosingTechniqueStats）と同じ
 * 並び・まとめ（groupLosingTechniqueRows）。表は最新の集計だけを持つので、レースの日より後の集計なら記録する（値は残す）
 */
async function venueLosingTechnique(date, venueCode, missing) {
  const rows = await sbGet("losing_technique_stats", `select=boat_number,losing_technique,count_90days,total_losses_90days,percentage,last_updated&venue_code=eq.${venueCode}&order=boat_number,percentage.desc`);
  const g = groupLosingTechniqueRows(rows);
  if (!rows.length) missing.push({ source: "db.exhibition.losingTechnique", reason: "losing_technique_stats にこの会場の行が無い" });
  else if (rows.some((r) => r.last_updated > date)) missing.push({ source: "db.exhibition.losingTechnique", reason: lateReason("losing_technique_stats", date) });
  return { last_updated: g.last_updated, by_boat: g.data };
}

/** オリジナル展示の値の状態: value=値あり、no_value=この会場の項目だが値が無い（欠測 --.-- か行なし）、not_offered=この会場に無い項目 */
export const ORIGINAL_EXHIBITION_STATUSES = ["value", "no_value", "not_offered"];

/**
 * オリジナル展示（BOATCAST。直前情報タブの getRaceOriginalExhibition と同じ表と整形 shapeOriginalExhibition）。
 * race: レースの状態。state は画面と同じ published（値あり）・empty（値が1つも無い）に、行が無い no_row（未公開・未取得）を足す。
 *   measure_status は 1=計測あり・2=計測不可。item_labels はこの会場の項目（画面の並びの正）
 * byBoat: 艇ごとに、4項目（一周・半周ラップ・まわり足・直線）と会場の項目の {value, status}
 * 締切の後に書き換えた値（updated_at が締切より後）は記録する（値は残す。#1902 で発走20分前から6分前まで取る）
 */
async function originalExhibition(raceId, date, startTime, missing) {
  const [headers, values] = await Promise.all([
    sbGet("race_original_exhibition", `select=measure_status,item_count,item_labels,updated_at&race_id=eq.${raceId}`),
    sbGet("race_original_exhibition_values", `select=boat_number,kind,value,updated_at&race_id=eq.${raceId}`),
  ]);
  const header = headers[0] ?? null;
  const shaped = shapeOriginalExhibition(header, values);
  const declared = (header?.item_labels ?? "").split("|").map((x) => x.trim()).filter(Boolean);
  // 既定の4項目・会場の項目・値のある項目（名前の違う項目も落とさない。/code-review 2026-10-26 #5）
  const kinds = [...new Set([...ORIGINAL_EXHIBITION_KINDS, ...declared, ...values.filter((v) => v.value !== null && v.value !== undefined).map((v) => v.kind)])];
  const offered = (k) => declared.length === 0 || declared.includes(k);
  const state = !header && values.length === 0 ? "no_row" : shaped.state;
  const deadline = deadlineUtc(date, startTime);
  // 時刻の表記の桁が違っても比べられるよう、数にして最も遅いものを取る（/code-review 2026-10-26 #4）
  const lastWrite = [header?.updated_at, ...values.map((v) => v.updated_at)].filter(Boolean).reduce((a, x) => (a === null || Date.parse(x) > Date.parse(a) ? x : a), null);
  const race = { state, measure_status: header?.measure_status ?? null, item_labels: declared, kinds: shaped.kinds, captured_at: shaped.capturedAt, last_written_at: lastWrite };
  if (state === "no_row") missing.push({ source: "db.exhibition.originalExhibition", reason: "race_original_exhibition にこのレースの行が無い（未公開・未取得）" });
  else if (header?.measure_status === 2) missing.push({ source: "db.exhibition.originalExhibition", reason: "計測不可（measure_status=2）" });
  else if (state === "empty") missing.push({ source: "db.exhibition.originalExhibition", reason: "値が1つも無い（まだ計測されていない・全艇欠測）" });
  if (declared.length) {
    const absent = ORIGINAL_EXHIBITION_KINDS.filter((k) => !declared.includes(k));
    if (absent.length) missing.push({ source: "db.exhibition.originalExhibition.kinds", reason: `この会場のオリジナル展示に無い項目: ${absent.join("・")}（not_offered）` });
  }
  if (lastWrite && deadline !== null && Date.parse(lastWrite) >= deadline) missing.push({ source: "db.exhibition.originalExhibition", reason: `締切の後（${lastWrite}）に書いた値を含む（発走前の値でない恐れ）` });
  const byBoat = {};
  if (state !== "no_row") {
    for (const n of [1, 2, 3, 4, 5, 6]) {
      byBoat[n] = Object.fromEntries(
        kinds.map((k) => {
          const v = shaped.byBoat[n]?.[k];
          const status = v !== undefined ? "value" : offered(k) ? "no_value" : "not_offered";
          if (status === "no_value" && state === "published") missing.push({ source: `db.exhibition.boats.${n}.original_exhibition.${k}`, reason: "値が無い（欠測）" });
          return [k, { value: v ?? null, status }];
        }),
      );
    }
  }
  return { race, byBoat };
}

/**
 * 会場のコース別の決まり手（venue_course_technique_baseline）。レースのグレードの6コースと、グレードを問わない ALL の6コース
 * （グレードの母数が小さいとき朝の一覧は ALL を使う。scripts/daily/generate-morning-digest.js）。race_grade が無ければ ippan で引く。
 * 全国（nationalCourse）は同じ問い合わせの24会場の行から nationalCourseOf で出す
 */
async function venueCourseBaseline(date, venueCode, raceGrade, missing) {
  const grade = raceGrade ?? "ippan";
  if (!raceGrade) missing.push({ source: "db.exhibition.venueCourse.race_grade", reason: "races に race_grade が無く ippan で引いた" });
  const rows = await sbGet("venue_course_technique_baseline", `select=venue_code,race_grade,${VENUE_COURSE_FIELDS.join(",")}&race_grade=in.(${grade},ALL)&order=venue_code,race_grade,course`);
  const mine = rows.filter((r) => r.venue_code === venueCode);
  const pick = (g) =>
    COURSES.map((c) => {
      const r = mine.find((x) => x.race_grade === g && x.course === c);
      if (!r) missing.push({ source: `db.exhibition.venueCourse.${g}.${c}`, reason: "venue_course_technique_baseline にこの会場・グレード・コースの行が無い" });
      return r ? Object.fromEntries(VENUE_COURSE_FIELDS.map((f) => [f, r[f] ?? null])) : null;
    });
  const venueCourse = { race_grade: grade, courses: pick(grade), all: pick("ALL") };
  if (mine.some((r) => r.window_end >= date || r.last_updated > date)) missing.push({ source: "db.exhibition.venueCourse", reason: lateReason("venue_course_technique_baseline", date) });
  const { problems, ...nationalCourse } = nationalCourseOf(rows, grade);
  for (const p of problems) missing.push({ source: "db.exhibition.nationalCourse", reason: p });
  if (rows.some((r) => r.window_end >= date || r.last_updated > date)) missing.push({ source: "db.exhibition.nationalCourse", reason: lateReason("venue_course_technique_baseline", date) });
  return { venueCourse, nationalCourse };
}

/** 全国×コースの行の欄（回数は率×走数から戻した整数）。nige は1コースだけ、nigashi は2〜6コースだけ（表の CHECK と同じ） */
export const NATIONAL_COURSE_FIELDS = ["course", "runs", "venues", "nige_count", "nige_rate", "makuri_count", "makuri_rate", "nigashi_count", "nigashi_rate", "window_start", "window_end", "last_updated"];
const round2 = (v) => Math.round(v * 100) / 100;
const maxOf = (rows, key) => rows.reduce((a, r) => (r[key] != null && (a === null || r[key] > a) ? r[key] : a), null);

/**
 * 全国×実進入コースの逃げ率・まくり率・逃がし率（純関数）。venue_course_technique_baseline は会場ごとの行だけを持つ
 * （venue_code 1〜24、全国の行は無い）。各行の率は RPC compute_venue_course_technique_baseline が回数/runs×100 を
 * 小数2桁に丸めた値なので、率×runs/100 を丸めて回数に戻し（runs が10000未満なら一意に戻る。戻した回数から率を作り直して
 * 一致しなければ problems に書く）、会場の回数と runs を足して、RPC と同じく小数2桁の%にする。
 * 行の無い会場・グレードのセルは、RPC が走の無いセルを出さないので0走として扱う。窓が会場で食い違えば problems に書く
 * @param {object[]} rows 24会場の行（venue_code, race_grade, course, runs, nige_rate, makuri_rate, nigashi_rate, window_start, window_end, last_updated）
 * @param {string} grade レースのグレード
 * @returns {{race_grade: string, courses: (object|null)[], all: (object|null)[], problems: string[]}}
 */
export function nationalCourseOf(rows, grade) {
  const problems = [];
  const windows = new Set(rows.map((r) => `${r.window_start}〜${r.window_end}`));
  if (windows.size > 1) problems.push(`会場で集計の窓が違う（${[...windows].join("・")}）`);
  const back = (r, key) => {
    const n = Math.round((Number(r[key]) * r.runs) / 100);
    if (round2((n / r.runs) * 100) !== Number(r[key])) problems.push(`会場${r.venue_code} ${r.race_grade} ${r.course}コースの ${key} ${r[key]} から回数に戻せない（runs ${r.runs}）`);
    return n;
  };
  const sum = (g) =>
    COURSES.map((c) => {
      const cell = rows.filter((r) => r.race_grade === g && r.course === c && r.runs > 0);
      if (!cell.length) {
        problems.push(`${g} ${c}コースの行が1会場も無い`);
        return null;
      }
      const runs = cell.reduce((a, r) => a + r.runs, 0);
      const count = (key) => cell.reduce((a, r) => a + back(r, key), 0);
      const rate = (n) => (n === null ? null : round2((n / runs) * 100));
      const nige = c === 1 ? count("nige_rate") : null;
      const makuri = count("makuri_rate");
      const nigashi = c === 1 ? null : count("nigashi_rate");
      return {
        course: c,
        runs,
        venues: cell.length,
        nige_count: nige,
        nige_rate: rate(nige),
        makuri_count: makuri,
        makuri_rate: rate(makuri),
        nigashi_count: nigashi,
        nigashi_rate: rate(nigashi),
        window_start: cell[0].window_start,
        window_end: cell[0].window_end,
        last_updated: maxOf(cell, "last_updated"),
      };
    });
  const all = sum("ALL");
  const allVenues = new Set(rows.filter((r) => r.race_grade === "ALL").map((r) => r.venue_code));
  if (allVenues.size < 24) problems.push(`ALL の行がある会場が${allVenues.size}会場だけ（24会場の合計でない）`);
  return { race_grade: grade, courses: grade === "ALL" ? all : sum(grade), all, problems: [...new Set(problems)] };
}

/** 枠の決まり手の内訳（techniqueBreakdown、画面と同じ関数）。share は%の1桁 */
const boatTechniques = (t) => {
  const { total, items } = techniqueBreakdown(t);
  return { technique_total: total, techniques: items.map((x) => ({ technique: x.technique, count: x.count, share: pct1(x.share) })) };
};
const NO_TECHNIQUES = { technique_total: null, techniques: null };

/**
 * 会場×枠と全国×枠の1着率・決まり手（純関数）。会場は会場特徴カード（VenueCharacteristicsCard・VenueCharacteristicsDetails）と
 * 同じ関数（placeRatesByBoat・groupWinningTechniqueRows・techniqueBreakdown。主な決まり手は percentage の最大＝画面の techniques[0]）、
 * 全国の1着率は画面の全国平均（nationalWinRateByBoat）。全国の決まり手は24会場の回数のプール（poolTechniqueCounts、画面に無い）。
 * 元が無いものは null（会場の両方が無ければ venueBoat が null、全国の両方が無ければ nationalBoat が null）
 * @param {{total_races:number, last_updated?:string, data:object}|null} outcome この会場の /api/outcome-distribution の応答
 * @param {object[]|null} venueTechRows この会場の winning_technique_stats の行
 * @param {object[]|null} outcomeRows 全会場の outcome_distribution の行（venue_code, first_boat, count_90days, last_updated）
 * @param {object[]|null} techRows 全会場の winning_technique_stats の行
 */
export function boatTendencyOf(outcome, venueTechRows, outcomeRows, techRows) {
  const rates = outcome ? placeRatesByBoat(outcome) : null;
  // 画面は boat_number・percentage の降順で読む（techniques[0] が主な決まり手）
  const grouped = venueTechRows ? groupWinningTechniqueRows([...venueTechRows].sort((a, b) => a.boat_number - b.boat_number || b.percentage - a.percentage)) : null;
  const national = outcomeRows ? nationalWinRateByBoat(outcomeRows) : null;
  const pooled = techRows ? poolTechniqueCounts(techRows) : null;
  const venueBoat =
    rates || grouped
      ? {
          total_races: rates ? outcome.total_races : null,
          last_updated: rates ? (outcome.last_updated ?? null) : null,
          technique_last_updated: grouped?.last_updated ?? null,
          by_boat: Object.fromEntries(
            COURSES.map((n) => {
              const r = rates?.find((x) => x.boat === n);
              const top = grouped?.data?.[n]?.techniques?.[0] ?? null;
              return [
                n,
                {
                  win_rate: r ? pct1(r.winRate) : null,
                  top2_rate: r ? pct1(r.top2Rate) : null,
                  top3_rate: r ? pct1(r.top3Rate) : null,
                  top_technique: top ? { technique: top.technique, percentage: top.percentage } : null,
                  ...(grouped ? boatTechniques(grouped.data[n]) : NO_TECHNIQUES),
                },
              ];
            }),
          ),
        }
      : null;
  const nationalBoat =
    national || pooled
      ? {
          total_races: national ? outcomeRows.reduce((a, r) => a + (r.count_90days ?? 0), 0) : null,
          venues: national ? new Set(outcomeRows.map((r) => r.venue_code)).size : null,
          technique_venues: pooled ? new Set(techRows.map((r) => r.venue_code)).size : null,
          last_updated: national ? maxOf(outcomeRows, "last_updated") : null,
          technique_last_updated: pooled ? maxOf(techRows, "last_updated") : null,
          by_boat: Object.fromEntries(COURSES.map((n) => [n, { win_rate: national ? pct1(national[n] ?? 0) : null, ...(pooled ? boatTechniques(pooled[n]) : NO_TECHNIQUES) }])),
        }
      : null;
  return { venueBoat, nationalBoat };
}

/**
 * 会場×枠と全国×枠の1着率・決まり手（boatTendencyOf）の元を読む。全国は画面と同じ表（outcome_distribution・
 * winning_technique_stats）の全会場の行。どれも90日の最新の集計だけを持つので、レースの日より後の集計なら記録する（値は残す）
 */
async function boatTendency(date, outcome, venueTechRows, missing) {
  const [outcomeRows, techRows] = await Promise.all([
    // 2500行を超えるので並べ替えて読む（並べないとページの境で抜け・重なる）
    sbGet("outcome_distribution", "select=venue_code,first_boat,second_boat,third_boat,count_90days,last_updated&order=venue_code,first_boat,second_boat,third_boat").catch(orNull(missing, "db.exhibition.nationalBoat.win_rate")),
    sbGet("winning_technique_stats", "select=venue_code,boat_number,winning_technique,count_90days,last_updated&order=venue_code,boat_number,winning_technique").catch(orNull(missing, "db.exhibition.nationalBoat.techniques")),
  ]);
  if (!outcome) missing.push({ source: "db.exhibition.venueBoat.win_rate", reason: "この会場の outcome-distribution が無い（api.outcome）" });
  else if (!outcome.total_races) missing.push({ source: "db.exhibition.venueBoat.win_rate", reason: "outcome_distribution にこの会場の90日のレースが無い" });
  else if (outcome.last_updated > date) missing.push({ source: "db.exhibition.venueBoat.win_rate", reason: lateReason("outcome_distribution", date) });
  if (venueTechRows && !venueTechRows.length) missing.push({ source: "db.exhibition.venueBoat.techniques", reason: "winning_technique_stats にこの会場の行が無い" });
  else if (!venueTechRows) missing.push({ source: "db.exhibition.venueBoat.techniques", reason: "会場の winning_technique_stats が読めない（db.exhibition.technique）" });
  else if (venueTechRows.some((r) => r.last_updated > date)) missing.push({ source: "db.exhibition.venueBoat.techniques", reason: lateReason("winning_technique_stats", date) });
  if (outcomeRows && !outcomeRows.length) missing.push({ source: "db.exhibition.nationalBoat.win_rate", reason: "outcome_distribution が空" });
  if (techRows && !techRows.length) missing.push({ source: "db.exhibition.nationalBoat.techniques", reason: "winning_technique_stats が空" });
  const out = boatTendencyOf(outcome?.total_races ? outcome : null, venueTechRows?.length ? venueTechRows : null, outcomeRows?.length ? outcomeRows : null, techRows?.length ? techRows : null);
  const nb = out.nationalBoat;
  if (nb?.venues != null && nb.venues < 24) missing.push({ source: "db.exhibition.nationalBoat.win_rate", reason: `outcome_distribution の会場が${nb.venues}会場だけ` });
  if (nb?.technique_venues != null && nb.technique_venues < 24) missing.push({ source: "db.exhibition.nationalBoat.techniques", reason: `winning_technique_stats の会場が${nb.technique_venues}会場だけ` });
  if ((nb?.last_updated ?? "") > date) missing.push({ source: "db.exhibition.nationalBoat.win_rate", reason: lateReason("outcome_distribution", date) });
  if ((nb?.technique_last_updated ?? "") > date) missing.push({ source: "db.exhibition.nationalBoat.techniques", reason: lateReason("winning_technique_stats", date) });
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
  if (stage === "exhibition") db.exhibition = await fetchExhibitionMaterials(raceId, date, Number(venue), raceRow?.startTime ?? null, missing, api.facts?.racers ?? null, raceRow?.grade ?? null, api.outcome?.[Number(venue)] ?? null);
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
