#!/usr/bin/env node
/**
 * 選手ページの JSON-LD（src/pure/racerStructuredData.js）が、ProfilePage＋Person と画面のパンくずと同じ BreadcrumbList を、画面に出す値だけで組むこと。
 *
 * 人の画面（RacerStructuredData.jsx）と生の HTML の head が同じ関数を使う。import して呼んだ値で見る。
 * 1. Person は空白を詰めた名・登録番号（文字列）・よみ（半角の空白1つ）・生年月日・出身地・選手の URL。dateModified は ProfilePage に置く
 * 2. 無い項目は鍵ごと出さない（空の値を出さない）
 * 3. BreadcrumbList は「ホーム › 選手一覧 › 名」で、src/utils/breadcrumbLd.js の toBreadcrumbListLd と同じ値
 * 4. プロフィールが無ければ何も出さない。名が無ければ BreadcrumbList を出さない（壊れたパンくずを出さない）
 */
import assert from "node:assert/strict";
import { racerStructuredData } from "../../src/pure/racerStructuredData.js";
import { toBreadcrumbListLd } from "../../src/utils/breadcrumbLd.js";

const FULL = {
  name: "峰　　竜太",
  name_kana: "みね　　りゅうた",
  birth_date: "1985-03-30",
  hometown: "佐賀県",
};

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

check("1. ProfilePage と Person の値", () => {
  const [page] = racerStructuredData(FULL, "4320", "2026-10-31");
  assert.deepEqual(page, {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    dateModified: "2026-10-31",
    mainEntity: {
      "@type": "Person",
      name: "峰竜太",
      identifier: "4320",
      alternateName: "みね りゅうた",
      birthDate: "1985-03-30",
      homeLocation: "佐賀県",
      url: "https://www.boat-ai.jp/racer/4320",
    },
  });
});

check("2. 無い項目は出さない", () => {
  const [page] = racerStructuredData({ name: "峰竜太" }, "4320");
  assert.equal("dateModified" in page, false);
  assert.deepEqual(Object.keys(page.mainEntity), ["@type", "name", "identifier", "url"]);
});

check("3. BreadcrumbList は画面のパンくずと同じ", () => {
  const lds = racerStructuredData(FULL, "4320");
  assert.equal(lds.length, 2);
  assert.deepEqual(
    lds[1],
    toBreadcrumbListLd([
      { name: "ホーム", url: "/" },
      { name: "選手一覧", url: "/racers" },
      { name: "峰竜太", url: "/racer/4320" },
    ]),
  );
});

check("4. プロフィールが無い・名が無い", () => {
  assert.deepEqual(racerStructuredData(null, "4320"), []);
  const noName = racerStructuredData({ name_kana: "みね　りゅうた" }, "4320");
  assert.equal(noName.length, 1);
  assert.equal(noName[0]["@type"], "ProfilePage");
});

if (failures > 0) {
  console.error(`\n${failures} 件の失敗`);
  process.exit(1);
}
console.log("\nverify-racer-structured-data: すべて通った");
