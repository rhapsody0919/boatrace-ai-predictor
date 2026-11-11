// src/services/supabaseDataService.js から scripts/maintenance/split-data-layer.mjs で字のまま移した（領域: prediction）。
// 本体の字下げは元のまま。手で直すときは普通の関数として直してよい

import { supabase } from "./supabaseClient";
import { withCache } from "./core.js";

/**
 * unifiedモデルのイン崩れ指数の実測精度（レベル別イン崩れ率）を取得する（BOA-177）
 * scripts/daily/calculate-unified-volatility-accuracy.js が日次で accuracy_cache に
 * 保存した集計値を読むだけ。既存のVolatilityAccuracySectionコンポーネントと
 * 同じshape（baseline/byLevel）で返す
 */
export function getUnifiedVolatilityAccuracy() {
    return withCache(
      "unified-volatility-accuracy",
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return null;
        }
        const { data } = await supabase
          .from("accuracy_cache")
          .select("data")
          .eq("key", "unified_volatility_accuracy")
          .single();

        return data?.data ?? null;
      },
      6 * 60 * 60 * 1000,
    );
  }

/**
 * イン崩れ注意度の段ごとの実績（BOA-822 task 24、plan §6）。夜の in_caution_bands.py が書く
 * accuracy_cache.in_caution_accuracy（prelaunch・postlaunch）。無ければ null、読み取りの失敗は投げる
 */
export function getInCautionAccuracy() {
    return withCache(
      "in-caution-accuracy",
      async () => {
        if (!supabase) throw new Error("Supabase client not initialized");
        // 失敗は supabaseClient の throwOnError で例外になる（.claude/rules/frontend-data-fetch.md 1）
        const { data } = await supabase
          .from("accuracy_cache")
          .select("data")
          .eq("key", "in_caution_accuracy")
          .maybeSingle();
        return data?.data ?? null;
      },
      6 * 60 * 60 * 1000,
    );
  }

/**
 * unifiedモデルの3連単参考情報（FR4）を1レース分取得する（AI予想モデル大規模改修 Task11）。
 * scripts/daily/generate-unified-trifecta-reference.js（発走前バッチ）が書き込む。
 * 発走前バッチ未実行の時間帯はnullを返す（呼び出し側で非表示にする）
 */
export async function getUnifiedTrifectaReference(raceId) {
    if (!supabase || !raceId) return null;
    const { data } = await supabase
      .from("bet_recommendations")
      .select(
        "recommendation, expected_value, expected_hit_rate, expected_payout, reasons",
      )
      .eq("model_id", "unified")
      .eq("race_id", raceId)
      .maybeSingle();

    if (!data) return null;

    return {
      recommendation: data.recommendation,
      expectedValue: data.expected_value,
      expectedHitRate: data.expected_hit_rate,
      expectedPayout: data.expected_payout,
      combo: data.reasons?.combo ?? null,
      odds: data.reasons?.odds ?? null,
    };
  }
