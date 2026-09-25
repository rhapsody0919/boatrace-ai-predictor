#!/usr/bin/env node
/**
 * E2Eで無言でskipされたテストを可視化する。
 *
 * ## なぜ要るか
 *
 * `test.skip(条件, 理由)` は、条件が真になるとそのテストを飛ばす。データ依存の条件
 * （「比較に十分な行数が無い」「このレースにはプレビューが出ない」など）は本番DBの
 * 状態で変わるので、この書き方自体は妥当。
 *
 * 問題は、条件が**常に**真になったときに何も起きないこと。テストは緑のまま残り、
 * 実際には一度も検証していない状態が続く。2026-09-25、320px幅の横スクロールを見る
 * テスト7個が、共有ヘルパー `selectUpcomingRace` が常に false を返すせいで長期間
 * skipされ続けていたことが分かった（3b6ef2ce のコミットコメント）。
 * 「テストがある」と「テストが動いている」は別物で、後者は数えないと分からない。
 *
 * ## 何をするか
 *
 * Playwright の JSON レポート（`e2e-results.json`）を読み、skipされたテストを
 * 件数・率・一覧で出す。率が閾値を超えたら失敗する。
 *
 * 閾値は「ある日いきなり増えたことに気づく」ためのもので、
 * skipを0にするための基準ではない（データ依存のskipは正常に起こる）。
 *
 * 使い方:
 *   npm run test:e2e && node scripts/maintenance/check-e2e-skips.js
 *   node scripts/maintenance/check-e2e-skips.js --max-rate=0.2
 *
 * 検証: scripts/maintenance/verify-e2e-skips.js
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/**
 * 既定の上限。実測（2026-09-25）より少し上に置く。
 * skipが跳ね上がったときに気づくための線であって、0を目指す基準ではない。
 */
const DEFAULT_MAX_SKIP_RATE = 0.15;

/**
 * Playwright の JSON レポートから、テストの結果を平らに取り出す。
 * suites は入れ子になるので再帰で潰す。
 */
export function flattenTests(report) {
  const out = [];
  const walk = (suites, trail) => {
    for (const suite of suites ?? []) {
      const title = [...trail, suite.title].filter(Boolean);
      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests ?? []) {
          out.push({
            title: [...title, spec.title].join(" › "),
            file: suite.file ?? spec.file ?? "",
            status: test.status ?? test.results?.[0]?.status ?? "unknown",
            annotations: test.annotations ?? spec.annotations ?? [],
          });
        }
      }
      walk(suite.suites, title);
    }
  };
  walk(report?.suites, []);
  return out;
}

/** skipの理由。Playwright は annotations に {type:"skip", description} で入れる。 */
export function skipReasonOf(test) {
  const found = (test.annotations ?? []).find((a) => a.type === "skip");
  return found?.description?.trim() || "(理由の記載なし)";
}

/**
 * 同じ理由でこれ以上まとまってskipされていたら注意を促す。
 * 率では捕まらない（母数が大きいと薄まる）が、「同じ条件が常に真」は
 * ひとかたまりで現れるので件数で見る。
 */
const CLUSTER_WARN_COUNT = 5;

/** 判定。閾値を超えたら fail、そうでなければ ok。 */
export function judge(tests, maxRate) {
  const total = tests.length;
  const skipped = tests.filter((t) => t.status === "skipped");
  const rate = total === 0 ? 0 : skipped.length / total;
  return {
    total,
    skipped,
    rate,
    ok: total === 0 || rate <= maxRate,
  };
}

/** 理由ごとにまとめ、件数の多い順に返す。 */
export function groupByReason(skipped) {
  const byReason = new Map();
  for (const t of skipped) {
    const reason = skipReasonOf(t);
    if (!byReason.has(reason)) byReason.set(reason, []);
    byReason.get(reason).push(t.title);
  }
  return [...byReason].sort((a, b) => b[1].length - a[1].length);
}

/** 同じ理由でまとまってskipされている組（注意を促す対象）。 */
export function clusteredReasons(skipped, threshold = CLUSTER_WARN_COUNT) {
  return groupByReason(skipped).filter(
    ([, titles]) => titles.length >= threshold,
  );
}

function main() {
  const rateArg = process.argv
    .find((a) => a.startsWith("--max-rate="))
    ?.split("=")[1];
  const maxRate = rateArg ? Number(rateArg) : DEFAULT_MAX_SKIP_RATE;
  if (!Number.isFinite(maxRate) || maxRate < 0 || maxRate > 1) {
    console.error(
      `NG: --max-rate は0〜1で指定してください（受け取った値: ${rateArg}）`,
    );
    process.exit(1);
  }

  const reportPath = path.join(repoRoot, "e2e-results.json");
  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch {
    console.error(`NG: ${path.relative(repoRoot, reportPath)} を読めません。`);
    console.error("  先に npm run test:e2e を実行してください。");
    process.exit(1);
  }

  const tests = flattenTests(report);
  const { total, skipped, rate, ok } = judge(tests, maxRate);

  console.log(
    `E2E: ${total}件中 ${skipped.length}件がskip（${(rate * 100).toFixed(1)}%、上限 ${(maxRate * 100).toFixed(0)}%）`,
  );

  if (skipped.length > 0) {
    // 同じ理由のものはまとめる。同じ条件がずっと真になっていることが見えるように
    console.log("");
    for (const [reason, titles] of groupByReason(skipped)) {
      console.log(`  ${titles.length}件  ${reason}`);
      for (const title of titles.slice(0, 3)) console.log(`         ${title}`);
      if (titles.length > 3) console.log(`         ほか${titles.length - 3}件`);
    }

    // 率では薄まるが、「同じ条件が常に真」はひとかたまりで現れる
    const clusters = clusteredReasons(skipped);
    if (clusters.length > 0) {
      console.log("");
      console.log(
        `注意: 同じ理由で${CLUSTER_WARN_COUNT}件以上まとまってskipされています（${clusters.length}組）。`,
      );
      console.log(
        "  その条件が常に真になっていると、これらのテストは緑のまま何も検証しません。",
      );
      console.log(
        "  本日開催レースの有無など実行時刻で変わる条件なら、固定の過去データで検証できないか検討してください。",
      );
    }
  }

  if (!ok) {
    console.error("");
    console.error(
      `NG: skipが上限（${(maxRate * 100).toFixed(0)}%）を超えています。`,
    );
    console.error(
      "  データ依存のskipは正常に起こりますが、条件が常に真になっていると、",
    );
    console.error(
      "  そのテストは緑のまま何も検証しません。上の理由ごとの件数を見て、",
    );
    console.error("  同じ条件で大量にskipされていないか確認してください。");
    process.exit(1);
  }
  console.log("");
  console.log("OK: skipは上限内");
}

const invokedDirectly =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) main();
