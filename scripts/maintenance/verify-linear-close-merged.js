/**
 * verify-linear-close-merged.js - マージした PR の Linear の票を閉じてよいかの判定（scripts/lib/linearCloseMerged.js、
 * BOA-1711）を確かめる。ネットワークに触れない。
 *
 * 守る物: 閉じる票は枝の BOA-N 1枚（無ければ題の先頭）だけで、題の途中の票（親・参照）は閉じない。
 * 迷う物（開いた子・同じ票の開いた PR・続きを示す語・票が多すぎる）は閉じない。閉じた票は触らない。
 */
import assert from "node:assert/strict";
import { decide, ticketsFor, countTickets } from "../lib/linearCloseMerged.js";

assert.deepEqual(ticketsFor("claude: BOA-12 x", "claude/boa-1704-venue"), ["BOA-1704"], "枝が先");
assert.deepEqual(ticketsFor("BOA-1690 トップ", "fix/x"), ["BOA-1690"], "枝に無ければ題の先頭");
assert.deepEqual(ticketsFor("トップの直し（BOA-1690 の続き）", "fix/x"), [], "題の途中は親・参照");
assert.deepEqual(ticketsFor("chore: update sitemap", "master"), []);
assert.equal(countTickets("BOA-1 BOA-2 BOA-3 BOA-4", "claude/boa-1"), 4);

const open = { state: { type: "backlog" }, children: { nodes: [] } };
const pr = { title: "claude: BOA-7 直す", body: "", head: { ref: "claude/boa-7-x" } };
assert.equal(decide("BOA-7", open, [], pr).action, "close");
assert.equal(decide("BOA-7", { ...open, state: { type: "completed" } }, [], pr).action, "skip");
assert.equal(decide("BOA-7", { ...open, state: { type: "canceled" } }, [], pr).action, "skip");
assert.equal(
  decide("BOA-7", { ...open, children: { nodes: [{ identifier: "BOA-8", state: { type: "started" } }] } }, [], pr).action,
  "keep",
  "開いた子があれば閉じない",
);
assert.equal(
  decide("BOA-7", { ...open, children: { nodes: [{ identifier: "BOA-8", state: { type: "completed" } }] } }, [], pr).action,
  "close",
  "子が全部閉じていれば閉じる",
);
assert.equal(
  decide("BOA-7", open, [{ number: 9, title: "x", head: { ref: "claude/boa-7-more" } }], pr).action,
  "keep",
  "同じ票の開いた PR があれば閉じない",
);
for (const w of ["（2/3）", "前半", "第2段", "続きは次の PR", "WIP"]) {
  assert.equal(decide("BOA-7", open, [], { ...pr, title: `claude: BOA-7 直す${w}` }).action, "keep", w);
}
assert.equal(decide("BOA-7", open, [], { ...pr, title: "BOA-7 11/22 の直し" }).action, "close", "日付の 11/22 は続きの語でない");
assert.equal(
  decide("BOA-7", open, [], { ...pr, title: "BOA-7 BOA-8 BOA-9 BOA-10 まとめ" }).action,
  "keep",
  "票が多すぎれば閉じない",
);

console.log("verify-linear-close-merged: OK（票の選び方・閉じない条件）");
