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
