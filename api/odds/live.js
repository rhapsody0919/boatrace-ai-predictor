/**
 * オッズのライブ取得（BOA-487）: GET /api/odds/live?raceId=YYYY-MM-DD-VV-RR&page=tf|3t|3f|2tf|k
 *
 * オッズ一覧タブを開いたとき・「更新」を押したときに、公式のオッズページを1ページ取得して解析し、そのまま返す。
 * race_odds には書かない（スナップショットの窓・prediction_odds の導出と混ぜない）。
 *
 * - 受け付けるのは JST の当日のレースだけ。page は列挙値のみ、未知のクエリパラメータは 400（no-store）
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
        return createPoliteFetch({ breaker, maxRetries: 0, timeoutMs: 12000 });
      },
    );
  }
  return politeFetchPromise;
}

export default async function handler(req, res) {
  const { status, cacheControl, body } = await handleLiveOddsRequest({
    query: req.query ?? {},
    method: req.method,
    politeFetch: await getPoliteFetch(),
  });
  res.setHeader("Cache-Control", cacheControl);
  return res.status(status).json(body);
}
