// 風の5区分（src/pure/windSector.js）が、kb では分析の windBin と、main では画面の windRelation と同じ向きを返し、会場の offset の写しが2つの元の表と同じであることを守る
import assert from "node:assert/strict";
import { VENUE_ARROW_OFFSET, WIND_SECTORS, windSectorOf } from "../../src/pure/windSector.js";
import { VENUE_WIND_OFFSET, windBin } from "../analysis/analyze-weather-in-escape.js";
import { VENUE_WIND_OFFSET_DEG, WIND_DIRECTIONS, windRelation } from "../../src/utils/windDirection.js";

const VENUES = Array.from({ length: 24 }, (_, i) => i + 1);
const SPEEDS = [null, 0, 1, 1.5, 2, 3, 4, 7];
const LABELS = [...WIND_DIRECTIONS, "無風", null, "不明"];

// 1. 写しの offset が2つの元の表と24場すべてで同じ
for (const v of VENUES) {
  assert.equal(VENUE_ARROW_OFFSET[v], VENUE_WIND_OFFSET[v], `分析の表と会場 ${v}`);
  assert.equal(VENUE_ARROW_OFFSET[v] * 22.5, VENUE_WIND_OFFSET_DEG[v], `画面の表と会場 ${v}`);
}

// 2. kb（K の本当の方位）は windBin と全ての組で同じ
for (const v of VENUES) {
  for (const d of LABELS) {
    for (const s of SPEEDS) {
      const got = windSectorOf({ era: "kb", venueCode: v, direction: d, speed: s, hasCondition: true });
      assert.equal(got, windBin(v, d, s), `kb 会場 ${v}・${d}・${s}m`);
    }
  }
}

// 3. main（画面の矢印の番号）は、風速1m超で windRelation と同じ向き（tail/head/cross）
const RELATION = { tail: "tail", tail_strong: "tail", head: "head", head_strong: "head", calm_cross: "cross" };
for (const v of VENUES) {
  for (const d of WIND_DIRECTIONS) {
    for (const s of [1.5, 2, 3, 4, 7]) {
      const got = windSectorOf({ era: "main", venueCode: v, direction: d, speed: s, hasCondition: true });
      assert.equal(RELATION[got], windRelation(d, v, s), `main 会場 ${v}・${d}・${s}m`);
    }
  }
}

// 4. 具体の値（矢印「東」=追い風、「西」=向かい風、会場によらない。K は会場の offset で回す）
const main = (direction, speed, venueCode = 18) => windSectorOf({ era: "main", venueCode, direction, speed, hasCondition: true });
assert.equal(main("東", 4), "tail_strong");
assert.equal(main("東", 3), "tail");
assert.equal(main("西", 5), "head_strong");
assert.equal(main("西", 2), "head");
assert.equal(main("北", 6), "calm_cross", "横風は強くても calm_cross");
assert.equal(main("北", 1), "calm_cross", "1m以下は向きによらない");
assert.equal(main("無風", 0), "calm_cross");
// 徳山（offset 14）: K の「北」は矢印 14 → φ = 225° → −135° → 向かい風
assert.equal(windSectorOf({ era: "kb", venueCode: 18, direction: "北", speed: 5, hasCondition: true }), "head_strong");
// 桐生（offset 5）: K の「北北西」は矢印 (15+5)%16=4 → 追い風
assert.equal(windSectorOf({ era: "kb", venueCode: 1, direction: "北北西", speed: 2, hasCondition: true }), "tail");

// 5. NULL になる場合（212 の CHECK: condition_source が NULL なら wind_sector も NULL）
assert.equal(windSectorOf({ era: "main", venueCode: 1, direction: "東", speed: 5, hasCondition: false }), null, "条件が無い");
assert.equal(windSectorOf({ era: "kb", venueCode: 1, direction: "北", speed: null, hasCondition: true }), null, "風速が無い");
assert.equal(windSectorOf({ era: "main", venueCode: 1, direction: null, speed: 3, hasCondition: true }), null, "向きが無い");
assert.equal(windSectorOf({ era: "main", venueCode: 99, direction: "東", speed: 3, hasCondition: true }), null, "会場が分からない");
assert.throws(() => windSectorOf({ era: "x", venueCode: 1, direction: "東", speed: 3, hasCondition: true }), /era は kb か main/);

// 6. 返す値は5区分の語彙だけ
for (const v of VENUES) {
  for (const d of LABELS) {
    for (const s of SPEEDS) {
      for (const era of ["kb", "main"]) {
        const got = windSectorOf({ era, venueCode: v, direction: d, speed: s, hasCondition: true });
        assert.ok(got === null || WIND_SECTORS.includes(got), `${era} ${v} ${d} ${s}: ${got}`);
      }
    }
  }
}

console.log("✅ verify-wind-sector: 5区分が windBin（kb）・windRelation（main）と一致、offset の写しが2表と一致");
