/**
 * 展示データ取得（A2）の Vercel Cron（BOA案件: スクレイピング基盤のサーバーレス移行 Phase 1、
 * WS4b T4b-06-2、plan.md §3.6・§4.1）。
 *
 * 2つの経路を、scrape_job_state の mode（job='exhibition'）で切り替える（scripts/lib/scrapeJobs/preRaceHandlers.js）:
 *
 *   従来の経路（mode が off・行なし・読み取り失敗）: 既存の scripts/daily/scrape-exhibition-data.js の run(schedule, date) を
 *     そのまま呼ぶ（ロジックは複製しない。GitHub Actions版と同一の挙動）。cron-job.org から2分間隔で呼ばれる。
 *     cron-job.orgのタイムアウト（30秒）と実処理時間（30秒を超えうる）は別々の関心事のため、レスポンスを即座に
 *     返し（202）、実処理は waitUntil() でバックグラウンド継続する（2026-09-14決定）。本番の展示は、2026-09-16から
 *     この経路で動いており、scrape_job_state に exhibition の行は無い。**この経路の動作は、従来から変えていない。**
 *   スロットの経路（mode が shadow・live）: 予定表（scrape_slots）の `exhibition` スロット（発走33分前を期限に、7分前まで。
 *     公開されるまで120秒おきに再試行）を、共通ラッパ経由で消化する。現行の3窓（30/15/10分前）を1本に畳んだもの。
 *     処理の完了後に 200/500 を返す（waitUntil は使わない）。
 *       shadow  取得・解析のみ（データへは書かない。予定表に result_digest）。従来の経路も動き続けて、データを書く
 *       live    展示データ・気象を書き込む。従来の経路は動かさない。予定表の展示タイム取得済みのスキップ（skipped_have_data）
 *
 * 切り替え・切り戻しは、DBの更新のみ（再デプロイ不要）: mode を shadow → live にし、戻すときは off。
 * cron-job.org の停止は、live で1日以上安定して動くことを確認した後の、ユーザー作業（verification-runbook.md Q）。
 * vercel.json の Vercel Cron（毎分）は、live・shadow のときだけスロットの経路を動かす。off のときは、cron-job.org が
 * 従来の経路を動かしているため、何もしない（従来の経路を二重に動かさない）。
 *
 * 予測の再計算（案1、BOA-353 T4b-03、plan.md §5）: REFRESH_ON_VERCEL=true のとき、展示・気象を実際に書き込んだレースに
 * ついてのみ、mainRefresh を呼ぶ（既定は off＝従来どおり展示の取得のみ）。従来の経路は、取得の後に同じバックグラウンド
 * 処理の中で、スロットの経路は、全スロットの完了後に1回。GitHub Actions 側のオッズ起点の再計算との併走の防止は、
 * scripts/lib/predictionRefresh.js を参照。再計算のモジュールは、有効なときだけ読み込む。
 *
 * cron式（vercel.json）はUTC。JSTに換算した起動時間帯:
 *   `* 22-23,0-14 * * *`  毎分、JST 07:00〜23:59
 *
 * 認証: Authorization: Bearer {CRON_SECRET}ヘッダーが一致しない限り拒否する。
 *
 * maxDuration はレジストリ（scripts/lib/scrapeJobs/registry.js の exhibition.maxDurationSec）と同じ値をリテラルで書く
 * （Vercel がビルド時に静的に読むため）。verify:scrape-pre-race-job が一致を検査する。従来の経路の実処理（waitUntil）も
 * この枠の中で動く（従来から300秒）。
 */
import { createExhibitionCronHandler } from "../../scripts/lib/scrapeJobs/preRaceHandlers.js";

export const config = {
  maxDuration: 300,
};

export default createExhibitionCronHandler();
