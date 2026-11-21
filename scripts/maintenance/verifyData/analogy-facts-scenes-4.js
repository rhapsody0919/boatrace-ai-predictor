/**
 * verify-analogy-facts.js の後半の場面（4/4）。verify ではない。
 * 判定と期待値は分ける前の verify-analogy-facts.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  todayValueRank,
  noLocalRecord,
  todayValues,
  judgeLabelKey,
} from "../../../src/utils/analogyFacts.js";
import { similarRaceLink } from "../../../src/utils/analogySimilarDisplay.js";
import { splitSentences } from "../../../src/utils/analogyFormat.js";
import { hintTableBest, raceListRows } from "../../../src/utils/analogyAggregate.js";
import { KNOWN_GAPS } from "./analogy-facts-scenes-1.js";

let check;

function scene1() {
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
}

function scene2() {
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
export function runAnalogyFactsScenes7(env) {
  ({ check } = env);
  scene1();
  scene2();
}

function scene3() {
  // ---- 平均STの表の金枠（BOA-814）。出走表と同じ決まり ----------------------
  {
    const st = (filled, n, extra = {}) => ({
      course_filled: filled,
      course_n: n,
      overall: [0.16, 0.16, 0.16, 0.16, 0.16, 0.16],
      venue: [],
      venue_n: [],
      ...extra,
    });
    const sets = (b) =>
      Object.fromEntries(Object.entries(b).map(([k, v]) => [k, [...v].sort()]));
    const base = [0.15, 0.12, 0.14, 0.13, 0.16, 0.17];
    check(
      "平均STの表: 一番小さい値に金枠",
      sets(hintTableBest(st(base, [20, 20, 20, 20, 20, 20]), null)),
      { course: [2], overall: [], venue: [], exh: [] },
    );
    check(
      "平均STの表: 走数が6走未満の値は一番でも付けず、次の艇に繰り下げない",
      sets(hintTableBest(st(base, [20, 5, 20, 20, 20, 20]), null)).course,
      [],
    );
    check(
      "平均STの表: 3桁で同じ値なら両方に付ける",
      sets(
        hintTableBest(
          st([0.1504, 0.1496, 0.16, 0.17, 0.18, 0.19], [9, 9, 9, 9, 9, 9]),
          null,
        ),
      ).course,
      [1, 2],
    );
    check(
      "平均STの表: 会場の値は薄く出している（10走未満）ものに付けない",
      sets(
        hintTableBest(
          st(base, [20, 20, 20, 20, 20, 20], {
            venue: [0.11, 0.14, 0.15, 0.16, 0.17, 0.18],
            venue_n: [9, 30, 30, 30, 30, 30],
          }),
          null,
        ),
      ).venue,
      [],
    );
    check(
      "平均STの表: 展示STは F を外し、2桁で比べる",
      sets(
        hintTableBest(st(base, [20, 20, 20, 20, 20, 20]), [
          -0.02,
          0.051,
          0.049,
          0.1,
          0.12,
          null,
        ]),
      ).exh,
      [2, 3],
    );
  }
}

function scene4() {
  // ---- STEP4 の件数から元のレースの一覧（BOA-823）。画面の絞りと押した物を重ねる ----------------
  {
    const races = {
      entry_bits: ["waku", "inlost", "mae", "mae6", "mae5", "mae56", "maeOther"],
      form_bits: ["flat", "wall", "d2", "d3", "kado", "d1", "dash"],
      rows: [
        ["2026-10-09-01-01", 0b1, 0b10011, "213", "差し", 1980],
        ["2026-10-08-02-01", 0b1, 0b10000, "132", "逃げ", 1240],
        ["2026-10-07-03-01", 0b100, 0b1, "415", "まくり", 15600],
        ["2026-10-06-04-01", 0b1, 0b0, "246", null, null],
      ],
    };
    const ids = (o) => raceListRows(races, o).map((r) => r.race_id.slice(5, 10));
    check("一覧: 1着の艇", ids({ pick: { kind: "first", boat: 2 } }), [
      "10-09",
      "10-06",
    ]);
    check(
      "一覧: 進入（枠なり）と形（カド一撃）で絞る",
      ids({ entry: "waku", form: "kado", pick: { kind: "first", boat: 2 } }),
      ["10-09"],
    );
    check("一覧: 3連単", ids({ pick: { kind: "tri", combo: [1, 3, 2] } }), [
      "10-08",
    ]);
    check(
      "一覧: 帯（2着→3着）",
      ids({ pick: { kind: "band", p: 1, a: 1, b: 5 } }),
      ["10-07"],
    );
    check("一覧: 万舟", ids({ pick: { kind: "manshu" } }), ["10-07"]);
    check(
      "一覧: 決まり手の記録なしは「その他」",
      ids({ pick: { kind: "tech", tech: "その他" } }),
      ["10-06"],
    );
    check(
      "一覧: 1号艇以外",
      ids({ not1: true, pick: { kind: "tech", tech: "差し" } }),
      ["10-09"],
    );
    check(
      "一覧: 形の名前",
      raceListRows(races, { pick: { kind: "first", boat: 2 } })[0].forms,
      ["flat", "wall", "kado"],
    );
  }
  console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length} 件（仕様未定・不一致に数えない）`);
  for (const [input, observe] of KNOWN_GAPS) {
    let current;
    try {
      const value = observe();
      current = value === undefined ? "undefined" : JSON.stringify(value);
    } catch (error) {
      current = `例外 ${error.message}`;
    }
    console.log(`  ${input}: ${current}`);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check） */
export function runAnalogyFactsScenes8(env) {
  ({ check } = env);
  scene3();
  scene4();
}
