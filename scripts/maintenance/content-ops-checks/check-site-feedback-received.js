/**
 * ご意見ボックスの新着の件数（セッション開始時チェックの siteFeedback）。窓口が朝夜のまとめに1行で出す
 * （2026-11-26 オーナー決定。本文は週1でオーナーが Supabase で読む。AI に本文を読ませない決定 2026-11-23）。
 *
 * 読むのは時ごとの受け付けた件数の表 site_feedback_hourly（209）の hour・received だけ。本文の表 site_feedback は読まない
 * （鍵は service_role で読めてしまうので、コードの決まりで守る。verify-site-feedback-received.js が表の名を照らす）。
 * 直近7日は最大168行で、1000行の上限の内。
 * 失敗は 0 件にせず error で返す（表が無い・鍵が無い・通信の失敗）。
 */
import { supabase } from "../../lib/supabaseClient.js";

const HOUR_MS = 60 * 60 * 1000;
const JST_MS = 9 * HOUR_MS;

/** UTC の時の始まり（timestamptz の文字列）を JST の「M/D H時」にする */
const jstHourLabel = (iso) => {
  const d = new Date(Date.parse(iso) + JST_MS);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${d.getUTCHours()}時`;
};

/**
 * 時ごとの件数から、直近24時間・7日の和と、最も多かった時間を出す（純関数）。直近24時間は、始まりが24時間前以降の時（今の時を含む）。
 * @param {Array<{hour: string, received: number}>} rows
 * @param {Date} now
 */
export function summarizeSiteFeedbackHourly(rows, now) {
  const since24 = now.getTime() - 24 * HOUR_MS;
  let last24h = 0;
  let last7d = 0;
  let busiest = null;
  for (const r of rows) {
    const n = Number(r.received) || 0;
    last7d += n;
    if (Date.parse(r.hour) >= since24) last24h += n;
    if (!busiest || n > busiest.received)
      busiest = { hourJst: jstHourLabel(r.hour), received: n };
  }
  return { last24h, last7d, busiest: busiest?.received ? busiest : null };
}

/**
 * @param {{client?: import("@supabase/supabase-js").SupabaseClient|null, now?: Date}} [opts]
 */
export async function checkSiteFeedbackReceived({
  client = supabase,
  now = new Date(),
} = {}) {
  if (!client)
    return {
      error:
        "Supabase の鍵が無いため、ご意見の件数を読めない（.env.local のある作業ツリーで回す）",
    };
  const since = new Date(now.getTime() - 7 * 24 * HOUR_MS).toISOString();
  try {
    const { data, error } = await client
      .from("site_feedback_hourly")
      .select("hour,received")
      .gte("hour", since)
      .order("hour");
    if (error) throw error;
    return summarizeSiteFeedbackHourly(data ?? [], now);
  } catch (error) {
    return {
      error: `ご意見の件数（site_feedback_hourly）を読めない: ${error.message ?? error}`,
    };
  }
}
