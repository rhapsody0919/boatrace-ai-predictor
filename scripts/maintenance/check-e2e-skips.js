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
 * ## 採点する前に、採点できるレポートかを確かめる
 *
 * 率は「走った分」の分数なので、走った数が減ると率は下がる。つまり率だけを見ると、
 * この検査は**一本も動いていない実行を満点にする**。実測で確認した例:
 *
 *   - `webServer` が起動に失敗して中断した実行は、空ではなく新鮮なレポートを書く。
 *     `suites: []` / `stats.expected: 0` / `errors: [中断の理由]` という中身で、
 *     率は 0/0 として 0% と出る
 *   - 設定にある6プロジェクトのうち1つ（例: layout-wide の30件）が testMatch の
 *     変化で0件になっても、全体1086件に対する率はほとんど動かない。元の事件
 *     （7件が長期間skip、3b6ef2ce）と同じ「緑のまま何も検証しない」が一段上で起きる
 *
 * なので率を見る前に、レポートが採点に足るかを見る（`reportProblems`）。
 * 判断材料はすべてレポート自身の中にある（`errors` / `config.projects` /
 * `stats.startTime`）ので、別に台帳を持つ必要がない。
 *
 * 使い方:
 *   npm run test:e2e && node scripts/maintenance/check-e2e-skips.js
 *   node scripts/maintenance/check-e2e-skips.js --max-rate=0.2
 *   # 一部のプロジェクトだけ走らせた後（例: npm run test:layout）は、
 *   # 揃っているべきプロジェクトを明示する
 *   node scripts/maintenance/check-e2e-skips.js --projects=layout-mobile,layout-wide
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
 * レポートがこれより古かったら採点しない。
 *
 * リポジトリ直下の `e2e-results.json` は（Playwright の outputDir と違って）
 * 実行開始時に消えないので、一度書かれると次に走らせるまで残り続ける。
 * テストを走らせずに `npm run check:e2e-skips` だけ叩くと、何日前の結果でも
 * 「OK」と出てしまう。いつの結果かはレポート自身（`stats.startTime`）が
 * 持っているので、それを見る。
 */
const DEFAULT_MAX_AGE_HOURS = 24;

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
            project: test.projectName ?? "",
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

/**
 * 採点できるレポートかを確かめる。問題を人が読める文で並べて返す（空なら採点可）。
 *
 * 率を見る前にこれを通す。「走った数が減れば率も下がる」ので、率は
 * 「そもそも走っていない」を検知できない。ここで見るのは次の3点。
 *
 *   1. `errors` が空か — 中断した実行は新鮮なレポートを書くが中身が空になる
 *   2. 揃っているべきプロジェクトが全部1件以上あるか — 1つ丸ごと消えても率は動かない
 *   3. いつの結果か — 古いレポートを採点すると、走らせていないのに緑になる
 *
 * `expectProjects` を渡さない場合は、レポートの `config.projects` に載っている
 * 全プロジェクトが揃っていることを求める。`config.projects` は `--project` で
 * 絞って実行しても設定上の全件が載る（実測）ため、一部だけ走らせた場合は
 * 呼び出し側が期待する集合を明示する必要がある。既定を厳しい側に置くのは、
 * 新しい呼び出し元が指定を忘れたときに緩くなるのを避けるため。
 */
export function reportProblems(report, tests, options = {}) {
  const {
    now = Date.now(),
    maxAgeHours = DEFAULT_MAX_AGE_HOURS,
    expectProjects = null,
  } = options;
  const problems = [];

  const errors = report?.errors ?? [];
  if (errors.length > 0) {
    const first = errors[0]?.message?.split("\n")[0] ?? "(内容不明)";
    problems.push(
      `実行が正常に完了していません（Playwrightのerrorsが${errors.length}件）。先頭: ${first}`,
    );
  }

  if (tests.length === 0) {
    problems.push(
      "レポートにテストが1件も入っていません。採点する対象がありません。",
    );
  } else {
    const declared = (report?.config?.projects ?? [])
      .map((p) => p?.name)
      .filter(Boolean);
    const expected = expectProjects ?? declared;
    const ran = new Set(tests.map((t) => t.project).filter(Boolean));
    const missing = expected.filter((name) => !ran.has(name));
    if (missing.length > 0) {
      problems.push(
        `設定にあるのに1件も走っていないプロジェクトがあります: ${missing.join(", ")}`,
      );
    }
  }

  const started = Date.parse(report?.stats?.startTime ?? "");
  if (!Number.isFinite(started)) {
    problems.push(
      "レポートに実行時刻（stats.startTime）がありません。いつの結果か分からないため採点しません。",
    );
  } else {
    const ageHours = (now - started) / 3600000;
    if (ageHours > maxAgeHours) {
      problems.push(
        `レポートが古すぎます（${ageHours.toFixed(1)}時間前、上限${maxAgeHours}時間）。テストを走らせずに採点しかけています。`,
      );
    }
  }

  return problems;
}

/**
 * 率の判定。閾値を超えたら fail、そうでなければ ok。
 *
 * 1件も無い場合の率は0になるが、それを「合格」と読んではいけない。
 * 「走っていない」は率の問題ではなくレポートの問題なので、`reportProblems` が
 * 先に落とす。ここは採点対象が揃っている前提で率だけを見る。
 */
export function judge(tests, maxRate) {
  const total = tests.length;
  const skipped = tests.filter((t) => t.status === "skipped");
  const rate = total === 0 ? 0 : skipped.length / total;
  return {
    total,
    skipped,
    rate,
    ok: rate <= maxRate,
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

/** `--name=値` を取り出す。無ければ undefined。 */
function argOf(name) {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
}

function main() {
  const rateArg = argOf("max-rate");
  const maxRate = rateArg ? Number(rateArg) : DEFAULT_MAX_SKIP_RATE;
  if (!Number.isFinite(maxRate) || maxRate < 0 || maxRate > 1) {
    console.error(
      `NG: --max-rate は0〜1で指定してください（受け取った値: ${rateArg}）`,
    );
    process.exit(1);
  }

  const ageArg = argOf("max-age-hours");
  const maxAgeHours = ageArg ? Number(ageArg) : DEFAULT_MAX_AGE_HOURS;
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    console.error(
      `NG: --max-age-hours は正の数で指定してください（受け取った値: ${ageArg}）`,
    );
    process.exit(1);
  }

  const projectsArg = argOf("projects");
  const expectProjects = projectsArg
    ? projectsArg
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : null;
  if (expectProjects && expectProjects.length === 0) {
    console.error(
      "NG: --projects が空です。カンマ区切りで1つ以上指定してください。",
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

  // 率を見る前に、このレポートが採点に足るかを見る。
  // 「走った数が減れば率も下がる」ので、率だけでは「走っていない」を検知できない。
  const problems = reportProblems(report, tests, {
    maxAgeHours,
    expectProjects,
  });
  if (problems.length > 0) {
    console.error("NG: このレポートは採点できません。");
    for (const p of problems) console.error(`  - ${p}`);
    console.error("");
    console.error(
      "  skipの率が低いことは「テストが動いている」ことを意味しません。",
    );
    console.error(
      "  採点対象が揃っていないレポートを通すと、この検査が防ぎたい",
    );
    console.error("  「緑のまま何も検証していない」状態そのものになります。");
    console.error("");
    console.error("  先に npm run test:e2e を実行してください。");
    console.error(
      "  一部のプロジェクトだけ走らせた場合は --projects= で期待する集合を指定してください。",
    );
    process.exit(1);
  }

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
