// src/services/supabaseDataService.js から scripts/maintenance/split-data-layer.mjs で字のまま移した（領域: motor）。
// 本体の字下げは元のまま。手で直すときは普通の関数として直してよい

import { supabase } from "./supabaseClient";
import { isWithinFreshMotorWindow } from "../utils/motorFreshRate.js";
import { isUsableRaceResult } from "../utils/raceResultUsable.js";
import {
  PRETEST_LOOKBACK_DAYS,
  pickLatestPretestByRacer,
  shiftDate,
} from "../utils/pretestRows";
import { computeMotorPowerIndex } from "../utils/motorPowerIndex.js";
import { chunkArray, withCache } from "./core.js";
import {
  beforeKey,
  findBoatColumnIndex,
  getMotorGenerationStart,
  getRacesForVenueSince,
  getVenueMeetStart,
  includeKey,
  isAllOfficialMotorRateZero,
  motorWindowStart,
} from "./motorQueries.js";

/**
 * モータ情報タブ向けに、節の前検タイムを選手ごとに1クエリで引く（BOA-451）。
 * 採る行は「同じ会場・`race_date <= 当日` かつ `>= 当日 - 6日` の最新」。
 * 根拠と、今節タブ（節の最初の行）と必ず一致することの実測は
 * `src/utils/pretestRows.js` に書いてある。
 *
 * 取得の失敗は投げる（`.throwOnError()` の例外をそのまま上に流す）。以前は空のMapへ倒していたが、
 * 呼び出し元の getRaceMotorBreakdown は withCache の中なので、失敗が「この節は前検なし」として
 * 過去レースでは7日間キャッシュに残り、リロードしても前検の列が出なかった（BOA-686）。
 * 例外なら withCache は保存せず、画面は取得失敗を出して取り直せる。
 * @returns {Promise<Map<number, object>>}
 */
export async function fetchPretestByRacer(venueCode, date) {
  if (!supabase || !date) return new Map();
  const { data } = await supabase
    .from("motor_pretest_stats")
    .select("racer_id, race_date, pretest_time, pretest_rank")
    .eq("venue_code", venueCode)
    .gte("race_date", shiftDate(date, -PRETEST_LOOKBACK_DAYS))
    .lte("race_date", date);
  return pickLatestPretestByRacer(data ?? []);
}

/**
 * 指定会場・モーター番号の「機力指数」を算出する（BOA-265）
 * このモーターが過去90日に出走した全レースについて、
 * 「そのレースで実際に2着以内だったか（0/1）」−
 * 「その時このモーターに乗っていた選手自身の全国2連率」を計算し、
 * 全レース分を平均する。強い選手ばかりが使ってきたことによる
 * 見かけ上の高評価（交絡バイアス）を避けるための設計。
 * 単純に motor_2rate − 現在の選手のglobal_2rate を引き算するだけでは
 * 過去の使用選手の実力とモーター自体の性能を区別できないため、
 * この残差平均方式を採用している（ユーザー指摘を受けて修正、2026-09-12）。
 * daysで集計期間を指定できる（既定90日=「過去90日」、30日=「直近1ヶ月」、BOA-283）。
 * 期間は現行モーターの世代（使用開始日以降）で切り詰める（BOA-329。入れ替え前の
 * 同じ番号の別モーターを混ぜない）。使用開始日が不明な会場は集計せず
 * generation_unknown: true を返す
 */
export function getMotorPowerIndex(venueCode, motorNumber, days = 90, beforeRaceId = null) {
    return withCache(
      // v3: 期間を現行モーターの世代で切り詰め、generation_unknown・
      // clipped_by_generationを追加（BOA-329）
      `motor-power-index-v3-${venueCode}-${motorNumber}-${days}${beforeKey(beforeRaceId)}`,
      async () => {
        const empty = {
          venue_code: venueCode,
          motor_number: motorNumber,
          sample_count: 0,
          actual_rate2: null,
          actual_rate3: null,
          avg_baseline_rate2: null,
          power_index: null,
          generation_unknown: false,
          clipped_by_generation: false,
        };
        if (!supabase) {
          console.error("Supabase client not initialized");
          return empty;
        }

        const window = await motorWindowStart(venueCode, days, beforeRaceId);
        if (window.since === null) {
          return { ...empty, generation_unknown: true };
        }
        const windowed = {
          ...empty,
          clipped_by_generation: window.clippedByGeneration,
        };
        const races = await getRacesForVenueSince(
          venueCode,
          window.since,
          beforeRaceId,
        );
        if (races.length === 0) return windowed;

        const raceIds = races.map((r) => r.race_id);
        const entryChunks = chunkArray(raceIds, 500);

        const entryResults = await Promise.all(
          entryChunks.map((chunk) =>
            supabase
              .from("race_entries")
              .select("race_id, boat_number, global_2rate")
              .in("race_id", chunk)
              .eq("motor_number", motorNumber),
          ),
        );
        let entries = [];
        entryResults.forEach(({ data }) => {
          entries = entries.concat(data ?? []);
        });
        if (entries.length === 0) return windowed;

        const resultChunks = chunkArray(
          entries.map((e) => e.race_id),
          500,
        );
        const resultResults = await Promise.all(
          resultChunks.map((chunk) =>
            supabase
              .from("race_results")
              .select("race_id, rank1, rank2, rank3")
              .in("race_id", chunk),
          ),
        );
        const resultByRaceId = new Map();
        resultResults.forEach(({ data }) => {
          (data ?? []).forEach((r) => resultByRaceId.set(r.race_id, r));
        });

        // 指数の計算は src/utils/motorPowerIndex.js（BOA-1245。龍神ボート番付と共有するため手を加えずに移した）
        const index = computeMotorPowerIndex(entries, resultByRaceId);
        return index ? { ...windowed, ...index } : windowed;
      },
    );
  }

/**
 * 新しいモーターの最初の開催向けの列（BOA-830、2026-10-11 ユーザー決定）。
 * 公式の出走表のモーター2連率は、入れ替え後の最初の節の間は全艇 0（2節目の初日から入る）。
 * 公式が 0 の艇に、現世代の開始日以降・このレースより前の自前の値を出すための材料を返す。
 *
 * - generation_runs / generation_rate2 / generation_rate3 / generation_power_index:
 *   機力指数の計算（過去90日・このレースより前）の結果。期間は使用開始日で切り詰められる。
 *   このレースが現世代で、入れ替えから90日以内か公式 0 の艇があるときだけ取る。それ以外は null
 * - prior_meet_runs: 入れ替えから90日以内で公式 > 0 の艇の、節の初日より前の走数
 *   （公式の値が何走で出た数字か）。取れなければ null
 * - freshness: { generationStart（このレースが現世代のときだけ）, firstMeet（その日の
 *   その会場の公式2連率が全行 0＝最初の節） }
 *
 * 使用開始日・節の初日・公式の確認の取得に失敗したら、その材料を出さずに failed: true
 * （呼び出し元はキャッシュに保存しない）
 * @param {string} raceId
 * @param {number} venueCode
 * @param {Array<{motor_number:number, motor_2rate:number|null}>} rows race_entries の行（公式値）
 * @returns {Promise<{columns: Array<Object>, freshness: {generationStart: string|null, firstMeet: boolean}, failed: boolean}>}
 */
export async function getRaceMotorFreshness(raceId, venueCode, rows) {
    const raceDate = raceId.slice(0, 10);
    const none = rows.map(() => ({
      generation_runs: null,
      generation_rate2: null,
      generation_rate3: null,
      generation_power_index: null,
      prior_meet_runs: null,
    }));
    let failed = false;
    let generationStart = null;
    try {
      generationStart = await getMotorGenerationStart(venueCode);
    } catch (err) {
      console.error("モーター使用開始日の取得に失敗:", err.message);
      failed = true;
    }
    if (generationStart === null || raceDate < generationStart) {
      return {
        columns: none,
        freshness: { generationStart: null, firstMeet: false },
        failed,
      };
    }
    const official = rows.map((r) =>
      r.motor_2rate === null || r.motor_2rate === undefined
        ? null
        : Number(r.motor_2rate),
    );
    const fresh = isWithinFreshMotorWindow(generationStart, raceDate);
    const needOwn = fresh || official.some((v) => v === 0);
    // 節の初日・全行0の確認は、取れなくても他の列は出す（その材料だけ出さず、保存しない）
    const softFail = (label, fallback) => (err) => {
      console.error(`${label}の取得に失敗:`, err.message);
      failed = true;
      return fallback;
    };
    const [own, meetStart, firstMeet] = await Promise.all([
      needOwn
        ? Promise.all(
            rows.map((r) =>
              getMotorPowerIndex(venueCode, r.motor_number, 90, raceId),
            ),
          )
        : null,
      fresh
        ? getVenueMeetStart(venueCode, raceDate).catch(
            softFail("節の初日", null),
          )
        : null,
      // 最初の節は、入れ替えから90日以内で、このレースにも公式0の艇があるときだけ確かめる。
      // 公式の値が取れていない日（全行 null）を、何か月後でも最初の節と取り違えないため
      fresh && official.some((v) => v === 0)
        ? isAllOfficialMotorRateZero(venueCode, raceDate).catch(
            softFail("公式2連率の確認", false),
          )
        : false,
    ]);
    // 節の初日より前（race_id < "YYYY-MM-DD"）の走数。公式は節の途中で変わらないので、
    // 公式の値はこの走りで出た数字
    const prior =
      meetStart !== null
        ? await Promise.all(
            rows.map((r, i) =>
              official[i] > 0
                ? getMotorPowerIndex(
                    venueCode,
                    r.motor_number,
                    90,
                    meetStart,
                  )
                : null,
            ),
          )
        : null;
    return {
      columns: rows.map((_, i) => ({
        generation_runs: own?.[i]?.sample_count ?? null,
        generation_rate2: own?.[i]?.actual_rate2 ?? null,
        generation_rate3: own?.[i]?.actual_rate3 ?? null,
        generation_power_index: own?.[i]?.power_index ?? null,
        prior_meet_runs: prior?.[i]?.sample_count ?? null,
      })),
      freshness: { generationStart, firstMeet },
      failed,
    };
  }

/** 指定モーター番号の出走を、対象レース群からまとめて引く（getMotorUsageHistory 用）。 */
async function fetchMotorEntries(races, motorNumber) {
  const raceIds = races.map((r) => r.race_id);
  const chunks = chunkArray(raceIds, 500);
  const entryResults = await Promise.all(
    chunks.map((chunk) =>
      supabase
        .from("race_entries")
        .select("race_id, boat_number, racer_id, player_name, grade")
        .in("race_id", chunk)
        .eq("motor_number", motorNumber),
    ),
  );
  let entries = [];
  entryResults.forEach(({ data }) => {
    entries = entries.concat(data ?? []);
  });
  return entries;
}

/**
 * race_id昇順に並べ、同一選手が2日以内の間隔で乗り続けている限り同じ節とみなす
 * （getMotorUsageHistory 用）。
 */
function groupEntriesIntoMeets(entries) {
  const sorted = [...entries].sort((a, b) =>
    a.race_id.localeCompare(b.race_id),
  );
  const meets = [];
  let current = null;
  sorted.forEach((e) => {
    const date = e.race_id.slice(0, 10);
    if (current && current.racerId === e.racer_id) {
      const gapDays =
        (new Date(date) - new Date(current.lastDate)) / 86400000;
      if (gapDays <= 2) {
        current.entries.push(e);
        current.lastDate = date;
        return;
      }
    }
    if (current) meets.push(current);
    current = {
      racerId: e.racer_id,
      playerName: e.player_name,
      grade: e.grade,
      entries: [e],
      firstDate: date,
      lastDate: date,
    };
  });
  if (current) meets.push(current);
  return meets;
}

/**
 * 指定会場・モーター番号を過去に使用した選手の履歴を、節ごとにグループ化して
 * 取得する（BOA-283）。「誰がこのモーターに乗っていたか」を辿れるようにする。
 * 節の境目は「同一選手が同一モーターに乗り続けた出走の間隔が2日以内か」で
 * 判定する（BOA-265のgetRacerCurrentMotorStatusと同じ考え方を一般化したもの）。
 * 各節の2連率/3連率はそのモーター・その選手のその節内の実績（機力指数のような
 * 選手実力の差し引きはしない、素の成績）を返す。選手の実力水準は級別バッジで
 * 別途示す（ユーザーフィードバック、2026-09-13: 機力指数を軸にすると選手間の
 * 比較がしづらいため、素の連対率＋級別表示に変更）。
 * 期間は過去90日を現行モーターの世代（使用開始日以降）で切り詰める（BOA-329。
 * 入れ替え前の同じ番号の別モーターに乗った選手を出さない）。使用開始日が
 * 不明な会場は空
 * includeTarget: true（BOA-1297）は beforeRaceId のレース自身の出走も含める。
 * 未確定のレースなら結果が無く、その走は rank: null で入る（n には数えない）。
 * 初日の初走でも今節の firstDate が取れるようにするための口
 */
export function getMotorUsageHistory(
    venueCode,
    motorNumber,
    beforeRaceId = null,
    { includeTarget = false } = {},
  ) {
    return withCache(
      // v2: 期間を現行モーターの世代で切り詰める（BOA-329）
      // v3: 着順の付かなかった走（失格等）も分母に数える（BOA-549）
      `motor-usage-history-v4-${venueCode}-${motorNumber}${includeKey(beforeRaceId, includeTarget)}${beforeKey(beforeRaceId)}`,
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return [];
        }

        const window = await motorWindowStart(venueCode, 90, beforeRaceId);
        if (window.since === null) return [];
        const races = await getRacesForVenueSince(
          venueCode,
          window.since,
          beforeRaceId,
          { includeTarget },
        );
        if (races.length === 0) return [];

        const entries = await fetchMotorEntries(races, motorNumber);
        if (entries.length === 0) return [];

        const resultChunks = chunkArray(
          entries.map((e) => e.race_id),
          500,
        );
        const resultResults = await Promise.all(
          resultChunks.map((chunk) =>
            supabase
              .from("race_results")
              .select(
                "race_id, rank1, rank2, rank3, rank4, rank5, rank6, race_status",
              )
              .in("race_id", chunk),
          ),
        );
        const resultByRaceId = new Map();
        resultResults.forEach(({ data }) => {
          (data ?? []).forEach((r) => resultByRaceId.set(r.race_id, r));
        });

        const rankOf = (result, boatNumber) =>
          findBoatColumnIndex(result, "rank", boatNumber);

        const meets = groupEntriesIntoMeets(entries);

        return meets
          .map((meet) => {
            let hits2 = 0;
            let hits3 = 0;
            let n = 0;
            const races = meet.entries.map((e) => {
              const result = resultByRaceId.get(e.race_id);
              const rank = rankOf(result, e.boat_number);
              // 着順の付かなかった走（失格・転覆等）も、結果の出たレースなら1走に数える。
              // 機力指数・枠番別成績と同じ数え方にそろえる（BOA-549。以前は節の2連率
              // だけ分母から外していて、同じモーターの2連率が画面の中で食い違った）。
              // 公式のモーター2連率は選手責任外の失格（S0）・欠場を数えないが、2026年の
              // データにはそれを見分ける列が無い（実測では着順なしの走の約76%が公式でも
              // 出走に数えられていた）。公式の成績コードの取り込みは別チケット
              if (rank !== null) {
                n += 1;
                if (rank <= 2) hits2 += 1;
                if (rank <= 3) hits3 += 1;
              } else if (isUsableRaceResult(result)) {
                n += 1;
              }
              return { date: e.race_id.slice(0, 10), rank };
            });
            return {
              racerId: meet.racerId,
              playerName: meet.playerName,
              grade: meet.grade,
              firstDate: meet.firstDate,
              lastDate: meet.lastDate,
              races,
              sampleCount: n,
              rate2: n > 0 ? (hits2 / n) * 100 : null,
              rate3: n > 0 ? (hits3 / n) * 100 : null,
            };
          })
          .reverse();
      },
    );
  }
