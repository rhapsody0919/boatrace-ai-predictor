#!/usr/bin/env node
/**
 * check-e2e-skips.js の判定を検証する。
 *
 * このチェック自体が壊れると「skipが増えても何も言わなくなる」だけで、
 * 緑のまま素通りする。まさにそれが元の問題（無言のskip）なので、
 * 判定を純関数に切り出して、通る側と落ちる側の両方を固定の入力で確かめる。
 * 実際のE2E実行・本番DBには依存しない。
 */

import {
  clusteredReasons,
  flattenTests,
  groupByReason,
  judge,
  reportProblems,
  skipReasonOf,
} from "./check-e2e-skips.js";

const failures = [];
let checked = 0;

function check(label, actual, expected) {
  checked += 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(
      `${label}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`,
    );
  }
}

// --- Playwright の JSON レポートの読み取り ---
const report = {
  suites: [
    {
      title: "smoke.spec.js",
      file: "e2e/smoke.spec.js",
      specs: [
        { title: "トップが開く", tests: [{ status: "expected" }] },
        {
          title: "比較表が出る",
          tests: [
            {
              status: "skipped",
              annotations: [{ type: "skip", description: "行数が足りない" }],
            },
          ],
        },
      ],
      suites: [
        {
          title: "レース詳細",
          specs: [
            {
              title: "バッジが出る",
              tests: [
                {
                  status: "skipped",
                  annotations: [
                    { type: "skip", description: "行数が足りない" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
const tests = flattenTests(report);
check("入れ子のsuiteも平らにする", tests.length, 3);
check(
  "タイトルは親から連結する",
  tests.find((t) => t.title.includes("バッジ")).title,
  "smoke.spec.js › レース詳細 › バッジが出る",
);
check("statusを拾う", tests.filter((t) => t.status === "skipped").length, 2);
check("空のレポート", flattenTests({}).length, 0);
check("suitesがnull", flattenTests({ suites: null }).length, 0);
// プロジェクト名を拾えないと「プロジェクトが丸ごと欠けた」を検知できない
check(
  "projectNameを拾う",
  flattenTests({
    suites: [
      {
        title: "layout.spec.js",
        specs: [
          {
            title: "横スクロールしない",
            tests: [{ status: "expected", projectName: "layout-wide" }],
          },
        ],
      },
    ],
  })[0].project,
  "layout-wide",
);
check("projectNameが無ければ空文字", tests[0].project, "");

// --- skipの理由 ---
check(
  "annotationsから理由を取る",
  skipReasonOf({
    annotations: [{ type: "skip", description: " 行数が足りない " }],
  }),
  "行数が足りない",
);
check(
  "skip以外のannotationは見ない",
  skipReasonOf({ annotations: [{ type: "fixme", description: "あとで" }] }),
  "(理由の記載なし)",
);
check("annotationsが無い", skipReasonOf({}), "(理由の記載なし)");
check(
  "descriptionが空",
  skipReasonOf({ annotations: [{ type: "skip", description: "  " }] }),
  "(理由の記載なし)",
);

// --- 閾値の判定（落ちる側を必ず確かめる） ---
const mk = (total, skipped) =>
  Array.from({ length: total }, (_, i) => ({
    title: `t${i}`,
    status: i < skipped ? "skipped" : "expected",
    annotations: [],
  }));

check("skipなし", judge(mk(10, 0), 0.15).ok, true);
check("閾値ちょうどは通す", judge(mk(100, 15), 0.15).ok, true);
check("閾値を1件超えたら落とす", judge(mk(100, 16), 0.15).ok, false);
check("率を出す", Number(judge(mk(100, 16), 0.15).rate.toFixed(2)), 0.16);
check("skipの一覧を返す", judge(mk(10, 3), 0.15).skipped.length, 3);
// judge は率だけを見る。1件も無いときの率は0になるが、それは「合格」ではなく
// 「率では何も言えない」という意味。落とすのは reportProblems の仕事（下記）。
check("1件も無いときの率は0", judge([], 0.15).rate, 0);
check("全部skipなら落とす", judge(mk(10, 10), 0.15).ok, false);
check("上限1.0なら全skipでも通す", judge(mk(10, 10), 1).ok, true);

// --- 採点できるレポートか（率を見る前の門） ---
// 率は「走った分」の分数なので、走った数が減れば率も下がる。
// 「そもそも走っていない」を率で捕まえることは原理的にできないため、
// ここが緩むと検査は緑のまま何も守らなくなる。落ちる側を必ず確かめる。
const NOW = Date.parse("2026-09-26T00:00:00Z");
const freshAt = new Date(NOW - 60_000).toISOString();
const hoursAgo = (h) => new Date(NOW - h * 3600_000).toISOString();

const mkReport = (over = {}) => ({
  config: { projects: [{ name: "smoke" }, { name: "layout-wide" }] },
  errors: [],
  stats: { startTime: freshAt },
  ...over,
});
const mkRan = (projects) =>
  projects.map((p, i) => ({
    title: `t${i}`,
    status: "expected",
    project: p,
    annotations: [],
  }));
const bothRan = mkRan(["smoke", "layout-wide"]);
const probs = (report, tests, opts = {}) =>
  reportProblems(report, tests, { now: NOW, ...opts });

check("揃っていれば問題なし", probs(mkReport(), bothRan), []);

// 中断した実行は「空」ではなく新鮮なレポートを書く（webServer起動失敗の実測）
const aborted = mkReport({
  errors: [{ message: "Error: Process from config.webServer...\n2行目" }],
  suites: [],
});
check("errorsがあれば落とす", probs(aborted, []).length, 2);
check(
  "errorsの1行目を出す",
  probs(aborted, []).some((p) => p.includes("config.webServer")),
  true,
);
check(
  "errorsの2行目は出さない",
  probs(aborted, []).some((p) => p.includes("2行目")),
  false,
);
check("テストが0件なら落とす", probs(mkReport(), []).length, 1);

// 設定にある6プロジェクトのうち1つが0件になっても、率はほとんど動かない。
// 実測: layout-* は各30件で、全体1086件に対し2.8%にすぎない
check(
  "プロジェクトが丸ごと欠けたら落とす",
  probs(mkReport(), mkRan(["smoke"])).length,
  1,
);
check(
  "欠けたプロジェクト名を出す",
  probs(mkReport(), mkRan(["smoke"]))[0].includes("layout-wide"),
  true,
);
// `config.projects` は --project で絞っても設定上の全件が載る（実測）ため、
// 一部だけ走らせた場合は呼び出し側が期待する集合を明示する
check(
  "期待する集合を絞れば通す",
  probs(mkReport(), mkRan(["smoke"]), { expectProjects: ["smoke"] }),
  [],
);
check(
  "絞った集合にも欠けていれば落とす",
  probs(mkReport(), mkRan(["smoke"]), {
    expectProjects: ["smoke", "layout-wide"],
  }).length,
  1,
);
check(
  "config.projectsが無ければプロジェクトは見ない",
  probs(mkReport({ config: {} }), mkRan(["smoke"])),
  [],
);

// 直下の e2e-results.json は実行開始時に消えないので、走らせずに採点しかけられる
check(
  "古いレポートは落とす",
  probs(mkReport({ stats: { startTime: hoursAgo(25) } }), bothRan).length,
  1,
);
check(
  "24時間ちょうどは通す",
  probs(mkReport({ stats: { startTime: hoursAgo(24) } }), bothRan),
  [],
);
check(
  "上限を延ばせば通す",
  probs(mkReport({ stats: { startTime: hoursAgo(25) } }), bothRan, {
    maxAgeHours: 48,
  }),
  [],
);
check(
  "上限を縮めれば落とす",
  probs(mkReport(), bothRan, { maxAgeHours: 0.001 }).length,
  1,
);
check(
  "実行時刻が無ければ落とす",
  probs(mkReport({ stats: {} }), bothRan).length,
  1,
);
check(
  "実行時刻が壊れていれば落とす",
  probs(mkReport({ stats: { startTime: "きのう" } }), bothRan).length,
  1,
);

// --- 理由ごとの集約とクラスタの検知 ---
// 率では薄まる。実測（2026-09-25）でも1086件中8件=0.7%と低いのに、
// そのうち7件は「本日開催中の未終了レースが見つからない」という同一条件だった。
const mkSkips = (reasons) =>
  reasons.map((r, i) => ({
    title: `t${i}`,
    status: "skipped",
    annotations: [{ type: "skip", description: r }],
  }));

const sample = mkSkips([
  ...Array(7).fill("開催中のレースが無い"),
  "行数が足りない",
]);
check(
  "件数の多い理由が先",
  groupByReason(sample)[0][0],
  "開催中のレースが無い",
);
check("理由の数", groupByReason(sample).length, 2);
check("まとまりを検知する", clusteredReasons(sample).length, 1);
check("まとまりの件数", clusteredReasons(sample)[0][1].length, 7);
check(
  "閾値未満のまとまりは拾わない",
  clusteredReasons(mkSkips(["a", "a", "b"])).length,
  0,
);
check(
  "閾値を下げれば拾う",
  clusteredReasons(mkSkips(["a", "a", "b"]), 2).length,
  1,
);
check("skipが無ければ空", clusteredReasons([]).length, 0);

if (failures.length > 0) {
  console.error("NG: E2Eのskip判定が期待どおりに動いていません");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`OK: E2Eのskip判定${checked}件を検証`);
