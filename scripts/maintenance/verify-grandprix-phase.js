#!/usr/bin/env node
/**
 * グランプリの特集（/grandprix）の日数の帯の段階（開幕前の日数・開催中の日目・終了）と、賞金の「億・万」の書き方を守る（BOA-1724）。
 *
 * - 開幕の前日は「1日」、初日は「1日目」、最終日は「6日目」、翌日は終了。月・年をまたいでも暦の日で数える
 * - 円は万円未満を1回だけ四捨五入し、ちょうど1億は「1億」（「1億0万」にしない）
 * - 賞金の順位のデータは、確定（confirmed）なら18人そろい、額は多い順
 */
import assert from "node:assert/strict";
import { formatYenMan, grandPrixPhase } from "../../src/pure/grandPrixPhase.js";
import { EDITION, PRIZE_RANKING } from "../../src/data/grandPrixFeature.js";

const ed = { startDate: "2026-12-15", endDate: "2026-12-20" };
assert.deepEqual(grandPrixPhase("2026-11-27", ed), { phase: "before", days: 18 });
assert.deepEqual(grandPrixPhase("2026-12-14", ed), { phase: "before", days: 1 });
assert.deepEqual(grandPrixPhase("2026-12-15", ed), { phase: "during", day: 1 });
assert.deepEqual(grandPrixPhase("2026-12-20", ed), { phase: "during", day: 6 });
assert.deepEqual(grandPrixPhase("2026-12-21", ed), { phase: "after" });
assert.deepEqual(grandPrixPhase("2026-12-31", { startDate: "2027-01-02", endDate: "2027-01-07" }), { phase: "before", days: 2 });

assert.equal(formatYenMan(196592000), "1億9,659万");
assert.equal(formatYenMan(95763366), "9,576万");
assert.equal(formatYenMan(100004999), "1億");
assert.equal(formatYenMan(132412338), "1億3,241万");

assert.ok(EDITION.startDate <= EDITION.endDate);
const yens = PRIZE_RANKING.racers.map((r) => r.yen);
assert.deepEqual([...yens].sort((a, b) => b - a), yens, "賞金は多い順");
if (PRIZE_RANKING.confirmed) assert.equal(PRIZE_RANKING.racers.length, 18, "確定なら18人");
console.log("verify-grandprix-phase: OK");
