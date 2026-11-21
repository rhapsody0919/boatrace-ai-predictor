/**
 * verify-analogy-facts.js の後半の場面（3/4）。verify ではない。
 * 判定と期待値は分ける前の verify-analogy-facts.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  hintRows,
  hintBadgeByForm,
  minRanks,
  rankBand,
  clearDiff,
  waveBand,
} from "../../../src/utils/analogyScenario.js";
import { windWaveView } from "../../../src/utils/analogyFacts.js";
import { wilsonInterval } from "../../../src/utils/wilson.js";
import {
  sliderSteps,
  defaultStepIndex,
  normalizeNeighbor,
  aggregateNeighbors,
  trifectaList,
  itemRates,
  neighborCounts,
} from "../../../src/utils/analogyAggregate.js";

let check;
let nb, ag, rates, rows;

// 展開シナリオの画面の判定
const sh = {
  course: {
    kado4: { kado: { hit: [45, 220], miss: [66, 678] } },
    in_slow02: { d1: { hit: [31, 175], miss: [62, 723] } },
    flat03: { flat: { hit: [3, 20], miss: [100, 900] } },
  },
};

// 今日の風・波の数え方（Q-F3）: 波が別の情報を持つ会場だけ風×波、今日の区分が300件未満なら風だけ
const pair = (n) =>
  Object.fromEntries(
    [1, 2, 3, 4, 5, 6].map((b) => [String(b), { win: [1, n] }]),
  );

const va = (useWave, waveN) => ({
  wind: { "2-3": pair(5000) },
  wind_wave: { "2-3": { "3-5": pair(waveN) } },
  wave_mode: { use_wave: useWave, corr: useWave ? 0.52 : 1 },
});

const exh = { wind_band: "2-3", wind_speed: 3, wave_height: 4 };

function scene1() {
  // スライダーの段（spec B-4）
  check("段（15件の層）", sliderSteps(15), [10, 15]);
  check("段（800件以上）", sliderSteps(800).length, 12);
  check(
    "既定の段（800件）",
    sliderSteps(800)[defaultStepIndex(sliderSteps(800))],
    400,
  );
  check(
    "既定の段（15件）",
    sliderSteps(15)[defaultStepIndex(sliderSteps(15))],
    15,
  );
  // 類似レースの集計
  nb = [
    {
      race_id: "2021-10-14-16-12",
      finish: [1, 3, 6],
      technique: "逃げ",
      items: { venue: 1, nat_win_6: 2, is_final_day: -1 },
    },
    {
      race_id: "2019-08-06-11-12",
      finish: [3, 1, 4],
      technique: "まくり",
      items: { venue: 0, nat_win_6: 2 },
    },
    {
      race_id: "2020-01-01-01-01",
      finish: [3, 1, 0],
      technique: null,
      items: {},
    },
  ].map(normalizeNeighbor);
  check(
    "日付・会場・R（race_id から）",
    [nb[0].date, nb[0].venue_code, nb[0].race_number],
    ["2021-10-14", 16, 12],
  );
  ag = aggregateNeighbors(nb);
  check("集計: 件数（着順の欠けを除く）", ag.n, 2);
  check("集計: 1着", ag.win, [1, 0, 1, 0, 0, 0]);
  check("集計: 3着以内", ag.hit[3], [2, 0, 2, 1, 0, 1]);
  check("集計: 決まり手", ag.tech, { 逃げ: 1, まくり: 1 });
  check("3連単", trifectaList(ag.tri, { not1: true }), [[[3, 1, 4], 1]]);
  rates = itemRates(nb, [
    { key: "venue" },
    { key: "nat_win_6" },
    { key: "is_final_day" },
  ]);
  check(
    "同じ割合（会場）",
    [rates.venue.same, rates.venue.near, rates.venue.n],
    [0, 1, 2],
  );
  check("同じ割合（欠損は数えない）", rates.is_final_day.n, 0);
  check("1件の同じ・近い・違う", neighborCounts(nb[0], false), {
    same: 1,
    near: 1,
    diff: 0,
    total: 2,
  });
  rows = hintRows(
    sh,
    { kado4: true, in_slow02: true, flat03: true },
    "course",
    wilsonInterval,
  );
  check(
    "手がかりの札",
    rows.map((r) => [r.id, r.kind]),
    [
      ["kado4", "up"],
      ["in_slow02", "up"],
      ["flat03", "unclear"],
    ],
  );
  check(
    "全体の割合（当てはまる＋当てはまらない）",
    rows.map((r) => Number(r.pall.toFixed(4))),
    [
      Number((111 / 898).toFixed(4)),
      Number((93 / 898).toFixed(4)),
      Number((103 / 920).toFixed(4)),
    ],
  );
  check("札は形ごとに1つ", Object.keys(hintBadgeByForm(rows)), ["kado", "d1"]);
}

function scene2() {
  check("min 順位", minRanks([34.2, 37.2, 39, null, 37.2, 30], true), [
    4,
    2,
    1,
    null,
    2,
    5,
  ]);
  check("③の区分", [1, 2, 3, 4, 5, 6, null].map(rankBand), [
    "top",
    "top",
    "mid",
    "mid",
    "low",
    "low",
    null,
  ]);
  check("差がはっきりする", clearDiff([60, 100], [30, 100]), true);
  check("差がはっきりしない", clearDiff([6, 10], [5, 10]), false);
  check("波の区分", [0, 2, 3, 5, 6, null].map(waveBand), [
    "0-2",
    "0-2",
    "3-5",
    "3-5",
    "6+",
    null,
  ]);
  check(
    "風・波: 波が別の情報で300件以上",
    windWaveView(va(true, 300), exh).mode,
    "wave",
  );
  check("風・波: 300件以上のときの件数", windWaveView(va(true, 300), exh).n, 300);
  check("風・波: 300件未満は風だけ", windWaveView(va(true, 299), exh), {
    mode: "waveFew",
    rows: pair(5000),
    n: 5000,
    waveN: 299,
    wind: "2-3",
    wave: "3-5",
  });
  check(
    "風・波: 波＝風の会場は風だけ",
    windWaveView(va(false, 9999), exh).mode,
    "wind",
  );
  check(
    "風・波: 古い集計（wave_mode 無し）は風だけ",
    windWaveView({ wind: { "2-3": pair(10) } }, exh).mode,
    "wind",
  );
  check(
    "風・波: 波＝風の会場は「波高は風速とほぼ同じ」の注記を出す",
    windWaveView(va(false, 9999), exh).sameAsWind,
    true,
  );
  check(
    "風・波: 波で分ける会場でも今日の波高が無ければ風だけ・注記は出さない",
    (({ mode, sameAsWind }) => ({ mode, sameAsWind }))(
      windWaveView(va(true, 500), { wind_speed: 3 }),
    ),
    { mode: "wind", sameAsWind: false },
  );
  check(
    "風・波: Q-F3 より前の集計（wave_mode 無し）は注記を出さない",
    windWaveView({ wind: { "2-3": pair(10) } }, exh).sameAsWind,
    false,
  );
  check(
    "風・波: 今日の風が無ければ出さない",
    windWaveView(va(true, 500), { wave_height: 3 }),
    null,
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（check） */
export function runAnalogyFactsScenes6(env) {
  ({ check } = env);
  scene1();
  scene2();
}
