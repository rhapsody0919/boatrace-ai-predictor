#!/usr/bin/env node
/**
 * 生の HTML の head の純関数（src/pure/pageHead.js）が、人の画面と同じ値を作り、外枠の index.html に壊さず差し込むこと。
 *
 * src/ の本文は読まない（import して呼んだ値で見る。外枠は index.html の head と同じ形の見本）。
 * 1. pageHeadRoute は /races/{実在する日}/{1〜24} だけを受ける（0埋め・範囲外・実在しない日・言語の接頭辞・末尾の / は null）
 * 2. 過去日の会場の title・description・canonical は人の画面の口（src/utils/pageMeta.js）と同じ関数・同じ文
 * 3. JSON-LD は画面の Breadcrumb が出す BreadcrumbList（src/utils/breadcrumbLd.js）と同じ値。URL の解決が要るパスは出さない
 * 4. 差し込み: title はちょうど1つで値に既定の文、description・canonical が1つずつ、JSON-LD が読めて </script> で抜けない、
 *    値はエスケープされる。外枠の title が1つでない・description か canonical が既にある・値が欠ける・サイトの外の canonical・</head> が無い、は null
 */
import assert from "node:assert/strict";
import ja from "../../src/locales/ja/common.json" with { type: "json" };
import * as head from "../../src/pure/pageHead.js";
import * as pageMeta from "../../src/utils/pageMeta.js";
import { toBreadcrumbListLd } from "../../src/utils/breadcrumbLd.js";

// 外枠（index.html）の head と同じ形の見本: title が1つ、description・canonical は無い、共通の JSON-LD が3つ。
// 本物の index.html への差し込みは e2e/page-head-handoff.spec.js が配備と同じ外枠（vite の index.html）で見る
const DEFAULT_TITLE = "ボートレースのデータ分析とAI予想が無料｜競艇 龍神レーダー";
const shell = [
  "<!doctype html>",
  '<html lang="ja">',
  "<head>",
  '<meta charset="UTF-8" />',
  '<meta name="robots" content="index, follow" />',
  `<title>${DEFAULT_TITLE}</title>`,
  ...["WebSite", "SoftwareApplication", "Organization"].map(
    (type) => `<script type="application/ld+json">{"@context":"https://schema.org","@type":"${type}"}</script>`,
  ),
  "</head>",
  '<body><div id="root"></div><script type="module" src="/assets/index-abc.js"></script></body>',
  "</html>",
].join("\n");
const HOME = ja.analysisPage.breadcrumbHome;

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}\n     ${error.message}`);
  }
};

const sample = () =>
  head.pastVenuePageHead({ date: "2026-11-26", venueCode: 1, venueName: ja.venues["1"], homeName: HOME });

check("1. pageHeadRoute は過去日の会場ページの形だけを受ける", () => {
  assert.deepEqual(head.pageHeadRoute("/races/2026-11-26/1"), {
    kind: "pastVenue",
    date: "2026-11-26",
    venueCode: 1,
  });
  assert.equal(head.pageHeadRoute("/races/2024-02-29/24")?.venueCode, 24);
  for (const p of [
    "/races/2026-11-26/01",
    "/races/2026-11-26/0",
    "/races/2026-11-26/25",
    "/races/2026-11-26/abc",
    "/races/2026-02-30/1",
    "/races/2026-13-01/1",
    "/races/2026-11-26",
    "/races/2026-11-26/1/",
    "/en/races/2026-11-26/1",
    "/race/2026-11-26-01-01",
    "/",
  ]) {
    assert.equal(head.pageHeadRoute(p), null, p);
  }
});

check("2. 過去日の会場の meta は人の画面の口と同じ", () => {
  assert.equal(pageMeta.getPastVenuePageMeta, head.getPastVenuePageMeta);
  assert.deepEqual(head.getPastVenuePageMeta("桐生", "2026-11-26", 1), {
    title: "桐生競艇の結果・配当 2026年11月26日(木)のレース一覧・AIデータ分析 - 龍神レーダー",
    description:
      "桐生競艇（ボートレース桐生）の2026年11月26日(木)の全レースの結果。着順・決まり手・3連単の配当と、各レースの出走表・AIデータ分析を無料で確認できます。",
    canonical: "https://www.boat-ai.jp/races/2026-11-26/1",
  });
});

check("3. JSON-LD は画面の BreadcrumbList と同じ", () => {
  const items = head.getPastVenueBreadcrumbItems(HOME, "2026-11-26", 1, "桐生");
  assert.deepEqual(items.map((x) => x.url), ["/", "/races", "/races/2026-11-26", "/races/2026-11-26/1"]);
  assert.deepEqual(sample().jsonLd, [toBreadcrumbListLd(items)]);
  // 解決が要るパス・空の名前を含むと JSON-LD を出さない（壊れた BreadcrumbList を出すより無いほうがよい）
  const odd = head.pastVenuePageHead({ date: "2026-11-26", venueCode: 1, venueName: "", homeName: HOME });
  assert.deepEqual(odd.jsonLd, []);
});

const headOf = (html) => html.slice(0, html.indexOf("</head>"));
const count = (text, re) => [...text.matchAll(re)].length;

check("4a. 差し込んだ head は title・description・canonical が1つずつで JSON-LD が読める", () => {
  const out = head.injectPageHead(shell, sample());
  assert.ok(out, "差し込めない");
  const h = headOf(out);
  const defaultTitle = DEFAULT_TITLE;
  assert.equal(count(h, /<title[\s>]/g), 1);
  assert.ok(h.includes(`<title data-page-head="${defaultTitle}">桐生競艇の結果・配当`), "title の値が既定の文でない");
  assert.equal(count(h, /<meta name="description"/g), 1);
  assert.equal(count(h, /rel="canonical"/g), 1);
  assert.ok(h.includes('href="https://www.boat-ai.jp/races/2026-11-26/1"'));
  const lds = [...h.matchAll(/<script type="application\/ld\+json" data-page-head="">([^<]*)<\/script>/g)];
  assert.equal(lds.length, 1);
  assert.equal(JSON.parse(lds[0][1])["@type"], "BreadcrumbList");
  // 外枠の残り（body・共通の JSON-LD 3つ）は変えない
  assert.equal(out.slice(out.indexOf("</head>")), shell.slice(shell.indexOf("</head>")));
  assert.equal(count(h, /application\/ld\+json/g), count(headOf(shell), /application\/ld\+json/g) + 1);
});

check("4b. 値はエスケープされ、JSON-LD は </script> で抜けない", () => {
  const evil = {
    title: 'A</title><script>alert(1)</script>"',
    description: 'x" onload="y',
    canonical: "https://www.boat-ai.jp/races/2026-11-26/1",
    jsonLd: [{ name: "</script><script>alert(1)</script> " }],
  };
  const h = headOf(head.injectPageHead(shell, evil));
  assert.ok(!h.includes("<script>alert"), "生の <script> が入った");
  assert.ok(!h.includes('x" onload'), "属性を抜けた");
  assert.ok(!h.includes(" "));
  const ld = h.match(/<script type="application\/ld\+json" data-page-head="">(.*?)<\/script>/s)[1];
  assert.equal(JSON.parse(ld).name, "</script><script>alert(1)</script> ");
});

check("4c. 差し込めない外枠・値は null（素通り）", () => {
  const ok = sample();
  const twoTitles = shell.replace("</head>", "<title>x</title></head>");
  const withCanonical = shell.replace("</head>", '<link rel="canonical" href="https://www.boat-ai.jp/" /></head>');
  const withDescription = shell.replace("</head>", '<meta name="description" content="x" /></head>');
  assert.equal(head.injectPageHead(twoTitles, ok), null);
  assert.equal(head.injectPageHead(withCanonical, ok), null);
  assert.equal(head.injectPageHead(withDescription, ok), null);
  assert.equal(head.injectPageHead(shell.replace("</head>", ""), ok), null);
  assert.equal(head.injectPageHead(null, ok), null);
  assert.equal(head.injectPageHead(shell, { ...ok, title: " " }), null);
  assert.equal(head.injectPageHead(shell, { ...ok, description: undefined }), null);
  assert.equal(head.injectPageHead(shell, { ...ok, canonical: "https://example.com/x" }), null);
  assert.equal(head.injectPageHead(shell, { ...ok, canonical: "https://www.boat-ai.jp.example.com/" }), null);
  assert.equal(head.injectPageHead(shell, { ...ok, jsonLd: [null] }), null);
  assert.equal(head.injectPageHead(shell, null), null);
});

if (failures > 0) {
  console.error(`\n${failures} 件の失敗`);
  process.exit(1);
}
console.log("\nverify-page-head-model: すべて通った");
