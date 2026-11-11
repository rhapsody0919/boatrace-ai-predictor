// src/services/supabaseDataService.js から scripts/maintenance/split-data-layer.mjs で字のまま移した（領域: meet）。
// 本体の字下げは元のまま。手で直すときは普通の関数として直してよい

import { supabase } from "./supabaseClient";
import {
  groupIntoCurrentMeet,
  groupIntoMeetBeforeRace,
} from "../utils/meetGrouping";
import { isRaceCancelled } from "../utils/raceCancellation.js";
import { fetchAllByIn, isPermissionDeniedError, withCache } from "./core.js";

/**
 * 今期のF（`f_count`）のうち1本を**今節**で切った艇番を返す（BOA-440）。
 *
 * 出走表の「F1」だけでは、半年前のFか今節のFか分からない。今節のFは
 * 当日のスタート勘に直結するため、Fバッジに「今節」の印を付ける材料にする。
 *
 * - 対象は `f_count >= 1` の艇だけ。F0の艇にはバッジ自体が無い
 * - 見るのは**前日まで**の走。`f_count` は朝の出走表の値で、同じ日の前のレースで
 *   切ったFは含まない（実測: Fの翌日の出走表では15件中15件で1本増えていた）。
 *   同じ日のFを拾うと「F1 今節」の1本が別のFを指してしまう
 * - 節の範囲は `groupIntoCurrentMeet` を**選手＋会場**で絞って推定する
 *   （`basicInfoStats.buildMeetResults` と同じ絞り方。meetGrouping.js の前提）
 *
 * @returns {Promise<number[]>} 今節にFがある艇番
 */
export function getCurrentMeetFlyingBoats(raceId) {
    return withCache(`race-current-meet-flying-${raceId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }
      const date = raceId.slice(0, 10);
      const venue = raceId.slice(11, 13);

      const { data: entries } = await supabase
        .from("race_entries")
        .select("boat_number, racer_id, f_count")
        .eq("race_id", raceId);
      const targets = (entries ?? []).filter(
        (e) => e.racer_id != null && (e.f_count ?? 0) >= 1,
      );
      if (targets.length === 0) return [];

      // 節は長くて7日。前後の空き（2日）を見分けるのに足りる幅を取る
      const from = new Date(`${date}T00:00:00Z`);
      from.setUTCDate(from.getUTCDate() - 14);
      const { data: past } = await supabase
        .from("race_entries")
        .select("race_id, racer_id, boat_number")
        .in(
          "racer_id",
          targets.map((e) => e.racer_id),
        )
        .gte("race_id", from.toISOString().slice(0, 10))
        .lt("race_id", raceId);

      const meetRunsByRacer = new Map(
        targets.map((e) => {
          const upto = (past ?? [])
            .filter(
              (r) =>
                r.racer_id === e.racer_id && r.race_id.slice(11, 13) === venue,
            )
            .sort((a, b) => a.race_id.localeCompare(b.race_id));
          const meet = groupIntoCurrentMeet([
            ...upto,
            { race_id: raceId, anchor: true },
          ]).filter((r) => !r.anchor && r.race_id.slice(0, 10) < date);
          return [e.racer_id, meet];
        }),
      );
      const meetRaceIds = [
        ...new Set([...meetRunsByRacer.values()].flat().map((r) => r.race_id)),
      ];
      if (meetRaceIds.length === 0) return [];

      const { data: flying } = await supabase
        .from("race_start_timings")
        .select("race_id, boat_number")
        .in("race_id", meetRaceIds)
        .eq("is_flying", true);
      const flew = new Set(
        (flying ?? []).map((r) => `${r.race_id}#${r.boat_number}`),
      );

      return targets
        .filter((e) =>
          meetRunsByRacer
            .get(e.racer_id)
            .some((r) => flew.has(`${r.race_id}#${r.boat_number}`)),
        )
        .map((e) => e.boat_number)
        .sort((a, b) => a - b);
    });
  }

/**
 * 各艇の**今節の前走**（同じ会場・同じ節で、表示中のレースより前の最後の走）を返す
 * （BOA-610、データ出走表の「今節の前走」行）。
 *
 * 以前この行は exhibition_data.prev_*（公式の直前情報の前走）を出していたが、
 * それは「同じ日の前の走」で、前日までの走が入らない。節の2日目以降でも、
 * その日の1走目は空になる（2026-09-30 児島7R の西村拓也は 9/29 10R を走っているのに空）。
 * 節の切り方は `groupIntoMeetBeforeRace`（今節タブ・今節展示情報と同じ。選手＋会場＋目印）。
 *
 * 戻り値は艇ごとに1行:
 *   { boat_number, firstOfMeet: true }                       今節の走がまだ無い
 *   { boat_number, raceId, boatNumber, result, finishMark }  前走（result は race_results の1行か null）
 * 中止になったレース（`isRaceCancelled`）は走っていないので飛ばす。
 * 前走の結果がまだ無い行があるとき（同じ日の直前のレースが確定前）は `fetchFailed: true` を
 * 付けて withCache に焼き付けない（frontend-data-fetch.md §4）
 *
 * @returns {Promise<{rows: Array<Object>, fetchFailed?: boolean}>}
 */
export function getRaceMeetPrevRuns(raceId) {
    return withCache(`race-meet-prev-runs-v2-${raceId}`, async () => {
      if (!supabase) {
        throw new Error("Supabase client not initialized");
      }
      const date = raceId.slice(0, 10);
      const venue = raceId.slice(11, 13);

      const { data: entries } = await supabase
        .from("race_entries")
        .select("boat_number, racer_id")
        .eq("race_id", raceId);
      const targets = (entries ?? []).filter((e) => e.racer_id != null);
      if (targets.length === 0) return { rows: [] };

      // 節は長くて7日。前後の空き（2日）を見分けるのに足りる幅を取る
      // （getCurrentMeetFlyingBoats と同じ）。6選手×14日なら1000行に届かない
      const from = new Date(`${date}T00:00:00Z`);
      from.setUTCDate(from.getUTCDate() - 14);
      const { data: past } = await supabase
        .from("race_entries")
        .select("race_id, racer_id, boat_number")
        .in(
          "racer_id",
          targets.map((e) => e.racer_id),
        )
        // `%-VV-%` だと月の部分（-09-）にも当たるので桁で位置を固定する
        .like("race_id", `__________-${venue}-__`)
        .gte("race_id", from.toISOString().slice(0, 10))
        .lt("race_id", raceId);

      const meetByBoat = new Map(
        targets.map((e) => [
          e.boat_number,
          groupIntoMeetBeforeRace(
            (past ?? []).filter((r) => r.racer_id === e.racer_id),
            raceId,
          ),
        ]),
      );
      const meetRaceIds = [
        ...new Set([...meetByBoat.values()].flat().map((r) => r.race_id)),
      ];
      if (meetRaceIds.length === 0) {
        return {
          rows: targets.map((e) => ({
            boat_number: e.boat_number,
            firstOfMeet: true,
          })),
        };
      }

      // 中止になったレースにも出走表の行は残る（結果の行は無い）。節の走を全部引いて、
      // 中止を飛ばした最後の走を前走にする（中止を拾うと結果が来ないまま「—」が残る）
      const [{ data: results }, { data: timings }, { data: races }] =
        await Promise.all([
          supabase
            .from("race_results")
            .select(
              "race_id, rank1, rank2, rank3, rank4, rank5, rank6, actual_course_1, actual_course_2, actual_course_3, actual_course_4, actual_course_5, actual_course_6",
            )
            .in("race_id", meetRaceIds),
          supabase
            .from("race_start_timings")
            .select("race_id, boat_number, finish_mark, entry_course")
            .in("race_id", meetRaceIds),
          supabase
            .from("races")
            .select("race_id, cancellation_status")
            .in("race_id", meetRaceIds),
        ]);
      const resultById = new Map((results ?? []).map((r) => [r.race_id, r]));
      const statusById = new Map(
        (races ?? []).map((r) => [r.race_id, r.cancellation_status]),
      );
      const timingByKey = new Map(
        (timings ?? []).map((r) => [`${r.race_id}#${r.boat_number}`, r]),
      );

      const rows = targets.map((e) => {
        const prev = meetByBoat.get(e.boat_number).findLast(
          (r) =>
            !isRaceCancelled({
              cancellationStatus: statusById.get(r.race_id) ?? null,
              result: resultById.get(r.race_id) ?? null,
            }),
        );
        if (!prev) return { boat_number: e.boat_number, firstOfMeet: true };
        return {
          boat_number: e.boat_number,
          raceId: prev.race_id,
          boatNumber: prev.boat_number,
          result: resultById.get(prev.race_id) ?? null,
          finishMark:
            timingByKey.get(`${prev.race_id}#${prev.boat_number}`)
              ?.finish_mark ?? null,
          entryCourse:
            timingByKey.get(`${prev.race_id}#${prev.boat_number}`)
              ?.entry_course ?? null,
        };
      });
      const pending = rows.some((r) => !r.firstOfMeet && !r.result);
      return pending ? { rows, fetchFailed: true } : { rows };
    });
  }

/**
 * 指定選手の「今節（表示中のレースと同じ会場・同じ節で、同じモーターに乗った
 * 当該レースより前の走）」の展示タイム推移を取得する（BOA-304、直前情報タブ
 * 「今節展示情報」）。節の切り方は `groupIntoMeetBeforeRace`（今節タブの
 * basicInfoStats.buildMeetResults と同じ）。節の初戦なら空配列を返す
 * `boatNumber` も返す（追加クエリ0本）。オリジナル展示（BOA-473）は
 * `(race_id, boat_number)` で引くため、呼び出し側がこの2つを組にして使う。
 * @returns {Promise<Array<{raceId: string, boatNumber: number, exhibitionTime: number|null}>>} 昇順（古い→新しい）
 */
export function getRacerMeetExhibitionTrendBefore(racerId, motorNumber, beforeRaceId) {
    return withCache(
      // v2: BOA-591 で別会場・前の節の値を返さないようにした。過去レースは7日TTLで
      // localStorage に残るため、旧キーの誤った値を読まないようにキーを変える
      `racer-meet-exhibition-trend-v2-${racerId}-${motorNumber}-${beforeRaceId}`,
      async () => {
        if (!supabase || !racerId || !motorNumber || !beforeRaceId) return [];

        const { data: entries } = await supabase
          .from("race_entries")
          .select("race_id, boat_number")
          .eq("racer_id", racerId)
          .eq("motor_number", motorNumber)
          .lt("race_id", beforeRaceId)
          .order("race_id", { ascending: false })
          .limit(30);

        if (!entries || entries.length === 0) return [];

        // **会場で絞り、表示中のレースを目印に足してから切る**（BOA-591）。
        // モーター番号は会場ごとに振られるので、番号だけで引くと別会場の同じ番号の
        // モーターの節が混ざる。目印が無いと、節の初戦で何ヶ月も前の節を今節として拾う
        const meet = groupIntoMeetBeforeRace(entries, beforeRaceId);
        if (meet.length === 0) return [];
        const raceIds = meet.map((e) => e.race_id);

        const exhibitionRows = await fetchAllByIn(
          "exhibition_data",
          "race_id, boat_number, exhibition_time",
          "race_id",
          raceIds,
        );
        const exhibitionByKey = new Map(
          exhibitionRows.map((r) => [
            `${r.race_id}-${r.boat_number}`,
            r.exhibition_time,
          ]),
        );

        return meet.map((e) => ({
          raceId: e.race_id,
          boatNumber: e.boat_number,
          exhibitionTime:
            exhibitionByKey.get(`${e.race_id}-${e.boat_number}`) ?? null,
        }));
      },
    );
  }

/**
 * 今節のオリジナル展示（一周・半周ラップ・まわり足・直線）を、**レースIDの集合に対して
 * 1クエリ**で引く（[BOA-473](https://linear.app/boat-ai/issue/BOA-473) / phase a FR-4b の続き）。
 *
 * ## なぜ選手ごとではなく集合で引くか
 *
 * 直前情報タブの「今節展示情報」は選手ごとに
 * `getRacerMeetExhibitionTrendBefore` を呼ぶ（6選手 × 2クエリ）。同じ形で
 * オリジナル展示も選手ごとに引くと **+6本**になり、非機能要件（1タブあたり+3本以内）を
 * 超える。6選手の今節はほぼ同じレース集合なので、**IDを束ねて1本**にする。
 *
 * ## なぜ「今節展示情報」に出すのか
 *
 * 直前情報タブの「展示情報」に出しているオリジナル展示（BOA-452）は、**そのレースの
 * 展示が発表されてからしか出ない**（発走30〜10分前）。それまでの間、機力の内訳は
 * 画面に何も無い。ボートレース日和は同じ画面に「今節展示情報」として前走と節平均を
 * 併記していて、**締切前に読めるのはこちらだけ**。
 *
 * 戻り値の `state` は `getRaceOriginalExhibition` と同じ規約:
 *   "published" 値がある / "empty" まだ無い / "forbidden" 匿名に権限が無い（096未適用）
 * 終端でない状態には `fetchFailed: true` を付けて `withCache` に焼き付けない。
 *
 * @param {string[]} raceIds 今節のレースID（表示中のレースより前）
 * @returns {Promise<{state: string, byKey: Object<string, Object<string, number>>}>}
 *   `byKey` のキーは `` `${raceId}-${boatNumber}` ``、値は `{ 一周: 36.9, ... }`
 */
export function getMeetOriginalExhibitionByRaceBoat(raceIds) {
    const ids = [...new Set(raceIds ?? [])].filter(Boolean).sort();
    if (ids.length === 0) {
      return Promise.resolve({ state: "empty", byKey: {}, fetchFailed: true });
    }
    // **IDを全部キーに入れる**。件数＋最後のIDだけだと、同じ節・同じ最終レースで
    // 中身の違う集合（選手の顔ぶれが変わって別のレースが混ざる等）が同じキーに
    // なりうる。全部繋ぐと末尾が `YYYY-MM-DD-VV-RR` のままなので、
    // inferTtlFromKey の過去レース判定（7日TTL）もそのまま効く
    return withCache(`meet-original-exhibition-${ids.join(",")}`, async () => {
      if (!supabase) {
        throw new Error("Supabase client not initialized");
      }
      let rows;
      try {
        rows = await fetchAllByIn(
          "race_original_exhibition_values",
          "race_id, boat_number, kind, value",
          "race_id",
          ids,
        );
      } catch (error) {
        if (isPermissionDeniedError(error)) {
          // 096（匿名へのSELECT公開）が未適用なら行ごと出さない
          return { state: "forbidden", byKey: {}, fetchFailed: true };
        }
        throw error;
      }

      const byKey = {};
      (rows ?? []).forEach((row) => {
        // 欠測（BOATCASTの `--.--`）は NULL で入る。平均の分母に入れない
        if (row.value === null || row.value === undefined) return;
        const key = `${row.race_id}-${row.boat_number}`;
        byKey[key] = { ...(byKey[key] ?? {}), [row.kind]: Number(row.value) };
      });

      if (Object.keys(byKey).length === 0) {
        return { state: "empty", byKey: {}, fetchFailed: true };
      }
      return { state: "published", byKey };
    });
  }
