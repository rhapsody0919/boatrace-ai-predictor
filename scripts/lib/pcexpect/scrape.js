/**
 * 公式サイトのコンピュータ予想（pcexpect）の取得・解析・external_predictions への upsert（runForRaces）。
 * scripts/daily/scrape-pcexpect.js から字のまま移した（CLI の入口は main を持ち、ここを再 export する。ハンドラー scrapeJobs/pcexpectHandlers.js はここを読む）
 */

import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { supabase } from "../supabaseClient.js";
import { mapWithConcurrency } from "../scrapeJobs/concurrency.js";
import { BreakerOpenError } from "../scrapeJobs/circuitBreaker.js";
import { DEFAULT_USER_AGENT } from "../scrapeJobs/politeFetch.js";

const SOURCE = "pcexpect_official";

const FETCH_HEADERS = {
  "User-Agent": DEFAULT_USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
};

export function buildUrl({ date, venueCode, raceNo }) {
  const hd = date.replace(/-/g, "");
  const jcd = String(venueCode).padStart(2, "0");
  return `https://www.boatrace.jp/owpc/pc/race/pcexpect?hd=${hd}&jcd=${jcd}&rno=${raceNo}`;
}

/** 既定の取得（GitHub Actions・CLI）。HTTP エラーは例外にする */
export async function fetchHtml(url) {
  const res = await fetch(url, { headers: FETCH_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

/**
 * pcexpect HTML から予想フォーカスと自信度を抽出
 * 構造（2026-01 時点）:
 *   .numberSet2_unit × 4
 *     .numberSet2_row 内に .numberSet2_number × 2 (2連単) または × 3 (3連単)
 *   .state2_lv.is-lvN (N = 1..5) で自信度
 *
 * 「データなし」ページでは .numberSet2 が存在しないため null を返す。
 */
export function parsePcexpect(html) {
  const $ = cheerio.load(html);
  const container = $(".numberSet2").first();
  if (container.length === 0) return null;

  const focus2t = [];
  const focus3t = [];

  container.find(".numberSet2_unit").each((_, unit) => {
    $(unit)
      .find(".numberSet2_row")
      .each((_, row) => {
        // 子ノードを順に走査して [number, sep, number, sep, ...] を組み立て
        // 数字ペアごとに "-" / "=" が異なる場合があるため (例: "2=5-1")
        const parts = [];
        $(row)
          .contents()
          .each((__, node) => {
            if (
              node.type === "tag" &&
              ($(node).hasClass("numberSet2_number") || $(node).find(".numberSet2_number").length)
            ) {
              const numText = $(node).text().trim();
              const n = parseInt(numText, 10);
              if (!Number.isNaN(n)) parts.push(String(n));
            } else if (node.type === "text") {
              const t = (node.data || "").replace(/\s+/g, "");
              if (t === "=" || t === "-") parts.push(t);
            }
          });

        const nums = parts.filter((p) => /^\d+$/.test(p));
        const seps = parts.filter((p) => p === "-" || p === "=");
        if (nums.length < 2) return;
        const pattern = parts.join("");

        if (nums.length === 2) focus2t.push({ pattern, seps });
        else if (nums.length === 3) focus3t.push({ pattern, seps });
      });
  });

  // 自信度: <p class="state2_lv is-lvN"></p>
  let confidence = null;
  const lvEl = $(".state2_lv").first();
  if (lvEl.length > 0) {
    const cls = lvEl.attr("class") || "";
    const m = cls.match(/is-lv(\d)/);
    if (m) confidence = parseInt(m[1], 10);
  }

  // 進入予想（画像のコーナーパターンファイル名のみ保持）
  let entryPredictionImage = null;
  const cornerImg = $(".boat1_corner img").first();
  if (cornerImg.length > 0) {
    entryPredictionImage = cornerImg.attr("src") || null;
  }

  // 何も取れなかった場合は null
  if (focus2t.length === 0 && focus3t.length === 0 && confidence === null) {
    return null;
  }

  return {
    focus_2t: focus2t,
    focus_3t: focus3t,
    confidence,
    entry_prediction_image: entryPredictionImage,
  };
}

/**
 * 解析した payload のダイジェスト（SHA-1の先頭16桁）。shadow が予定表の result_digest に記録し、
 * 既存基盤が external_predictions に書いた payload から同じ関数で計算した値と比べる
 * （scripts/maintenance/check-morning-init-shadow.js）。JSON のキーの並びは、解析側もDB（jsonb）側も
 * 保存順に依らないよう、キーを昇順に揃えてから計算する。
 */
export function computePcexpectDigest(payload) {
  const canonical = JSON.stringify(payload, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : value,
  );
  return createHash("sha1").update(canonical).digest("hex").slice(0, 16);
}

async function upsertPrediction(
  { date, venueCode, raceNo, payload, raceStartAt, scrapedAt = new Date() },
  client = supabase,
) {
  const row = {
    source: SOURCE,
    race_date: date,
    venue_code: venueCode,
    race_no: raceNo,
    payload,
    scraped_at: scrapedAt.toISOString(),
    race_start_at: raceStartAt ? raceStartAt.toISOString() : null,
  };
  const { error } = await client
    .from("external_predictions")
    .upsert(row, { onConflict: "source,race_date,venue_code,race_no" });
  if (error) throw new Error(`upsert: ${error.message}`);
}

/**
 * レース単位の入口。指定レースの公式コンピュータ予想を取得・解析し、live なら external_predictions へ upsert する。
 * 1つのレースの失敗で、他のレースを止めない。結果はレースごとの outcome（予定表のスロットの語彙）で返す。
 *
 *   ok            解析でき、（live なら）書き込んだ。resultDigest は payload のダイジェスト（shadow の比較用）
 *   no_values     ページに予想が無い（未公開の可能性）。再試行する
 *   breaker_open  サーキットブレーカーが開いていた（retryAt まで再試行を遅らせる）
 *   error         取得・書き込みの失敗
 *
 * @param {Array<{race_id?: string, venue_code: number, race_number?: number, race_no?: number, start_time?: Date|null}>} races
 *   start_time は external_predictions.race_start_at に保存する発走時刻（無ければ null）
 * @param {Object} options
 * @param {string} options.date 対象日（YYYY-MM-DD）
 * @param {"live"|"shadow"} [options.mode] shadow は取得・解析のみ（DBへは書かない）
 * @param {(url: string) => Promise<string>} [options.fetchHtml] 既定は fetch（Vercel は politeFetch を渡す）
 * @param {import("@supabase/supabase-js").SupabaseClient|null} [options.client]
 * @param {number} [options.concurrency]
 * @param {number} [options.intervalMs] 1レースの処理後に待つ時間（CLI の逐次取得のレート制限用）
 * @param {() => Date} [options.now]
 */
export async function runForRaces(
  races,
  {
    date,
    mode = "live",
    fetchHtml: fetchPage = fetchHtml,
    client = supabase,
    concurrency = 1,
    intervalMs = 0,
    now = () => new Date(),
  } = {},
) {
  if (mode !== "live" && mode !== "shadow") {
    throw new Error(`mode は live か shadow にしてください: ${mode}`);
  }
  if (!date) throw new Error("date（YYYY-MM-DD）が必要です");
  if (mode === "live" && !client) {
    throw new Error("Supabase が設定されていないため、公式予想を書き込めません");
  }
  const base = { rowsWritten: 0, rowsParsed: 0, rowsExpected: 1 };

  return mapWithConcurrency(races, concurrency, async (race) => {
    const raceNo = race.race_number ?? race.race_no;
    const raceId = race.race_id ?? `${date}-${race.venue_code}-${raceNo}`;
    try {
      const html = await fetchPage(
        buildUrl({ date, venueCode: race.venue_code, raceNo }),
      );
      const payload = parsePcexpect(html);
      if (!payload) {
        return {
          ...base,
          race_id: raceId,
          outcome: "no_values",
          error: "公式コンピュータ予想が見つかりません（未公開・データなしの可能性）",
        };
      }
      if (mode === "live") {
        await upsertPrediction(
          {
            date,
            venueCode: race.venue_code,
            raceNo,
            payload,
            raceStartAt: race.start_time ?? null,
            scrapedAt: now(),
          },
          client,
        );
      }
      return {
        ...base,
        race_id: raceId,
        outcome: "ok",
        rowsParsed: 1,
        rowsWritten: mode === "live" ? 1 : 0,
        resultDigest: computePcexpectDigest(payload),
        payload,
      };
    } catch (error) {
      if (error instanceof BreakerOpenError) {
        return {
          ...base,
          race_id: raceId,
          outcome: "breaker_open",
          retryAt: new Date(error.until),
          error: error.message,
        };
      }
      return {
        ...base,
        race_id: raceId,
        outcome: "error",
        error: error.message,
      };
    } finally {
      if (intervalMs > 0) {
        await new Promise((res) => setTimeout(res, intervalMs));
      }
    }
  });
}
