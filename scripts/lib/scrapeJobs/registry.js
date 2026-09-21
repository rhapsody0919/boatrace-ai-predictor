/**
 * ジョブレジストリ: 窓・許容幅・再試行・リース・並列度・実行時間の定義（plan.md §3.6・§4.3・§4.4）。
 *
 * 値は初期案で、各データセットの移行（WS4b）の実測で調整する。ジョブ名は scrape_slots.job・
 * scrape_job_state.job と同じ（DBにCHECK制約は付けず、ここで管理する）。
 *
 * kind:
 *   window     予定表（scrape_slots）のスロットを、期限が来たものだけ消化する（展示・オッズ・結果・レース情報・公式予想）
 *   daily      1日1回（＋補足の起動）。対象日を「指定時刻」から解決し、last_target_date で冪等にする
 *   continuous 窓なしの連続実行（A4・A5・チャンク処理）。ジョブ単位のリースで排他する
 *   monitor    監視・保守（モードのゲートなし。scrape_job_state に実行を記録する）
 *
 * 窓型の slotSecEstimate（1スロットの処理時間の見積り、秒）: boatrace.jp のページの応答が、リージョン・UA・
 * 実行元によらず1件あたり約8〜10秒かかる（2026-09-20の実測: syd1・hnd1のVercel、ローカルとも8.1〜10.3秒、
 * 全て成功。docs/design/scraping-vercel-consolidation/plan.md §8）。1スロットが1レース分のページを並列に取る
 * 前提で、最悪12秒（実測の最大10.3秒+余裕）とする。claimLimit/concurrency の切り上げ × slotSecEstimate が、
 * リースより十分短くなければ、後ろのスロットの処理中にリースが切れ、別の実行が同じスロットを取ってしまう
 * （二重取得）。validateRegistry がこの関係を検査する。
 */

/** ホスト単位のサーキットブレーカーの scrape_job_state.job の接頭辞（例: host:boatrace.jp） */
export const HOST_JOB_PREFIX = "host:";

/** 関数の maxDuration からこの秒数を引いた時点で、新しいスロットに着手しない */
export const SOFT_DEADLINE_MARGIN_SEC = 30;

export const SCRAPE_JOBS = Object.freeze({
  // A1 レース情報更新。発走60分前の1本。出走表（racelist）だけを取る（beforeinfo は展示 A2 が全項目を取る。D2の解消）
  // 実装: scripts/lib/scrapeJobs/preRaceHandlers.js、api/cron/race-info.js（T4b-09）。maxDurationSec は、全スロットの
  // 完了後に予測の再計算（案1。約8〜10秒）を1回呼ぶ余裕を含めて180秒（スロットの処理は、ソフトデッドライン150秒まで）
  race_info: {
    kind: "window",
    offsets: [-60],
    graceMin: 3,
    retrySec: 60,
    leaseSec: 90,
    claimLimit: 24,
    concurrency: 4,
    slotSecEstimate: 12,
    maxDurationSec: 180,
    hosts: ["boatrace.jp"],
  },
  // A2 展示。現行の3窓（30/15/10分前）を1本（-33〜-7分）に畳む案（要判断eで承認済み。悪化したらoffsetsを戻す）。
  // 公開時刻の実測（2026-09-20・21の202レース、WS2の created_at と発走時刻の差）: 最初に取得できた時点は、発走の
  // 30.6〜8.6分前（中央値16.2分前、95%が17.6分前以内）。従来の窓（27〜33・12〜18・7〜13分前）の外側は見ていないが、
  // 全レースが7分前までに取得できた。-33〜-7分はこの範囲を覆う（verification-runbook.md Q-0）
  // 実装: scripts/lib/scrapeJobs/preRaceHandlers.js、api/cron/exhibition.js（T4b-06）。maxDurationSec は、従来の経路
  // （mode が off のとき。waitUntil の実処理）が従来から300秒で動いているため300秒のまま
  exhibition: {
    kind: "window",
    offsets: [-33],
    graceMin: 26,
    retrySec: 120,
    leaseSec: 90,
    claimLimit: 24,
    concurrency: 4,
    slotSecEstimate: 12,
    maxDurationSec: 300,
    hosts: ["boatrace.jp"],
  },
  // A3 オッズ。6窓×5ページ。許容幅3分のため、リースは許容幅より短く（120秒）
  // 実装: scripts/lib/scrapeJobs/oddsHandlers.js、api/cron/odds.js（T4b-04）。1スロット＝1レース×1窓（5ページを並列）
  odds: {
    kind: "window",
    offsets: [-60, -30, -15, -10, -5, 0],
    graceMin: 3,
    retrySec: 60,
    leaseSec: 120,
    claimLimit: 24,
    concurrency: 4,
    slotSecEstimate: 12,
    maxDurationSec: 300,
    hosts: ["boatrace.jp"],
  },
  // A6 結果取得。発走5分後から90分後まで、5分おきに再試行
  result: {
    kind: "window",
    offsets: [5],
    graceMin: 85,
    retrySec: 300,
    leaseSec: 180,
    claimLimit: 40,
    concurrency: 4,
    slotSecEstimate: 12,
    maxDurationSec: 300,
    hosts: ["boatrace.jp"],
  },
  // B1 公式コンピュータ予想。朝（-720分）から発走30分前まで。1レース約10.6秒（GitHub Actionsの実測）のため、
  // 20件×3並列で約75秒。公式予想は静的（2026-09-21の実測: 8.5時間後の再取得が朝の値と一致）で、朝1回の取得で足りる。
  // 実装: scripts/lib/scrapeJobs/pcexpectHandlers.js、api/cron/pcexpect.js（T4b-08）
  pcexpect: {
    kind: "window",
    offsets: [-720],
    graceMin: 690,
    retrySec: 600,
    leaseSec: 300,
    claimLimit: 20,
    concurrency: 3,
    slotSecEstimate: 12,
    maxDurationSec: 300,
    hosts: ["boatrace.jp"],
  },

  // N24 ピットレポート（選手コメント。BOA-379）。対象はSG（全レース）・G1・G2（7R以降）のみ（予定表のスロットも
  // 対象レースにだけ作る: scripts/lib/pitReportJob.js の createPitReportStore）。発走60分前から発走+180分まで、
  // 公開まで5分おきに再試行する（公開時刻の実測は docs/design/pit-comments/spec.md §2。過去日のページも長期間取れるため、
  // 窓を過ぎた取りこぼしは、バックフィルの手動CLIで補える）。1日の取得は、対象レース約7件＋未公開の間の再試行のみ
  // （G3・一般戦のページは取得しない）。実装: scripts/lib/pitReportJob.js、api/cron/pit-reports.js
  pit_reports: {
    kind: "window",
    offsets: [-60],
    graceMin: 240,
    retrySec: 300,
    leaseSec: 60,
    claimLimit: 8,
    concurrency: 4,
    slotSecEstimate: 12,
    maxDurationSec: 120,
    hosts: ["boatrace.jp"],
  },

  // A8 朝の初期化（races・race_entries・predictions の初期化。チャンク処理）。05:00指定（cron: 05:00〜09:58 JST の2分ごと。
  // 設計判断(f): 従来の07:00開始より2時間早める）。会場を、1回の呼び出しで最大8件（時間の許す限り）処理し、進捗を
  // scrape_job_state.cursor に保存して次の起動が続きを処理する（全会場が済むまで incomplete）。1会場約30秒
  // （scrape-to-json の実測: 13会場で282秒＝1会場約22秒、並列を下げて約30秒の見積り）、24会場で約12分。
  // リースは maxDuration と同じ800秒（cron の間隔120秒より長いが、実行中の起動は、リースで何もしない）。
  // 実装: scripts/lib/racesInit/job.js、api/cron/races-init.js（T4b-07）
  races_init: {
    kind: "daily",
    targetTimeJst: "05:00",
    leaseSec: 800,
    maxDurationSec: 800,
    hosts: ["boatrace.jp"],
  },

  // 日次ジョブ。targetTimeJst は「その日の対象日を決める指定時刻」（JST、HH:MM）。実行が遅れても、
  // 対象日は指定時刻から解決する（resolveTargetDate。GitHub Actionsの遅延による日付の取り違えの恒久対策）。
  // 期待件数の判定関数と実装は、各データセットの移行（WS4b）で run() が返す（rowsExpected）。
  // B2 得点率。22:00指定（cron: 22:00・23:30・01:30 JST）。boatrace.jp の pointrank を、開催中の会場ごとに1ページ
  // （約15ページ）。同時3・1ページ約8〜10秒のため、約50秒。実装: scripts/lib/pointRankJob.js（T4b-12）
  point_rank: {
    kind: "daily",
    targetTimeJst: "22:00",
    leaseSec: 600,
    maxDurationSec: 300,
    hosts: ["boatrace.jp"],
  },
  // B4 進入コース別選手成績。20:00指定（cron: 20:00・22:30・00:30 JST）。会場公式サイト（別ドメイン、10会場）を、
  // 会場ごとに当日のレース数（最大12）のページ。会場内は逐次（300ms間隔）、会場間は同時3。1ページ約1秒（GitHub Actionsの
  // 実測: 3会場・1,296行で26秒）。hosts は会場ごとに別のため、ジョブ単位のブレーカー確認は行わない
  // （politeFetch がホスト単位で確認する）。実装: scripts/lib/venueEntryCourseStatsJob.js（T4b-13）
  entry_course_stats: {
    kind: "daily",
    targetTimeJst: "20:00",
    leaseSec: 600,
    maxDurationSec: 300,
    hosts: [],
  },
  // B3 会場別モーター成績。06:00指定（cron: 06:00・08:00 JST）。会場公式サイト（別ドメイン、22会場＋宮島のPDF）を、
  // 会場ごとに1ページ。同時4（各ドメインには1日1〜2リクエストのみ）。GitHub Actionsの逐次実行で約29秒。
  // 実装: scripts/lib/venueMotorStatsJob.js（T4b-14）
  venue_motor_stats: {
    kind: "daily",
    targetTimeJst: "06:00",
    leaseSec: 600,
    maxDurationSec: 300,
    hosts: [],
  },
  // B5 選手ニュース。23:10指定（cron: 23:10・01:10 JST）。当月・前月のレーサーデータ一覧（2ページ、約9秒×2）と、
  // 未処理の記事だけDB照合。実装: scripts/lib/racerNewsJob.js（T4b-15）
  racer_news: {
    kind: "daily",
    targetTimeJst: "23:10",
    leaseSec: 300,
    maxDurationSec: 120,
    hosts: ["boatrace.jp"],
  },
  // B6 選手プロフィール・期別成績（月次・チャンク）。JST 03:00指定（従来のGitHub Actionsと同じ夜間）。cron は UTC 18:00〜20:50 の
  // 10分間隔で、UTC 基準の毎月1日（5月・11月は8日・15日も。scrape-racer-season-stats.yml の cron 式と同じ）＝JST の翌日
  // （毎月2日、5月・11月は9日・16日も）03:00〜05:50。開始時に選手一覧・直近の出走を読むDB負荷を、開催時間帯（9:00〜21:00 JST）から
  // 避けるため。最後のチャンクの終了は 05:55 頃で、07:00 JST 前に完了する。
  // 約1,630人を、1回の呼び出しで、時間の許す限り（最大300人）処理し、登録番号の昇順の位置を scrape_job_state.cursor に保存して
  // 次の起動で再開する。1ページ約8〜10秒（2026-09-20の実測。racersearch/season も同じ）のため、同時4で1回あたり約110人
  // （約15回、約2.5時間。窓は3時間・18回の起動）。maxDuration は300秒（設計は800秒だが、Fluid Compute の有効化が未確認（plan.md U1）で、
  // 無効なプロジェクトに800を指定するとビルドが失敗するため。確認できたら800に上げる）。リースは maxDuration と同じで、cron の
  // 間隔（600秒）より短い。
  // 実装: scripts/lib/racerProfilesJob.js（T4b-16）
  racer_profiles: {
    kind: "daily",
    targetTimeJst: "03:00",
    leaseSec: 800,
    maxDurationSec: 800,
    hosts: ["boatrace.jp"],
    // 起動する日（JST の日）。UTC 基準の1日（5月・11月は8日・15日も）の 18:00〜20:50 UTC は、JST の翌日 03:00〜05:50 のため、
    // JST では2日（5月・11月は9日・16日も）。monitor が、起動しない日に「日次が未処理」と誤報しないために使う
    runDaysOfMonth: { default: [2], 5: [2, 9, 16], 11: [2, 9, 16] },
  },

  // A5 レース特記事項（race_special_notes）。10分ごと（JST 07:00〜23:59）に、開催会場のページを巡回する。
  // 窓なし・ジョブ単位のリースで排他（cron-job.org と Vercel Cron の両方から起動されても、同時に1つだけ走る）。
  // 会場は6並列で、1ページ約8〜10秒（plan.md §8の実測）のため、24会場でも約40〜60秒。リースは maxDuration と同じ
  // 300秒（cron の間隔600秒より短く、処理が異常に長引いた場合も、次の起動までに解放される）
  // 実装: scripts/lib/raceNoticesJob.js、api/cron/race-notices.js（T4b-11）
  race_notices: {
    kind: "continuous",
    leaseSec: 300,
    maxDurationSec: 300,
    hosts: ["boatrace.jp"],
  },
  // ↓ WS4b 結果取得（PR #743）の定義
  // A6補助 Kファイル同期（進入コース・rank4〜6。plan.md §4.1・T4b-05-1）。07:00・12:00 JST の2回起動し、12:00は
  // 07:00の実行が完了しなかった（Kファイル未公開・失敗）場合の補足（完了済みなら、last_target_date で何もしない）。
  // 対象は当日を除く直近4日。Kファイルは別ドメイン（www1.mbrace.or.jp）
  kfile_sync: {
    kind: "daily",
    targetTimeJst: "07:00",
    leaseSec: 300,
    maxDurationSec: 300,
    hosts: ["mbrace.or.jp"],
  },
  // A6補助 結果のcatch-up（T4b-05-2）。当日 expired になった結果のスロットの再取得・的中フラグの補完（日次）・
  // 中止・順延の確定の取りこぼしの補填。23:50 JST に起動し、その時点で結果のスロットが未完了（最終レースは
  // 発走+90分が翌00:15）なら、対象日を処理済みにせず、00:30 JST の補足の起動が、同じ対象日をもう一度処理する
  result_catchup: {
    kind: "daily",
    targetTimeJst: "23:50",
    leaseSec: 600,
    maxDurationSec: 300,
    hosts: ["boatrace.jp"],
  },

  // T4a-10 の疑似ジョブ: 取得先へアクセスせず、スロットを消化するだけ（重複配信・二重claim・リースの奪取・
  // 期限計算の検証用。api/cron/scrape-pseudo.js）。Cronには登録しない（手動リクエストのみ）。検証後は削除してよい
  pseudo: {
    kind: "window",
    offsets: [-60],
    graceMin: 30,
    retrySec: 10,
    leaseSec: 20,
    claimLimit: 40,
    concurrency: 4,
    slotSecEstimate: 1,
    maxDurationSec: 60,
    hosts: [],
  },

  // 監視・保守（plan.md §7・§3.9）。モードのゲートなし
  "scrape-monitor": {
    kind: "monitor",
    leaseSec: 120,
    maxDurationSec: 120,
    hosts: [],
  },
  "scrape-cleanup": {
    kind: "monitor",
    leaseSec: 120,
    maxDurationSec: 60,
    hosts: [],
  },

  // ↓ N23・N29（tasks.md T4b-20・T4b-21）
  // N23 前検タイム・前検順位・節時点のモーター/ボート2連対率（motor_pretest_stats）。05:20指定（cron: 05:30・06:00・06:30 JST。
  // 指定を cron より10分早くするのは、起動が数秒早まっても、対象日が前日に化けないため）。開催中の会場（races）ごとに
  // rankingmotor を1ページ（約13ページ）。同時3・1ページ約8〜10秒のため約40秒。オッズの運用窓（07:00〜23:59 JST）の外に限る。
  // races_init が live のとき、その日の分の完了前は取得しない（incomplete）。実装: scripts/lib/motorPretestJob.js
  motor_pretest: {
    kind: "daily",
    targetTimeJst: "05:20",
    leaseSec: 300,
    maxDurationSec: 300,
    hosts: ["boatrace.jp"],
  },
  // N29 日次の照合（前日の結果・払戻・着順・進入を、DBとKファイルで突き合わせる。書き込みなし）。07:50指定（cron: 08:00・12:30・
  // 17:30 JST。kfile_sync の07:00・12:00の後）。対象日は「指定時刻の日付の前日」。Kファイル（別ドメイン）を1回ダウンロードし、
  // races・race_results・race_payouts（前日分）を読む。実装: scripts/lib/dailyReconcileJob.js
  daily_reconcile: {
    kind: "daily",
    targetTimeJst: "07:50",
    leaseSec: 300,
    maxDurationSec: 120,
    hosts: ["mbrace.or.jp"],
  },
});

/**
 * 日次ジョブが、その日（JST の YYYY-MM-DD）に起動する予定か。runDaysOfMonth の無いジョブは毎日。
 * runDaysOfMonth: { default: [日...], [月]: [日...] }（月ごとの指定が default に優先する）。
 * 月次ジョブ（B6）の未処理を、起動しない日に誤報しないため。
 *
 * @param {{runDaysOfMonth?: Record<string, number[]>}} def
 * @param {string} dateJst YYYY-MM-DD
 */
export function isScheduledDate(def, dateJst) {
  const days = def.runDaysOfMonth;
  if (!days) return true;
  const month = Number(dateJst.slice(5, 7));
  const day = Number(dateJst.slice(8, 10));
  return (days[month] ?? days.default ?? []).includes(day);
}

/** kind が window のジョブ名の一覧 */
export function windowJobNames(registry = SCRAPE_JOBS) {
  return Object.entries(registry)
    .filter(([, def]) => def.kind === "window")
    .map(([name]) => name);
}

/**
 * ensure_scrape_slots に渡すジョブ×窓の定義（[{job, offset_min, grace_min}]）
 * @param {string[]} jobs
 */
export function slotDefsFor(jobs, registry = SCRAPE_JOBS) {
  return jobs.flatMap((job) => {
    const def = registry[job];
    if (!def || def.kind !== "window") {
      throw new Error(`窓型ではない、または未登録のジョブです: ${job}`);
    }
    return def.offsets.map((offset) => ({
      job,
      offset_min: offset,
      grace_min: def.graceMin,
    }));
  });
}

/**
 * レジストリの整合性の検査。違反の一覧（空なら正常）を返す。
 *   - 窓型: リース < 許容幅（許容幅より長いリースは、リースの解除が許容幅を超えて窓を取りこぼす。
 *     BOA-313のロック導入への警告）、再試行の間隔 < 許容幅（許容幅内に再試行できる）、
 *     窓（offset_min）は SMALLINT の範囲の整数で重複なし、並列度 <= claim上限
 *   - 全ジョブ: maxDurationSec がソフトデッドライン（−30秒）を引いても正
 *   - 日次: targetTimeJst が HH:MM
 */
export function validateRegistry(registry = SCRAPE_JOBS) {
  const problems = [];
  for (const [name, def] of Object.entries(registry)) {
    if (!["window", "daily", "continuous", "monitor"].includes(def.kind)) {
      problems.push(`${name}: kind が不正です: ${def.kind}`);
      continue;
    }
    if (!(def.maxDurationSec - SOFT_DEADLINE_MARGIN_SEC > 0)) {
      problems.push(
        `${name}: maxDurationSec(${def.maxDurationSec}) がソフトデッドラインの余白(${SOFT_DEADLINE_MARGIN_SEC}秒)以下です`,
      );
    }
    if (!Number.isInteger(def.leaseSec) || def.leaseSec < 1) {
      problems.push(`${name}: leaseSec が不正です: ${def.leaseSec}`);
    }
    if (def.kind === "window") {
      const graceSec = def.graceMin * 60;
      if (!Number.isInteger(def.graceMin) || def.graceMin < 0) {
        problems.push(`${name}: graceMin が不正です: ${def.graceMin}`);
      }
      if (def.leaseSec >= graceSec) {
        problems.push(
          `${name}: リース(${def.leaseSec}秒)は許容幅(${graceSec}秒)より短くしてください`,
        );
      }
      if (def.retrySec >= graceSec) {
        problems.push(
          `${name}: 再試行の間隔(${def.retrySec}秒)は許容幅(${graceSec}秒)より短くしてください`,
        );
      }
      if (
        !Array.isArray(def.offsets) ||
        def.offsets.length === 0 ||
        def.offsets.some(
          (o) => !Number.isInteger(o) || o < -32768 || o > 32767,
        ) ||
        new Set(def.offsets).size !== def.offsets.length
      ) {
        problems.push(`${name}: offsets が不正です: ${def.offsets}`);
      }
      const waves = Math.ceil(def.claimLimit / def.concurrency);
      if (waves * def.slotSecEstimate > def.leaseSec - 10) {
        problems.push(
          `${name}: 最後のスロットの完了見込み(${waves}回 × ${def.slotSecEstimate}秒)が、リース(${def.leaseSec}秒)に余裕(10秒)を残して収まりません。claimLimit を減らすか、リースを延ばしてください`,
        );
      }
      if (!(def.concurrency >= 1) || def.concurrency > def.claimLimit) {
        problems.push(
          `${name}: concurrency(${def.concurrency}) は 1以上・claimLimit(${def.claimLimit})以下にしてください`,
        );
      }
    }
    if (
      def.kind === "daily" &&
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(def.targetTimeJst ?? "")
    ) {
      problems.push(
        `${name}: targetTimeJst が HH:MM ではありません: ${def.targetTimeJst}`,
      );
    }
    if (def.runDaysOfMonth !== undefined) {
      const ok = Object.values(def.runDaysOfMonth).every(
        (days) =>
          Array.isArray(days) &&
          days.length > 0 &&
          days.every((d) => Number.isInteger(d) && d >= 1 && d <= 31),
      );
      if (!ok || !Array.isArray(def.runDaysOfMonth.default)) {
        problems.push(
          `${name}: runDaysOfMonth が不正です（{default: [日], [月]: [日]}、日は1〜31）: ${JSON.stringify(def.runDaysOfMonth)}`,
        );
      }
    }
  }
  return problems;
}
