#!/usr/bin/env node
/**
 * check-e2e-blog-tags.js（記事に関わる E2E の @blog の印の付け漏れ）の判定を固定の入力で検査する（BOA-929）。
 * 外部ネットワーク・実DB・Playwright の実行には触らない。
 */

import {
  findUntagged,
  hasBlogTag,
  isBlogRelated,
  listSpecs,
  testBlock,
} from "./check-e2e-blog-tags.js";

const failures = [];
let checked = 0;
function check(label, actual, expected) {
  checked += 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    failures.push(
      `${label}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`,
    );
}

const source = [
  'test("トップが出る", async ({ page }) => {', // 1
  '  await page.goto("/");', // 2
  "});", // 3
  'test("記事が出る", async ({ page }) => {', // 4
  '  await page.goto("/blog/foo");', // 5
  "});", // 6
  'test.describe("記事 @blog", () => {', // 7
  '  test("一覧", async ({ page }) => {', // 8
  '    await page.goto("/blog");', // 9
  "  });", // 10
  "});", // 11
  'test("ガイドの会場リンク", async ({ page }) => {', // 12
  "  await expect(page.locator('a[href^=\"/blog/venue-\"]')).toHaveCount(24);", // 13
  "});", // 14
];

check(
  "test( の本体だけを切り出し、次の試験を含めない",
  testBlock(source, 1, 1).includes("/blog"),
  false,
);
check(
  "本体の中の /blog を拾う",
  testBlock(source, 4, 1).includes('"/blog/foo"'),
  true,
);
check(
  "題の /blog で記事の試験とみなす",
  isBlogRelated("/blog で横に出ない", ""),
  true,
);
check(
  "記事の部品の class で記事の試験とみなす",
  isBlogRelated("x", 'page.locator(".blog-preview-card")'),
  true,
);
check(
  "記事と無関係な試験は対象外",
  isBlogRelated("トップ", 'page.goto("/races")'),
  false,
);
check(
  "describe の題の印も数える（tags には入らない）",
  hasBlogTag({ title: "a.spec.js › 記事 @blog › 一覧", tags: [] }),
  true,
);
check(
  "語の一部の @blogger は印にしない",
  hasBlogTag({ title: "a.spec.js › @blogger", tags: [] }),
  false,
);

const report = {
  suites: [
    {
      title: "a.spec.js",
      file: "a.spec.js",
      specs: [
        {
          title: "トップが出る",
          file: "a.spec.js",
          line: 1,
          column: 1,
          tags: [],
        },
        {
          title: "記事が出る",
          file: "a.spec.js",
          line: 4,
          column: 1,
          tags: [],
        },
        {
          title: "ガイドの会場リンク",
          file: "a.spec.js",
          line: 12,
          column: 1,
          tags: [],
        },
      ],
      suites: [
        {
          title: "記事 @blog",
          specs: [
            { title: "一覧", file: "a.spec.js", line: 8, column: 3, tags: [] },
          ],
        },
      ],
    },
  ],
};
const specs = listSpecs(report);
check("一覧から4件を取り出す", specs.length, 4);
check(
  "印の無い記事の試験だけを挙げる（付け漏れ）",
  findUntagged(specs, () => source).map((s) => s.line),
  [4, 12],
);
const fixed = specs.map((s) =>
  s.line === 4 || s.line === 12 ? { ...s, tags: ["@blog"] } : s,
);
check("印を付ければ0件", findUntagged(fixed, () => source).length, 0);

if (failures.length > 0) {
  console.error("NG: check-e2e-blog-tags の検査に失敗");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`OK: check-e2e-blog-tags の判定${checked}件を検証`);
