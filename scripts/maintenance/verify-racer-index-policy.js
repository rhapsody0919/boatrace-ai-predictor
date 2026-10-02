#!/usr/bin/env node
/**
 * src/utils/racerIndexPolicy.js（選手ページのインデックス判定）を固定の入力で検証する。
 *
 * ページ側の noindex と sitemap が同じ関数を使うので、ここが崩れると両方が同時にずれる。
 * 崩れると、B 級の薄いページが大量にインデックスされる（サイト全体の評価を下げる）か、
 * 現役の A1 選手が noindex に戻る（選手名検索の入口を失う）。
 */
import { isRacerIndexable } from "../../src/utils/racerIndexPolicy.js";

const failures = [];
let checked = 0;
function check(label, actual, expected) {
  checked += 1;
  if (actual !== expected) {
    failures.push(`${label}: 期待 ${expected} / 実際 ${actual}`);
  }
}
const SINCE = "2026-09-02"; // 今日 2026-10-02 の30日前
const p = (o) => ({
  hasNews: false,
  latestGrade: "A1",
  latestRaceDate: "2026-09-30",
  activeSince: SINCE,
  ...o,
});

check("現役の A1 は index", isRacerIndexable(p({})), true);
check(
  "A1 で境界の日（30日前ちょうど）は index",
  isRacerIndexable(p({ latestRaceDate: SINCE })),
  true,
);
check(
  "A1 でも31日以上出走が無ければ noindex",
  isRacerIndexable(p({ latestRaceDate: "2026-09-01" })),
  false,
);
check(
  "A2 は noindex（第1段階）",
  isRacerIndexable(p({ latestGrade: "A2" })),
  false,
);
check("B1 は noindex", isRacerIndexable(p({ latestGrade: "B1" })), false);
check(
  "「A1級」（racer_profiles の表記）は A1 とみなさない",
  isRacerIndexable(p({ latestGrade: "A1級" })),
  false,
);
check(
  "級が不明（null）は noindex",
  isRacerIndexable(p({ latestGrade: null })),
  false,
);
check(
  "出走日が不明（null）は noindex",
  isRacerIndexable(p({ latestRaceDate: null })),
  false,
);
check(
  "ニュースがあれば B1 でも index（従来の条件）",
  isRacerIndexable(p({ hasNews: true, latestGrade: "B1" })),
  true,
);
check(
  "ニュースがあれば出走が古くても index",
  isRacerIndexable(
    p({ hasNews: true, latestGrade: null, latestRaceDate: null }),
  ),
  true,
);

if (failures.length > 0) {
  console.error(
    `❌ verify-racer-index-policy: ${failures.length}/${checked} 件失敗`,
  );
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✅ verify-racer-index-policy: ${checked} 件すべて通過`);
