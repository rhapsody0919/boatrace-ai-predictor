/**
 * verify-volatility-accuracy-heading.js - 精度ページの「イン崩れ予測の実績」の見出しが、集計の期間と合っているか（BOA-717）
 *
 * 見出しは「直近90日」だったが、集計（scripts/daily/calculate-unified-volatility-accuracy.js）は期間を絞らず、
 * unified の運用開始（2026-08-11）以降の全件を accuracy_cache.unified_volatility_accuracy に書いている。
 * 運用開始から90日を超える 2026-11-09 以降、見出しと中身が食い違う。見出しを集計に合わせた（公開している数字は変えない）。
 *
 *   (a) 集計が期間を絞っていない（race_id・日付の範囲の条件が無い）なら、4言語の見出しが「直近N日」を名乗らず、
 *       運用開始日を書いている
 *   (b) 集計に期間の条件を足した場合は、この検証が失敗する。見出しを集計の期間に合わせ直してから、ここを更新する
 *       （集計の main を偽の DB（verifyData/aggregate-racer-stats-fake-db.js）で回し、predictions・race_results への
 *       問い合わせに gte/gt/lte/lt の範囲の条件が無いことと、accuracy_cache へ書いたことを記録で見る。実 DB に触らない）
 *
 * 実行: node scripts/maintenance/verify-volatility-accuracy-heading.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  fakeDb,
  loadVolatilityAccuracy,
  chainsOf,
  quietly,
} from "./verifyData/aggregate-racer-stats-fake-db.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

// 集計を偽の DB で回し、期間の条件（race_id・日付・作成日時の範囲）が無いことを問い合わせの記録で見る
const db = fakeDb({
  tables: {
    predictions: [
      {
        race_id: "2026-10-01-01-01",
        model_id: "unified",
        feature_contributions: {
          volatilityPercentile: 0.8,
          volatilityPercentileIsFallback: false,
        },
      },
      {
        race_id: "2026-10-01-01-02",
        model_id: "unified",
        feature_contributions: {
          volatilityPercentile: 0.2,
          volatilityPercentileIsFallback: false,
        },
      },
    ],
    race_results: [
      { race_id: "2026-10-01-01-01", rank1: 3, is_cancelled: false, race_status: "normal" },
      { race_id: "2026-10-01-01-02", rank1: 1, is_cancelled: false, race_status: "normal" },
    ],
  },
});
const { main } = await loadVolatilityAccuracy();
await quietly(() => main());
const WINDOW_COLUMNS = new Set(["race_id", "race_date", "created_at", "result_at"]);
const hasWindow = ["predictions", "race_results"].some((table) =>
  chainsOf(db, table).some((c) =>
    c.some(
      (q) =>
        ["gte", "gt", "lte", "lt"].includes(q.method) &&
        WINDOW_COLUMNS.has(q.args[0]),
    ),
  ),
);
const wrote = db.writes.find(
  (w) => w.table === "accuracy_cache" && w.rows?.key === "unified_volatility_accuracy",
);
check(
  "(b) 集計（calculate-unified-volatility-accuracy.js）は期間を絞っていない（絞るなら見出しを合わせ直してから、この検証を更新する）",
  !hasWindow &&
    chainsOf(db, "predictions").length > 0 &&
    wrote?.rows?.data?.baseline?.raceCount === 2,
);

const ROLLING = {
  ja: /直近\s*\d+\s*日/,
  en: /last\s+\d+\s+days/i,
  ko: /최근\s*\d+\s*일/,
  "zh-TW": /過去\s*\d+\s*天/,
};
const LAUNCH = {
  ja: "2026年8月11日",
  en: "August 11, 2026",
  ko: "2026년 8월 11일",
  "zh-TW": "2026年8月11日",
};
for (const lang of Object.keys(ROLLING)) {
  const title = JSON.parse(read(`src/locales/${lang}/common.json`))
    .volatilityAccuracy.title;
  check(
    `(a) ${lang}: 見出しが「直近N日」を名乗らず、運用開始日（${LAUNCH[lang]}）を書いている`,
    !ROLLING[lang].test(title) && title.includes(LAUNCH[lang]),
    title,
  );
}

if (failures > 0) {
  console.error(`\n${failures}件の検証が失敗しました`);
  process.exit(1);
}
console.log("\nALL OK");
