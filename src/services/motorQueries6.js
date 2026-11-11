// src/services/supabaseDataService.js から scripts/maintenance/split-data-layer.mjs で字のまま移した（領域: motor）。
// 本体の字下げは元のまま。手で直すときは普通の関数として直してよい

import { supabase } from "./supabaseClient";
import { withCache } from "./core.js";
import {
  INTERPRETATION_WINDOW_DAYS,
  NEUTRAL_EXHIBITION_DIFF_SEC,
  beforeKey,
  fetchMotorDailySeries,
  includeKey,
  toMaintenanceResult,
} from "./motorQueries.js";

/**
 * 指定モーターのプロペラ交換・部品交換の履歴を取得する（BOA-221）
 * 単独では「機力低下のサイン」にも「整備直後の好転サイン」にもなり得るため
 * （チケット参照）、イベント前後の展示タイム平均を比較し、方向感の目安
 * （improved/declined/neutral）を自動判定して添える。展示タイムは日次の
 * 実測値で、motor_2rate（公式サイトの「モーター交換時からの累積」値）と違い
 * イベント前後で単純比較できるため、この目的にはこちらを使う
 */
export function getMotorPartsHistory(
    venueCode,
    motorNumber,
    days = 90,
    beforeRaceId = null,
    { includeTarget = false } = {},
  ) {
    return withCache(
      // v2: 期間を現行モーターの世代で切り詰める（BOA-329）
      // v3: 交換が記録されたレース番号（raceNos）を追加（BOA-513）
      `motor-parts-history-v3-${venueCode}-${motorNumber}-${days}${includeKey(beforeRaceId, includeTarget)}${beforeKey(beforeRaceId)}`,
      async () => {
        const { series: dateSeries } = await fetchMotorDailySeries(
          venueCode,
          motorNumber,
          days,
          beforeRaceId,
          { includeTarget },
        );

        const avgOf = (list) => {
          const values = list
            .map((d) => d.exhibitionTime)
            .filter((v) => v !== null);
          return values.length > 0
            ? values.reduce((sum, v) => sum + v, 0) / values.length
            : null;
        };

        const events = [];
        dateSeries.forEach((d, i) => {
          if (!d.propellerChanged && !(d.parts && d.parts.length > 0)) return;

          const before = avgOf(
            dateSeries.slice(Math.max(0, i - INTERPRETATION_WINDOW_DAYS), i),
          );
          const after = avgOf(
            dateSeries.slice(i + 1, i + 1 + INTERPRETATION_WINDOW_DAYS),
          );
          let interpretation = null;
          if (before !== null && after !== null) {
            // 展示タイムは速いほど良い（小さいほど良い）ため、after<beforeは好転
            const diff = before - after;
            if (Math.abs(diff) >= NEUTRAL_EXHIBITION_DIFF_SEC) {
              interpretation = diff > 0 ? "improved" : "declined";
            } else {
              interpretation = "neutral";
            }
          }
          events.push({
            date: d.date,
            raceNos: d.eventRaceNos ?? [],
            propellerChanged: d.propellerChanged,
            parts: d.parts,
            interpretation,
          });
        });

        return {
          venue_code: venueCode,
          motor_number: motorNumber,
          events,
        };
      },
    );
  }

/**
 * 指定レースのチルト・調整重量・当日体重・前走成績・部品交換/プロペラ交換を
 * 取得する（BOA-221/BOA-289/BOA-304）。展示タイムと同じ行(exhibition_data)の
 * 別列で、履歴平均を出す必要が無い「今回のレースでの設定値・直近の実績値」の
 * ため、getRaceExhibitionTimeBreakdownのような過去90日平均フォールバックは
 * 不要。単純に該当race_idの1回読み取りで足りる
 *
 * propeller_change/parts_changedはtilt/adjustment_weightと同じマイグレーション
 * 056（BOA-221、既に全環境適用済み）の列のため、フォールバック対象には含めない。
 * BOA-289の新列（today_weight/prev_race_no/prev_entry_course/prev_start_timing/
 * prev_finish_rank、マイグレーション059）は未適用環境がありうる。1回のselectに
 * 未適用の列を含めると「column does not exist」でクエリ全体が失敗し、既に動作している
 * tilt/adjustment_weight/propeller_change/parts_changed（マイグレーション056）まで
 * 巻き添えで表示できなくなる。これを避けるため、失敗時は新列を除いた旧列のみで再取得する
 */
export function getRaceMotorMaintenanceBreakdown(raceId) {
    // v3: 戻り値を配列から { state, rows } に変えた（BOA-497）。v2 は展示進入等の列を
    // 足したとき（BOA-485）。キーを変えないと localStorage に残った旧形（配列）が返る
    // v4: prev_finish_mark（前走の着順が無いときの公式の記号）を足した（BOA-569）
    return withCache(`race-motor-maintenance-v4-${raceId}`, async () => {
      if (!supabase) {
        throw new Error("Supabase client not initialized");
      }

      // supabaseClient.js が .throwOnError() を既定で適用するため、取得エラーは例外になる。
      // 「新列が未適用」だけは旧列での再取得に倒したいので、ここで捕まえて分岐する
      // （それ以外のエラーはそのまま投げて、空配列＝「データなし」に化けさせない）
      let data;
      try {
        ({ data } = await supabase
          .from("exhibition_data")
          .select(
            // exhibition_course/is_absent/updated_at は直前情報タブの「展示進入」用
            // （BOA-485）。同じ行の別列なので、クエリ本数は増やさない（BOA-357）。
            // exhibition_time はキャッシュしてよいか（展示後か）の判定用（BOA-497）
            "boat_number, exhibition_time, tilt, adjustment_weight, propeller_change, parts_changed, today_weight, prev_race_no, prev_entry_course, prev_start_timing, prev_finish_rank, prev_finish_mark, exhibition_course, is_absent, updated_at",
          )
          .eq("race_id", raceId));
      } catch (error) {
        if (!/column .* does not exist/i.test(error?.message ?? ""))
          throw error;
        console.warn(
          "exhibition_data: BOA-289の新列が未適用のため旧列のみで再取得します（マイグレーション059未適用の可能性）:",
          error.message,
        );
        const { data: legacyData } = await supabase
          .from("exhibition_data")
          .select(
            "boat_number, exhibition_time, tilt, adjustment_weight, propeller_change, parts_changed",
          )
          .eq("race_id", raceId);
        return toMaintenanceResult(legacyData ?? []);
      }

      return toMaintenanceResult(data ?? []);
    });
  }
