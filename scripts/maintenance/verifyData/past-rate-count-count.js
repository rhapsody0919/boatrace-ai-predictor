/**
 * verify-past-rate-count.js の count の検査（SUITES.count）。大きさの関所のため、本文を字のまま移した。verify ではない。
 */
import { ROWS, row } from "./past-rate-count-fixtures.js";

export function countSuite(m, check) {
  const { c } = countSuitePart1(m, check);
  countSuitePart2(m, check, c);
  countSuitePart3(check, c);
  countSuitePart4(m, check);
}

function countSuitePart1(m, check) {
  const c = (type, input, rows = ROWS) => {
    const r = m.countPastRate(rows, type, input);
    return [r.n, r.count, r.excluded];
  };
  // orderCombos の組の中身・並びを直接固定する（点数だけでは並びを検出できない）。
  check("着順の組 1点", m.orderCombos({ first: 1, second: [2], third: [3] }), [
    [1, 2, 3],
  ]);
  check(
    "着順の組 2着・3着を昇順にして同じ艇を除く",
    m.orderCombos({ first: 1, second: [3, 2], third: [4, 2, 3] }),
    [
      [1, 2, 3],
      [1, 2, 4],
      [1, 3, 2],
      [1, 3, 4],
    ],
  );
  check(
    "着順の組 2着と3着の入れ替わり",
    m.orderCombos({ first: 1, second: [2, 3], third: [3, 2] }),
    [
      [1, 2, 3],
      [1, 3, 2],
    ],
  );
  check(
    "着順の組 全流し20組の中身と並び",
    m.orderCombos({
      first: 1,
      second: [2, 3, 4, 5, 6],
      third: [2, 3, 4, 5, 6],
    }),
    [
      [1, 2, 3],
      [1, 2, 4],
      [1, 2, 5],
      [1, 2, 6],
      [1, 3, 2],
      [1, 3, 4],
      [1, 3, 5],
      [1, 3, 6],
      [1, 4, 2],
      [1, 4, 3],
      [1, 4, 5],
      [1, 4, 6],
      [1, 5, 2],
      [1, 5, 3],
      [1, 5, 4],
      [1, 5, 6],
      [1, 6, 2],
      [1, 6, 3],
      [1, 6, 4],
      [1, 6, 5],
    ],
  );
  check(
    "着順の組 2着が1着と同じ艇だけ",
    m.orderCombos({ first: 1, second: [1], third: [2] }),
    [],
  );
  check(
    "着順の組 2着と3着が同じ艇だけ",
    m.orderCombos({ first: 1, second: [2], third: [2] }),
    [],
  );
  check("着順の組 2着・3着の欄が無い", m.orderCombos({ first: 1 }), []);
  check("着順の組 3着の欄が無い", m.orderCombos({ first: 1, second: [2] }), []);
  check(
    "着順の組 並びは文字列順でなく数値順",
    m.orderCombos({ first: 1, second: [10, 2], third: [3] }),
    [
      [1, 2, 3],
      [1, 10, 3],
    ],
  );
  const orderInput = { first: 1, second: [3, 2], third: [2, 3] };
  m.orderCombos(orderInput);
  check("着順の組 入力を並べ替えない", orderInput, {
    first: 1,
    second: [3, 2],
    third: [2, 3],
  });
  // 着順
  check(
    "着順 1点 1-3-2",
    c("order", { first: 1, second: [3], third: [2], nagashi: false }),
    [12, 1, []],
  );
  return { c };
}

function countSuitePart2(m, check, c) {
  check(
    "着順 流し 1-3,4-2,3,4（4点）",
    c("order", { first: 1, second: [3, 4], third: [2, 3, 4], nagashi: true }),
    [12, 3, []],
  );
  check(
    "着順の点数（同じ艇を含む組は数えない）",
    m.orderPoints({
      first: 1,
      second: [3, 4],
      third: [2, 3, 4],
      nagashi: true,
    }),
    4,
  );
  check(
    "着順の点数 1着と同じ艇は数えない",
    m.orderPoints({ first: 1, second: [1, 2], third: [1, 3], nagashi: true }),
    1,
  );
  check(
    "着順の内訳（件数の多い順、同数は組の昇順、上位4組）",
    m.countPastRate(ROWS, "order", {
      first: 1,
      second: [2, 3, 4, 5],
      third: [2, 3, 4],
      nagashi: true,
    }).breakdown,
    {
      items: [
        { combo: "1-2-3", count: 1 },
        { combo: "1-2-4", count: 1 },
        { combo: "1-3-2", count: 1 },
        { combo: "1-3-4", count: 1 },
      ],
      more: true,
    },
  );
  check(
    "着順 1点は内訳なし",
    m.countPastRate(ROWS, "order", {
      first: 1,
      second: [2],
      third: [3],
      nagashi: false,
    }).breakdown,
    null,
  );
  // 1号艇
  check("1号艇 1着", c("boat1", { outcome: "win" }), [12, 6, []]);
  check("1号艇 残る", c("boat1", { outcome: "top3" }), [12, 11, []]);
  check("1号艇 飛ぶ", c("boat1", { outcome: "out" }), [12, 1, []]);
  // 展開
  check(
    "展開 3号艇のまくり（決まり手が無い行を除く）",
    c("tenkai", { boat: 3, technique: "makuri" }),
    [11, 2, [{ reason: "technique", count: 1 }]],
  );
  check(
    "展開の2着の内訳（0件は省く、多い順・同数は艇番順）",
    m.countPastRate(ROWS, "tenkai", { boat: 1, technique: "nige" }).breakdown,
    {
      items: [
        { boat: 3, count: 2 },
        { boat: 2, count: 1 },
        { boat: 4, count: 1 },
        { boat: 5, count: 1 },
      ],
      more: false,
    },
  );
  // 進入
  check("進入 4号艇 3コース以内", c("entry", { boat: 4, target: "within3" }), [
    12,
    1,
    [],
  ]);
  check("進入 4号艇 4コース以内", c("entry", { boat: 4, target: "within4" }), [
    12,
    11,
    [],
  ]);
  check("進入 4号艇 枠なり", c("entry", { boat: 4, target: "waku" }), [
    12,
    10,
    [],
  ]);
}

function countSuitePart3(check, c) {
  check(
    "進入 5号艇 枠なり（その艇のコースが null の行を除く）",
    c("entry", { boat: 5, target: "waku" }),
    [11, 9, [{ reason: "course", count: 1 }]],
  );
  check(
    "進入 course_by_boat が配列ごと null の行を除く",
    c("entry", { boat: 3, target: "waku" }, [row({ cb: null }), row()]),
    [1, 1, [{ reason: "course", count: 1 }]],
  );
  // 配当の帯（1,000 ちょうどは中穴、10,000 ちょうどは万舟）
  check("配当 堅い", c("payout", { band: "low" }), [
    11,
    1,
    [{ reason: "payout", count: 1 }],
  ]);
  check("配当 中穴", c("payout", { band: "mid" }), [
    11,
    6,
    [{ reason: "payout", count: 1 }],
  ]);
  check("配当 万舟", c("payout", { band: "high" }), [
    11,
    4,
    [{ reason: "payout", count: 1 }],
  ]);
  // スリット
  const slitRows = [
    row({ st: [0.1, 0.15, 0.1, 0.12, 0.13, 0.14] }), // d2（1段目のみ）
    row({ st: [0.1, 0.18, 0.1, 0.12, 0.13, 0.14] }), // d2（両段）
    row({ st: [0.2, 0.2, 0.2, 0.15, 0.15, 0.15] }), // wall・kado・dash（1段目）
    row({ st: [0.15, 0.15, null, 0.15, 0.15, 0.15] }), // 要素の null（同じコースに2艇など）
    row({ st: null }), // 配列ごと null（守り）
  ];
  check(
    "スリット 2コース凹み 1段目",
    c("slit", { mode: "pattern", patterns: ["d2"], level: 1 }, slitRows),
    [3, 2, [{ reason: "st", count: 2 }]],
  );
  check(
    "スリット 2コース凹み 2段目",
    c("slit", { mode: "pattern", patterns: ["d2"], level: 2 }, slitRows),
    [3, 1, [{ reason: "st", count: 2 }]],
  );
  check(
    "スリット 2形 AND（カド一撃＋ダッシュ勢先行）",
    c(
      "slit",
      { mode: "pattern", patterns: ["kado", "dash"], level: 1 },
      slitRows,
    ),
    [3, 1, [{ reason: "st", count: 2 }]],
  );
  // 自分で作る: S − 6×c_k ≥ 30 で出る、6×c_k − S ≥ 30 で凹む
  const customRows = [
    row({ st: [0.2, 0.15, 0.15, 0.1, 0.15, 0.15] }), // S=90。1コース 6×20−90=30 で凹む、4コース 90−60=30 で出る
    row({ st: [0.19, 0.15, 0.15, 0.09, 0.15, 0.15] }), // S=88。1コース 114−88=26 凹まない、4コース 88−54=34 出る
  ];
  check(
    "自分で作る 1コース凹む・4コース出る",
    c("slit", { mode: "custom", courses: [-1, 0, 0, 1, 0, 0] }, customRows),
    [2, 1, []],
  );
  check(
    "自分で作る 4コース出るだけ",
    c("slit", { mode: "custom", courses: [0, 0, 0, 1, 0, 0] }, customRows),
    [2, 2, []],
  );
  // N=0
  // 浮動小数で割れる組: 0.29 と 0.23×5 は整数なら 6×29−144=30 ちょうど（浮動小数だと 29.99…）
  check(
    "自分で作る 30 ちょうど（整数で比べる）",
    c("slit", { mode: "custom", courses: [-1, 0, 0, 0, 0, 0] }, [
      row({ st: [0.29, 0.23, 0.23, 0.23, 0.23, 0.23] }),
    ]),
    [1, 1, []],
  );
  check(
    "N=0（展開で決まり手が全部 null）",
    c("tenkai", { boat: 1, technique: "nige" }, [row({ tech: null })]),
    [0, 0, [{ reason: "technique", count: 1 }]],
  );
}

function countSuitePart4(m, check) {
  // 決着
  check(
    "決着 1-3-2（着順1点と同じ数え方）",
    [
      m.decisionCount(ROWS, [1, 3, 2]).count,
      m.decisionCount(ROWS, [1, 3, 2]).n,
    ],
    [1, 12],
  );
  // 同時に起きない形（押した後に残る2形の組で決める）
  check(
    "同時に起きない: 内3艇そろうを選んだとき（1段目）",
    m.incompatibleForms(["wall"], 1),
    ["d2", "d3", "d1"],
  );
  check(
    "同時に起きない: 2段目は横一線と凹み・ダッシュ勢先行も",
    m.incompatibleForms(["flat"], 2),
    ["d2", "d3", "d1", "dash"],
  );
  check(
    "同時に起きない: 1段目の横一線は全部押せる",
    m.incompatibleForms(["flat"], 1),
    [],
  );
  check(
    "同時に起きない: 2形のときは新しい方と組む（内3艇→カド一撃の後は2コース凹みを押せる）",
    m.incompatibleForms(["wall", "kado"], 1),
    [],
  );
  check(
    "同時に起きない: 2形のときは新しい方と組む（カド一撃→内3艇）",
    m.incompatibleForms(["kado", "wall"], 1),
    ["d2", "d3", "d1"],
  );
  check("選択中の形は押せる（外すため）", m.incompatibleForms(["d2"], 1), [
    "wall",
    "d3",
    "d1",
  ]);
  check(
    "2段目に切り替えられない組（横一線＋イン凹み）",
    m.levelBlocked(["flat", "d1"]),
    true,
  );
  check(
    "2段目に切り替えられる組（カド一撃＋ダッシュ勢先行）",
    m.levelBlocked(["kado", "dash"]),
    false,
  );
}
