// 選手ページのスナップショットを、PC の並び（1200px 以上）でもスマホの文（600px 以下）でもない幅で描くことを守る（2026-11-26 の描画の遅れ）
import assert from "node:assert/strict";
import {
  RACER_VIEWPORT,
  renderRacerSnapshots,
} from "../generateAiSnapshotsRacers.js";

// 1200px 以上: 選手ページの PC の並び（RacerProfile.css・RacerPerformanceStatsPc.css の @media (min-width: 1200px)）で描画が重い
// 600px 以下: 推移の図が直近の走に絞られ、文が変わる（RacerPerformanceStats.jsx の isNarrowViewport）
assert.ok(RACER_VIEWPORT.width > 600, `幅 ${RACER_VIEWPORT.width} はスマホの文になる`);
assert.ok(RACER_VIEWPORT.width < 1200, `幅 ${RACER_VIEWPORT.width} は PC の並びになる`);

const opened = [];
const visited = [];
const fakePage = () => ({
  goto: async (url) => visited.push(url),
  waitForSelector: async () => {},
  // noindex にして書き込みを起こさない（このverifyはファイルを書かない）
  getAttribute: async () => "noindex",
  content: async () => "",
});
const openPage = async (options) => {
  opened.push(options);
  return fakePage();
};

const ids = ["4320", "5350", "3000", "4444", "5000", "5100"];
const result = await renderRacerSnapshots(openPage, "http://127.0.0.1:0", ids, "/nonexistent");

assert.equal(visited.length, ids.length, "全員を描く");
assert.deepEqual(result.skipped.sort(), [...ids].sort(), "noindex は保存しない");
assert.ok(opened.length > 0, "ページを開く");
for (const options of opened) {
  assert.deepEqual(options?.viewport, RACER_VIEWPORT, "どのページも決めた幅で開く");
}

console.log("verify-racer-snapshot-viewport: OK");
