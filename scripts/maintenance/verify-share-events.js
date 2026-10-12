#!/usr/bin/env node
/**
 * AI用にコピー・SNS シェアの GA4 のイベント（ai_copy・race_share、BOA-822 の計測）の中身を検証する。
 *
 * src/utils/shareEvents.js の純関数だけを見る。DBには接続しない。
 * 定義は docs/design/in-collapse-caution/measurement.md・events-share.md。
 *
 *   node scripts/maintenance/verify-share-events.js
 */
import assert from "node:assert/strict";
import { aiCopyEventOf, raceShareEventOf } from "../../src/utils/shareEvents.js";

const RESERVED = ["source", "medium", "campaign", "term", "content", "id"];
const noReserved = (ev) =>
  assert.ok(
    Object.keys(ev.params).every((k) => !RESERVED.includes(k)),
    `予約語のパラメータ: ${Object.keys(ev.params)}`,
  );

// ai_copy
const copy = aiCopyEventOf({
  raceId: "2026-10-12-09-02",
  promptType: "trifecta",
  place: "banner",
});
assert.deepEqual(copy, {
  name: "ai_copy",
  params: {
    race_id: "2026-10-12-09-02",
    ai_copy_prompt: "trifecta",
    ai_copy_place: "banner",
  },
});
noReserved(copy);
assert.equal(
  aiCopyEventOf({ raceId: "2026-10-12-09-02", promptType: null, place: "inline" })
    .params.ai_copy_prompt,
  "default",
  "質問の種類が無いときは default",
);
assert.equal(
  aiCopyEventOf({ raceId: null, promptType: "win", place: "inline" }),
  null,
  "レースが分からないときは送らない",
);

// race_share
for (const channel of ["x", "facebook", "line"]) {
  for (const kind of ["prediction", "result", "hit"]) {
    const ev = raceShareEventOf({ raceId: "2026-10-12-09-02", channel, kind });
    assert.deepEqual(ev, {
      name: "race_share",
      params: {
        race_id: "2026-10-12-09-02",
        share_channel: channel,
        share_kind: kind,
      },
    });
    noReserved(ev);
  }
}
assert.equal(
  raceShareEventOf({ raceId: "r", channel: "x", kind: null }),
  null,
  "種類の無い呼び出し（レース以外のシェア）は送らない",
);
assert.equal(
  raceShareEventOf({ raceId: "r", channel: "mail", kind: "hit" }),
  null,
  "知らない送り先は送らない",
);
assert.deepEqual(
  raceShareEventOf({ raceId: null, channel: "line", kind: "hit" }).params,
  { share_channel: "line", share_kind: "hit" },
  "レースが分からないときは race_id を付けない",
);

console.log("✅ verify-share-events: ai_copy・race_share の中身が定義どおり");
