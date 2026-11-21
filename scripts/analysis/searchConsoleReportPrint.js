import { formatDelta } from "../lib/reportComparison.js";

function printRows(rows, keyWidth) {
  if (rows.length === 0) {
    console.log("  （データなし）");
    return;
  }
  for (const r of rows) {
    console.log(
      `  ${r.keys[0].padEnd(keyWidth)} clicks:${String(r.clicks).padStart(4)} impressions:${String(r.impressions).padStart(6)} ctr:${(r.ctr * 100).toFixed(2)}% position:${r.position.toFixed(1)}`,
    );
  }
}

// 新機能記事・分析ツール関連ページ（/growth-report・/growth-pdcaで毎回確認する対象）
function isFeatureOrArticlePage(url) {
  return /\/winning-technique(\?|$)/.test(url) || /\/blog\/.*-guide/.test(url);
}

// ブランド名検索クエリの判定（指名検索比率トラッキング用、2026-08-20追加）
// 「ボートレースai」等の一般語+AI検索は指名検索ではないため、ブランド名が
// 一語として連続している形のみをブランドクエリとみなす
// （新ブランド「龍神レーダー」移行後は新表記も追跡し、旧表記からの移行状況を見る）
const OLD_BRAND_PATTERN = /boat\s*ai\b|ボート\s*ai\b|ボートアイ/i;
const NEW_BRAND_PATTERN =
  /龍神\s*レーダー|りゅうじん\s*レーダー|ryujin\s*radar|龍神\s*雷達|용신\s*레이더/i;

function classifyBrandQuery(query) {
  if (NEW_BRAND_PATTERN.test(query)) return "new";
  if (OLD_BRAND_PATTERN.test(query)) return "old";
  return null;
}

// CTR-vs-掲載順位ギャップ分析（2026-08-20追加）
// 業界一般的な順位別平均CTRの目安値（Advanced Web Ranking等の公開データを参考にした概算）。
// 「順位は妥当なのにCTRが低い」→タイトル/メタディスクリプションの問題
// 「CTRは高いのに順位が低い」→コンテンツ自体は検索意図に合っているが、権威（被リンク等）不足の可能性
const CTR_BENCHMARK_BUCKETS = [
  { maxPosition: 1.5, expectedCtr: 0.28 },
  { maxPosition: 2.5, expectedCtr: 0.15 },
  { maxPosition: 3.5, expectedCtr: 0.11 },
  { maxPosition: 4.5, expectedCtr: 0.08 },
  { maxPosition: 5.5, expectedCtr: 0.07 },
  { maxPosition: 10.5, expectedCtr: 0.035 },
  { maxPosition: 20.5, expectedCtr: 0.015 },
  { maxPosition: Infinity, expectedCtr: 0.005 },
];

function expectedCtrForPosition(position) {
  return CTR_BENCHMARK_BUCKETS.find((b) => position <= b.maxPosition)
    .expectedCtr;
}

// 表示回数が少ないと比率のブレが大きくノイズになるため、最低表示回数を設ける
const CTR_GAP_MIN_IMPRESSIONS = 20;

function findCtrGaps(rows) {
  const titleCandidates = [];
  const authorityCandidates = [];
  for (const r of rows) {
    if (r.impressions < CTR_GAP_MIN_IMPRESSIONS) continue;
    const expected = expectedCtrForPosition(r.position);
    const ratio = r.ctr / expected;
    if (ratio < 0.5) {
      titleCandidates.push({ ...r, expected, ratio });
    } else if (ratio > 1.5 && r.position > 10) {
      authorityCandidates.push({ ...r, expected, ratio });
    }
  }
  titleCandidates.sort((a, b) => b.impressions - a.impressions);
  authorityCandidates.sort((a, b) => b.impressions - a.impressions);
  return { titleCandidates, authorityCandidates };
}

function buildPageQueriesMap(pageQueryRows) {
  const map = new Map();
  for (const r of pageQueryRows) {
    const [query, page] = r.keys;
    if (!map.has(page)) map.set(page, []);
    map.get(page).push({ query, clicks: r.clicks, impressions: r.impressions });
  }
  for (const rows of map.values()) {
    rows.sort((a, b) => b.impressions - a.impressions);
  }
  return map;
}

function printTopQueriesForPages(pages, pageQueriesMap, label) {
  console.log(`\n## ${label}のページ別クエリ内訳（上位3件）`);
  if (pages.length === 0) {
    console.log("  （対象ページなし）");
    return;
  }
  for (const page of pages) {
    const queries = pageQueriesMap.get(page) ?? [];
    console.log(`  ${page}`);
    if (queries.length === 0) {
      console.log("    （クエリ内訳データなし。表示回数が少なすぎる可能性）");
      continue;
    }
    for (const q of queries.slice(0, 3)) {
      console.log(
        `    - ${q.query.padEnd(30)} clicks:${q.clicks} impressions:${q.impressions}`,
      );
    }
  }
}

// 全クエリを対象に順位変動を計算し、動きが大きい順にソートして表示する
// （毎回同じ上位20件のブランドクエリだけでなく、実際に動いたクエリを網羅的に拾う）
function printQueryMovers(prevQueries, allQueries) {
  const prevQueryMap = new Map(prevQueries.map((r) => [r.keys[0], r]));
  const movers = [];
  const newEntries = [];
  for (const r of allQueries) {
    if (r.clicks === 0 && r.impressions < 10) continue; // ノイズ除外（実績がほぼ無いクエリ）
    const prevRow = prevQueryMap.get(r.keys[0]);
    if (!prevRow) {
      newEntries.push(r);
      continue;
    }
    movers.push({
      query: r.keys[0],
      position: r.position,
      delta: r.position - prevRow.position,
    });
  }
  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  console.log(
    `\n  順位変動が大きいクエリ 上位15件（+は下落、-は上昇。実績のあるクエリ${movers.length}件中）:`,
  );
  if (movers.length === 0) {
    console.log("  （比較可能なクエリがありません）");
  }
  for (const m of movers.slice(0, 15)) {
    console.log(
      `    ${m.query.padEnd(40)} position:${m.position.toFixed(1)} (${formatDelta(m.delta)}pt)`,
    );
  }

  if (newEntries.length > 0) {
    console.log(
      `\n  新規ランクイン（実績のあるクエリのみ、上位10件、全${newEntries.length}件中）:`,
    );
    newEntries
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 10)
      .forEach((r) => {
        console.log(
          `    ${r.keys[0].padEnd(40)} position:${r.position.toFixed(1)} clicks:${r.clicks}`,
        );
      });
  }
}

// 指名検索（ブランド名クエリ）比率トラッキング（2026-08-20追加、BoatAI→龍神レーダーのリブランド監視用）
// 「ボートレースai」等の一般語+AI検索は含めない（classifyBrandQuery参照）
function printBrandShare(allQueries, previous) {
  let oldBrandClicks = 0;
  let newBrandClicks = 0;
  let oldBrandImpressions = 0;
  let newBrandImpressions = 0;
  for (const r of allQueries) {
    const kind = classifyBrandQuery(r.keys[0]);
    if (kind === "old") {
      oldBrandClicks += r.clicks;
      oldBrandImpressions += r.impressions;
    } else if (kind === "new") {
      newBrandClicks += r.clicks;
      newBrandImpressions += r.impressions;
    }
  }
  const totalClicks = allQueries.reduce((sum, r) => sum + r.clicks, 0);
  const brandShare =
    totalClicks > 0
      ? ((oldBrandClicks + newBrandClicks) / totalClicks) * 100
      : 0;
  console.log(`\n## 指名検索（ブランド名クエリ）比率`);
  console.log(
    `  旧ブランド名（BoatAI系）: クリック${oldBrandClicks} / 表示回数${oldBrandImpressions}`,
  );
  console.log(
    `  新ブランド名（龍神レーダー系）: クリック${newBrandClicks} / 表示回数${newBrandImpressions}`,
  );
  console.log(
    `  指名検索が全クリックに占める割合: ${brandShare.toFixed(1)}%（全クリック${totalClicks}件中）`,
  );
  if (previous) {
    const prevQueries = previous.data.allQueries ?? previous.data.topQueries;
    let prevOldBrandClicks = 0;
    let prevNewBrandClicks = 0;
    for (const r of prevQueries) {
      const kind = classifyBrandQuery(r.keys[0]);
      if (kind === "old") prevOldBrandClicks += r.clicks;
      else if (kind === "new") prevNewBrandClicks += r.clicks;
    }
    console.log(
      `  前回比: 旧ブランド ${formatDelta(oldBrandClicks - prevOldBrandClicks, 0)}件、新ブランド ${formatDelta(newBrandClicks - prevNewBrandClicks, 0)}件`,
    );
  }
}

// CTR-vs-掲載順位ギャップ分析（2026-08-20追加）。改善候補（titleCandidates）を返す
function printCtrGaps(topPages) {
  const { titleCandidates, authorityCandidates } = findCtrGaps(topPages);
  console.log(
    `\n## CTR-vs-掲載順位ギャップ（表示回数${CTR_GAP_MIN_IMPRESSIONS}以上のページが対象）`,
  );
  console.log(
    `  タイトル/メタディスクリプション改善候補（順位相応のCTR目安の半分未満）:`,
  );
  if (titleCandidates.length === 0) {
    console.log("  （該当なし）");
  }
  for (const c of titleCandidates.slice(0, 10)) {
    console.log(
      `    ${c.keys[0].padEnd(60)} position:${c.position.toFixed(1)} ctr:${(c.ctr * 100).toFixed(2)}% (目安${(c.expected * 100).toFixed(1)}%)`,
    );
  }
  console.log(
    `\n  権威・被リンク不足の可能性（CTRは目安の1.5倍超だが順位10位より下）:`,
  );
  if (authorityCandidates.length === 0) {
    console.log("  （該当なし）");
  }
  for (const c of authorityCandidates.slice(0, 10)) {
    console.log(
      `    ${c.keys[0].padEnd(60)} position:${c.position.toFixed(1)} ctr:${(c.ctr * 100).toFixed(2)}% (目安${(c.expected * 100).toFixed(1)}%)`,
    );
  }
  return titleCandidates;
}

export {
  printRows,
  isFeatureOrArticlePage,
  buildPageQueriesMap,
  printTopQueriesForPages,
  printQueryMovers,
  printBrandShare,
  printCtrGaps,
};
