// src/services/supabaseDataService.js から scripts/maintenance/split-data-layer.mjs で字のまま移した（領域: meet）。
// 本体の字下げは元のまま。手で直すときは普通の関数として直してよい

import { supabase } from "./supabaseClient";
import { meetStartFromRows } from "../utils/meetGrouping";
import { isRaceCancelled } from "../utils/raceCancellation.js";
import { officialAsOfDate } from "../utils/meetPageModel.js";
import { meetExclusionsOf } from "./meetExclusion.js";
import {
  countsForSeriesScore,
  shouldUseOfficialSeries,
  prelimOfficialAdjustments,
  prelimEndRaceIdOf,
  prelimEndDayOf,
  noRaceDaysOf,
  semifinalSlotsOf,
  splitMeetSeries,
  scoreTableFor,
  isAbsentStartRow,
  postPrelimFlyingRacerIds,
  runFinishLabel,
  officialMarkOf,
} from "../components/race/seriesPoints.js";
import {
  PRETEST_LOOKBACK_DAYS,
  pickMeetPretestByRacer,
  shiftDate,
} from "../utils/pretestRows";
import { fetchAllByIn, isPastRace, withCache } from "./core.js";

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
    return withCache(cacheKey, async () => {
      if (!supabase) throw new Error("Supabase client not initialized");

      // 節は最長でも7日程度。表示日から9日前までを見れば前節との境目が入る。
      // **窓を広げるときは既定の1000行上限に注意する**。出走表は10日 × 12R × 6艇 =
      // 最大720行で、余裕は280行しか無い（12日ぶんで864行、14日で上限を超える）。
      // 上限に当たっても PostgREST はエラーを返さず黙って切るので、古い日が
      // 落ちて節の境目を見失う。広げるならページングを入れる
      const from = new Date(date);
      from.setDate(from.getDate() - 9);
      const windowStart = from.toISOString().slice(0, 10);
      // 出走表と**窓ぶんの種別**を同時に取る。種別は節の初日を決めるのに要るので
      // `meetStart` より先に要るが、窓の範囲は `meetStart` に依存しないため
      // 往復は増えない（この2本のあとに走る並列の束から種別を外している）
      const [entriesRes, windowConditionsRes] = await Promise.all([
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
      ] = await Promise.all([
        fetchAllByIn(
          "race_results",
          "race_id, rank1, rank2, rank3, rank4, rank5, rank6",
          "race_id",
          raceIds,
        ),
        // **中止・順延**（047、BOA-254）。番組に残っているだけで行われなかった
        // レースを、準優の枠数から外すのに使う（BOA-490）。並列の束に入るので
        // 往復は増えず、行数も節の全レース（最大約84行）×2列で済む
        fetchAllByIn(
          "races",
          "race_id, cancellation_status",
          "race_id",
          raceIds,
        ),
        // 前検タイム（FR-4a、`motor_pretest_stats`。095で匿名SELECTを公開済み）。
        // 機力の**起点**。今節の展示順位の推移だけでは「元から悪い舟」なのか
        // 「調整が進んだ」のかが読めない。節の全選手分を1クエリで引く
        supabase
          .from("motor_pretest_stats")
          // `racer_class` も一緒に取る（追加クエリ0本）。級別は「44人中43位」が
          // B2の順当なのかA1の不調なのかを分ける情報で、勝負駆けの読みが変わる
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
        supabase
          .from("race_start_timings")
          // finish_mark: 欠場の行（「欠」）を出走から外すため（BOA-504）
          .select("race_id, boat_number, start_timing, is_flying, finish_mark")
          .gte("race_id", meetStart)
          .lt("race_id", raceId)
          .like("race_id", `__________-${vv}-__`)
          .then(({ data }) => data ?? []),
        // 公式の得点率一覧のスクレイプ（064）。**備考がそのまま入っている**ので、
        // 「賞典除外」「途中帰郷」で順位の対象外を直接判定できる（推定が要らない）。
        // ただし収録はSG/G1の一部のみ（2026-09-28時点で2開催101行）なので、
        // 無い開催では出走の有無からの推定にフォールバックする
        supabase
          .from("racer_series_points")
          // 備考（賞典除外・途中帰郷）に加えて、**得点率そのもの**も使う。
          // 公式の得点率は `(着順点 − 減点) ÷ 走数` で、当社は減点を持って
          // いないため、減点のある選手とその下の全員の順位がズレる（BOA-475）。
          // 走数の列は無いが `placements` の文字数から出せる
          // scraped_at: 予選中に減点・途中帰郷だけ借りるとき、表の時点が表示中の
          // レースより前かを確かめる（BOA-782、prelimOfficialAdjustments）
          .select(
            "racer_id, remarks, placements, total_points, penalty_points, scraped_at",
          )
          .eq("venue_code", venueCode)
          .eq("meet_start_date", meetStart)
          .then(({ data }) => data ?? []),
      ]);
      const resultById = new Map((results ?? []).map((r) => [r.race_id, r]));
      // 中止が**確定**し、結果も無いレース。判定は `isRaceCancelled` に集めてあるので
      // ここで文字列を比べない（`src/utils/raceCancellation.js`。疑いの段階と
      // 確定を各所で書き分けると必ずズレる、というのがあの関数の由来）。
      // 中止の疑い（tentative）は含まれない——疑いで枠数を減らすと、実際は
      // 行われたときにボーダーが狂う。結果の行を渡すので、誤って確定が残った
      // 実施済みのレースも含まれない（BOA-525）。列名だけスネーク→キャメルに合わせる
      const cancelledRaceIds = new Set(
        (cancellations ?? [])
          .filter((r) =>
            isRaceCancelled({
              cancellationStatus: r.cancellation_status,
              result: resultById.get(r.race_id) ?? null,
            }),
          )
          .map((r) => r.race_id),
      );
      const stageById = new Map(
        (conditions ?? []).map((c) => [c.race_id, c.race_stage]),
      );
      // 公式の値を丸ごと使うか（予選の後、または節ページが決めたとき）
      const usesOfficialSeries =
        useOfficial === true ||
        shouldUseOfficialSeries(
          stageById.get(raceId) ?? null,
          raceId,
          prelimEndRaceIdOf(conditions ?? []),
        );
      // 使わないとき（予選中の今節タブ）は、前夜の公式の表から減点と途中帰郷だけを
      // 当社計算に足す（オーナー決定 2026-10-13、BOA-782）。表の時点が表示中の
      // レースの日より前でなければ null（後から過去のレースを開いたときの後出しを防ぐ）
      const prelimOfficial = usesOfficialSeries
        ? null
        : prelimOfficialAdjustments(
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
      // **男女Ｗ優勝戦の節を2シリーズに分ける**（BOA-511）。同じレースを走った
      // 選手を辿った連結成分がシリーズになる。該当しなければ null。
      // 出走表は節ぶんを既に持っているので追加クエリ0本
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
          ? (meetSeries?.find((set) =>
              currentRacers.every((r) => set.has(r)),
            ) ?? null)
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
            (racersByRace.get(c.race_id) ?? []).some((r) =>
              currentSeries.has(r),
            ),
          )
        : (conditions ?? []);
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
      const startedKeys = new Set(
        (meetStarts ?? [])
          .filter((r) => !isAbsentStartRow(r))
          .map((r) => `${r.race_id}|${r.boat_number}`),
      );
      const racesWithSt = new Set((meetStarts ?? []).map((r) => r.race_id));
      // 着順が付かない走の公式の記号（落・転・妨など）。着順の並びに記号で出す（BOA-537）
      const markByKey = new Map(
        (meetStarts ?? [])
          .filter((r) => officialMarkOf(r.finish_mark))
          .map((r) => [`${r.race_id}|${r.boat_number}`, r.finish_mark]),
      );
      // フライングの走。着欄の記号（finish_mark）が未取得の走でも「失」と出さず「F」にする（BOA-589）
      const flyingKeys = new Set(
        (meetStarts ?? [])
          .filter((r) => r.is_flying === true)
          .map((r) => `${r.race_id}|${r.boat_number}`),
      );

      return {
        meetStart,
        meetEnd: date,
        // 表示中レースの種別。早見（得点率がどう動くか）の出し分けに使う
        currentStage: stageById.get(raceId) ?? null,
        // **予選の終わり**＝種別が「予選」の最後のレースの race_id。
        // 得点率はここで確定し、以降は算入されない。公式の得点率一覧も
        // 「4日目12R終了時点」で止まる（2026-09-27に若松G1で確認）。
        //
        // 最初の準優を境にすると**予選終了後の一般戦を算入してしまう**。
        // 若松は9/25(4日目)で予選が終わり、9/26は1R〜8Rが一般戦・9R〜11Rが
        // 準優だった。「最初の準優より前」で切ると9/26の一般戦が入り、
        // 52人中32人の得点率が公式とズレた（公式と照合して5/5で確認）。
        // 無い（予選中でまだ予選が終わっていない）なら null
        prelimEndRaceId: prelimEndRaceIdOf(conditions ?? []),
        // **公式の得点率一覧（`racer_series_points`）の行**。
        // `buildMeetRanking` がこれを受け取ると、当社計算ではなく公式の値で
        // 得点率・節内順位・着順の並びを出す（BOA-475）。
        //
        // **予選が終わった後の表示でだけ渡す**。公式の行は節に1行しか無く、
        // 中身は「◯日目１２R終了時点」＝予選終了時点のスナップショットなので、
        // 予選中のレースを開いているときに使うと**まだ走っていない走を含む
        // 得点率・順位**を出してしまう（レース詳細は過去日も開ける）。
        // 予選中は従来どおり当社計算で、減点のズレは残る（公式の行が生えるのも
        // 4日目以降なので、予選中は直しようが無い）
        officialByRacer: (() => {
          // 「使ってよいか」の判断は純関数に切り出してある（回帰テスト可能）。
          // 節ページが公式値を使うと決めたとき（useOfficial）はそちらに従う
          if (!usesOfficialSeries) return null;
          const rows = officialSeries ?? [];
          if (rows.length === 0) return null;
          return Object.fromEntries(rows.map((r) => [r.racer_id, r]));
        })(),
        // 予選中に当社計算へ足す、公式の前夜の減点（BOA-782）。`buildMeetRanking` が引く。
        // 表の時点（YYYY-MM-DD）は画面の注記に使う。使えなければ null
        officialPenaltyByRacer: prelimOfficial?.penaltyByRacer ?? null,
        officialPrelimAsOf: prelimOfficial?.asOf ?? null,
        // **順位の対象から外す選手と、その理由**（途中帰郷・賞典除外）。
        // 公式の順位表はこの選手たちを順位から外すため、当社が全員で順位を
        // 振ると下位ほどズレ、ボーダーの目安も狂う。理由は画面の説明の出し分けに使う
        ...meetExclusionsOf({
          usesOfficialSeries,
          officialSeries,
          conditions,
          meetStarts,
          meetRows,
          prelimOfficial,
          date,
        }),
        // **予選が終わった後のレースで今節Fを切った選手**（BOA-626）。
        // 順位は予選終了で確定しているので順位の対象からは外さない（上の判定は
        // 予選終了までのFだけを見る。公式の得点率一覧も同じ、BOA-649）。同じ
        // 「今節F」で片方は除外・片方は順位付きになる理由を、画面が順位の下で断るのに使う。
        // `meetStarts` は表示中レースの直前までなので、まだ切っていないFは入らない
        postPrelimFlyingRacerIds: postPrelimFlyingRacerIds(
          meetStarts,
          meetRows,
          prelimEndRaceIdOf(conditions ?? []),
        ),
        // **残りの予選走数**（表示中のレースを含む）。公式の「必要得点」は
        // 「準優ボーダーをクリアするために必要な得点」で、実データから
        // 逆算すると `ボーダー × (今の走数 + 残り走数) − 今の得点` だった
        // （公式の図: 篠崎 得点率5.75・残り2走 → 13点／池田 7.00・残り1走 → 1点）。
        // 残り走数は**番組が出ている予選レース**からしか数えられないので、
        // 当社は当日ぶんまでで数える（翌日以降の出走表は未取得のことが多い）。
        // 画面側はその旨を注記する
        //
        // **算入判定は得点率と同じ `countsForSeriesScore` を通す**。
        // 以前は「種別に『予選』を含むレース」だけを数えていたため、
        // 予選期間内でも会場固有名のレース（芦屋「サンライズＸ戦」、桐生
        // 「ドラドキ３」等）が残り走数から漏れ、必要得点が過大になっていた
        // （BOA-457）
        remainingPrelimRunsByRacer: (() => {
          const byRacer = {};
          const prelimEnd = prelimEndRaceIdOf(conditions ?? []);
          for (const e of meetRows) {
            if (e.race_id < raceId) continue;
            const st = stageById.get(e.race_id) ?? "";
            if (!countsForSeriesScore(st, e.race_id, prelimEnd)) continue;
            byRacer[e.racer_id] = (byRacer[e.racer_id] ?? 0) + 1;
          }
          return byRacer;
        })(),
        // 残り走で取りうる**最大得点**。残りの本数だけでは出せない（ドリーム戦の
        // 1着は12点、特選は11点）。予選配点の10点で決め打ちすると、ドリーム戦が
        // 残っている選手を「届かず」と誤って出す（BOA-457）
        remainingPrelimMaxPointsByRacer: (() => {
          const byRacer = {};
          const prelimEnd = prelimEndRaceIdOf(conditions ?? []);
          for (const e of meetRows) {
            if (e.race_id < raceId) continue;
            const st = stageById.get(e.race_id) ?? "";
            if (!countsForSeriesScore(st, e.race_id, prelimEnd)) continue;
            byRacer[e.racer_id] =
              (byRacer[e.racer_id] ?? 0) + scoreTableFor(st)[1];
          }
          return byRacer;
        })(),
        // **丸一日レースが無かった日**（全レースが中止・順延、BOA-636）。表示中の日
        // より前だけ。推移の横軸から抜ける理由と、予選終了の日目が日付の数と
        // 合わない理由を、画面が断るのに使う。追加クエリ0本
        noRaceDays: noRaceDaysOf(
          raceIds.filter((id) => id.slice(0, 10) < date),
          cancelledRaceIds,
        ),
        // 予選が終わった日が節の何日目か（公式の「4日目12R終了時点」に合わせる）
        // 中止の日を数えないよう `series_day` を使う（BOA-578、prelimEndDayOf）
        prelimEndDay: prelimEndDayOf(
          prelimEndRaceIdOf(conditions ?? []),
          conditions ?? [],
          raceIds,
          new Set(resultById.keys()),
        ),
        // **この節に組まれた準優勝戦の枠数**。慣例は3個レース=18名で、決められない
        // とき（予選中で準優がまだ番組に出ていない等）は **null**（0ではない）。
        // 画面は `?? SEMIFINAL_DEFAULT_SLOTS` で既定の18枠に落とす。
        // 「準優進出戦」は準優の1つ前の勝ち上がり戦なので数えない（BOA-457）。
        // 中止で流れた準優も数えない。番組に2日ぶん残る中止順延で枠数が倍になり、
        // ボーダー・必要得点・「届かず」まで狂う（BOA-490）
        semifinalSlots: semifinalSlotsOf(seriesConditions, {
          cancelledRaceIds,
          ranRaceIds: new Set(resultById.keys()),
          // 枠数は本数 × 6 ではなく実人数で数える。多摩川のＷ準優戦は
          // 同じ12名が2回走るヒートで、本数で数えると倍になる
          racersByRace,
        }),
        // **男女Ｗ優勝戦の節で、表示中の6艇が属するシリーズの選手**（BOA-511）。
        // null なら通常の節で、画面はこれまでどおり節全体を母集団にする。
        // 2シリーズを混ぜて順位を振ると、節内順位・出場人数・準優の目安が
        // すべて実際の勝ち上がり争いとズレる
        seriesRacerIds: currentSeries ? [...currentSeries] : null,
        // **この節をまだ1走もしていない選手**（BOA-690）。表示中のレースより前に、
        // 結果の出たレースが1つも無い選手。中止で流れたレースは走ったうちに数えない
        // （津 9/22 が丸一日中止で、9/23 に初めて走る選手を「走った」と数えていた）。
        // 「表示中のレース以降に番組がある」には絞らない。絞ると、中止になったレースに
        // しか番組が無かった選手がどこにも数えられず、人数の足し算が合わなかった
        // （津 9/21 の 6R〜12R。ファン評価1周目）。全部の走が欠場の選手は、結果の出た
        // レースに入っているのでここには入らない（absentOnly の側）。
        // この選手がいる間は順位の対象がそろっていないので、画面は準優の目安を伏せ、
        // 人数の行に書き足す。追加クエリ0本
        notYetStartedRacerIds: (() => {
          const ran = new Set();
          const all = new Set();
          for (const e of meetRows) {
            if (e.racer_id == null) continue;
            all.add(e.racer_id);
            if (e.race_id < raceId && resultById.has(e.race_id))
              ran.add(e.racer_id);
          }
          return [...all].filter((id) => !ran.has(id));
        })(),
        // **節の出場者**（表示日までの出走表に載った選手、当日の番組を含む。BOA-660）。
        // 得点率の母集団（表示中のレースより前に走った選手）で数えると、初日の2Rで
        // 「節の出場は6人」になった。追加クエリ0本
        meetEntrantIds: [
          ...new Set(
            meetRows.map((e) => e.racer_id).filter((id) => id != null),
          ),
        ],
        // **節がＷ開催か**（`seriesRacerIds` とは別）。両方の選手が乗るレースでは
        // 分けられないので `seriesRacerIds` が null になるが、そのときも
        // 「なぜ節全体で出しているのか」を画面が断れるようにする（BOA-511）
        isSplitMeet: Boolean(meetSeries),
        // 節の全レースの種別が取れているか（取れていなければ枠数は目安のまま）
        stagesKnown: stageById.size > 0,
        // その日の会場の展示タイム平均（水面の重さ）。同じ6.90でも日によって
        // 意味が変わるため、選手個人の推移を読むときの補正に使う。
        // 実測（若松2026-09-22〜27）で日ごとに 6.829〜6.907 と0.08秒動く
        venueDailyExhibitionAvg: Object.fromEntries(
          [
            ...(meetExhibition ?? [])
              .filter((r) => r.exhibition_time != null)
              .reduce((map, r) => {
                const d = r.race_id.slice(0, 10);
                const cur = map.get(d) ?? { sum: 0, n: 0 };
                cur.sum += Number(r.exhibition_time);
                cur.n += 1;
                map.set(d, cur);
                return map;
              }, new Map()),
          ].map(([d, v]) => [d, v.sum / v.n]),
        ),
        // 6艇それぞれの今節の走（ST・展示）。選手単位で引くと6本増えるため、
        // 節の全レースぶんを2クエリで取って画面側で選手ごとに畳む
        meetRunsByRacer: (() => {
          const exByRace = new Map();
          for (const r of meetExhibition ?? []) {
            if (!exByRace.has(r.race_id)) exByRace.set(r.race_id, new Map());
            exByRace.get(r.race_id).set(r.boat_number, r.exhibition_time);
          }
          const stByRace = new Map();
          for (const r of meetStarts ?? []) {
            if (!stByRace.has(r.race_id)) stByRace.set(r.race_id, new Map());
            stByRace.get(r.race_id).set(r.boat_number, r);
          }
          const byRacer = {};
          for (const e of meetRows) {
            // 推移も**表示中のレースより前**だけ（未実施のレースは
            // 展示もSTも無いので実害は無いが、過去日を開いたときに
            // 同じ日の後のレースを拾わないよう明示的に切る）
            if (e.race_id >= raceId) continue;
            const ex = exByRace.get(e.race_id)?.get(e.boat_number) ?? null;
            const stRow = stByRace.get(e.race_id)?.get(e.boat_number) ?? null;
            const st =
              stRow && !stRow.is_flying && stRow.start_timing != null
                ? Number(stRow.start_timing)
                : null;
            // そのレースの中で何番目のSTだったか（1が最速、同着は同順位）。
            // 「毎回ちゃんと届いているか」は平均STより順位の方が直接的で、
            // 日和の「安定率」（当社定義は最速STとの差0.05以内の割合）が
            // 答えようとしている問いに、%より読みやすい形で答えられる。
            // Fの艇は順位から外す（異常値のため）
            const sameRace = [...(stByRace.get(e.race_id)?.values() ?? [])]
              .filter((r) => !r.is_flying && r.start_timing != null)
              .map((r) => Number(r.start_timing));
            (byRacer[e.racer_id] ??= []).push({
              raceId: e.race_id,
              date: e.race_id.slice(0, 10),
              // その走の着順（1〜6・F・欠・転など）。推移の点の下に出す（BOA-537）
              finish: runFinishLabel(
                resultById.get(e.race_id) ?? null,
                e.boat_number,
                stRow,
                stByRace.has(e.race_id),
              ),
              exhibition: ex === null ? null : Number(ex),
              st,
              stRank:
                st === null ? null : sameRace.filter((v) => v < st).length + 1,
            });
          }
          for (const id of Object.keys(byRacer)) {
            byRacer[id].sort((a, b) => a.raceId.localeCompare(b.raceId));
          }
          return byRacer;
        })(),
        // 選手ごとの前検（節の最初の行＝前検日のもの）。
        // 直近は節の中の複数日に行があるため、最も古い日付を採る。
        // 採り方の根拠と、モータ情報タブ（最新の行を採る）と必ず一致することの
        // 実測は src/utils/pretestRows.js を読むこと
        pretestByRacer: Object.fromEntries(
          pickMeetPretestByRacer(
            pretest,
            new Map(
              meetRows
                .filter((e) => e.motor_number != null)
                .map((e) => [e.racer_id, e.motor_number]),
            ),
          ),
        ),
        // 得点率の計算は画面側の純関数（seriesPoints.js）と同じ規則。
        // ここでは素材（着順と種別）だけ渡し、集計は呼び出し側に任せる。
        // **表示中のレースより前だけ**を渡す。過去日を開いているときは
        // 同じ日の後のレースにも結果があるため、範囲を広げたまま渡すと
        // 「5Rを見ているのに9Rの結果まで得点率に入る」状態に戻る
        // （2026-09-28、必要得点のために取得範囲を広げた際に一度再発させた）
        entries: meetRows
          .filter((e) => e.race_id < raceId)
          .map((e) => ({
            raceId: e.race_id,
            boatNumber: e.boat_number,
            racerId: e.racer_id,
            playerName: e.player_name,
            raceStage: stageById.get(e.race_id) ?? null,
            // 欠場を走数から外すための材料（BOA-489）
            finishMark: markByKey.get(`${e.race_id}|${e.boat_number}`) ?? null,
            isFlying: flyingKeys.has(`${e.race_id}|${e.boat_number}`),
            started:
              !racesWithSt.has(e.race_id) ||
              startedKeys.has(`${e.race_id}|${e.boat_number}`),
            ...(resultById.get(e.race_id) ?? {}),
          })),
      };
    });
  }
