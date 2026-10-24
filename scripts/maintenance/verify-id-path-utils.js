/** BOA-1039: ID・名前・ページパスの仕様を、通信せず検証する。 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { getRaceId, parseRaceId } from "../../src/utils/raceId.js";
import { splitRacerName } from "../../src/utils/racerName.js";
import { racerPagePath } from "../../src/utils/racerPagePath.js";
import {
  VENUE_CODE_TO_BLOG_ID,
  getVenueBlogId,
  getVenueGuidePath,
} from "../../src/utils/venueUtils.js";

// 仕様の値: BOA-1039 の期待値と各モジュールのコメント・範囲定義。
// 今の実装の値: 同じ入力で一致するものだけを以下で assert する。
// 不一致は仕様へ追従する別の依頼で扱い、現在値を正解として固定しない。
const KNOWN_GAPS = [
  {
    function: "getRaceId",
    input: { rawData: { date: "2026-10-24", placeCd: 0, raceNo: 0 } },
    specificationValue: null,
    currentValue: "2026-10-24-00-00",
    reason: "parseRaceId の範囲は会場1〜24・レース1〜12",
  },
  {
    function: "getVenueBlogId",
    input: "6a",
    specificationValue: null,
    currentValue: "hamanako",
    reason: "会場コード以外の末尾文字を parseInt が捨てる",
  },
];
console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length}件（assert 対象外）`);
for (const gap of KNOWN_GAPS) console.log(JSON.stringify(gap));

let checks = 0;
function equal(label, actual, specificationValue) {
  assert.deepEqual(actual, specificationValue, label);
  checks++;
}

const date = "2026-10-24";
equal("parseRaceId: 0埋めIDの分解", parseRaceId(`${date}-06-09`), {
  date, venueCode: 6, raceNo: 9,
});
for (const input of [
  `${date}-00-09`, `${date}-25-09`, `${date}-06-00`,
  `${date}-06-13`, 20261024, `${date}-6-9`,
]) {
  equal(`parseRaceId: 不正入力 ${input}`, parseRaceId(input), null);
}
equal("getRaceId: 明示ID優先", getRaceId({
  id: "A", rawData: { date, placeCd: 6, raceNo: 9 },
}), "A");
// 明示IDは透過する契約（A）なので、往復検査は rawData の有効範囲に限る。
equal("getRaceId: idのみ", getRaceId({ id: "A" }), "A");
equal("getRaceId: null", getRaceId(null), null);
equal("getRaceId: raceNoなし", getRaceId({ rawData: { date, placeCd: 6 } }), null);
equal("getRaceId: 0埋め", getRaceId({
  rawData: { date, placeCd: 6, raceNo: 9 },
}), `${date}-06-09`);
for (let venueCode = 1; venueCode <= 24; venueCode++) {
  for (let raceNo = 1; raceNo <= 12; raceNo++) {
    const id = getRaceId({ rawData: { date, placeCd: venueCode, raceNo } });
    equal(`raceId: 往復 ${venueCode}/${raceNo}`, parseRaceId(id), {
      date, venueCode, raceNo,
    });
  }
}

for (const [input, specificationValue] of [
  ["丹下　　　将", ["丹下", "将"]],
  ["安河内鈴之介", ["安河内鈴之介"]],
  [null, []], ["  ", []],
]) {
  equal(`splitRacerName: ${input}`, splitRacerName(input), specificationValue);
}
equal("racerPagePath: STの推移", racerPagePath(4444, "stTrend"), "/racer/4444#st-trend");
equal("racerPagePath: sectionなし", racerPagePath(4444), "/racer/4444");
equal("racerPagePath: 不明section", racerPagePath(4444, "x"), "/racer/4444");

const venueCodes = Array.from({ length: 24 }, (_, i) => String(i + 1));
equal("会場マッピング: 1〜24のみ", Object.keys(VENUE_CODE_TO_BLOG_ID), venueCodes);
for (const code of venueCodes) {
  const blogId = getVenueBlogId(code);
  const path = getVenueGuidePath(code);
  equal(`会場${code}: ガイドパス`, path, `/blog/venue-${blogId}`);
  equal(`会場${code}: ガイド記事が存在`, existsSync(
    new URL(`../../public${path}.md`, import.meta.url),
  ), true);
}
equal("getVenueBlogId: 0埋め会場", getVenueBlogId("06"), "hamanako");
equal("getVenueBlogId: 範囲外", getVenueBlogId(25), null);
equal("getVenueGuidePath: 不正入力", getVenueGuidePath("x"), null);
console.log(`OK: ${checks}件の検証に成功`);
