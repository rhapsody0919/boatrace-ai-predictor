/**
 * boatrace.jp 公式コンピュータ予想 (pcexpect) スクレイパ
 *
 * 各レースの予想フォーカス（2連単4点 + 3連単6点）と自信度（1〜5）を
 * external_predictions テーブルへ upsert する。
 *
 * 使い方:
 *   node scripts/daily/scrape-pcexpect.js                    # 当日全レース
 *   node scripts/daily/scrape-pcexpect.js --date 2026-01-08  # 指定日
 *   node scripts/daily/scrape-pcexpect.js --venue 24         # 会場絞り込み
 *   node scripts/daily/scrape-pcexpect.js --race 1           # レース番号絞り込み（要 --venue）
 *   node scripts/daily/scrape-pcexpect.js --dry              # DB 書き込みせず標準出力のみ
 *
 * 取得・解析・保存の本体は runForRaces（レース単位の入口。WS4b T4b-08-1）。CLI の main() も、Vercel Function
 * （api/cron/pcexpect.js。予定表のスロット）も、これを呼ぶ。import しても main() は走らない。
 */

import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import {
  supabase,
  isSupabaseEnabled,
  VENUE_NAMES,
} from "../lib/supabaseClient.js";
import { getTodayDateJST, parseDateArg } from "../lib/dateUtils.js";
import { getRaceSchedule } from "../lib/raceSchedule.js";
import { mapWithConcurrency } from "../lib/scrapeJobs/concurrency.js";
import { BreakerOpenError } from "../lib/scrapeJobs/circuitBreaker.js";

const SOURCE = "pcexpect_official";
const FETCH_INTERVAL_MS = 1000;
const USER_AGENT =
  "BoatraceAIBot/1.0 (+https://github.com/tinaba96/boatrace-ai-predictor)";
const FETCH_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
};

function parseArgs(argv = process.argv.slice(2)) {
  const args = { date: null, venue: null, race: null, dry: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--date") args.date = argv[++i];
    else if (a === "--venue") args.venue = parseInt(argv[++i], 10);
    else if (a === "--race") args.race = parseInt(argv[++i], 10);
    else if (a === "--dry") args.dry = true;
  }
  if (!args.date) args.date = parseDateArg() || getTodayDateJST();
  return args;
}

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

async function main() {
  const args = parseArgs();
  const date = args.date;

  console.log(`📅 pcexpect スクレイプ開始: ${date}`);
  if (args.dry) console.log("  🧪 DRY RUN (DB 書き込みスキップ)");

  // --venue + --race が両方指定されていれば Supabase を介さず単発実行
  let schedule;
  if (args.venue && args.race) {
    schedule = [
      { venue_code: args.venue, race_no: args.race, start_time: null },
    ];
  } else {
    schedule = await getRaceSchedule(date);
    if (schedule.length === 0) {
      console.warn(`  ⚠️ ${date} のスケジュールが空のため処理終了`);
      process.exit(0);
    }
    if (args.venue)
      schedule = schedule.filter((r) => r.venue_code === args.venue);
    if (args.race) schedule = schedule.filter((r) => r.race_no === args.race);
  }

  console.log(`  対象レース数: ${schedule.length}`);
  if (!args.dry && !isSupabaseEnabled()) {
    console.error("  ❌ Supabase 未設定。--dry でテスト可");
    process.exit(1);
  }

  let okCount = 0;
  let emptyCount = 0;
  let errCount = 0;

  // 従来どおり、1レースずつ逐次（1秒間隔）で処理する
  const results = await runForRaces(schedule, {
    date,
    mode: args.dry ? "shadow" : "live",
    intervalMs: FETCH_INTERVAL_MS,
  });
  results.forEach((result, i) => {
    const r = schedule[i];
    const label = `${VENUE_NAMES[r.venue_code] || r.venue_code}${r.race_no}R`;
    if (result.outcome === "ok") {
      okCount++;
      const { payload } = result;
      console.log(
        args.dry
          ? `  ✅ ${label}: ${JSON.stringify(payload)}`
          : `  ✅ ${label}: 2t=${payload.focus_2t.length}点 3t=${payload.focus_3t.length}点 lv=${payload.confidence}`,
      );
    } else if (result.outcome === "no_values") {
      emptyCount++;
      console.log(`  ⚪ ${label}: データなし`);
    } else {
      errCount++;
      console.error(`  ❌ ${label}: ${result.error}`);
    }
  });

  console.log(
    `\n📊 完了: 成功 ${okCount} / データなし ${emptyCount} / エラー ${errCount}`,
  );
}

// スタンドアローン実行時のみ実行する（import 時に実行させない。Vercel Function から import される）
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("❌ 致命的エラー:", err);
    process.exit(1);
  });
}
