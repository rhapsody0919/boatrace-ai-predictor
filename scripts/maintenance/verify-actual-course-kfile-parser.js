/**
 * verify-actual-course-kfile-parser.js - BOA-257の進入コース(Kファイル方式)
 * パーサー（scripts/lib/kfileParser.js）のデータ精度検証。
 *
 * .claude/rules/analysis.md「データ精度の検証」に従い、コードレビューとは別に
 * 「集計結果が実データと一致しているか」だけを見る独立した検証として実施する。
 *
 * フィクスチャ: scripts/lib/__fixtures__/kfile/k260911.txt
 *   2026-09-11分の公式Kファイル（全国144レース分）を実際にダウンロード・解凍した
 *   実データそのもの（k{YYMMDD}.lzh、Shift_JIS固定幅テキスト）。
 *
 * 検証観点:
 *   1. 既知の個別レース（若松12R）の回帰確認: 4号艇が競走成績表で欠場（"K0"行）に
 *      なっており、K_RESULT_REが正しく除外してactual_course_4=nullになること
 *   2. 物理的整合性チェック（.claude/rules/analysis.md準拠）: 1号艇はほぼ進入変化が
 *      起きない（不一致率が極端に低いはず）のに対し、6号艇は前づけ等で進入変化が
 *      起きやすい（不一致率が明確に高いはず）。全艇が艇番=コース固定（不一致率0%）に
 *      戻っていたら旧バグ（race_results.course_1〜6と同じ問題）の再発を意味するため、
 *      「不一致が実際に一定数観測される」ことも合わせて検証する
 *   3. 全体の不一致率が、公式サイト（例: ボートレース福岡「枠番別コース取得率」）が
 *      公開する実績値（おおむね5〜20%のレンジ）と大きく乖離していないこと
 */
import fs from "node:fs";
import { parseKFileText } from "../lib/kfileParser.js";

const FIXTURE_PATH = new URL(
  "../lib/__fixtures__/kfile/k260911.txt",
  import.meta.url,
);

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    console.log(`✅ ${label}`);
  } else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

const text = fs.readFileSync(FIXTURE_PATH, "utf8");
const rows = parseKFileText(text, "2026-09-11");

// --- 1. 回帰確認: レース数・艇数 ---
check(
  "レース数の回帰確認(144レース)",
  rows.length === 144,
  `実際: ${rows.length}`,
);

let totalBoats = 0;
for (const row of rows) {
  for (let b = 1; b <= 6; b++) {
    if (row[`actual_course_${b}`] != null) totalBoats++;
  }
}
check(
  "艇データ件数の回帰確認(863件)",
  totalBoats === 863,
  `実際: ${totalBoats}`,
);

// --- 2. 既知の個別レース回帰確認: 若松(venue_code=20) 12R ---
// 4号艇（登番4274）が競走成績表で"K0"（欠場）行のため、K_RESULT_REにマッチせず
// actual_course_4はnullになるのが正しい挙動（欠場艇に進入コースは存在しないため）。
const wakamatsuR12 = rows.find(
  (r) => r.venue_code === 20 && r.race_number === 12,
);
check("若松12Rが抽出できている", !!wakamatsuR12);
if (wakamatsuR12) {
  check(
    "若松12R: 4号艇は欠場のためactual_course_4=null",
    wakamatsuR12.actual_course_4 === null,
    `実際: ${wakamatsuR12.actual_course_4}`,
  );
  check(
    "若松12R: 1〜3号艇は前づけ無しでcourse=艇番",
    wakamatsuR12.actual_course_1 === 1 &&
      wakamatsuR12.actual_course_2 === 2 &&
      wakamatsuR12.actual_course_3 === 3,
  );
  check(
    "若松12R: 5・6号艇は前づけあり(6号艇が5コースに、5号艇が4コースに進入)",
    wakamatsuR12.actual_course_5 === 4 && wakamatsuR12.actual_course_6 === 5,
  );
}

// --- 3. 物理的整合性チェック（.claude/rules/analysis.md準拠） ---
const byBoat = {
  1: [0, 0],
  2: [0, 0],
  3: [0, 0],
  4: [0, 0],
  5: [0, 0],
  6: [0, 0],
};
let mismatches = 0;
for (const row of rows) {
  for (let b = 1; b <= 6; b++) {
    const course = row[`actual_course_${b}`];
    if (course == null) continue;
    byBoat[b][1]++;
    if (course !== b) {
      byBoat[b][0]++;
      mismatches++;
    }
  }
}
const rate = (b) => (byBoat[b][1] > 0 ? byBoat[b][0] / byBoat[b][1] : null);
const overallRate = mismatches / totalBoats;

console.log("");
console.log("艇番別 不一致率:");
for (let b = 1; b <= 6; b++) {
  const r = rate(b);
  console.log(
    `  ${b}号艇: ${byBoat[b][0]}/${byBoat[b][1]} = ${r == null ? "n/a" : (r * 100).toFixed(1) + "%"}`,
  );
}
console.log(
  `全体: ${mismatches}/${totalBoats} = ${(overallRate * 100).toFixed(1)}%`,
);
console.log("");

// 1号艇はスタートの有利さから進入変化がほぼ起きない（旧バグの再発防止も兼ねて
// 「0%であること」ではなく「極端に低いこと」を見る＝将来1件でも実例が混ざっても
// 過剰反応しない）
check(
  "1号艇の不一致率は極端に低い(<=5%)",
  rate(1) !== null && rate(1) <= 0.05,
  `実際: ${((rate(1) ?? 0) * 100).toFixed(1)}%`,
);
// 6号艇は前づけ等で進入変化が起きやすい。旧バグ（全艇が艇番=コース固定）の
// 再発を検知するため「明確に高い」ことを検証する
check(
  "6号艇の不一致率は明確に高い(>=10%)",
  rate(6) !== null && rate(6) >= 0.1,
  `実際: ${((rate(6) ?? 0) * 100).toFixed(1)}%`,
);
check(
  "6号艇の不一致率は1号艇より明確に高い(単調増加傾向)",
  rate(6) !== null && rate(1) !== null && rate(6) > rate(1),
);
// 艇番が増えるほど不一致率も単調に増加する傾向（外側の艇ほど前づけで
// 内側コースを主張しやすい、または外に押し出されやすい）を確認する
let monotonicViolations = 0;
for (let b = 2; b <= 6; b++) {
  if (rate(b) !== null && rate(b - 1) !== null && rate(b) < rate(b - 1)) {
    monotonicViolations++;
  }
}
check(
  "艇番が増えるほど不一致率が概ね単調増加(逆転は1回まで許容)",
  monotonicViolations <= 1,
  `逆転回数: ${monotonicViolations}`,
);
// 公式サイト公開値（枠番別コース取得率、おおむね5〜20%レンジ）との整合性
check(
  "全体不一致率が公式実績と矛盾しないレンジ(5%〜20%)",
  overallRate >= 0.05 && overallRate <= 0.2,
  `実際: ${(overallRate * 100).toFixed(1)}%`,
);

console.log("");
console.log(failures === 0 ? "✅ 全て合格" : `❌ ${failures}件失敗`);
process.exit(failures === 0 ? 0 : 1);
