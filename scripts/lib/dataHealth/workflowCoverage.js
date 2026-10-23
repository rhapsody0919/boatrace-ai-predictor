/**
 * Environment prod-jobs を使う workflow（.github/workflows）の、data_health への登録の一覧。
 *
 * 2026-10-20 朝、prod-jobs の鍵の誤りで夜の集計が落ちたのに、画面の表の側から見ている監視が無く、誰も気づかなかった。
 * 新しい workflow を prod-jobs で足したとき、表の鮮度の見張りを足し忘れないよう、CI
 * （scripts/maintenance/verify-data-health-workflow-coverage.js）が次を検査する:
 *   - prod-jobs を使う workflow は全て、checks.js の鮮度の項目（workflow）に載るか、下の除外に理由つきで載る
 *   - 除外・鮮度の項目に、prod-jobs を使わない（または無い）workflow が残っていない
 *   - prod-jobs を使う workflow は全て、job の失敗の見張りの一覧（scripts/watch/job-watch.json の watched）にも載る
 *
 * 除外の kind:
 *   no_table          画面が読む表を書かない（照合・検査・通知・適用）
 *   watched_elsewhere 表を書くが、別の監視が見ている（その監視を reason に書く）
 *   not_daily         週次・月次で、日次の鮮度の対象にならない
 */

/** @type {Readonly<Record<string, {kind: "no_table"|"watched_elsewhere"|"not_daily", reason: string}>>} */
export const WORKFLOW_EXCLUSIONS = Object.freeze({
  "aggregate-racer-course-technique-stats.yml": {
    kind: "watched_elsewhere",
    reason:
      "手動の起動だけ（workflow_dispatch）。日次は Vercel の racer_course_technique_stats（13:00 JST）が書き、scrape-monitor の daily_overdue が見る",
  },
  "bot-html-parity.yml": {
    kind: "no_table",
    reason: "ボット向け HTML の照合（失敗は Slack）。表を書かない",
  },
  "campaign-pipeline.yml": {
    kind: "no_table",
    reason:
      "企画型 SNS 投稿のネタ（sns_topics）と下書き用。画面が読む表を書かない",
  },
  "collect-racer-news.yml": {
    kind: "watched_elsewhere",
    reason:
      "Vercel の racer_news が主（SKIP_RACER_NEWS_ON_GHA のゲート）。scrape-monitor の daily_overdue と、セッション開始時の racerNews が見る",
  },
  "content-ops-nightly-check.yml": {
    kind: "no_table",
    reason: "コンテンツ運用の夜の検査。表を書かない",
  },
  "db-apply.yml": {
    kind: "no_table",
    reason: "マイグレーションの適用。日次で書く集計の表を持たない",
  },
  "e2e-live.yml": {
    kind: "no_table",
    reason: "本番データでの E2E（失敗は Slack）。表を書かない",
  },
  "exhibition-gap-monitor.yml": {
    kind: "no_table",
    reason: "展示データの欠けの監視そのもの。表を書かない",
  },
  "generate-morning-digest.yml": {
    kind: "watched_elsewhere",
    reason:
      "手動の起動だけ（workflow_dispatch）。日次は Vercel の morning_digest（05:30〜 JST）が書き、scrape-monitor の daily_overdue が見る",
  },
  "in-caution-nightly.yml": {
    kind: "watched_elsewhere",
    reason:
      "in_caution_gap_band_daily は api/cron/in-caution-health.js（04:30 JST）と in-caution-today-health.js（05:45 JST）が見る",
  },
  "key-canary.yml": {
    kind: "no_table",
    reason:
      "prod-jobs の鍵で読み取りを1回だけ試すカナリア（PR #1679）。表を書かない",
  },
  "nightly-verify-db.yml": {
    kind: "no_table",
    reason:
      "本番 DB の読み取りの検証。表を書かない（verify-analogy-v16 の Storage の掃除だけ）",
  },
  "post-merge-checks.yml": {
    kind: "no_table",
    reason: "マージ後の master の検査。表を書かない",
  },
  "race-notices-drift-monitor.yml": {
    kind: "no_table",
    reason: "レース特記事項の構造変化の監視そのもの。表を書かない",
  },
  "scrape-monitor-liveness.yml": {
    kind: "no_table",
    reason:
      "scrape-monitor と data_health の死活の確認（メタ監視）。表を書かない",
  },
  "scrape-racer-season-stats.yml": {
    kind: "not_daily",
    reason:
      "月次（毎月2日と5月・11月のブースト）。Vercel の racer_profiles が主で、scrape-monitor が見る",
  },
  "scrape-scheduled.yml": {
    kind: "watched_elsewhere",
    reason:
      "出走表・結果の取得の旧基盤（Vercel の races_init 等が主）。取得した行は data_health の coverage.*・空テーブルの検査が件数で見る",
  },
  "scrape-venue-entry-course-stats.yml": {
    kind: "watched_elsewhere",
    reason:
      "Vercel の entry_course_stats が主（SKIP_ENTRY_COURSE_ON_GHA のゲート）。scrape-monitor の daily_overdue と、空テーブルの検査（venue_entry_course_stats）が見る",
  },
  "scrape-venue-motor-stats.yml": {
    kind: "watched_elsewhere",
    reason:
      "Vercel の venue_motor_stats が主（SKIP_MOTOR_STATS_ON_GHA のゲート）。scrape-monitor の daily_overdue と、空テーブルの検査（venue_motor_stats）が見る",
  },
  "storage-mirror.yml": {
    kind: "no_table",
    reason:
      "Supabase Storage を R2 に写す（ADR-0101）。表を書かない。最後の成功は hq の dashboard-alerts が gh run list で見る",
  },
  "storage-mirror-restore-drill.yml": {
    kind: "not_daily",
    reason:
      "Storage の写しの復元の試験（月1回、ADR-0101）。試験用のバケットに書くだけで画面の表を書かない。最後の成功は hq が gh run list で見る",
  },
  "train-analogy.yml": {
    kind: "not_daily",
    reason:
      "週1回の学習（日曜 04:00 JST、Vercel からの起動）。日次の鮮度の対象外",
  },
});

/** workflow の本文が Environment prod-jobs を使うか（`environment: prod-jobs` と `environment:\n  name: prod-jobs` の両方） */
export function usesProdJobs(yamlText) {
  return /^\s*environment:\s*(?:name:\s*)?(?:\n\s*name:\s*)?["']?prod-jobs["']?(?![\w-])/m.test(
    yamlText,
  );
}

/**
 * 登録の漏れ・残骸を返す（空なら正常）。
 * @param {{workflows: Record<string, string>, checks: ReadonlyArray<{id: string, workflow?: string}>, exclusions?: Record<string, {kind: string, reason: string}>, watched?: ReadonlyArray<string>|null}} input
 *   workflows はファイル名 → 本文。watched は job-watch.json の watched（.github/workflows/ からのパス）。null なら照合しない
 */
export function findCoverageProblems({
  workflows,
  checks,
  exclusions = WORKFLOW_EXCLUSIONS,
  watched = null,
}) {
  const problems = [];
  const watchedFiles = watched
    ? new Set(watched.map((w) => w.replace(/^\.github\/workflows\//, "")))
    : null;
  const prodJobs = Object.keys(workflows).filter((f) =>
    usesProdJobs(workflows[f]),
  );
  const covered = new Map();
  for (const c of checks) {
    if (!c.workflow) continue;
    covered.set(c.workflow, [...(covered.get(c.workflow) ?? []), c.id]);
  }
  for (const f of prodJobs) {
    const inChecks = covered.has(f);
    const inExclusions = Object.hasOwn(exclusions, f);
    if (!inChecks && !inExclusions)
      problems.push(
        `${f}: prod-jobs を使うのに、data_health の鮮度の項目（checks.js の workflow）にも除外（workflowCoverage.js）にも載っていません`,
      );
    if (watchedFiles && !watchedFiles.has(f))
      problems.push(
        `${f}: prod-jobs を使うのに、job の失敗の見張り（scripts/watch/job-watch.json の watched）に載っていません`,
      );
    if (inChecks && inExclusions)
      problems.push(
        `${f}: 鮮度の項目（${covered.get(f).join("、")}）と除外の両方に載っています。どちらかにしてください`,
      );
  }
  for (const [f, ids] of covered) {
    if (!Object.hasOwn(workflows, f))
      problems.push(`${ids.join("、")}: workflow ${f} がありません`);
    else if (!usesProdJobs(workflows[f]))
      problems.push(
        `${ids.join("、")}: workflow ${f} は prod-jobs を使っていません（一覧の残骸）`,
      );
  }
  for (const [f, ex] of Object.entries(exclusions)) {
    if (!Object.hasOwn(workflows, f))
      problems.push(`除外 ${f}: workflow がありません（一覧の残骸）`);
    else if (!usesProdJobs(workflows[f]))
      problems.push(`除外 ${f}: prod-jobs を使っていません（一覧の残骸）`);
    if (!["no_table", "watched_elsewhere", "not_daily"].includes(ex.kind))
      problems.push(`除外 ${f}: kind が不正です: ${ex.kind}`);
    if (!ex.reason || ex.reason.trim().length < 10)
      problems.push(`除外 ${f}: 理由（reason）を書いてください`);
  }
  return problems;
}
