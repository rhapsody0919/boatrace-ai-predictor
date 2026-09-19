/**
 * measure-unchanged-writes.js - 「変更の無い行は書かない」（WS8(b)）の効果を、DBへ一切書き込まずに
 * 実測するdry-run。従来は全行を書いていた箇所で、変更のある行が何件だったかを数える。
 *
 * 使い方（DBは読み取りのみ。対象日1日分。1セクション=数回のSELECT）:
 *   node scripts/maintenance/measure-unchanged-writes.js --section=actual-course --date=2026-09-16
 *   node scripts/maintenance/measure-unchanged-writes.js --section=race-info,volatility --date=2026-09-18
 *
 * セクション:
 *   actual-course: BOA-349の進入コース同期（syncActualCourseFromKFile）。進入コースが全艇未取得の
 *                  滞留レースを含む日を指定する（そうでない日は「未取得なし」で即終了する）
 *   race-info:     update-race-info.js の race_entries / race_conditions / races.race_grade。
 *                  対象日の全レースを「発走60分前」とみなして、公式サイトから取り直した値と
 *                  DB上の値を比較する（取得済みレースの再取得＝実運用の2回目以降の取得に相当）
 *   volatility:    generate-predictions.js のリフレッシュ（races.volatility系の更新）。
 *                  DB上のデータから予測を再計算し、races の現在値と比較する
 */
import { getRaceSchedule } from "../lib/raceSchedule.js";
import { parseDateArg } from "../lib/dateUtils.js";

const args = process.argv.slice(2);
const sections = (
  args.find((a) => a.startsWith("--section="))?.split("=")[1] ?? ""
)
  .split(",")
  .filter(Boolean);
const date = parseDateArg(args);
const KNOWN_SECTIONS = ["actual-course", "race-info", "volatility"];

if (
  sections.length === 0 ||
  !date ||
  sections.some((s) => !KNOWN_SECTIONS.includes(s))
) {
  console.error(
    "使い方: node scripts/maintenance/measure-unchanged-writes.js --section=actual-course,race-info,volatility（カンマ区切りで複数可） --date=YYYY-MM-DD",
  );
  process.exit(1);
}

console.log(
  `[DRY-RUN] sections=${sections.join(",")} date=${date}（DBへの書き込みは行いません）`,
);

const schedule = sections.some((s) => s !== "actual-course")
  ? await getRaceSchedule(date)
  : [];

for (const section of sections) {
  console.log(`\n===== ${section} =====`);
  if (section === "actual-course") {
    const { syncActualCourseFromKFile } =
      await import("../daily/scrape-results.js");
    const result = await syncActualCourseFromKFile(date, { dryRun: true });
    console.log(
      `結果: 書くはずのUPDATE ${result.updated}件 / 変更なしでスキップ ${result.skipped}件` +
        "（両方0件で他のログが無い場合は、進入コース未取得のレースが無く、Kファイルの取得も不要と判定された）",
    );
  } else if (section === "race-info") {
    const { run } = await import("../daily/update-race-info.js");
    const startsInOneHour = new Date(Date.now() + 60 * 60 * 1000);
    const fakeSchedule = schedule.map((r) => ({
      ...r,
      start_time: startsInOneHour,
    }));
    console.log(`対象: ${fakeSchedule.length}レース`);
    await run(fakeSchedule, date, { dryRun: true });
  } else if (section === "volatility") {
    const { mainRefresh } = await import("../daily/generate-predictions.js");
    const specificRaceIds = schedule.map((r) => r.race_id);
    console.log(`対象: ${specificRaceIds.length}レース`);
    await mainRefresh({ isDryRun: true, specificRaceIds });
  }
}
