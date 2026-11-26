// 選手ページのスナップショットを PC の並び（1200px 以上）でもスマホの文（600px 以下）でもない幅で描き、描いたページの保存・除外の分け方を守る（2026-11-26 の描画の遅れ）
import assert from "node:assert/strict";
import {
  RACER_VIEWPORT,
  dedupeDefaultTitle,
  renderRacerSnapshots,
} from "../generateAiSnapshotsRacers.js";

// 1200px 以上: 選手ページの PC の並び（RacerProfile.css・RacerPerformanceStatsPc.css の @media (min-width: 1200px)）で描画が重い
// 600px 以下: 推移の図が直近の走に絞られ、文が変わる（RacerPerformanceStats.jsx の isNarrowViewport）
assert.ok(
  RACER_VIEWPORT.width > 600,
  `幅 ${RACER_VIEWPORT.width} はスマホの文になる`,
);
assert.ok(
  RACER_VIEWPORT.width < 1200,
  `幅 ${RACER_VIEWPORT.width} は PC の並びになる`,
);

const DEFAULT_TITLE =
  "<title>ボートレースのデータ分析とAI予想が無料｜競艇 龍神レーダー</title>";
const READY =
  '<div data-snapshot-ready="true" data-snapshot-motor="done" data-snapshot-history="empty">選手</div>';
const timeout = () =>
  Object.assign(new Error("待ちの打ち切り"), { name: "TimeoutError" });

/** 選手ごとの偽のページの振る舞い */
const SCENES = {
  4320: { html: `${DEFAULT_TITLE}<title>選手A</title>${READY}` },
  5350: { robots: "noindex" },
  3000: { waitError: timeout },
  4444: {
    html: `<title>選手D</title>${READY.replace('"empty"', '"loading"')}`,
  },
  5100: { waitError: () => new Error("ブラウザが落ちた") },
};

const opened = [];
const visits = {};
// 4つ並べて描くので、どの選手を開いたかはページごとに持つ
const fakePage = () => {
  let current = null;
  return {
    goto: async (url) => {
      current = url.split("/").pop();
      visits[current] = (visits[current] ?? 0) + 1;
    },
    waitForSelector: async () => {
      const make = SCENES[current].waitError;
      if (make) throw make();
    },
    getAttribute: async () => SCENES[current].robots ?? "index,follow",
    content: async () => SCENES[current].html ?? "",
  };
};
const openPage = async (options) => {
  opened.push(options);
  return fakePage();
};

// 保存先は無い場所にする（この verify はファイルを書かない）。揃ったページだけが書き込みまで進み、ENOENT で失敗に数える
const outDir = "/nonexistent-racer-snapshot-viewport";
const ids = Object.keys(SCENES);
const result = await renderRacerSnapshots(
  openPage,
  "http://127.0.0.1:0",
  ids,
  outDir,
);

assert.deepEqual(
  [...result.skipped].sort(),
  ["3000", "4444", "5350"],
  "noindex・目印の打ち切り・読み込み中は保存しない",
);
const failed = Object.fromEntries(result.failed.map((f) => [f.id, f.error]));
assert.deepEqual(Object.keys(failed).sort(), ["4320", "5100"]);
assert.match(
  failed["4320"],
  /ENOENT.*4320\.html/,
  "揃ったページは書き込みまで進む",
);
assert.equal(
  failed["5100"],
  "ブラウザが落ちた",
  "打ち切り以外のエラーは失敗に数える",
);
assert.equal(result.saved, 0);
assert.equal(visits["5100"], 3, "失敗は2回まで描き直す");
assert.equal(visits["5350"], 1, "保存しないページは描き直さない");

assert.ok(opened.length > 0, "ページを開く");
for (const options of opened) {
  assert.deepEqual(
    options?.viewport,
    RACER_VIEWPORT,
    "どのページも決めた幅で開く",
  );
}

assert.equal(
  dedupeDefaultTitle(`${DEFAULT_TITLE}<title>選手A</title>`),
  "<title>選手A</title>",
  "既定の title を除く",
);
assert.equal(
  dedupeDefaultTitle(`${DEFAULT_TITLE}x`),
  `${DEFAULT_TITLE}x`,
  "title が1つなら残す",
);

console.log("verify-racer-snapshot-viewport: OK");
