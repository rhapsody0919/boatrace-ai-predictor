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
check("1件も無いレポートは落とさない", judge([], 0.15).ok, true);
check("全部skipなら落とす", judge(mk(10, 10), 0.15).ok, false);
check("上限1.0なら全skipでも通す", judge(mk(10, 10), 1).ok, true);

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
