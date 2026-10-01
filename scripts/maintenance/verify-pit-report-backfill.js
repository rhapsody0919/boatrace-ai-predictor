/**
 * verify-pit-report-backfill.js - ピットレポートの取り直し（BOA-611、backfill-pit-reports.js）の対象の選び方と集計の検証。
 * DBにも取得先にも接続しない（純関数だけを検証する）。
 *
 *   (a) 対象: 対象レース（SG 全レース・G1/G2 の 7R 以降）のうち、行が無いもの・published でコメントが出走表の艇数に
 *       満たないものだけ。not_target・全艇そろったもの・対象外のグレードやレース番号は選ばない。出走表が読めない
 *       レースは、取り直す側に倒す
 *   (b) 集計: 前後のコメント数・増えたレース数・書き込み行数。取得に失敗したレースは今の件数のまま数える
 *   (c) 変異検証: 選び方・集計を壊した版で、上の検証が失敗する
 *
 * 実行: node scripts/maintenance/verify-pit-report-backfill.js
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as real from "./backfill-pit-reports.js";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

const race = (id, grade, number) => ({
  race_id: id,
  race_grade: grade,
  race_number: number,
});
const RACES = [
  race("2026-09-30-16-07", "G1", 7), // published 1艇 → 取り直す
  race("2026-09-30-16-08", "G1", 8), // published 6艇 → そろっている
  race("2026-09-30-16-09", "G1", 9), // 行なし → 取り直す
  race("2026-09-30-16-10", "G1", 10), // not_target → 取り直さない
  race("2026-09-30-16-01", "G1", 1), // G1 の 1R → 対象外
  race("2026-09-30-03-12", "G3", 12), // G3 → 対象外
  race("2026-09-30-16-11", "G1", 11), // published 5艇・出走表5艇（欠場）→ そろっている
  race("2026-09-30-16-12", "G1", 12), // published 3艇・出走表が読めない → 取り直す
  race("2026-09-30-24-01", "SG", 1), // SG の 1R、published 2艇 → 取り直す
];
const REPORTS = [
  { race_id: "2026-09-30-16-07", status: "published", comment_count: 1 },
  { race_id: "2026-09-30-16-08", status: "published", comment_count: 6 },
  { race_id: "2026-09-30-16-10", status: "not_target", comment_count: 0 },
  { race_id: "2026-09-30-16-11", status: "published", comment_count: 5 },
  { race_id: "2026-09-30-16-12", status: "published", comment_count: 3 },
  { race_id: "2026-09-30-24-01", status: "published", comment_count: 2 },
];
const ENTRY_COUNTS = new Map([
  ["2026-09-30-16-07", 6],
  ["2026-09-30-16-08", 6],
  ["2026-09-30-16-09", 6],
  ["2026-09-30-16-10", 6],
  ["2026-09-30-16-11", 5],
  ["2026-09-30-24-01", 6],
]);

function evaluate(m) {
  const failed = [];
  const expect = (label, pass) => {
    if (!pass) failed.push(label);
  };
  const plan = m.planPitReportBackfill(RACES, REPORTS, ENTRY_COUNTS);
  const ids = plan.map((t) => `${t.race_id}:${t.reason}:${t.before}`);
  expect(
    "(a) 対象は、コメント不足・行なし・出走表が読めない・SG の1R の4件だけ（race_id の順）",
    JSON.stringify(ids) ===
      JSON.stringify([
        "2026-09-30-16-07:incomplete:1",
        "2026-09-30-16-09:missing:0",
        "2026-09-30-16-12:incomplete:3",
        "2026-09-30-24-01:incomplete:2",
      ]),
  );

  const t = (before) => ({ before });
  const summary = m.summarizePitReportBackfill([
    { target: t(1), result: { outcome: "ok", rowsParsed: 6, rowsWritten: 6 } },
    { target: t(0), result: { outcome: "ok", rowsParsed: 4, rowsWritten: 5 } },
    { target: t(3), result: { outcome: "ok", rowsParsed: 3, rowsWritten: 0 } },
    { target: t(2), result: { outcome: "error", error: "HTTP 500" } },
  ]);
  expect(
    "(b) 集計: コメント 6→15件・増えたレース2・書き込み11行・失敗は今の件数のまま",
    summary.races === 4 &&
      summary.commentsBefore === 6 &&
      summary.commentsAfter === 15 &&
      summary.increasedRaces === 2 &&
      summary.rowsWritten === 11 &&
      summary.outcomes.ok === 3 &&
      summary.outcomes.error === 1,
  );
  return failed;
}

const realFailed = evaluate(real);
check(
  "(a)(b) 対象の選び方・集計",
  realFailed.length === 0,
  realFailed.join(" / "),
);

// (c) 変異検証: 本体の文字列を置き換えた版を一時ファイルに書いて評価する
const SOURCE = fs.readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "backfill-pit-reports.js",
  ),
  "utf8",
);
const MUTANTS = [
  ["not_target も取り直す", 'if (report.status !== "published") continue;', ""],
  ["全艇そろったレースも取り直す", "before < expected", "before <= expected"],
  [
    "出走表が読めないレースを飛ばす",
    "expected === null || before < expected",
    "expected !== null && before < expected",
  ],
  [
    "対象外のグレード・レース番号も取り直す",
    "      continue;\n    }\n    const expected",
    "    }\n    const expected",
  ],
  [
    "取得に失敗したレースを0件として数える",
    'result.outcome === "error" ? target.before : parsed',
    "parsed",
  ],
];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pit-backfill-"));
for (const [label, from, to] of MUTANTS) {
  if (!SOURCE.includes(from)) {
    check(`(c) 変異検証: ${label} → 置き換え元が見つかる`, false, from);
    continue;
  }
  const file = path.join(
    dir,
    `${failures}-${MUTANTS.indexOf(MUTANTS.find((x) => x[0] === label))}.mjs`,
  );
  // import の相対パスを本体の場所に合わせる
  const libUrl = pathToFileURL(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../lib/"),
  ).href;
  fs.writeFileSync(
    file,
    SOURCE.replace(from, to).replaceAll('from "../lib/', `from "${libUrl}`),
  );
  let failed;
  try {
    failed = evaluate(await import(pathToFileURL(file).href));
  } catch (e) {
    failed = [`例外: ${e.message}`];
  }
  check(
    `(c) 変異検証: ${label} → 検証が失敗する（${failed.length}項目）`,
    failed.length > 0,
  );
}
fs.rmSync(dir, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures}件の検証が失敗しました`);
  process.exit(1);
}
console.log("\nALL OK");
