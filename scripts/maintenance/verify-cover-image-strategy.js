#!/usr/bin/env node
/**
 * BOA-1064: カバー画像の調達戦略を通信・時計なしで検証する。
 * 仕様: docs/reference/brand-kit.md「カバー画像・サムネイル」と対象の JSDoc。
 * 下記の期待値は指定土台 9b24d61f5 の実装とも一致する。
 * contentTopics/*Source.js は副作用を避けるため import せず、export const id を転記。
 */
import assert from "node:assert/strict";
import { getCoverImageStrategy } from "../lib/contentChannels/coverImageStrategy.js";

const KNOWN_GAPS = [
  {
    input: { sourceId: "humor" },
    spec: "未定（humorSource.js に id はあるが戦略の仕様がない）",
    current: '例外: 未知のネタ種別 "humor" に対するカバー画像戦略が定義されていません',
  },
];
console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length}件`);
for (const gap of KNOWN_GAPS) console.log(JSON.stringify(gap));

const cases = [
  {
    label: "new-feature は対象ルートのスクリーンショット",
    input: { sourceId: "new-feature", route: "/today" },
    expected: { type: "screenshot", path: "/today" },
  },
  {
    label: "data-insight は対象タブのスクリーンショット",
    input: { sourceId: "data-insight", tabId: "extrend" },
    expected: { type: "screenshot", path: "/winning-technique?tab=extrend" },
  },
  ...["venue-characteristic", "daily-result", "trivia"].map((sourceId) => ({
    label: `${sourceId} はデータカード`,
    input: { sourceId },
    expected: { type: "data-card" },
  })),
];
for (const { label, input, expected } of cases) {
  assert.deepEqual(getCoverImageStrategy(input), expected, label);
  console.log(`OK: ${label}`);
}

const unknownTest = "未知の sourceId は名前を含む例外";
assert.throws(
  () => getCoverImageStrategy({ sourceId: "no-such-source" }),
  (error) => error instanceof Error && error.message.includes("no-such-source"),
  unknownTest,
);
console.log(`OK: ${unknownTest}`);
console.log("✅ verify-cover-image-strategy: 検証通過（KNOWN_GAPS は失敗に含めない）");
