/**
 * verify-frontend-pure-functions.js の検査の続き（frontend-pure-functions-prev-hscroll-vol.js）。大きさの関所のため、本文を字のまま移した。verify ではない。
 */

// --- prevResult（BOA-569 → BOA-610）: 今節の前走の読み方。
// 前走は同じ会場・同じ節でこのレースより前の最後の走（race_results の1行と本番STの記号）
export function suitePrevResult(m, check) {
  const { prev } = suitePrevResultPart1(m, check);
  suitePrevResultPart2(m, check, prev);
}

export function suitePrevResultPart1(m, check) {
  // 2026-09-29 児島10R の5号艇 西村拓也: 4コースから2着。race_results の course_1〜6 は
  // 1〜6 のまま（進入順を表していない）。本番STの entry_course と actual_course_5 が 4
  const result = {
    rank1: 1,
    rank2: 5,
    rank3: 3,
    rank4: 4,
    rank5: 2,
    rank6: 6,
    course_1: 1,
    course_2: 2,
    course_3: 3,
    course_4: 4,
    course_5: 5,
    course_6: 6,
    actual_course_4: 5,
    actual_course_5: 4,
  };
  const prev = {
    boat_number: 1,
    raceId: "2026-09-29-16-10",
    boatNumber: 5,
    result,
    finishMark: "2",
    entryCourse: 4,
  };
  check(
    "meetPrevRunState: 着順と進入コース。進入は entry_course（course_N や枠番ではない。BOA-610 ファン評価1周目 P0）",
    m.meetPrevRunState(prev),
    { kind: "rank", rank: 2, course: 4, raceId: "2026-09-29-16-10" },
  );
  check(
    "meetPrevRunState: entry_course が無ければ actual_course_<艇番>、どちらも無ければ枠番で代用せず null",
    [
      m.meetPrevRunState({ ...prev, entryCourse: null }).course,
      m.meetPrevRunState({
        ...prev,
        entryCourse: null,
        result: { ...result, actual_course_5: null },
      }).course,
    ],
    [4, null],
  );
  check(
    "meetPrevRunState: 着順が付かない走は公式の記号。返還艇が着順の列にいても記号を先に見る（BOA-576）",
    [
      m.meetPrevRunState({ ...prev, finishMark: "Ｆ" }),
      m.meetPrevRunState({ ...prev, finishMark: "エ" }),
      m.meetPrevRunState({ ...prev, finishMark: "？" }),
    ],
    [
      {
        kind: "mark",
        mark: "F",
        markKey: "flying",
        course: 4,
        raceId: "2026-09-29-16-10",
      },
      {
        kind: "mark",
        mark: "エ",
        markKey: "engineStall",
        course: 4,
        raceId: "2026-09-29-16-10",
      },
      {
        kind: "mark",
        mark: "？",
        markKey: null,
        course: 4,
        raceId: "2026-09-29-16-10",
      },
    ],
  );
  check(
    "meetPrevRunState: 今節の走が無ければ「今節初戦」",
    m.meetPrevRunState({ boat_number: 1, firstOfMeet: true }),
    { kind: "firstOfMeet" },
  );
  return { prev };
}

export function suitePrevResultPart2(m, check, prev) {
  check(
    "meetPrevRunState: 前走の結果がまだ無ければ結果待ち（その走のレースIDつき）。行が無い・艇が結果に無ければ不明（「今節初戦」にしない）",
    [
      m.meetPrevRunState({ ...prev, result: null, finishMark: null }),
      m.meetPrevRunState(null),
      m.meetPrevRunState({ ...prev, boatNumber: 7, finishMark: null }),
    ],
    [
      { kind: "pending", raceId: "2026-09-29-16-10" },
      { kind: "unknown" },
      { kind: "unknown" },
    ],
  );
  check(
    "meetPrevRunWhenParams: 前走の日付とR番号。形が違えば null",
    [
      m.meetPrevRunWhenParams("2026-09-29-16-10"),
      m.meetPrevRunWhenParams("2026-10-01-02-01"),
      m.meetPrevRunWhenParams("2026-09-29"),
      m.meetPrevRunWhenParams(null),
    ],
    [
      { month: 9, day: 29, race: 10 },
      { month: 10, day: 1, race: 1 },
      null,
      null,
    ],
  );
  check(
    "finishMarkKeyOf: 履歴表とデータ出走表で同じ key に引く。数字・空・知らない記号は null（BOA-569 ファン評価3周目）",
    [
      m.finishMarkKeyOf("エ"),
      m.finishMarkKeyOf("落"),
      m.finishMarkKeyOf("Ｌ"),
      m.finishMarkKeyOf("3"),
      m.finishMarkKeyOf(""),
      m.finishMarkKeyOf(null),
    ],
    ["engineStall", "fell", "late", null, null, null],
  );
}

// --- horizontalScrollHintState: 横スクロールの手がかり（「›」・フェード）の出し方
// （#1130 ファン評価。全コース表で5px残りでも40pxのフェードと「›」が最後の列を覆い、
// 4px以下の残りでは何も出なかった）
export function suiteHscrollHint(m, check) {
  const { st } = suiteHscrollHintPart1(m, check);
  suiteHscrollHintPart2(m, check, st);
}

export function suiteHscrollHintPart1(m, check) {
  check(
    "hscroll: フェードは残りの幅まで縮め、上限40px・残り1px以下は0",
    [50, 40, 20, 10, 4, 1.5, 1, 0, -10].map((v) => m.hscrollFadeWidth(v)),
    [40, 40, 20, 10, 4, 1.5, 0, 0, 0],
  );
  const st = (scrollWidth, clientWidth, scrollLeft) =>
    m.horizontalScrollHintState({ scrollWidth, clientWidth, scrollLeft });
  check("hscroll: 収まっていれば何も出さない", st(300, 300, 0), {
    hasMore: false,
    hasLess: false,
  });
  check("hscroll: 残り1px以下は何も出さない", st(301, 300, 0), {
    hasMore: false,
    hasLess: false,
  });
  // 12px以下の残りで「›」を出さず細いフェードだけにしていた版では、380pxの枠別の全コース表で
  // 「(n=20)」が「(n=2」に読めた（BOA-735、ユーザー判断で境目を下げた）
  check("hscroll: 残り4pxでも「›」を出す", st(320, 316, 0), {
    hasMore: true,
    hasLess: false,
  });
  check("hscroll: 残り20pxは「›」を出す", st(336, 316, 0), {
    hasMore: true,
    hasLess: false,
  });
  check(
    "hscroll: 左に12px以下しか送っていなければ「‹」は出さない（PR #1192 ファン評価2周目）",
    st(320, 300, 3),
    { hasMore: true, hasLess: false },
  );
  check(
    "hscroll: 1回に送る幅は、固定の左の列を引いた見える幅の8割",
    [
      m.horizontalScrollStep({ clientWidth: 312, stickyWidth: 90 }),
      m.horizontalScrollStep({ clientWidth: 312, stickyWidth: 0 }),
      m.horizontalScrollStep({ clientWidth: 60, stickyWidth: 50 }),
    ],
    [178, 250, 40],
  );
  // 送る先を列の境目にそろえる（PR #1202 ファン評価2周目）。列の境目（固定の列を引いた位置）は 0・60・120・180・240
  const starts = [0, 60, 120, 180, 240];
  const snap = (current, step, direction, max = 263) =>
    m.snapScrollTarget({ current, step, direction, max, columnStarts: starts });
  check(
    "hscroll: 送る先は、目安（今の位置＋8割）を越えない、いちばん遠い列の境目",
    [
      snap(0, 218, 1),
      snap(120, 100, 1),
      snap(240, 100, -1),
      snap(180, 218, -1),
    ],
    [180, 180, 180, 0],
  );
  // 「‹」で左端までの残りが目安の4分の1以下なら左端まで戻す（BOA-742。375px のモーター一覧で
  // 233→37→0 と2回かかった）。右は右端が列の途中のことがあるので、手前の列の境目で止める
  check(
    "hscroll: 「‹」で左端までの残りが目安の4分の1以下なら、1回で左端まで戻す（右は境目で止める）",
    [
      m.snapScrollTarget({
        current: 233,
        step: 205,
        direction: -1,
        max: 233,
        columnStarts: [0, 37, 98, 159],
      }),
      snap(120, 120, -1),
      snap(0, 218, 1),
    ],
    [0, 0, 180],
  );
  check(
    "hscroll: 1列も越えないときは次の列の境目、端を越えるときは端",
    [snap(0, 40, 1), snap(240, 40, 1), snap(200, 300, 1), snap(130, 5, -1)],
    [60, 263, 263, 120],
  );
  // 右端の位置も列の境目にそろえる余白（PR #1202 ファン評価3周目）
  check(
    "hscroll: 右端が列の途中なら、次の列の境目まで届く余白を足す",
    m.tailPaddingFor({ naturalMax: 126, columnStarts: [0, 60, 146, 220] }),
    20,
  );
  check(
    "hscroll: 右端がすでに列の境目、溢れが1px以下、先に列が無いときは足さない",
    [
      m.tailPaddingFor({ naturalMax: 146, columnStarts: [0, 60, 146, 220] }),
      m.tailPaddingFor({ naturalMax: 1, columnStarts: [0, 30] }),
      m.tailPaddingFor({ naturalMax: 300, columnStarts: [0, 60, 146, 220] }),
    ],
    [0, 0, 0],
  );
  return { st };
}

export function suiteHscrollHintPart2(m, check, st) {
  check(
    "hscroll: 少しだけ（10px）溢れる表にも、次の列の境目まで届く余白を足す（BOA-735）",
    m.tailPaddingFor({ naturalMax: 10, columnStarts: [0, 30] }),
    20,
  );
  check("hscroll: 右端まで送ったら「›」は消え、「‹」が出る", st(357, 301, 56), {
    hasMore: false,
    hasLess: true,
  });
}

// --- volatilityDisplayValue: イン崩れ指数の表示の数値がラベルの境目をまたがない（PR #1186 ファン評価）
// --- pickVolatilityHighlights（BOA-757）: ホームのイン崩れ注意度ハイライトの選び方。
// 締切を過ぎたレースが締切前と区別なく並び、これから見るレースを選ぶ導線にならなかった
export function suiteVolatilityHighlights(m, check) {
  const { race, ids, races } = suiteVolatilityHighlightsPart1(m, check);
  suiteVolatilityHighlightsPart2(m, check, race, ids, races);
}

export function suiteVolatilityHighlightsPart1(m, check) {
  const level = (p) => (p >= 70 ? "high" : p <= 30 ? "low" : "standard");
  const race = (id, p, closed) => ({
    id,
    percentile: p,
    level: level(p),
    closed,
  });
  const ids = (r) => ({
    high: r.high.map((x) => x.id),
    low: r.low.map((x) => x.id),
    allClosed: r.allClosed,
  });
  // 締切済みの a（95）・f（5）は、締切前が1本でもあれば選ばない
  const races = [
    race("a", 95, true),
    race("b", 80, false),
    race("c", 75, false),
    race("d", 40, false),
    race("e", 20, false),
    race("f", 5, true),
  ];
  check(
    "volatilityHighlights: 締切前が残っていれば、締切前だけから段階ごとに選ぶ",
    ids(m.pickVolatilityHighlights(races, 5)),
    { high: ["b", "c"], low: ["e"], allClosed: false },
  );
  // BOA-822: イン崩れ注意度（pct 0〜100、段は保存した level）で並べる。中くらい（mid）はどちらの列にも入れない
  const ic = (id, pct, level, closed = false) => ({ id, pct, level, closed });
  check(
    "volatilityHighlights: イン崩れ注意度は pct の高い順・低い順、中くらいは入れない",
    ids(
      m.pickVolatilityHighlights(
        [
          ic("p", 65, "high"),
          ic("q", 82, "high"),
          ic("r", 43, "mid"),
          ic("s", 26, "low"),
          ic("t", 31, "low"),
        ],
        5,
        "pct",
      ),
    ),
    { high: ["q", "p"], low: ["s", "t"], allClosed: false },
  );
  // PR #1602 レビュー: pct は整数で同値が多い。同じ値は締切の早い順（入力の順＝会場の順で5本目の境を決めない）
  const ict = (id, pct, level, startTime) => ({
    id,
    pct,
    level,
    startTime,
    closed: false,
  });
  check(
    "volatilityHighlights: 同じ割合のレースは締切の早い順に並べる",
    ids(
      m.pickVolatilityHighlights(
        [
          ict("u", 75, "high", "16:40"),
          ict("v", 75, "high", "15:10"),
          ict("w", 75, "high", null),
          ict("x", 21, "low", "20:30"),
          ict("y", 21, "low", "11:05"),
        ],
        2,
        "pct",
      ),
    ),
    { high: ["v", "u"], low: ["y", "x"], allClosed: false },
  );
  // PR #1248 ファン評価1周目: 夕方の残り数本で、崩れやすさ28〜33の「標準」が「高」の列に入った
  check(
    "volatilityHighlights: 「標準」（31〜69）のレースはどちらの列にも入れない",
    ids(
      m.pickVolatilityHighlights(
        [race("x", 33, false), race("y", 45, false), race("z", 14, false)],
        5,
      ),
    ),
    { high: [], low: ["z"], allClosed: false },
  );
  return { race, ids, races };
}

export function suiteVolatilityHighlightsPart2(m, check, race, ids, races) {
  check(
    "volatilityHighlights: 締切前が1本だけでも、そのレースを出す",
    ids(
      m.pickVolatilityHighlights(
        [race("a", 95, true), race("q", 85, false)],
        5,
      ),
    ),
    { high: ["q"], low: [], allClosed: false },
  );
  // 締切前が「標準」だけでも、選ぶ対象はあるので節は出す（PR #1248 ファン評価2周目）
  check(
    "volatilityHighlights: 締切前が「標準」だけでも poolSize は残り、節を出せる",
    m.pickVolatilityHighlights([race("a", 95, true), race("s", 45, false)], 5)
      .poolSize,
    1,
  );
  check(
    "volatilityHighlights: 全部締切済みなら、締切済みから選び allClosed",
    ids(
      m.pickVolatilityHighlights(
        races.map((r) => ({ ...r, closed: true })),
        2,
      ),
    ),
    { high: ["a", "b"], low: ["f", "e"], allClosed: true },
  );
}
