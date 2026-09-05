/**
 * X運用ルール遵守チェック
 *
 * docs/operation/x-operations-playbook.md に明文化された絶対厳守事項・運用ルールを
 * data/analysis/x-posts/history.json から機械的にチェックする。
 * これまで /x-growth-report はインプレッション等の実績数値は見ていたが、
 * 「そもそもルール通り運用できているか」を検証していなかった（2026-09-05発覚）。
 *
 * チェック項目:
 *   1. 1日の投稿本数上限（4本、動画＋ブログ告知＋引用リツイート合計）
 *   2. 同一記事の重複告知（2026-08-31/09-01に実際に発生した問題の再発検知）
 *   3. 型の連続（直近3投稿で同じ型が続いていないか）
 *   4. マスコットローテーション状況
 *
 * 使い方:
 *   node scripts/analysis/x-operations-compliance-report.js [--days=30]
 */
import fs from "fs";
import path from "path";

const DAYS = parseInt(
  (process.argv.find((a) => a.startsWith("--days=")) || "--days=30").split(
    "=",
  )[1],
  10,
);

const HISTORY_PATH = "data/analysis/x-posts/history.json";

function loadHistory() {
  if (!fs.existsSync(HISTORY_PATH)) {
    console.error(`❌ ${HISTORY_PATH} が見つかりません`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8"));
}

function withinWindow(dateStr, days) {
  const d = new Date(dateStr);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return d >= cutoff;
}

function checkDailyPostLimit(posts) {
  const byDate = {};
  posts
    .filter((p) => p.status === "posted" && withinWindow(p.date, DAYS))
    .forEach((p) => {
      byDate[p.date] = byDate[p.date] || [];
      byDate[p.date].push(p);
    });

  const violations = Object.entries(byDate)
    .filter(([, ps]) => ps.length > 4)
    .map(([date, ps]) => ({
      date,
      count: ps.length,
      contents: ps.map((p) => p.content?.slice(0, 30) || p.format),
    }));

  return { byDate, violations };
}

function checkDuplicateAnnouncements(posts) {
  // contentの冒頭20文字 + character が同一の投稿を重複告知候補として検出。
  // characterまで一致条件に含めるのは、マスコットA/B/Cテストで同一素材（例: 児島2R）を
  // 異なるキャラで意図的に使い回すケースを誤検知しないため（2026-09-05、実際にこの
  // 誤検知が発生し判定ロジックを修正した実例）
  const seen = {};
  const duplicates = [];
  posts
    .filter(
      (p) => p.status === "posted" && withinWindow(p.date, DAYS) && p.content,
    )
    .forEach((p) => {
      const key = `${p.character ?? ""}::${p.content.slice(0, 20)}`;
      if (seen[key]) {
        duplicates.push({
          dates: [seen[key].date, p.date],
          content: p.content.slice(0, 20),
        });
      } else {
        seen[key] = p;
      }
    });
  return duplicates;
}

function checkFormatRepetition(posts) {
  const sorted = posts
    .filter((p) => p.status === "posted")
    .sort((a, b) => a.date.localeCompare(b.date));
  const recent = sorted.slice(-6);
  const repeats = [];
  for (let i = 2; i < recent.length; i++) {
    if (
      recent[i].format &&
      recent[i].format === recent[i - 1].format &&
      recent[i].format === recent[i - 2].format
    ) {
      repeats.push({
        format: recent[i].format,
        dates: [recent[i - 2].date, recent[i - 1].date, recent[i].date],
      });
    }
  }
  return repeats;
}

function summarizeByFormat(posts) {
  const withMetrics = posts.filter(
    (p) => p.metrics && typeof p.metrics.impressions === "number",
  );
  const byFormat = {};
  withMetrics.forEach((p) => {
    byFormat[p.format] = byFormat[p.format] || [];
    byFormat[p.format].push(p.metrics.impressions);
  });
  return Object.entries(byFormat).map(([format, impressions]) => ({
    format,
    count: impressions.length,
    avgImpressions: parseFloat(
      (impressions.reduce((a, b) => a + b, 0) / impressions.length).toFixed(1),
    ),
  }));
}

function main() {
  const history = loadHistory();
  const posts = history.posts || [];

  console.log(
    `\n📋 X運用ルール遵守チェック（直近${DAYS}日間、対象: ${HISTORY_PATH}）`,
  );
  console.log("=".repeat(50));

  const { byDate, violations } = checkDailyPostLimit(posts);
  console.log(`\n## 1日の投稿本数上限（4本）チェック`);
  console.log(`  対象日数: ${Object.keys(byDate).length}日`);
  if (violations.length === 0) {
    console.log("  ✅ 上限超過なし");
  } else {
    console.log(`  ⚠️  上限超過: ${violations.length}日`);
    violations.forEach((v) => {
      console.log(`    ${v.date}: ${v.count}本 — ${v.contents.join(" / ")}`);
    });
  }

  const duplicates = checkDuplicateAnnouncements(posts);
  console.log(`\n## 同一記事の重複告知チェック`);
  if (duplicates.length === 0) {
    console.log("  ✅ 重複告知なし");
  } else {
    console.log(`  ⚠️  重複告知の疑い: ${duplicates.length}件`);
    duplicates.forEach((d) => {
      console.log(`    ${d.dates.join(" と ")}: 「${d.content}...」`);
    });
  }

  const repeats = checkFormatRepetition(posts);
  console.log(`\n## 型の連続チェック（直近投稿で同じ型が3回続いていないか）`);
  if (repeats.length === 0) {
    console.log("  ✅ 型の連続なし");
  } else {
    repeats.forEach((r) => {
      console.log(`  ⚠️  「${r.format}」が3投稿連続: ${r.dates.join(", ")}`);
    });
  }

  const byFormat = summarizeByFormat(posts);
  console.log(
    `\n## 型別の平均インプレッション（metricsが記録されている投稿のみ）`,
  );
  if (byFormat.length === 0) {
    console.log("  データなし（metricsが未記録の投稿が大半）");
  } else {
    byFormat
      .sort((a, b) => b.avgImpressions - a.avgImpressions)
      .forEach((f) => {
        console.log(
          `  ${f.format.padEnd(25)} 平均${f.avgImpressions}（n=${f.count}）`,
        );
      });
  }

  console.log(`\n## マスコットローテーション状況`);
  console.log(`  ${history.mascotRotationStatus || "記録なし"}`);

  const timestamplessCount = posts.filter((p) => p.status === "posted").length;
  console.log(`\n## データ品質の注記`);
  console.log(
    `  ${timestamplessCount}件の投稿記録に投稿時刻（時:分）が含まれていない。「火〜木9-11時」仮説の検証には` +
      `時刻データが必須のため、history.json追記時に postedAtTime（HH:MM）フィールドの記録を推奨する`,
  );

  const outDir = "data/analysis/x-operations-compliance";
  fs.mkdirSync(outDir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const outPath = path.join(outDir, `report-${today}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        days: DAYS,
        dailyPostLimitViolations: violations,
        duplicateAnnouncements: duplicates,
        formatRepetitions: repeats,
        byFormatImpressions: byFormat,
        mascotRotationStatus: history.mascotRotationStatus || null,
        dataQualityNote:
          "postedAtTime（時刻）フィールドが未記録のため時間帯仮説は検証不能",
      },
      null,
      2,
    ),
  );
  console.log(`\n💾 保存: ${path.resolve(outPath)}`);
}

main();
