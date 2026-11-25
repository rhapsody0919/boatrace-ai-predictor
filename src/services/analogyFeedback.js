/**
 * 龍神ソナー（BOA-271）の「画面の中の声」を analogy_feedback に送る（docs/db-migration/143_analogy_feedback.sql）。
 * anon は INSERT しかできないので、返り値を求めない（return=minimal、.select() を付けない）。
 */
import { supabase } from "./supabaseClient";

/** 同じブラウザ・同じレース・同じ種類の2行目（UNIQUE 違反）は「もう受け取っている」として成功扱い */
const ALREADY_SAVED = "23505";

/**
 * @param {{kind: "vote"|"detail", race_id: string, verdict: "useful"|"lacking",
 *   reasons: string[]|null, comment: string|null, analogy_stage: string, analogy_tab: string,
 *   lang: string, client_key: string}} row
 */
export async function sendAnalogyFeedback(row) {
  if (!supabase) throw new Error("Supabase が未設定のため声を送れない");
  try {
    await supabase.from("analogy_feedback").insert(row);
  } catch (err) {
    if (err?.code === ALREADY_SAVED) return;
    throw err;
  }
}

/**
 * サイト全体のご意見ボックスの1件を site_feedback に送る（表: docs/db-migration/208_site_feedback.sql）。
 * anon は INSERT しかできないので、返り値を求めない（上と同じ）。重複の決まりは無く、
 * 失敗（表の CHECK・連投の制限・通信）は投げ、画面が「送れませんでした」を出す。
 *
 * @param {{kind: string|null, comment: string, rating: number|null, page_type: string,
 *   lang: string, client_key: string}} row src/pure/siteFeedback.js の buildSiteFeedbackRow の返り値
 */
export async function sendSiteFeedback(row) {
  if (!supabase) throw new Error("Supabase が未設定のためご意見を送れない");
  await supabase.from("site_feedback").insert(row);
}
