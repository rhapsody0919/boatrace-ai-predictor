// src/services/supabaseDataService.js から scripts/maintenance/split-data-layer.mjs で字のまま移した（領域: meet）。
// getMeetScoreboard は取得（クエリ）と、取得後の整形・集計の純関数に分けてある

import { supabase } from "./supabaseClient";
import { meetStartFromRows } from "../utils/meetGrouping";
import { isRaceCancelled } from "../utils/raceCancellation.js";
import { officialAsOfDate } from "../utils/meetPageModel.js";
import {
  shouldUseOfficialSeries,
  prelimOfficialAdjustments,
  prelimEndRaceIdOf,
  splitMeetSeries,
  isAbsentStartRow,
  officialMarkOf,
} from "../pure/seriesPoints.js";
import { PRETEST_LOOKBACK_DAYS, shiftDate } from "../utils/pretestRows";
import { fetchAllByIn, isPastRace, withCache } from "./core.js";
import { headFieldsOf, seriesFieldsOf, runFieldsOf } from "./meetQueries4.js";

/**
 * 節の全選手の今節得点率と順位を取得する（phase a FR-3 Phase B、BOA-291）。
 *
 * ## なぜ節の全選手が要るのか
 *
 * 得点率は**単独では読めない**。「3.67」と出しても、準優に乗るのかが分からない。
 * ファンが見たいのは「この節の中で今どこにいるか」「準優の枠まであと何点か」で、
 * それには節の全選手（約48名）の得点率が要る。
 *
 * ## 取得は3本
 *
 * `race_id` が `YYYY-MM-DD-VV-RR` の固定長なので、`like("__________-VV-__")` で
 * 会場を厳密に絞れる（実測: 桐生の1節=432行を1クエリ・550ms）。
 * 節の切り出しは日付の連続性（間隔2日以内）で行う。`race_series` は引かない。
 *
 * **1レース詳細あたり+3本**。ただしキーは節単位なので、6艇のどれを開いても
 * 使い回され、同じ節の他のレースを開いても再取得しない。
 *
 * @param {string} raceId 表示中のレース。節ページ（BOA-682）は、その日の全レースを
 *   済みとして扱う架空ID `{日付}-{会場}-99` を渡すことがある
 * @param {number} venueCode
 * @param {{useOfficial?: boolean}} [options] `useOfficial: true` なら、種別に関係なく
 *   公式の得点率一覧（`officialByRacer`・備考の途中帰郷・賞典除外）を使う。節ページが
 *   使う（plan §2.4）: 予選後の夜（架空IDには種別が無く公式値が使われない）と、予選中
 *   （公式の前夜時点の値をそのまま出す。ユーザー決定 2026-10-06、減点・途中帰郷を公式と
 *   一致させるため）。省略時は従来どおり表示中レースの種別で決める（今節タブ）
 * @returns {Promise<{rows: Array, currentStage: string|null,
 *   meetStart: string, meetEnd: string, semifinalSlots: number|null}>}
 */
export function getMeetScoreboard(raceId, venueCode, { useOfficial } = {}) {
  const date = (raceId ?? "").slice(0, 10);
  if (!date || venueCode === null || venueCode === undefined) {
    return Promise.resolve(null);
  }
  const vv = String(venueCode).padStart(2, "0");
  // v15: 本番STの「欠」の行を出走に数えない（BOA-504）
  // v16: 推移の走に着順（finish）を足した（BOA-537）
  // v17: 着順の並びの材料に公式の記号（finishMark）を足した（BOA-537）
  // v18: 賞典除外（公式の備考・今節F）を順位から外す理由を足した（BOA-587）
  // v19: 着順の並びでフライングを「F」と出すため、is_flying を足した（BOA-589）
  // v20: 予選終了の日目を series_day から出す（中止の日を数えない、BOA-578）
  // v21: 予選後に今節Fを切った選手（postPrelimFlyingRacerIds）を足した（BOA-626）
  // v22: 丸一日レースが無かった日（noRaceDays）を足した（BOA-636）
  // v23: 節の出場者（meetEntrantIds）を足した（BOA-660）
  // v24: 予選中に帰った選手を予選の翌日から外す・過去のレースは後の日付の前検も使う（BOA-674）
  // v26: 途中帰郷を、前の日まで走っていて表示日に1走も無い選手として全日程で外す。
  //      公式の備考は予選の後だけ使い、その途中帰郷は officialWithdrawn にする（#1149）
  // v28: まだ1走もしていない選手（notYetStartedRacerIds）を足した（BOA-690）
  // v29: 節ページの useOfficial を足した（BOA-682）。キーを分けないと、今節タブと
  //      節ページで公式値の採否が違う結果を取り違える
  // v30: 予選中に公式の前夜の減点・途中帰郷を足した（officialPenaltyByRacer、BOA-782）
  const cacheKey = `meet-scoreboard-v30-${raceId}${useOfficial ? ":of" : ""}`;
  return withCache(cacheKey, () =>
    loadMeetScoreboard({ raceId, venueCode, useOfficial, date, vv }),
  );
}

// 節は最長でも7日程度。表示日から9日前までを見れば前節との境目が入る。
// **窓を広げるときは既定の1000行上限に注意する**。出走表は10日 × 12R × 6艇 =
// 最大720行で、余裕は280行しか無い（12日ぶんで864行、14日で上限を超える）。
// 上限に当たっても PostgREST はエラーを返さず黙って切るので、古い日が
// 落ちて節の境目を見失う。広げるならページングを入れる
function windowStartOf(date) {
  const from = new Date(date);
  from.setDate(from.getDate() - 9);
  return from.toISOString().slice(0, 10);
}

// 出走表と**窓ぶんの種別**を同時に取る。種別は節の初日を決めるのに要るので
// `meetStart` より先に要るが、窓の範囲は `meetStart` に依存しないため
// 往復は増えない（この2本のあとに走る並列の束から種別を外している）
function fetchWindow(vv, windowStart, date) {
  return Promise.all([
    supabase
      .from("race_entries")
      .select("race_id, boat_number, racer_id, player_name, motor_number")
      .gte("race_id", windowStart)
      // **これから走るレースも含めて**取る（2026-09-28）。得点率の集計は
      // 「結果がまだ無いレースは分母に入れない」で弾いているので混ざらない。
      // 必要得点（ボーダーに届くのに要る点）には**残り何走あるか**が要り、
      // それは番組が出ている予選レースの数から数えるしかない
      .lte("race_id", `${date}-zz`)
      .like("race_id", `__________-${vv}-__`),
    supabase
      .from("race_conditions")
      // `race_title` も取る（追加クエリ0本）。男女Ｗ優勝戦＝1つの節に2シリーズが
      // 同居する開催の検出に使う（BOA-511）。判定材料はこの列だけで足りる
      .select("race_id, race_stage, is_final_day, series_day, race_title")
      .gte("race_id", windowStart)
      .lte("race_id", `${date}-zz`)
      .like("race_id", `__________-${vv}-__`),
  ]);
}

// 節に絞った取得の束（結果・中止・前検・展示・ST・公式の得点率）
function fetchMeetBundle({ raceId, venueCode, date, vv, meetStart, raceIds }) {
  return Promise.all([
    fetchAllByIn(
      "race_results",
      "race_id, rank1, rank2, rank3, rank4, rank5, rank6",
      "race_id",
      raceIds,
    ),
    // **中止・順延**（047、BOA-254）。番組に残っているだけで行われなかった
    // レースを、準優の枠数から外すのに使う（BOA-490）。並列の束に入るので
    // 往復は増えず、行数も節の全レース（最大約84行）×2列で済む
    fetchAllByIn("races", "race_id, cancellation_status", "race_id", raceIds),
    // 前検タイム（FR-4a、`motor_pretest_stats`。095で匿名SELECTを公開済み）。
    // 機力の**起点**。今節の展示順位の推移だけでは「元から悪い舟」なのか
    // 「調整が進んだ」のかが読めない。節の全選手分を1クエリで引く
    // `racer_class` も一緒に取る（追加クエリ0本）。級別は「44人中43位」が
    // B2の順当なのかA1の不調なのかを分ける情報で、勝負駆けの読みが変わる
    supabase
      .from("motor_pretest_stats")
      .select(
        "racer_id, race_date, motor_number, pretest_time, pretest_rank, racer_class",
      )
      .eq("venue_code", venueCode)
      .gte("race_date", meetStart)
      // 過去のレースは**表示日より後の行**も引く（BOA-674）。前検の取得が止まって
      // いた日（9/18〜9/22 初日の節。BOA-679）は初日の行が無く、前検が全部「—」に
      // なった。前検は節の中で変わらないので、後の日付の行でも同じ値。
      // 別の節の行はモーター番号で弾く（pickMeetPretestByRacer）。当日は後の行が
      // まだ無いので、今までどおり表示日まで
      .lte(
        "race_date",
        isPastRace(raceId) ? shiftDate(date, PRETEST_LOOKBACK_DAYS) : date,
      )
      .then(({ data }) => data ?? []),
    // **節の全レース・全艇**の展示タイム（2026-09-27追加、+1本）。
    // 2つの用途を1クエリで賄う:
    //   1. その日の会場平均（水面の重さ。同じ6.90でも日によって意味が違う）
    //   2. 6艇それぞれの今節の展示の推移（選手単位で引くと6本増える）
    // 節は最長7日 × 12R × 6艇 = 504行で、Supabaseの既定上限1000行に収まる
    supabase
      .from("exhibition_data")
      .select("race_id, boat_number, exhibition_time")
      .gte("race_id", meetStart)
      .lt("race_id", raceId)
      .like("race_id", `__________-${vv}-__`)
      .then(({ data }) => data ?? []),
    // 同じく節の全レース・全艇の本番ST（+1本）。6艇のST推移に使う。
    // フライングは異常値なので呼び出し側で落とす
    // finish_mark: 欠場の行（「欠」）を出走から外すため（BOA-504）
    supabase
      .from("race_start_timings")
      .select("race_id, boat_number, start_timing, is_flying, finish_mark")
      .gte("race_id", meetStart)
      .lt("race_id", raceId)
      .like("race_id", `__________-${vv}-__`)
      .then(({ data }) => data ?? []),
    // 公式の得点率一覧のスクレイプ（064）。**備考がそのまま入っている**ので、
    // 「賞典除外」「途中帰郷」で順位の対象外を直接判定できる（推定が要らない）。
    // ただし収録はSG/G1の一部のみ（2026-09-28時点で2開催101行）なので、
    // 無い開催では出走の有無からの推定にフォールバックする
    // 備考（賞典除外・途中帰郷）に加えて、**得点率そのもの**も使う。
    // 公式の得点率は `(着順点 − 減点) ÷ 走数` で、当社は減点を持って
    // いないため、減点のある選手とその下の全員の順位がズレる（BOA-475）。
    // 走数の列は無いが `placements` の文字数から出せる
    // scraped_at: 予選中に減点・途中帰郷だけ借りるとき、表の時点が表示中の
    // レースより前かを確かめる（BOA-782、prelimOfficialAdjustments）
    supabase
      .from("racer_series_points")
      .select(
        "racer_id, remarks, placements, total_points, penalty_points, scraped_at",
      )
      .eq("venue_code", venueCode)
      .eq("meet_start_date", meetStart)
      .then(({ data }) => data ?? []),
  ]);
}

async function loadMeetScoreboard({
  raceId,
  venueCode,
  useOfficial,
  date,
  vv,
}) {
  if (!supabase) throw new Error("Supabase client not initialized");

  const [entriesRes, windowConditionsRes] = await fetchWindow(
    vv,
    windowStartOf(date),
    date,
  );
  const rows = entriesRes.data ?? [];
  if (rows.length === 0) return null;
  const windowConditions = windowConditionsRes.data ?? [];

  // **節の初日は `series_day` から決める**（BOA-508）。
  // 以前は日付の連続性（間が2日を**超えたら**別の節）で切っていたが、
  // 節と節の間が中1日空くと連続する開催日の差がちょうど2日になり、
  // 境目とみなされず**前の節が丸ごと混ざっていた**。2026-09-28 戸田8Rで
  // 節内順位が6艇とも「対象外」になり、出場人数・準優の目安・必要得点が
  // 前の節の値になった（BOA-491）。実測では3,065（会場×日）のうち59件で
  // 前の節を跨いでいた。
  //
  // `race_entries` にしか無い日（種別が未取得）も拾えるよう、日付は出走表側を
  // 基準にし、`series_day` は種別から引く
  // 種別が1行も取れていない日の isFinalDay は null（「分からない」）。meetDaysFromRows が扱う
  const meetStart =
    meetStartFromRows(
      rows.map((r) => r.race_id.slice(0, 10)),
      windowConditions,
      date,
    ) ?? date;
  const meetRows = rows.filter((r) => r.race_id.slice(0, 10) >= meetStart);
  const raceIds = [...new Set(meetRows.map((r) => r.race_id))];
  // 節に絞った種別（以降は今までどおり `conditions` として使う）
  const conditions = windowConditions.filter(
    (c) => c.race_id.slice(0, 10) >= meetStart,
  );

  const [
    results,
    cancellations,
    pretest,
    meetExhibition,
    meetStarts,
    officialSeries,
  ] = await fetchMeetBundle({
    raceId,
    venueCode,
    date,
    vv,
    meetStart,
    raceIds,
  });

  return assembleScoreboard({
    raceId,
    date,
    useOfficial,
    meetStart,
    meetRows,
    raceIds,
    conditions,
    results,
    cancellations,
    pretest,
    meetExhibition,
    meetStarts,
    officialSeries,
  });
}

// ---- 取得後の整形・集計（純関数）----

const keyOf = (r) => `${r.race_id}|${r.boat_number}`;

// 中止が**確定**し、結果も無いレース。判定は `isRaceCancelled` に集めてあるので
// ここで文字列を比べない（`src/utils/raceCancellation.js`。疑いの段階と
// 確定を各所で書き分けると必ずズレる、というのがあの関数の由来）。
// 中止の疑い（tentative）は含まれない——疑いで枠数を減らすと、実際は
// 行われたときにボーダーが狂う。結果の行を渡すので、誤って確定が残った
// 実施済みのレースも含まれない（BOA-525）。列名だけスネーク→キャメルに合わせる
function cancelledRaceIdsOf(cancellations, resultById) {
  return new Set(
    (cancellations ?? [])
      .filter((r) =>
        isRaceCancelled({
          cancellationStatus: r.cancellation_status,
          result: resultById.get(r.race_id) ?? null,
        }),
      )
      .map((r) => r.race_id),
  );
}

// 使わないとき（予選中の今節タブ）は、前夜の公式の表から減点と途中帰郷だけを
// 当社計算に足す（オーナー決定 2026-10-13、BOA-782）。表の時点が表示中の
// レースの日より前でなければ null（後から過去のレースを開いたときの後出しを防ぐ）
function prelimOfficialOf(usesOfficialSeries, officialSeries, date) {
  if (usesOfficialSeries) return null;
  return prelimOfficialAdjustments(
    officialSeries,
    officialAsOfDate(
      (officialSeries ?? [])
        .map((r) => r.scraped_at)
        .filter(Boolean)
        .sort()
        .pop() ?? null,
    ),
    date,
  );
}

// **男女Ｗ優勝戦の節を2シリーズに分ける**（BOA-511）。同じレースを走った
// 選手を辿った連結成分がシリーズになる。該当しなければ null。
// 出走表は節ぶんを既に持っているので追加クエリ0本
function seriesContextOf({ meetRows, conditions, raceId }) {
  const racersByRace = new Map();
  for (const e of meetRows) {
    if (!racersByRace.has(e.race_id)) racersByRace.set(e.race_id, []);
    if (e.racer_id != null) racersByRace.get(e.race_id).push(e.racer_id);
  }
  const meetSeries = splitMeetSeries(conditions ?? [], racersByRace);
  // 表示中のレースの6艇が属する側。**6艇全員が同じ側に居るときだけ**分ける。
  // 予選終了後の消化レースには両方の選手が乗ることがあり（多摩川に5レース）、
  // 「1人でも居る側」で決めると反対側の艇が表から消える。
  // そういうレースでは分けずに節全体を出す（注記も出さない）
  const currentRacers = (racersByRace.get(raceId) ?? []).filter(
    (r) => r !== null && r !== undefined,
  );
  const currentSeries =
    currentRacers.length > 0
      ? (meetSeries?.find((set) => currentRacers.every((r) => set.has(r))) ??
        null)
      : null;
  // 枠数はシリーズの準優だけから出す。節全体で数えると2シリーズ合計になる
  // 枠数を出すための、この側のレースだけの種別。
  // **1つの準優に両側の選手が混ざらないことが前提**（実データのＷ開催6節では
  // 準優12本すべてが 6+0 か 0+6）。`some` で絞っているので、もし混合の準優が
  // 現れると両側の `seriesConditions` に入り、枠数が反対側の選手ごと数えられる。
  // 予選終了後の消化レースは混ざるが、そちらは `semifinalRaceIdsOf` が
  // 種別で落とすので枠数には効かない
  const seriesConditions = currentSeries
    ? (conditions ?? []).filter((c) =>
        (racersByRace.get(c.race_id) ?? []).some((r) => currentSeries.has(r)),
      )
    : (conditions ?? []);
  return { racersByRace, meetSeries, currentSeries, seriesConditions };
}

// **本番スタートの記録があるか**（欠場の判定。BOA-489）。
// 着順に載らない走には「失格・落水（走ったが着順が付かない。0点だが
// 走数に入れる）」と「欠場（走っていない。走数にも入れない）」があり、
// 区別にはST記録の有無を使う。`meetStarts` は得点率に使う範囲
// （節の頭〜表示中レースの直前）と同じ窓を引いているので追加クエリ0本。
//
// STが1行も無いレースは**取得漏れ**の可能性があるため、全艇を出走扱いに
// 倒す（欠場扱いにするとレースが丸ごと得点率から消えて、いま直そうと
// している誤差より大きく狂う）
// 欠場の艇にも行がある（finish_mark が「欠」）ので、それは出走に数えない（BOA-504）
// 着順が付かない走の公式の記号（落・転・妨など）。着順の並びに記号で出す（BOA-537）
// フライングの走。着欄の記号（finish_mark）が未取得の走でも「失」と出さず「F」にする（BOA-589）
function startMapsOf(meetStarts) {
  const rows = meetStarts ?? [];
  return {
    startedKeys: new Set(
      rows
        .filter((r) => !isAbsentStartRow(r))
        .map((r) => `${r.race_id}|${r.boat_number}`),
    ),
    racesWithSt: new Set(rows.map((r) => r.race_id)),
    markByKey: new Map(
      rows
        .filter((r) => officialMarkOf(r.finish_mark))
        .map((r) => [keyOf(r), r.finish_mark]),
    ),
    flyingKeys: new Set(rows.filter((r) => r.is_flying === true).map(keyOf)),
  };
}

// 取得した行から、返り値の形に整える
function assembleScoreboard(input) {
  const {
    raceId,
    date,
    useOfficial,
    meetStart,
    meetRows,
    raceIds,
    conditions,
  } = input;
  const {
    results,
    cancellations,
    pretest,
    meetExhibition,
    meetStarts,
    officialSeries,
  } = input;
  const resultById = new Map((results ?? []).map((r) => [r.race_id, r]));
  const cancelledRaceIds = cancelledRaceIdsOf(cancellations, resultById);
  const stageById = new Map(
    (conditions ?? []).map((c) => [c.race_id, c.race_stage]),
  );
  const prelimEnd = prelimEndRaceIdOf(conditions ?? []);
  // 公式の値を丸ごと使うか（予選の後、または節ページが決めたとき）
  const usesOfficialSeries =
    useOfficial === true ||
    shouldUseOfficialSeries(stageById.get(raceId) ?? null, raceId, prelimEnd);
  const prelimOfficial = prelimOfficialOf(
    usesOfficialSeries,
    officialSeries,
    date,
  );
  const series = seriesContextOf({ meetRows, conditions, raceId });
  const ctx = {
    ...input,
    resultById,
    cancelledRaceIds,
    stageById,
    prelimEnd,
    usesOfficialSeries,
    prelimOfficial,
    startMaps: startMapsOf(meetStarts),
    ...series,
  };
  return {
    ...headFieldsOf(ctx),
    ...seriesFieldsOf(ctx),
    ...runFieldsOf(ctx, {
      pretest,
      meetExhibition,
      meetStarts,
      raceIds,
      meetStart,
    }),
  };
}

