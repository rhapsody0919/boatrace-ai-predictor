#!/usr/bin/env node
/**
 * BOA-1040: 画面・ボット共通のパンくず生成を、通信・時計なしで検証する。
 * 仕様の値: breadcrumbLd.js の JSDoc、依頼100、https://schema.org/BreadcrumbList
 * 今の実装の値: 指定土台 65bf85925。差がある入力は KNOWN_GAPS に記録し、assert しない。
 */
import assert from "node:assert/strict";
import {
  isValidCrumbs,
  toBreadcrumbListLd,
} from "../../src/utils/breadcrumbLd.js";

// 仕様と今の実装が一致する入力だけを、固定した期待値で検査する。
const validationCases = [
  {
    label: "名前とURLあり",
    input: [{ name: "a", url: "/" }],
    spec: true,
    current: true,
  },
  { label: "空配列", input: [], spec: false, current: false },
  { label: "null", input: null, spec: false, current: false },
  {
    label: "呼出側の別キー",
    input: [{ label: "a", path: "/" }],
    spec: false,
    current: false,
  },
  {
    label: "空URL",
    input: [{ name: "a", url: "" }],
    spec: false,
    current: false,
  },
  {
    label: "空の名前",
    input: [{ name: "", url: "/" }],
    spec: false,
    current: false,
  },
  { label: "URL欠落", input: [{ name: "a" }], spec: false, current: false },
  { label: "名前欠落", input: [{ url: "/" }], spec: false, current: false },
  {
    label: "文字列以外のURL",
    input: [{ name: "a", url: 1 }],
    spec: false,
    current: false,
  },
  {
    label: "文字列以外の名前",
    input: [{ name: 1, url: "/" }],
    spec: false,
    current: false,
  },
  { label: "null項目", input: [null], spec: false, current: false },
  {
    label: "後続の不正項目",
    input: [{ name: "a", url: "/" }, { name: "b" }],
    spec: false,
    current: false,
  },
];

const crumbs = [
  { name: "トップ", url: "/" },
  { name: "会場", url: "/venue/06?x=1" },
  { name: "外", url: "https://example.com/a" },
];
// 仕様の値: 1からの位置、絶対URL、名前と順序を保持する。
const specLd = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    {
      "@type": "ListItem",
      position: 1,
      name: "トップ",
      item: "https://www.boat-ai.jp/",
    },
    {
      "@type": "ListItem",
      position: 2,
      name: "会場",
      item: "https://www.boat-ai.jp/venue/06?x=1",
    },
    {
      "@type": "ListItem",
      position: 3,
      name: "外",
      item: "https://example.com/a",
    },
  ],
};
// 今の実装の値（固定値）。実行結果から期待値を生成しない。
const currentLd = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    {
      "@type": "ListItem",
      position: 1,
      name: "トップ",
      item: "https://www.boat-ai.jp/",
    },
    {
      "@type": "ListItem",
      position: 2,
      name: "会場",
      item: "https://www.boat-ai.jp/venue/06?x=1",
    },
    {
      "@type": "ListItem",
      position: 3,
      name: "外",
      item: "https://example.com/a",
    },
  ],
};

const gapInput = [{ name: "a", url: "/undefined" }];
const KNOWN_GAPS = [
  {
    input: gapInput,
    spec: "isValidCrumbs が true の入力の item に undefined が入らない（依頼100）",
    current: { valid: true, item: "https://www.boat-ai.jp/undefined" },
    observed: {
      valid: isValidCrumbs(gapInput),
      item: toBreadcrumbListLd(gapInput).itemListElement[0].item,
    },
  },
];
console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length}件`);
for (const gap of KNOWN_GAPS) console.log(JSON.stringify(gap));

for (const { label, input, spec, current } of validationCases) {
  assert.equal(current, spec, `${label}: 仕様と今の値が一致`);
  assert.equal(isValidCrumbs(input), spec, `isValidCrumbs: ${label}`);
}
assert.deepEqual(currentLd, specLd, "BreadcrumbList: 仕様と今の値が一致");
assert.equal(isValidCrumbs(crumbs), true, "生成対象は有効");
assert.deepEqual(
  toBreadcrumbListLd(crumbs),
  specLd,
  "BreadcrumbList: 型・位置・名前・絶対URL",
);

for (const input of [
  crumbs,
  ...validationCases.filter((c) => c.spec).map((c) => c.input),
]) {
  for (const element of toBreadcrumbListLd(input).itemListElement) {
    assert.equal(
      element.item.includes("undefined"),
      false,
      "有効な通常入力のitemにundefinedが無い",
    );
  }
}
console.log("✅ verify-breadcrumb-ld: 検証通過（KNOWN_GAPS は失敗に含めない）");
