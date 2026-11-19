/**
 * verify-analogy-facts.js の後半の場面（3/4）。verify ではない。
 * 判定と期待値は分ける前の verify-analogy-facts.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { rankBand, clearDiff, waveBand } from "../../../src/utils/analogyScenario.js";
import {
  windWaveView,
  todayValueRank,
  noLocalRecord,
  todayValues,
  judgeLabelKey,
} from "../../../src/utils/analogyFacts.js";
import { similarRaceLink } from "../../../src/utils/analogySimilarDisplay.js";
import { splitSentences } from "../../../src/utils/analogyFormat.js";

let check;

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
  // ---- カードの今日の値と順位・類似レースのリンク先（2026-10-06 ユーザー指摘） ----
  check("今日の値と順位", todayValueRank([5, 7, 6, 4, 3, 2], true, 3), {
    value: 6,
    from: 2,
    to: 2,
    same: 1,
    of: 6,
  });
  // 記録の無い艇（当地勝率 0.00 は欠け）がいるときは、記録のある艇の中の順位（「記録のある5艇中5位」。BOA-802）
  check(
    "今日の値と順位（記録の無い艇がいる）",
    todayValueRank([4.11, 5.2, null, 6.0, 5.5, 4.8], true, 1),
    { value: 4.11, from: 5, to: 5, same: 1, of: 5 },
  );
  check(
    "今日の値と順位（同じ値は幅）",
    todayValueRank([5, 6, 6, 4, 3, 2], true, 3),
    {
      value: 6,
      from: 1,
      to: 2,
      same: 2,
      of: 6,
    },
  );
}

function scene2() {
  check(
    "今日の値と順位（小さいほど良い）",
    todayValueRank([0.15, 0.12, 0.18, 0.2, 0.1, 0.16], false, 2).from,
    2,
  );
  check(
    "今日の値が無ければ null",
    todayValueRank([5, null, 6, 4, 3, 2], true, 2),
    null,
  );
  check(
    "類似レースのリンク: 本体の日付はレースページ",
    similarRaceLink("2025-12-03-20-01"),
    {
      internal: true,
      href: "/race/2025-12-03-20-01",
    },
  );
  check(
    "類似レースのリンク: 古いレースは公式サイト",
    similarRaceLink("2019-08-06-11-12").href,
    "https://www.boatrace.jp/owpc/pc/race/raceresult?rno=12&jcd=11&hd=20190806",
  );
  check("類似レースのリンク: 形が違えば null", similarRaceLink("x"), null);
  // ---- 説明文を1文ずつに分ける（2026-10-06 ユーザー決定の箇条書き） ----
  check(
    "1文ずつ（括弧の中の「。」では分けない）",
    splitSentences(
      "カド＝一番内（助走を長くとる艇。例）。7つの形。絵は例（縮尺は1艇身≒0.13秒）",
    ),
    [
      "カド＝一番内（助走を長くとる艇。例）。",
      "7つの形。",
      "絵は例（縮尺は1艇身≒0.13秒）",
    ],
  );
  check(
    "英語は「. 」で分け、数字の小数点では分けない",
    splitSentences("Counted shares. About 0.13 s (e.g. a. b). End"),
    ["Counted shares.", "About 0.13 s (e.g. a. b).", "End"],
  );
  check("空は空", splitSentences(""), []);
  // ---- ファン評価4周目（2026-10-07 ユーザー決定） ----
  check("当地勝率 0.00 は記録なし", [0, 0.5, 5.2, null].map(noLocalRecord), [
    null,
    0.5,
    5.2,
    null,
  ]);
  check(
    "今日の当地勝率の 0.00 は欠け（ほかの項目の 0 はそのまま）",
    todayValues(
      {
        items: {
          loc_win: { values: [0, 6.1, 0, 5, 4, 3] },
          recent_win30: { values: [0, 0.1, 0.2, 0.3, 0.4, 0.5] },
        },
      },
      null,
    ),
    {
      loc_win: [null, 6.1, null, 5, 4, 3],
      recent_win30: [0, 0.1, 0.2, 0.3, 0.4, 0.5],
    },
  );
  check(
    "判定: ぶれ幅が重なり差が5ポイント未満なら「ほとんど無い」",
    judgeLabelKey({ level: "unclear", diff: -0.0027 }, [510, 705], [516, 744]),
    "unclearTiny",
  );
  check(
    "判定: 少ない側が100件未満なら件数が少ない",
    judgeLabelKey({ level: "unclear", diff: 0.5 }, [4, 5], [300, 1000]),
    "unclearFew",
  );
  check(
    "判定: 少ない側が100件以上ならぶれ幅が重なる",
    judgeLabelKey({ level: "unclear", diff: 0.06 }, [766, 1017], [725, 1019]),
    "unclear",
  );
  check(
    "判定: 境目の100件は「ぶれ幅が重なる」",
    judgeLabelKey({ level: "unclear", diff: -0.1 }, [60, 100], [70, 100]),
    "unclear",
  );
  check(
    "判定: 差が大きいはそのまま",
    judgeLabelKey({ level: "large" }, [4, 5], [1, 5]),
    "large",
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（check） */
export function runAnalogyFactsScenes4(env) {
  ({ check } = env);
  scene1();
  scene2();
}
