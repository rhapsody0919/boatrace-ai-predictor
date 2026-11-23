import { readFileSync } from "node:fs";
import { test, expect } from "./fixtures.js";

/**
 * レースカードの「外れ」の札に主語（展開）を付ける。「❌ 外れ」だけだと、隣のイン崩れ注意の札が外れたように読める
 * （2026-11-23 会場ページのモックのファン評価 P1、docs/design/venue-race-card-redesign/approved.md）。
 * 的中の札（badgeTurn）と同じ主語を、4言語のすべてで持つ。
 */
const SUBJECT = { ja: "展開", en: "Turn", ko: "전개", "zh-TW": "展開" };

for (const [lang, subject] of Object.entries(SUBJECT)) {
  test(`${lang}: 的中と外れの札が同じ主語を持つ`, () => {
    const { raceCard } = JSON.parse(
      readFileSync(
        new URL(`../src/locales/${lang}/common.json`, import.meta.url),
      ),
    );
    expect(raceCard.badgeTurn).toContain(subject);
    expect(raceCard.missBadge).toContain(subject);
  });
}
