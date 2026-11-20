import { SCRAPE_JOBS } from "./registry.js";
import { DETECTION_LAG, EXPECTED_UNPUBLISHED } from "./expectedUnpublished.js";
import {
  THRESHOLDS,
  isHostRow,
  aggregateByJob,
  toJstTimeString,
} from "./monitorWindowStats.js";

/** Slackのブロックの本文の上限（3000字）に対する、本文の予算 */
const SLACK_TEXT_BUDGET = 2800;

/**
 * アラートのSlackメッセージ（Incoming Webhook。絵文字は使わない）。
 * 本文が予算を超える場合は、入り切る分だけ載せ、残りは「ほかN件（次回の実行で通知）」とする。
 * 載せなかったアラートは、通知済みとして記録してはならない（呼び出し側が includedCount で判断する）
 *
 * @returns {{message: Object, includedCount: number}}
 */
export function formatAlertMessage(
  alerts,
  now,
  { budget = SLACK_TEXT_BUDGET } = {},
) {
  const head = `*データ取得の監視: ${alerts.length}件の異常*（${toJstTimeString(now)} JST）`;
  const lines = [];
  let used = head.length;
  for (const a of alerts) {
    const line = `・${a.text.length > 400 ? `${a.text.slice(0, 399)}…` : a.text}`;
    // 「ほかN件」の行の分（最大約40字）を残す
    if (used + line.length + 1 + 40 > budget && lines.length < alerts.length) {
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  const rest = alerts.length - lines.length;
  const body = [
    head,
    ...lines,
    ...(rest > 0 ? [`…ほか${rest}件（次回の実行で通知します）`] : []),
  ].join("\n");
  return {
    includedCount: lines.length,
    message: {
      text: `[データ取得の監視] ${alerts.length}件の異常（${toJstTimeString(now)} JST）`,
      attachments: [
        {
          color: "#c9a227",
          blocks: [{ type: "section", text: { type: "mrkdwn", text: body } }],
        },
      ],
    },
  };
}

/** 日次サマリーのSlackメッセージ */
export function formatDailySummary({
  date,
  stats7d,
  statsDay,
  jobStates,
  detectionLagDay,
  detectionLag7d,
}) {
  const pct = (r) => (r === null ? "-" : `${(r * 100).toFixed(1)}%`);
  const min = (v) => (v === null ? "-" : v.toFixed(1));
  const day = new Map(aggregateByJob(statsDay).map((j) => [j.job, j]));
  const week = aggregateByJob(stats7d);
  const p95 = new Map();
  for (const s of stats7d) {
    const cur = p95.get(s.job);
    if (s.delayP95Min !== null && (cur === undefined || s.delayP95Min > cur)) {
      p95.set(s.job, s.delayP95Min);
    }
  }
  const rows = week.map((w) => {
    const d = day.get(w.job);
    // 想定内の未公開（分母から除外した件数）: 対象のジョブ（odds）は0件でも出す。他のジョブは、あるときだけ出す
    const unpublished =
      w.job === EXPECTED_UNPUBLISHED.job ||
      w.expectedUnpublished > 0 ||
      (d?.expectedUnpublished ?? 0) > 0
        ? ` / 発売開始の遅れ(想定内・分母から除外) 前日 ${d?.expectedUnpublished ?? 0}件・直近7日 ${w.expectedUnpublished}件`
        : "";
    const deferred =
      w.deferred > 0 || (d?.deferred ?? 0) > 0
        ? ` / 判定保留 前日 ${d?.deferred ?? 0}件・直近7日 ${w.deferred}件`
        : "";
    return `${w.job}: 前日 ${pct(d?.rate ?? null)}（${d?.hit ?? 0}/${d?.total ?? 0}） / 直近7日 ${pct(w.rate)}（${w.hit}/${w.total}） / expired ${w.expired}件 / 未実行 ${w.unexecuted}件${unpublished}${deferred} / 遅延p95 ${min(p95.get(w.job) ?? null)}分`;
  });
  // 発売開始の検知の遅れ（分母から除外した-60のスロット）。オッズが有効なときは、0件でも出す（0件と明示）
  if (detectionLagDay || detectionLag7d) {
    const lagText = (l) =>
      l
        ? `${DETECTION_LAG.thresholdMin}分以内 ${l.within}/${l.measured}（${pct(l.rate)}） / p50 ${min(l.p50Min)}分・p95 ${min(l.p95Min)}分・最大 ${min(l.maxMin)}分 / 計測不能 ${l.unmeasured}件（延長で取得 ${l.byBasis.extension}件・後続の窓で取得 ${l.byBasis.later_window}件）`
        : "-";
    rows.push(
      `odds 発売開始の検知の遅れ（基準: ${DETECTION_LAG.thresholdMin}分以内の割合${DETECTION_LAG.rate * 100}%以上）: 前日 ${lagText(detectionLagDay)} / 直近7日 ${lagText(detectionLag7d)}`,
    );
  }
  // レジストリにある取得ジョブだけ（疑似の行 predict-code-hash 等は、モードの一覧に出さない）
  const modes = jobStates
    .filter((r) => !isHostRow(r) && SCRAPE_JOBS[r.job])
    .map((r) => `${r.job}=${r.mode}`)
    .join(" / ");
  return {
    text: `[データ取得の日次サマリー] ${date}`,
    attachments: [
      {
        color: "#2eb67d",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*データ取得の日次サマリー ${date}*（窓内取得率の閾値 ${THRESHOLDS.windowRate * 100}%）\n${rows.join("\n") || "（集計対象のスロットなし）"}\nモード: ${modes || "なし"}`.slice(
                0,
                2900,
              ),
            },
          },
        ],
      },
    ],
  };
}
