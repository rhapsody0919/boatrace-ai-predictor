/**
 * verify-gha-skip-gate.js の後半の場面（2/6）。verify ではない。
 * 判定と期待値は分ける前の verify-gha-skip-gate.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { ResultHttpError } from "../../daily/scrape-results.js";
import { FetchError } from "../../lib/scrapeJobs/politeFetch.js";
import { BreakerOpenError } from "../../lib/scrapeJobs/circuitBreaker.js";

let jst, minutesAgo, show, row, record, mod, decide, skipOf, NOW, healthy, V;

/** 元の verify の1つの塊 { } を割った 1/3 */
async function gsg2Scene1() {
  // 再現（P0）: 公式が 403・接続の失敗を返し続けて連続失敗が閾値を超え、その後 Vercel の起動も止まった。
  // ブレーカーは開いていない（403 は beforeinfo 以外のパスで数えない）。修正前は GitHub が素の fetch で肩代わりした
  const stale = minutesAgo(NOW, 30);
  const lastErrors = [
    "HTTP 403 for https://www.boatrace.jp/owpc/pc/race/odds3t?rno=1&jcd=01&hd=20260924",
    "取得に失敗しました（3回試行）: https://www.boatrace.jp/owpc/pc/race/odds3t — fetch failed",
    "HTTP 503 for https://www.boatrace.jp/owpc/pc/race/raceresult",
    "TypeError: fetch failed",
    "connect ETIMEDOUT 1.2.3.4:443",
    "サーキットブレーカーが開いています（host:boatrace.jp、2026-09-24T03:00:00.000Z まで）",
  ];
  const results = [];
  for (const lastError of lastErrors) {
    results.push(
      await decide(
        V,
        [
          healthy({
            last_tick_at: stale,
            consecutive_failures: 5,
            last_error: lastError,
          }),
        ],
        NOW,
      ),
    );
  }
  record(
    "オッズ（再現 P0）: 起動が古くても、直近の失敗が 403・503・接続の失敗・ブレーカー → スキップ（GitHub の IP から回り込まない）",
    results.every(
      (d) => d.skip === true && d.reason === "fetch_failure_no_takeover",
    ),
    show(results.map((d) => d.reason)),
  );
  const other = await decide(
    V,
    [
      healthy({
        last_tick_at: stale,
        consecutive_failures: 5,
        last_error: "races の読み取りに失敗しました: permission denied",
      }),
    ],
    NOW,
  );
  const cleared = await decide(
    V,
    [healthy({ last_tick_at: stale, last_error: null })],
    NOW,
  );
  record(
    "オッズ: 起動が古く、直近の失敗が取得先と関係ない（DB の権限等）・失敗なし → 実行（Vercel の停止の予備は残す）",
    other.skip === false &&
      other.reason === "tick_stale" &&
      cleared.skip === false &&
      cleared.reason === "tick_stale",
    show([other, cleared]),
  );
  // last_error の形を絞る: DB の失敗（store.js の wrap・スケジュールの読み取り）は取得先の失敗に数えない
  const dbErrors = [
    "スロットの取得(odds)に失敗しました: canceling statement due to statement timeout",
    "レーススケジュールの取得に失敗しました: timeout",
    "network error while reading races",
    "AbortError: The operation was aborted",
  ];
  return { stale, dbErrors };
}

/** 元の verify の1つの塊 { } を割った 2/3 */
async function gsg2Scene2({ stale, dbErrors }) {
  // 投げる側の実物の文字列（store.js の truncateError は message をそのまま入れる）
  const realErrors = [
    new ResultHttpError(
      "https://www.boatrace.jp/owpc/pc/race/raceresult",
      403,
    ).message,
    "HTTP 403", // race_info（update-race-info.js）・odds_final・point_rank・racerProfileSync の HTTP 503
    "point_rank: 取得できません: HTTP 403",
    "Kファイル取得失敗: HTTP 403 (https://www1.mbrace.or.jp/od2/K/x.lzh)",
    "カテゴリ一覧取得に失敗しました(403): https://www.boatrace.jp/owpc/pc/site/news/",
    "http_403",
    "HTTP 503",
    "HTTP 429 for https://www.boatrace.jp/x",
    new FetchError("https://www.boatrace.jp/x", 3, new Error("timeout"))
      .message,
    new BreakerOpenError(
      "host:boatrace.jp",
      Date.parse("2026-09-24T03:00:00Z"),
    ).message,
  ];
  record(
    "isFetchFailureError（再現 P1）: 各ジョブが投げる実物の形（ResultHttpError・HTTP 403・Kファイル・racer_news の (403)・http_403・HTTP 503・FetchError・BreakerOpenError）を拾う",
    realErrors.every((e) => mod.isFetchFailureError(e)),
    show(realErrors.filter((e) => !mod.isFetchFailureError(e))),
  );
  record(
    "isFetchFailureError: DB・スケジュールの失敗は取得先の失敗にしない（予備を止めない）。取得先の形だけを拾う",
    dbErrors.every((e) => !mod.isFetchFailureError(e)) &&
      mod.isFetchFailureError("HTTP 429 for https://www.boatrace.jp/x") &&
      !mod.isFetchFailureError(null),
    show(dbErrors.map((e) => mod.isFetchFailureError(e))),
  );
  // 古い失敗（その後も Vercel が起動し続けた）は、肩代わりを止める理由にしない
  const staleFailure = await decide(
    V,
    [
      healthy({
        last_tick_at: stale,
        updated_at: minutesAgo(NOW, 10 * 60),
        consecutive_failures: 1,
        last_error: "TypeError: fetch failed",
      }),
    ],
    NOW,
  );
  const recentFailure = await decide(
    V,
    [
      healthy({
        last_tick_at: stale,
        updated_at: minutesAgo(NOW, 31),
        consecutive_failures: 5,
        last_error: "TypeError: fetch failed",
      }),
    ],
    NOW,
  );
  const dayOld = await decide(
    V,
    [
      healthy({
        last_tick_at: minutesAgo(NOW, 25 * 60),
        updated_at: minutesAgo(NOW, 25 * 60),
        consecutive_failures: 5,
        last_error: "HTTP 403",
      }),
    ],
    NOW,
  );
  record(
    "オッズ: 24時間より前の失敗は数えない（前日の 403 で今日の予備を止めない）",
    dayOld.skip === false && dayOld.reason === "tick_stale",
    show(dayOld),
  );
  return { staleFailure, recentFailure };
}

/** 元の verify の1つの塊 { } を割った 3/3 */
async function gsg2Scene3({ staleFailure, recentFailure }) {
  record(
    "オッズ: 接続の失敗が最後の起動より5分超前（その後も起動が続いた）なら古い失敗として実行、最後の起動の頃の失敗ならスキップ",
    staleFailure.skip === false &&
      staleFailure.reason === "tick_stale" &&
      recentFailure.skip === true &&
      recentFailure.reason === "fetch_failure_no_takeover",
    show([staleFailure, recentFailure]),
  );
  // レースの無い時間帯: 最終成功が半日前・なしでも、起動が新しければ（Vercelは動いている）誤って実行しない
  const quiet1 = await skipOf(
    V,
    [healthy({ last_success_at: minutesAgo(NOW, 12 * 60) })],
    NOW,
  );
  const quiet2 = await skipOf(V, [healthy({ last_success_at: null })], NOW);
  record(
    "レースの無い時間帯（夜間・昼の谷間）: 最終成功が12時間前・記録なしでも、起動が新しければ（Vercelは動いている）、誤って実行しない（二重取得を避ける）",
    quiet1 === true && quiet2 === true,
    show({ quiet1, quiet2 }),
  );
  const N2 = jst("2026-09-24 07:31");
  const quiet4 = await skipOf(
    V,
    [
      row("odds", {
        last_tick_at: minutesAgo(N2, 3),
        last_success_at: minutesAgo(N2, 9 * 60),
      }),
    ],
    N2,
  );
  record(
    "朝の最初の窓（07:31）: 起動3分前・最終成功が前夜（9時間前）でも → スキップ",
    quiet4 === true,
  );
  // Vercel Cron の運用窓の外（起動が数時間前）で GitHub に処理があるときは、従来どおり実行する
  const off = await skipOf(
    V,
    [healthy({ last_tick_at: minutesAgo(NOW, 5 * 60) })],
    NOW,
  );
  record("運用窓の外（起動が5時間前）: 実行（現行どおり）", off === false);
  const dKfile = await decide(
    "SKIP_KFILE_ON_GHA",
    [row("kfile_sync", { last_target_date: "2026-09-24" })],
    NOW,
  );
  record(
    "kfile_sync: 対象日（07:00指定→当日）を処理済み → スキップ",
    dKfile.skip === true,
    show(dKfile),
  );
  const dKfile2 = await decide(
    "SKIP_KFILE_ON_GHA",
    [row("kfile_sync", { last_target_date: "2026-09-23" })],
    NOW,
  );
  record(
    "kfile_sync: 当日分が未処理（前日分のみ） → 実行",
    dKfile2.skip === false && dKfile2.reason === "target_pending",
    show(dKfile2),
  );
}

async function gsg2Scene4() {
  {
    const s1 = await gsg2Scene1();
    const s2 = await gsg2Scene2(s1);
    await gsg2Scene3(s2);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（jst・minutesAgo・show・row・record・mod・decide・skipOf・NOW・healthy・V） */
export async function runGhaSkipGateScenes3(env) {
  ({ jst, minutesAgo, show, row, record, mod, decide, skipOf, NOW, healthy, V } = env);
  await gsg2Scene4();
}
