#!/usr/bin/env node
/**
 * 会場ページ（過去日付、/races/:date/:code）の title・description が「結果」「配当」の語を持ち、尾の形と canonical を保つことを見る（BOA-1723）。
 *
 * 崩れると、「{会場} 競艇 結果」「競艇 配当」の検索で、結果の行（着順・決まり手・3連単の配当）が出る過去日の会場ページが拾われない
 * （GSC 2026-10-26〜11-22 は sitemap に載る直近7日分でも表示0回）。尾は e2e/venue-seo-meta.spec.js が固定している形。
 * 関数を呼ぶだけ。ネットワークにも DB にも接続しない。
 */
import { getPastVenuePageMeta } from "../../src/utils/pageMeta.js";

const failures = [];
let checked = 0;
function check(label, ok, detail) {
  checked += 1;
  if (!ok) failures.push(`${label}: ${detail}`);
}

const cases = [
  { venue: "桐生", date: "2026-11-25", code: 1, day: "2026年11月25日(水)" },
  { venue: "平和島", date: "2026-08-11", code: 4, day: "2026年8月11日(火)" },
  { venue: "福岡", date: "2026-01-01", code: "22", day: "2026年1月1日(木)" },
];

for (const { venue, date, code, day } of cases) {
  const { title, description, canonical } = getPastVenuePageMeta(venue, date, code);
  const where = `${venue}・${date}`;
  check(
    `${where} title の頭`,
    title.startsWith(`${venue}競艇の結果・配当 ${day}`),
    `「${venue}競艇の結果・配当 ${day}」で始まらない: ${title}`,
  );
  check(
    `${where} title の尾`,
    /のレース一覧・AIデータ分析 - 龍神レーダー$/.test(title),
    `e2e が固定している尾でない: ${title}`,
  );
  for (const word of ["結果", "3連単の配当", "出走表", day]) {
    check(
      `${where} description の「${word}」`,
      description.includes(word),
      `含まない: ${description}`,
    );
  }
  check(
    `${where} canonical`,
    canonical === `https://www.boat-ai.jp/races/${date}/${code}`,
    `日付と会場の URL でない: ${canonical}`,
  );
}

if (failures.length > 0) {
  console.error(`✗ verify-venue-past-meta-keywords: ${failures.length}/${checked} 件が失敗`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ verify-venue-past-meta-keywords: ${checked} 件を確認`);
