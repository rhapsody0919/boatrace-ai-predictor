/**
 * オッズのライブ取得（BOA-487）: GET /api/odds/live?raceId=YYYY-MM-DD-VV-RR&page=tf|3t|3f|2tf|k
 *
 * オッズ一覧タブを開いたとき・「更新」を押したときに、公式のオッズページを1ページ取得して解析し、そのまま返す。
 * 締切 -90〜+10分（両端を含む）だけ公式へ取得する。範囲外は race_odds の最新行を返す。
 * 締切不明は従来どおり取得する。race_odds には書かない。
 *
 * - 受け付けるのは JST の当日のレースだけ。page は列挙値のみ、未知のクエリパラメータは 400（no-store）
 * - クエリの形は ?raceId=…&page=… の順・エンコードなしの1つだけ。違えば 400（BOA-1110、isCanonicalLiveOddsSearch）
 * - 成功: 200 { ok:true, raceId, page, fetchedAt, officialUpdatedAt, final, data }
 *   Cache-Control は s-maxage=30（締切時オッズ＝final なら300）。CDN に集約し、閲覧者数によらず公式への
 *   アクセスを1レース×1ページあたり最大30秒に1回に抑える
 * - 公式側の失敗（HTTP非200・タイムアウト・ブレーカー・未発売）: 200 { ok:false, reason, retryAfterSec }、s-maxage=10
 * - 取得は createPoliteFetch（再試行なし・12秒で打ち切り）。サーキットブレーカーは Cron と同じ DB ストア
 *   （scrape_job_state の host:boatrace.jp 行）を共有する。Cron が 429/503 でブレーカーを開けていれば、ここも取りに行かない
 *
 * 検証・解析・応答の組み立ては scripts/lib/liveOdds.js（verify-odds-live-api.js で検証）。
 *
 * リージョンは syd1（vercel.json）。ブレーカー状態を読む DB（Supabase、ap-southeast-2）への往復を、既定の iad1 の
 * 約250msから約30〜46msにする（BOA-573）。公式（boatrace.jp）の応答は入口（Akamai）で1リクエストごとに約8秒
 * 待たされ（server-timing: edge dur=8000、origin dur=17〜52）、リージョンでは変わらない
 */
import { handleLiveOddsRequest } from "../../scripts/lib/liveOdds.js";
import { createCircuitBreaker } from "../../scripts/lib/scrapeJobs/circuitBreaker.js";
import { createPoliteFetch } from "../../scripts/lib/scrapeJobs/politeFetch.js";
import { createSupabaseStore } from "../../scripts/lib/scrapeJobs/store.js";
import { createFetchCounter } from "../../scripts/lib/scrapeJobs/fetchCounter.js";
import { raceStartInstant } from "../../scripts/lib/scrapeJobs/time.js";
import { waitUntil } from "@vercel/functions";

export const config = {
  maxDuration: 30,
};

// 同じインスタンスへの連続した呼び出しで、ブレーカーのプロセス内の状態を共有する（DB の状態は TTL 付きで読む）
let politeFetchPromise = null;
function getPoliteFetch() {
  if (!politeFetchPromise) {
    politeFetchPromise = import("../../scripts/lib/supabaseClient.js").then(
      ({ supabase }) => {
        // Supabase が無い環境（ローカル等）は、プロセス内のブレーカーだけで動く
        const breaker = createCircuitBreaker({
          store: supabase
            ? createSupabaseStore(supabase).breakerStore
            : undefined,
        });
        // 公式へ取りに行った数を数え、20件か60秒ごとに足す（長く生きるインスタンス。BOA-1145 P3）
        const counter = createFetchCounter({
          client: supabase ?? null,
          source: "live",
        });
        // 利用者の要求の 429 は段階を上げない（Retry-After>10秒ならその時間開く。BOA-1145 #1983 の審査）
        const politeFetch = createPoliteFetch({
          breaker,
          maxRetries: 0,
          timeoutMs: 12000,
          countOverload: false,
          counter,
        });
        return { politeFetch, counter, ...createLiveOddsReaders(supabase) };
      },
    );
  }
  return politeFetchPromise;
}

/** DBの読み取りだけを注入する。最新行に要求ページの値が無ければ null。 */
export function createLiveOddsReaders(supabase) {
  return {
    async getDeadline(raceId) {
      if (!supabase) return null;
      const { data, error } = await supabase.from("races")
        .select("race_date, start_time").eq("race_id", raceId).maybeSingle();
      if (error) throw error;
      return data?.start_time ? raceStartInstant(data.race_date, data.start_time) : null;
    },
    async getLatestSnapshot(raceId, page) {
      if (!supabase) throw new Error("Supabase client not initialized");
      const { data: row, error } = await supabase.from("race_odds")
        .select("*").eq("race_id", raceId)
        .order("captured_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      if (!row) return null;
      const nonEmpty = (value) => value && Object.keys(value).length > 0;
      const data = {};
      const columns = {
        "3t": { trifectaAll: "trifecta_all" }, "3f": { trioAll: "trio_all" },
        "2tf": { exactaAll: "exacta_all", quinellaAll: "quinella_all" },
        k: { wideAll: "wide_all" },
      };
      if (page === "tf") {
        data.win = {}; data.place = {};
        for (let n = 1; n <= 6; n++) {
          const win = row[`odds_win_${n}`];
          const low = row[`odds_place_${n}_low`];
          const high = row[`odds_place_${n}_high`];
          if (win != null) data.win[n] = win;
          if (low != null && high != null) data.place[n] = { low, high };
        }
      } else {
        for (const [key, column] of Object.entries(columns[page])) {
          data[key] = row[column] ?? {};
        }
      }
      if (!Object.values(data).some(nonEmpty)) return null;
      // race_odds は発売中の窓。公式更新時刻と締切時の印は保存していない。
      return { fetchedAt: row.captured_at, officialUpdatedAt: null, final: false, data };
    },
  };
}

export default async function handler(req, res) {
  const { politeFetch, counter, getDeadline, getLatestSnapshot } = await getPoliteFetch();
  const { status, cacheControl, body } = await handleLiveOddsRequest({
    query: req.query ?? {},
    method: req.method,
    // 生のクエリの形も検査する（並び替え・エンコードでキャッシュを外させない。BOA-1110）
    rawSearch: new URL(req.url ?? "", "http://localhost").search,
    politeFetch,
    getDeadline,
    getLatestSnapshot,
  });
  res.setHeader("Cache-Control", cacheControl);
  const sent = res.status(status).json(body);
  // 数えの書き込みは応答の後に回す（利用者を待たせない。185 の審査 P3）。waitUntil が使えない環境（ローカル）はそのまま流す。
  // fetchCounter は投げない
  const pending = counter.maybeFlush();
  try {
    waitUntil(pending);
  } catch {
    void pending;
  }
  return sent;
}
