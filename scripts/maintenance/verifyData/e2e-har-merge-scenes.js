/**
 * verify-e2e-har-merge.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-e2e-har-merge.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { viewportSkipReason } from "../../../e2e/viewport-skip.js";
import {
  notifiedInJobs,
  NOTIFY_STEP_PREFIX,
  countResults,
  judgeAdoption,
} from "../e2e-recording.js";
import { summarize, toMarkdown, MARKER } from "../report-e2e-passthrough.js";

let check;
let counts, viewportCounts, rows;

// --- 自動撮り直しの採用判定（全件通過・skip が増えていない）
const report = (statuses) => ({
  suites: [
    {
      title: "a.spec.js",
      specs: statuses.map((status, i) => ({
        title: `t${i}`,
        tests: [{ status }],
      })),
    },
  ],
});

// BOA-929: 画面幅だけで決まる skip（e2e/viewport-skip.js の印）は skipped に数えない。
// 2026-10-24 の撮り直しは、layout.spec.js の画面幅の skip 28件で「現行 0件 → 新 28件」と不採用になった。
// 印は付けた側の申告なので、同じテストがどのプロジェクトでも走っていなければ数えに戻す
const vp = (reason) => ({
  type: "skip",
  description: viewportSkipReason(reason),
});

const dataSkip = {
  type: "skip",
  description: "本日開催中の未終了レースが見つからない",
};

// tests: [title, status, annotation] のうち、題ごとに [skip, 走った] の2プロジェクトを作る
const projectReport = (rows) => ({
  suites: [
    {
      title: "layout.spec.js",
      file: "layout.spec.js",
      specs: rows.map(([title, tests]) => ({
        title,
        tests: tests.map(([projectName, status, annotation]) => ({
          projectName,
          status,
          annotations: annotation ? [annotation] : [],
        })),
      })),
    },
  ],
});

function scene1() {
  check(
    "通知ステップが動いた実行だけを通知済みとみなす",
    [
      notifiedInJobs([
        { steps: [{ name: `${NOTIFY_STEP_PREFIX} (x)`, conclusion: "success" }] },
      ]),
      notifiedInJobs([
        { steps: [{ name: `${NOTIFY_STEP_PREFIX} (x)`, conclusion: "skipped" }] },
      ]),
      notifiedInJobs([{ steps: [{ name: "録画", conclusion: "success" }] }]),
      notifiedInJobs(undefined),
    ],
    [true, false, false, false],
  );
  counts = countResults(
    report(["expected", "skipped", "unexpected", "flaky"]),
  );
  check("件数の数え方（flaky は失敗に数えない）", counts, {
    tests: 4,
    skipped: 1,
    viewportSkipped: 0,
    failed: 1,
    flaky: 1,
    errors: 0,
  });
  viewportCounts = countResults(
    projectReport([
      [
        "1440",
        [
          ["layout-mobile", "skipped", vp("1440pxで確認")],
          ["layout-desktop", "expected"],
        ],
      ],
      [
        "smp",
        [
          ["layout-wide", "skipped", vp("スマホ幅でだけ溢れる画面")],
          ["layout-mobile", "expected"],
        ],
      ],
      ["data", [["smoke", "skipped", dataSkip]]],
      ["noreason", [["smoke", "skipped", null]]],
      // 印はあるが、どのプロジェクトでも走っていない（データ依存の条件に印を付けた）
      [
        "mislabeled",
        [
          ["layout-mobile", "skipped", vp("PC幅だけ")],
          ["layout-desktop", "skipped", vp("PC幅だけ")],
        ],
      ],
    ]),
  );
  check(
    "画面幅の skip は skipped から外し viewportSkipped に数える。全プロジェクトで skip なら数えに戻す",
    [viewportCounts.skipped, viewportCounts.viewportSkipped],
    [4, 2],
  );
  check(
    "画面幅の skip だけが増えても採用する（10/24 の不採用の再現: 現行 0件）",
    judgeAdoption(
      countResults(
        projectReport(
          Array.from({ length: 28 }, (_, i) => [
            `t${i}`,
            [
              ["layout-mobile", "skipped", vp("PC幅（1025px以上）だけの指定")],
              ["layout-desktop", "expected"],
            ],
          ]),
        ),
      ),
      { skipped: 0 },
    ).reasons.filter((r) => r.startsWith("skip")),
    [],
  );
  check(
    "印の無い skip（データ依存）が増えたら不採用のまま",
    judgeAdoption(
      countResults(projectReport([["data", [["smoke", "skipped", dataSkip]]]])),
      { skipped: 0 },
    ).reasons.some((r) => r.startsWith("skip")),
    true,
  );
  check(
    "全件通過・skip 同数なら採用",
    judgeAdoption({ tests: 10, skipped: 1, failed: 0, errors: 0 }, { skipped: 1 })
      .adopt,
    true,
  );
}

function scene2() {
  check(
    "skip が増えたら不採用",
    judgeAdoption({ tests: 10, skipped: 2, failed: 0, errors: 0 }, { skipped: 1 })
      .adopt,
    false,
  );
  check(
    "失敗があれば不採用",
    judgeAdoption({ tests: 10, skipped: 0, failed: 1, errors: 0 }, { skipped: 5 })
      .adopt,
    false,
  );
  check(
    "1件も走っていなければ不採用",
    judgeAdoption({ tests: 0, skipped: 0, failed: 0, errors: 0 }, null).adopt,
    false,
  );
  check(
    "現行の録画が無ければ skip は比べない",
    judgeAdoption({ tests: 10, skipped: 3, failed: 0, errors: 0 }, null).adopt,
    true,
  );
  check(
    "レポートに問題（途中停止・プロジェクト0件）があれば不採用",
    judgeAdoption({ tests: 10, skipped: 0, failed: 0, errors: 0 }, null, ["x"])
      .adopt,
    false,
  );
  // --- 素通し一覧（黙って本番依存に戻らないよう、PR に必ず出す）
  rows = summarize([
    { method: "GET", url: "/rest/v1/a", test: "x", project: "smoke" },
    { method: "GET", url: "/rest/v1/a", test: "y", project: "smoke" },
    { method: "GET", url: "/rest/v1/a", test: "x", project: "smoke" },
    { method: "POST", url: "/rest/v1/rpc/b", test: "z", project: "layout-wide" },
  ]);
  check("同じ通信は1行にまとめ、テストを重複なく並べる", rows[0].tests, [
    "[smoke] x",
    "[smoke] y",
  ]);
  check("通信の種類数", rows.length, 2);
  check(
    "0件でも目印付きで出す（PRコメントを更新できるように）",
    toMarkdown([]).startsWith(MARKER),
    true,
  );
  check(
    "E2E が走らなかったときは 0件 と書かない",
    toMarkdown([], { ran: false }).includes("0件"),
    false,
  );
  check(
    "素通しがあれば URL を表に出す",
    toMarkdown(rows).includes("/rest/v1/rpc/b"),
    true,
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（check） */
export function runE2eHarMergeScenes1(env) {
  ({ check } = env);
  scene1();
  scene2();
}
