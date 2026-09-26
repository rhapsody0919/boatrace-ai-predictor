#!/usr/bin/env node
/**
 * bug-cause-report.js の判定を検証する。
 *
 * この集計が壊れると、4〜6週間後の計測で対象の取りこぼし・水増しが起きる。
 * そのとき第1期と比較できなくなり、対策が効いたかどうかが永久に分からない。
 * 絞り込みの条件を固定の入力で確かめる。
 */

import {
  BASELINE,
  isFixCommit,
  isPreMergeFix,
  perPr,
} from "./bug-cause-report.js";

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

// --- fixコミットの判定 ---
check("通常のfix", isFixCommit("fix: 何かを直す"), true);
check("スコープ付き", isFixCommit("fix(scope): 何かを直す"), true);
check("featは対象外", isFixCommit("feat: 何かを足す"), false);
check("docsは対象外", isFixCommit("docs: 何かを書く"), false);
check(
  "マージコミットは対象外",
  isFixCommit("Merge pull request #1 from x"),
  false,
);
check("本文中のfixは拾わない", isFixCommit("feat: fix という語を含む"), false);
check("prefixが無いものは対象外", isFixCommit("何かを直す"), false);

// --- マージ前に捕捉されたfixの除外 ---
// 第1期はこの絞り込みで 169件 → 147件になった。基準を変えると比較できなくなる
check(
  "セルフレビュー由来は除く",
  isPreMergeFix("fix: セルフレビューの指摘3件を修正する"),
  true,
);
check("レビュー指摘は除く", isPreMergeFix("fix: レビュー指摘を反映"), true);
check(
  "フィードバックは除く",
  isPreMergeFix("fix: 実機確認フィードバック6件を反映"),
  true,
);
check(
  "本文に書かれていても除く",
  isPreMergeFix("fix: 何かを直す\n\nセルフレビューで発見した"),
  true,
);
check(
  "本番で発覚したものは残す",
  isPreMergeFix("fix: 本番でバッジが表示されない不具合を直す"),
  false,
);
check(
  "取得失敗系は残す",
  isPreMergeFix("fix: 取得エラーを既定で例外にする"),
  false,
);

// --- 正規化 ---
check("1PRあたりに直す", perPr(39, 125), 0.312);
check("小数第3位まで", perPr(1, 3), 0.333);
check("分母が0なら計算しない", perPr(10, 0), null);
check("分子が0", perPr(0, 130), 0);

// --- ベースラインの整合 ---
// docs/operation/bug-cause-measurement.md の表と食い違うと比較が狂う
const sum = Object.values(BASELINE.byCause).reduce((a, b) => a + b, 0);
check("原因別の合計が分類件数と一致する", sum, BASELINE.classified);
check("分類件数", BASELINE.classified, 147);
// このスクリプトの数え方に揃えた値。第2期も同じ数え方をする
check("マージPR数", BASELINE.mergedPrs, 125);
check("最多はR4", Object.entries(BASELINE.byCause)[0][1], 39);

if (failures.length > 0) {
  console.error("NG: バグ原因レポートの集計が期待どおりに動いていません");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`OK: バグ原因レポートの集計${checked}件を検証`);
