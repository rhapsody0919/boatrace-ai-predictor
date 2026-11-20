/**
 * verify-fan-period.js の字の表（parserMutants・rowsMutants・downloaderMutants）。大きさの関所のため、本文を字のまま移した。verify ではない。
 */

export const parserMutants = [
  [
    "氏名の幅を16→15バイトにする（全角の桁ずれ）",
    [
      [
        '["name", 16, "text", "名前漢字"],',
        '["name", 15, "text", "名前漢字"],',
      ],
    ],
  ],
  [
    "全体の2連対率の桁数を4→3にする",
    [
      [
        '["top2_rate", 4, "d1", "複勝率"],\n  ["first_count", 3, "int", "1着回数"],',
        '["top2_rate", 3, "d1", "複勝率"],\n  ["first_count", 3, "int", "1着回数"],',
      ],
    ],
  ],
  [
    "算出期間（至）の桁数を8→7にする",
    [
      [
        '["calc_to", 8, "raw", "算出期間（至）"],',
        '["calc_to", 7, "raw", "算出期間（至）"],',
      ],
    ],
  ],
  [
    "昭和の起点を1925→1926にする（生年月日が1年ずれる）",
    [["S: 1925,", "S: 1926,"]],
  ],
  [
    "コース別の着回数を6→5個しか読まない",
    [["const COURSE_DETAIL_PLACES = 6;", "const COURSE_DETAIL_PLACES = 5;"]],
  ],
  [
    "旧レイアウト（410バイト）を出身地ありとして読む",
    [
      [
        "const hasHometown = rec.length === FAN_RECORD_BYTES;",
        "const hasHometown = true;",
      ],
    ],
  ],
  [
    "ファイル名と期の一致を検査しない（10月分の年のずれを無視）",
    [
      [
        "if (period.year !== expectYear || period.no !== expectNo)",
        "if (false)",
      ],
    ],
  ],
];

export const rowsMutants = [
  [
    "出走0でも勝率・2連対率をNULLにしない",
    [
      [
        "const noStarts = !r.starts;\n  const row = {",
        "const noStarts = false;\n  const row = {",
      ],
    ],
  ],
  [
    "出遅れ（選手責任）を L0 で数える",
    [
      [
        'sumCourses(r, "l1") + r.no_course.l1',
        'sumCourses(r, "l0") + r.no_course.l0',
      ],
    ],
  ],
  [
    "コース別の平均STを進入0でもNULLにしない",
    [
      [
        "row[`c${c}_avg_st`] = none ? null : course.avg_st;",
        "row[`c${c}_avg_st`] = course.avg_st;",
      ],
    ],
  ],
  [
    "期の識別子を導出せず固定値にする",
    [
      [
        "period_label: noStarts ? null : label,",
        'period_label: noStarts ? null : "2026-first",',
      ],
    ],
  ],
];

// 取得ループの変異
export const downloaderMutants = [
  [
    "403の連続停止を無効にする（閾値を大きくする）",
    [
      [
        "consecutiveBad >= cls.threshold",
        "consecutiveBad >= cls.threshold + 100",
      ],
    ],
  ],
  [
    "内容が想定外の応答の後に間隔を空けない",
    [
      ["      consecutiveInvalid = 0;\n", "      consecutiveInvalid = 0;\n"],
      [
        "        await pace();\n        continue;\n      }\n      consecutiveInvalid = 0;",
        "        continue;\n      }\n      consecutiveInvalid = 0;",
      ],
    ],
  ],
  [
    "未公開（想定内の404）を完了扱いにする",
    [['(s.status === "absent" && !s.expected)', '(s.status === "absent")']],
  ],
  [
    "日次上限を数えない",
    [["if (usedTonight >= opts.dailyLimit)", "if (false)"]],
  ],
];
