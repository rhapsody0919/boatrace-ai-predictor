/**
 * SNS の暦日の値の取り込み（sns-pdca-loop tasks 22、cron `sns_daily`、plan §5）。JST 10:00 に1日1回、sns_channel_daily へ入れる。
 *
 * - YouTube Analytics（太平洋時間の暦日）: チャネル全体の日次と、動画ごとの「投稿日＋翌日」の日次（版の判定に使う）。
 *   確定まで数日かかるので、毎日 D−3〜D−1（太平洋時間）を取り直す
 * - GA4（JST の暦日）: X・YouTube から来た人のチャネル全体の日次と、投稿の UTM ごとの日次（X の下書きの ID の race-full・
 *   today_digest、全貌動画の utm_content=race_id は X・YouTube と utm_term ごとに投稿日と翌日だけ）。
 *   それぞれ「龍神ソナーのタブを開いた人」も。毎日 D−3〜D−1（JST）を取り直す。流入元のリストは scripts/lib/snsGa4.js
 *   YouTube Shorts「節の機力」（format=setsu_kiryoku_short、#2112）は、説明欄のリンク（会場のページ）の utm_* と landingPage で
 *   下書きに結びつけ、投稿日と翌日だけを残す（collectSetsuShort）。X の節の機力（setsu_kiryoku）は本文にリンクが無いので GA4 の行は無い
 * - 48h・7d（sns_metric_jobs）はこの cron ではなく、posted のトリガー（169 の enqueue_sns_metric_jobs）が作る。全貌以外の型は
 *   format によらず 48h・7d なので、setsu_kiryoku_short・setsu_kiryoku も変えずに予約される
 * - 値が変わった行だけ書く（読み直して比べる。取得のたびに全行を UPDATE しない）
 * - チャネル全体の日次は行が無い日も埋める（YouTube は D−3 の件数だけ0確定、直近日と平均は欠測。GA4 は0）。UTM ごとの日次は行がある分だけ
 * - 片方の取得に失敗しても、もう片方は書いてから失敗として返す（補足の起動がやり直す）
 * - GA4 の鍵が未設定の間は GA4 を飛ばし、report.alerts で知らせる
 * - shadow は取得と比較までで、書かない
 */
import {
  CHANNEL_METRICS,
  ENGAGED_LOOKBACK_DAYS,
  UPSERT_CHUNK,
  ptDate,
  range,
} from "./snsDailyRunnerParts.js";
import { collectGa4, collectSetsuShort } from "./snsDailyRunnerGa4.js";
import {
  collectEngaged,
  collectYoutube,
} from "./snsDailyRunnerYoutube.js";

export {
  SNS_DAILY_LOOKBACK_DAYS,
  UTM_CAMPAIGNS,
  SETSU_SHORT_FORMAT,
  ENGAGED_WINDOW,
  ENGAGED_LOOKBACK_DAYS,
  ENGAGED_BUDGET_MS,
  ptMidnightUtc,
  addDays,
  ptDate,
} from "./snsDailyRunnerParts.js";
export { setsuShortLink } from "./snsDailyRunnerGa4.js";
export { createYoutubeAnalyticsClient } from "./snsDailyRunnerYoutube.js";
export { createSnsDailyStore } from "./snsDailyRunnerStore.js";

const rowKey = (r) =>
  [
    r.day,
    r.channel,
    r.draft_id ?? "",
    r.utm_content ?? "",
    r.source,
    r.metric_name,
    r.definition,
  ].join("|");

/** YouTube Analytics の日次と pt3d の観測を集める。取得に失敗しても errors に足すだけで続ける（acc に取れた分を残す） */
async function collectYoutubeSide({
  youtube,
  store,
  now,
  startedMs,
  ptDays,
  push,
  youtubeZeroFinalizations,
  errors,
  acc,
}) {
  try {
    const yt = await youtube();
    acc.expected += ptDays.length * CHANNEL_METRICS.length;
    const videos = await store.youtubeVideos(
      new Date(now.getTime() - ENGAGED_LOOKBACK_DAYS * 86400000).toISOString(),
    );
    await collectYoutube({
      yt,
      videos,
      ptDays,
      push,
      youtubeZeroFinalizations,
    });
    // 観測（pt3d）は日次の表と別に失敗を数える。動画ごとの失敗は collectEngaged の中で errors に入れて次へ進む
    try {
      acc.observations = await collectEngaged({
        yt,
        store,
        videos,
        ptDays,
        now,
        startedMs,
        errors,
      });
    } catch (error) {
      errors.push(`engagedViews の観測の準備: ${error.message}`);
    }
  } catch (error) {
    errors.push(`YouTube Analytics: ${error.message}`);
  }
}

/** GA4 の流入を集める。鍵が無ければ alerts で知らせて飛ばす */
async function collectGa4Side({ ga4, store, jstDays, push, errors, alerts, acc }) {
  if (!ga4) {
    alerts.push({
      key: "ga4_unconfigured",
      text: "SNS の日次の取り込み: GA4 の鍵（GOOGLE_SERVICE_ACCOUNT_KEY・GA4_PROPERTY_ID）が Vercel に無いので、GA4 の流入を取っていない",
    });
    return;
  }
  try {
    const runReport = await ga4();
    acc.expected += jstDays.length * 2 * 3;
    await collectGa4({ runReport, store, jstDays, push });
    // 節の機力の Shorts の失敗は、ほかの GA4 の行と分けて知らせる（ほかの行は書く。補足の起動がやり直す）
    try {
      await collectSetsuShort({ runReport, store, jstDays, push });
    } catch (error) {
      errors.push(`GA4（節の機力の Shorts）: ${error.message}`);
    }
  } catch (error) {
    errors.push(`GA4: ${error.message}`);
  }
}

/** 既存の行と比べて、値か欠測の理由が変わった行だけを返す */
function changedRows(rows, existing) {
  return rows.filter((r) => {
    const old = existing.get(rowKey(r));
    return (
      !old ||
      (old.metric_value === null ? null : Number(old.metric_value)) !==
        r.metric_value ||
      (old.missing_reason ?? null) !== (r.missing_reason ?? null)
    );
  });
}

/** pt3d の観測を入れる。入れた数を返す。窓の CHECK が未適用なら alerts に足して止める */
async function appendObservations(store, observations, errors, alerts) {
  let observed = 0;
  for (const { draft_id, observation } of observations) {
    try {
      await store.appendObservation(draft_id, observation);
      observed += 1;
    } catch (error) {
      // 175 の前（窓の CHECK に pt3d が無い）は、日次の取り込みを失敗にせず知らせる（当てれば次の日から入る）。
      // 判定は窓の CHECK の名前だけ。ほかの CHECK 違反（期間の式等）は本当の不整合なので失敗にする（system-architect の審査 P2-2）
      if (/sns_metric_observations_window_check/.test(error.message)) {
        alerts.push({
          key: "engaged_window_unapplied",
          text: "SNS の日次の取り込み: 動画ごとの engagedViews（pt3d）を sns_metric_observations に入れられない。マイグレーション 175 が未適用",
        });
        break;
      }
      // 1件の失敗で残りの動画を止めない（system-architect の審査 P3-1）
      errors.push(`engagedViews の観測（${draft_id}）: ${error.message}`);
    }
  }
  return observed;
}

/**
 * @param {{mode: string, now: () => Date, targetDate: string}} ctx targetDate は JST の対象日（cron ラッパが解決する）
 * @param {{store, youtube: () => Promise<{report: Function}>, ga4: (() => Promise<Function>)|null}} deps
 * youtube().report(params) は YouTube Analytics の行を [{day, ...指標}] で返す。ga4() は runReport（snsGa4.js）。
 * ga4 が null なら鍵が未設定
 */
export async function runSnsDaily(ctx, { store, youtube, ga4 }) {
  const startedMs = Date.now();
  const now = ctx.now();
  const observedAt = now.toISOString();
  const jstDays = range(ctx.targetDate);
  const ptDays = range(ptDate(now));
  const rows = [];
  const errors = [];
  const alerts = [];
  const youtubeZeroFinalizations = [];
  const push = (row) =>
    rows.push({
      draft_id: null,
      utm_content: null,
      observed_at: observedAt,
      ...row,
    });
  // expected: 取れるはずの行数、observations: 入れる pt3d の観測（どちらも取得の途中までの分が残る）
  const acc = { expected: 0, observations: [] };

  await collectYoutubeSide({
    youtube,
    store,
    now,
    startedMs,
    ptDays,
    push,
    youtubeZeroFinalizations,
    errors,
    acc,
  });
  await collectGa4Side({ ga4, store, jstDays, push, errors, alerts, acc });
  const { expected, observations } = acc;

  // 同じキーの行が2つあると、本番の一括 upsert（1文の INSERT … ON CONFLICT）が「同じ行を2回更新」で文ごと拒まれる。
  // GA4 の次元を足したことで同じキーに複数の行が来うる（例: 下書きの ID の UTM に utm_term を付けた来訪）ので、値を足して1行にする
  const merged = mergeSameKey(rows);
  rows.length = 0;
  rows.push(...merged);
  const from = [...jstDays, ...ptDays].sort()[0];
  const to = [...jstDays, ...ptDays].sort().at(-1);
  const existing = new Map(
    (await store.existing(from, to)).map((r) => [rowKey(r), r]),
  );
  const changed = changedRows(rows, existing);
  const live = ctx.mode === "live";
  if (live)
    for (let i = 0; i < changed.length; i += UPSERT_CHUNK)
      await store.upsert(changed.slice(i, i + UPSERT_CHUNK));
  const observed = live
    ? await appendObservations(store, observations, errors, alerts)
    : 0;

  const report = {
    jstDays,
    ptDays,
    youtubeZeroFinalizations,
    parsed: rows.length,
    changed: changed.length,
    observations: observations.length,
    observed,
    alerts,
  };
  return {
    rowsParsed: rows.length,
    rowsExpected: expected,
    rowsWritten: live ? changed.length : 0,
    report,
    body: { parsed: rows.length, changed: changed.length, errors },
    ...(errors.length
      ? { outcome: "error", error: errors.join(" / ").slice(0, 500) }
      : {}),
  };
}

/** 一意キーが同じ行を1行にする（値は足す。欠測の行は値のある行に負ける）。GA4 の値はどれも人数・回数なので足せる */
export function mergeSameKey(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = rowKey(row);
    const prev = byKey.get(key);
    if (!prev) byKey.set(key, { ...row });
    else if (row.metric_value !== null)
      byKey.set(key, {
        ...prev,
        metric_value: (prev.metric_value ?? 0) + row.metric_value,
        missing_reason: null,
      });
  }
  return [...byKey.values()];
}
