#!/usr/bin/env node
/**
 * verify-nigashi-by-course.js - 選手ページの進入コース別の逃し率が、出走履歴の実際の進入コース（2〜6）と決まり手「逃げ」だけで数え、1コース・進入が分からない走を数えないことを守る。
 * 純関数 src/pure/nigashiStats.js の nigashiByCourse を照らす（オーナー 2026-11-25）。
 */
import assert from "node:assert/strict";
import { nigashiByCourse } from "../../src/pure/nigashiStats.js";

const hist = (o) => ({ raceId: "2026-01-10-05-03", entryCourse: 2, winningTechnique: "逃げ", ...o });
assert.deepEqual(
  nigashiByCourse([
    hist({ raceId: "2025-12-06-12-01" }),
    hist({ winningTechnique: "差し" }),
    hist({ entryCourse: 4, raceId: "2026-11-24-05-12" }),
    hist({ entryCourse: 1 }),
    hist({ entryCourse: null }),
  ]),
  {
    rows: [
      { course: 2, n: 2, count: 1, pct: 50 },
      { course: 4, n: 1, count: 1, pct: 100 },
    ],
    from: "2025-12-06",
    to: "2026-11-24",
  },
);
assert.deepEqual(nigashiByCourse(null), { rows: [], from: null, to: null });

console.log("OK: 進入コース別の逃し率の数え方");
