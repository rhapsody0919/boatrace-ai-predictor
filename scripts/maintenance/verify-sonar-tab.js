/**
 * 龍神ソナーの別タブ化（BOA-271、2026-10-08 承認モック sonar-tab v3）の純粋関数の検査（ci）。
 *
 * 1. 開いたときのタブ（src/utils/raceUrlState.js の resolveInitialRaceTab）: 移す前に投稿した
 *    ?tab=aiPrediction&sonar=… はソナーのタブ。sonar= の無いもの・不正な値は AI予想のまま。
 *    ソナーのタブを出していない（機能フラグを戻した）ときは、旧リンクも AI予想で開く（code-review 指摘）
 * 2. GA4 の page_view の URL（pageViewPath）から ?sonar= を除く（押すたびに PV が増えないため）
 * 3. ソナーの輪（src/utils/analogySonar.js の sonarRings）: 外周（今の件数）より小さい番目だけで、隣の輪・外周と
 *    24以上離れ、3本まで
 *
 * 使い方: node scripts/maintenance/verify-sonar-tab.js
 */
import {
  pageViewPath,
  parseSonarParam,
  resolveInitialRaceTab,
} from "../../src/utils/raceUrlState.js";
import { sonarRings } from "../../src/utils/analogySonar.js";

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(
    `${ok ? "OK" : "NG"}: ${name}${ok ? "" : `（期待 ${JSON.stringify(want)}、実際 ${JSON.stringify(got)}）`}`,
  );
};

// 1. 開いたときのタブ
check(
  "旧リンク ?tab=aiPrediction&sonar=similar はソナー",
  resolveInitialRaceTab("aiPrediction", "similar"),
  "sonar",
);
check(
  "?tab=aiPrediction（sonar 無し）は AI予想",
  resolveInitialRaceTab("aiPrediction", null),
  "aiPrediction",
);
check(
  "?sonar= が不正な値なら AI予想",
  resolveInitialRaceTab("aiPrediction", "odds"),
  "aiPrediction",
);
check(
  "?tab=sonar はそのまま",
  resolveInitialRaceTab("sonar", "scenario"),
  "sonar",
);
check(
  "ほかのタブの ?sonar= は無視",
  resolveInitialRaceTab("meet", "facts"),
  "meet",
);
check(
  "フラグを戻したときの旧リンクは AI予想",
  resolveInitialRaceTab("aiPrediction", "similar", false),
  "aiPrediction",
);
check("tab 無しは null のまま", resolveInitialRaceTab(null, "similar"), null);
check(
  "parseSonarParam は3つだけ",
  ["facts", "similar", "scenario", "x", null].map(parseSonarParam),
  ["facts", "similar", "scenario", null, null],
);

// 2. page_view
check(
  "page_view から tab・sonar を除く",
  pageViewPath("/race/2026-10-08-01-10", "?tab=sonar&sonar=similar"),
  "/race/2026-10-08-01-10",
);
check(
  "言語つきのパスでも除く",
  pageViewPath("/en/race/2026-10-08-01-10", "?sonar=facts&x=1"),
  "/en/race/2026-10-08-01-10?x=1",
);

// 3. 輪（SimilarSonar と同じ置き方）
const R = 188;
const rOfFor = (n) => (rk) =>
  n < 100
    ? 18 + ((R - 24) * Math.max(1, rk)) / Math.max(n, 1)
    : 18 + ((R - 24) * Math.log10(Math.max(1, rk))) / Math.log10(n);
for (const n of [15, 40, 60, 100, 400, 800]) {
  const rOf = rOfFor(n);
  const rings = sonarRings(n, rOf);
  const rs = rings.map(rOf);
  const gaps = rs.every((r, i) => i === 0 || r - rs[i - 1] >= 24);
  const outer = rs.every((r) => rOf(n) - r >= 24);
  check(
    `${n}件: 輪は外周より内・24以上離れて3本まで（${rings.join("・")}）`,
    rings.length <= 3 && rings.every((k) => k < n) && gaps && outer,
    true,
  );
}
check("件数1以下は輪なし", sonarRings(1, rOfFor(1)), []);

if (failed) {
  console.error(`NG: ${failed}件`);
  process.exit(1);
}
console.log("OK: 龍神ソナーの別タブ化の純粋関数");
