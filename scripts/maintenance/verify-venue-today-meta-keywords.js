#!/usr/bin/env node
/**
 * 会場ページ（本日分、/venue/:code）の ja の title・description が「出走表」「結果」の語を持ち、頭の「{会場}競艇の予想」を保つことを見る（BOA-1723）。
 *
 * 崩れると、「{会場} 競艇 結果」「{会場} 競艇 出走表」の検索で会場のページが表示されない（GSC 2026-10-26〜11-22 は表示ほぼ0回）か、
 * いま順位の付いている「{会場}競艇予想 ai」の語が title の後ろへ押し出される。
 * 人の画面とボット向け HTML（ADR 0089）は同じ getTodayVenuePageMeta を使うので、ここで両方の値を見たことになる。
 * 製品の t（api/_lib/botPage.js の getJaT）と getTodayVenuePageMeta を呼ぶだけ。ネットワークにも DB にも接続しない。
 */
import { getJaT } from "../../api/_lib/botPage.js";
import { getTodayVenuePageMeta } from "../../src/utils/pageMeta.js";

// ボット向け HTML の関数と同じ ja の t（人の画面の src/i18n.js と同じ resources・補間）
const t = await getJaT();

const failures = [];
let checked = 0;
function check(label, ok, detail) {
  checked += 1;
  if (!ok) failures.push(`${label}: ${detail}`);
}

const scenes = [
  { label: "一般戦", races: [{ raceGrade: "ippan", raceTitle: "日刊スポーツ杯" }] },
  { label: "開催なし", races: [] },
  {
    label: "SG 開催中（節タイトル入り）",
    races: [{ raceGrade: "SG", raceTitle: "第７２回ボートレースメモリアル" }],
  },
];

for (const venueCode of [1, 4, 12, 22]) {
  const venue = t(`venues.${venueCode}`);
  for (const { label, races } of scenes) {
    const { title, description, canonical } = getTodayVenuePageMeta(
      t,
      venueCode,
      races,
      "ja",
    );
    const where = `${venue}・${label}`;
    // 節タイトル入りは長くなり「AI予想」が検索結果で切れるので「結果」を足さない（seo-marketer の審査 2026-11-26）
    const head = races.some((r) => r.raceGrade === "SG")
      ? `${venue}競艇の予想・出走表 `
      : `${venue}競艇の予想・出走表・結果｜`;
    check(
      `${where} title の頭`,
      title.startsWith(head),
      `「${head}」で始まらない: ${title}`,
    );
    check(
      `${where} title の尾`,
      title.endsWith(" - 龍神レーダー"),
      `サイト名で終わらない: ${title}`,
    );
    for (const word of ["出走表", "結果", "AI予想"]) {
      check(
        `${where} description の「${word}」`,
        description.includes(word),
        `含まない: ${description}`,
      );
    }
    check(
      `${where} description の「今日」`,
      description.includes("今日"),
      `含まない: ${description}`,
    );
    check(
      `${where} canonical`,
      canonical === `https://www.boat-ai.jp/venue/${venueCode}`,
      `日付の無い固定の URL でない: ${canonical}`,
    );
    check(
      `${where} 補間の残り`,
      !/\{\{|\}\}/.test(title + description),
      `{{ }} が残っている: ${title} / ${description}`,
    );
  }
}

if (failures.length > 0) {
  console.error(`✗ verify-venue-today-meta-keywords: ${failures.length}/${checked} 件が失敗`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ verify-venue-today-meta-keywords: ${checked} 件を確認`);
