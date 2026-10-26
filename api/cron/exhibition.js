/**
 * 展示データ取得（A2）の Vercel Cron（BOA案件: スクレイピング基盤のサーバーレス移行 Phase 1、
 * WS4b T4b-06-2、plan.md §3.6・§4.1）。
 *
 * scrape_job_state の mode（job='exhibition'）で動かすかを決める（scripts/lib/scrapeJobs/preRaceHandlers.js）:
 *
 *   スロットの経路（mode が shadow・live）: 予定表（scrape_slots）の `exhibition` スロット（発走33分前を期限に、7分前まで。
 *     公開されるまで120秒おきに再試行）を、共通ラッパ（politeFetch・DB のブレーカー）経由で消化する。
 *     Vercel Cron の起動は、処理の完了後に 200/500 を返す。
 *     cron-job.org の起動は、タイムアウト（30秒）に掛からないよう、バックグラウンド（waitUntil）で処理して 202 を即座に返す。
 *       shadow  取得・解析のみ（データへは書かない。予定表に result_digest）
 *       live    展示データ・気象を書き込む。予定表の展示タイム取得済みのスキップ（skipped_have_data）
 *   mode が off・行なし・読み取り失敗: 何もしない（200）。どこからも取らない。
 *     従来の経路（cron-job.org 起点の素の fetch。ブレーカーなし）は、守りを通らずに公式を叩く回り込みになるため消した
 *     （docs/design/scraping-load-budget/spec.md §0・§8 の P0）
 *
 * 切り替え・切り戻しは、DBの更新のみ（再デプロイ不要）。
 *
 * 予測の再計算（案1、BOA-353 T4b-03、plan.md §5）: REFRESH_ON_VERCEL=true のとき、展示・気象を実際に書き込んだレースに
 * ついてのみ、mainRefresh を呼ぶ（既定は off＝展示の取得のみ）。全スロットの完了後に1回。GitHub Actions 側のオッズ起点の再計算との併走の防止は、
 * scripts/lib/predictionRefresh.js を参照。再計算のモジュールは、有効なときだけ読み込む。
 *
 * cron式（vercel.json）はUTC。JSTに換算した起動時間帯:
 *   `* 22-23,0-14 * * *`  毎分、JST 07:00〜23:59
 *
 * 認証: Authorization: Bearer {CRON_SECRET}ヘッダーが一致しない限り拒否する。
 *
 * maxDuration はレジストリ（scripts/lib/scrapeJobs/registry.js の exhibition.maxDurationSec）と同じ値をリテラルで書く
 * （Vercel がビルド時に静的に読むため）。verify:scrape-pre-race-job が一致を検査する。
 */
import { createExhibitionCronHandler } from "../../scripts/lib/scrapeJobs/preRaceHandlers.js";

export const config = {
  maxDuration: 300,
};

export default createExhibitionCronHandler();
