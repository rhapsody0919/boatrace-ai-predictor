/**
 * verify-fan-period.js の期待値（実データ）と、パーサー・行変換の評価。verify ではない。
 * 変異検証で、壊した版のパーサー・行変換にも同じ評価をかける。
 */

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
// 期待値（実データ）
// ---------------------------------------------------------------------------

// 公式の選手ページ「期別成績」（2026-09-21取得。集計期間 2025/11/01〜2026/04/30）
const OFFICIAL_SEASON = {
  3448: {
    win_rate: 4.61,
    top2_rate: 24.4,
    starts: 90,
    finals: 1,
    wins: 0,
    avg_st: 0.19,
    ability: 47,
    flying: 1,
    false_start: 0,
    places: [10, 12, 17, 13, 26, 11],
  },
  3809: {
    win_rate: 3.86,
    top2_rate: 12.3,
    starts: 65,
    finals: 0,
    wins: 0,
    avg_st: 0.19,
    ability: 45,
    flying: 1,
    false_start: 1,
    places: [2, 6, 15, 13, 14, 13],
  },
  3955: {
    win_rate: 4.84,
    top2_rate: 24.5,
    starts: 57,
    finals: 0,
    wins: 0,
    avg_st: 0.19,
    ability: 49,
    flying: 0,
    false_start: 0,
    places: [5, 9, 13, 13, 7, 10],
  },
  4177: {
    win_rate: 4.53,
    top2_rate: 25,
    starts: 76,
    finals: 1,
    wins: 1,
    avg_st: 0.17,
    ability: 46,
    flying: 0,
    false_start: 0,
    places: [12, 7, 13, 10, 15, 19],
  },
  5111: {
    win_rate: 5.55,
    top2_rate: 40,
    starts: 95,
    finals: 1,
    wins: 0,
    avg_st: 0.15,
    ability: 50,
    flying: 0,
    false_start: 0,
    places: [20, 18, 14, 14, 13, 16],
  },
  5158: {
    win_rate: 6.78,
    top2_rate: 52,
    starts: 123,
    finals: 6,
    wins: 1,
    avg_st: 0.16,
    ability: 54,
    flying: 0,
    false_start: 0,
    places: [44, 20, 17, 22, 14, 5],
  },
};
// 出走0の選手（公式ページは全項目が「-」）
const OFFICIAL_NO_STARTS = [5472, 3391];
// 公式の選手ページ「コース別成績」（2026-09-21取得）。進入率=進入回数/出走回数、3連対率=(1〜3着)/進入回数
const OFFICIAL_COURSE = {
  3448: {
    entry_rate: [16.7, 16.7, 17.8, 17.8, 17.8, 13.3],
    top3_rate: [93.3, 46.7, 50, 18.8, 18.8, 33.3],
    avg_st: [0.17, 0.18, 0.2, 0.19, 0.21, 0.19],
    start_rank: [3.4, 4.7, 3.9, 3.6, 4.1, 3.8],
  },
  4365: {
    entry_rate: [19, 19, 13, 15, 16, 18],
    top3_rate: [84.2, 78.9, 69.2, 66.7, 18.8, 11.1],
    avg_st: [0.14, 0.16, 0.18, 0.17, 0.18, 0.22],
    start_rank: [2.7, 3.3, 3.5, 2.5, 3.4, 4],
  },
};
// 公式の選手ページ「プロフィール」（2026-09-21取得）。氏名・出身地・血液型・級の表記は、ページとfanで異なる（空白・県・型）
const OFFICIAL_PROFILE = {
  3024: {
    name: "西島義則",
    birth: "1961-10-30",
    height: 166,
    weight: 59,
    branch: "広島",
    term: 49,
    blood: "AB",
    hometown: "島根",
    sex: 1,
  },
  3618: {
    name: "海野ゆかり",
    birth: "1973-11-28",
    height: 164,
    weight: 45,
    branch: "広島",
    term: 71,
    blood: "O",
    hometown: "広島",
    sex: 2,
  },
  5186: {
    name: "遠藤圭吾",
    birth: "2000-04-14",
    height: 171,
    weight: 54,
    branch: "東京",
    term: 128,
    blood: "A",
    hometown: "神奈川",
    sex: 1,
  },
};
// 本番DBの racer_profiles（2026-09-21 SELECT。B6が2026-09-19〜20に取得した値）: [能力指数, F, 出遅れ, 勝率]。出走0はNULL
const DB_PROFILES = {
  3024: [53, 3, 0, 6.68],
  3448: [47, 1, 0, 4.61],
  3809: [45, 1, 1, 3.86],
  3618: [57, 0, 0, 6.36],
  5186: [43, 1, 1, 3.62],
  3955: [49, 0, 0, 4.84],
  4177: [46, 0, 0, 4.53],
  5111: [50, 0, 0, 5.55],
  5158: [54, 0, 0, 6.78],
  4365: [50, 0, 0, 5.56],
  5472: [null, null, null, null],
  3391: [null, null, null, null],
};

const norm = (s) => (s ?? "").normalize("NFKC").replace(/\s+/g, "");

function addFan2604Header(add, fan) {
  add(
    "fan2604: 12人・異常0",
    fan.record_count === 12 && fan.anomalies.length === 0,
    JSON.stringify(fan.anomalies.slice(0, 2)),
  );
  add(
    "期: 2026年2期、算出期間 2025-11-01〜2026-04-30",
    same(fan.period, {
      year: 2026,
      no: 2,
      calc_from: "2025-11-01",
      calc_to: "2026-04-30",
    }),
  );
}

function parsedViews(R, fan) {
  const by = new Map(fan.records.map((r) => [r.racer_id, r]));
  const { rows } = R.buildStatsRows(fan);
  const rowBy = new Map(rows.map((r) => [r.racer_id, r]));
  const prof = R.buildProfileSyncRows(fan).rows;
  const profBy = new Map(prof.map((r) => [r.racer_id, r]));
  return { by, rowBy, prof, profBy };
}

const sum = (r, k) => r.courses.reduce((a, c) => a + c[k], 0);

function addSeasonChecks(add, { by, rowBy }) {
  // 2. 公式の選手ページとの一致（期別成績）
  for (const [id, o] of Object.entries(OFFICIAL_SEASON)) {
    const r = by.get(Number(id));
    const row = rowBy.get(Number(id));
    const got = {
      win_rate: row.win_rate,
      top2_rate: row.top2_rate,
      starts: row.starts,
      finals: row.finals,
      wins: row.wins,
      avg_st: row.avg_st,
      ability: row.ability_now,
      flying: sum(r, "f"),
      false_start: sum(r, "l1") + r.no_course.l1,
      places: [0, 1, 2, 3, 4, 5].map((i) =>
        r.courses.reduce((a, c) => a + c.places[i], 0),
      ),
    };
    add(
      `公式の選手ページ（期別成績）と一致: ${id}`,
      same(got, o),
      `page=${JSON.stringify(o)} fan=${JSON.stringify(got)}`,
    );
  }
  for (const id of OFFICIAL_NO_STARTS) {
    const row = rowBy.get(id);
    add(
      `出走0の選手は勝率・2連対率・平均ST・能力指数がNULL（公式ページは「-」）: ${id}`,
      row.starts === 0 &&
        row.win_rate === null &&
        row.top2_rate === null &&
        row.avg_st === null &&
        row.ability_now === null,
      JSON.stringify(row).slice(0, 200),
    );
  }
  add(
    "進入0のコースの平均ST・スタート順位・2連対率はNULL（5472は全コース進入0）",
    [1, 2, 3, 4, 5, 6].every((c) => {
      const row = rowBy.get(5472);
      return (
        row[`c${c}_avg_st`] === null &&
        row[`c${c}_avg_start_rank`] === null &&
        row[`c${c}_top2_rate`] === null
      );
    }),
  );
}

function addCourseChecks(add, { by, rowBy }) {
  // 公式の選手ページ（コース別成績）との一致
  for (const [id, o] of Object.entries(OFFICIAL_COURSE)) {
    const r = by.get(Number(id));
    const row = rowBy.get(Number(id));
    const got = {
      entry_rate: r.courses.map(
        (c) => Math.round((c.entries / r.starts) * 1000) / 10,
      ),
      top3_rate: r.courses.map(
        (c) =>
          Math.round(
            ((c.places[0] + c.places[1] + c.places[2]) / c.entries) * 1000,
          ) / 10,
      ),
      avg_st: [1, 2, 3, 4, 5, 6].map((c) => row[`c${c}_avg_st`]),
      start_rank: [1, 2, 3, 4, 5, 6].map((c) => row[`c${c}_avg_start_rank`]),
    };
    add(
      `公式の選手ページ（コース別成績）と一致: ${id}`,
      same(got, o),
      `page=${JSON.stringify(o)} fan=${JSON.stringify(got)}`,
    );
  }
}

function addProfileChecks(add, { by }) {
  // 公式の選手ページ（プロフィール）との一致
  for (const [id, o] of Object.entries(OFFICIAL_PROFILE)) {
    const r = by.get(Number(id));
    const got = {
      name: norm(r.name),
      birth: r.birth_date,
      height: r.height_cm,
      weight: r.weight_kg,
      branch: r.branch,
      term: r.training_term,
      blood: r.blood_type,
      hometown: norm(r.hometown),
      sex: r.sex,
    };
    add(
      `公式の選手ページ（プロフィール）と一致: ${id}`,
      same(got, o),
      `page=${JSON.stringify(o)} fan=${JSON.stringify(got)}`,
    );
  }
}

function addDbChecks(add, { prof, profBy }) {
  // 3. 本番DBの racer_profiles との一致（反映する行の値）
  for (const [id, exp] of Object.entries(DB_PROFILES)) {
    const p = profBy.get(Number(id));
    if (!p) continue;
    const got = [
      p.ability_index,
      p.flying_count_period,
      p.false_start_count_period,
      p.official_win_rate_period,
    ];
    add(
      `racer_profiles（本番DB）の値と一致: ${id}`,
      same(got, exp),
      `db=${JSON.stringify(exp)} fan=${JSON.stringify(got)}`,
    );
  }
  add(
    "反映行の期の識別子は 2026-second（B6と同じ）",
    prof
      .filter((p) => p.ability_index !== null)
      .every((p) => p.period_label === "2026-second"),
  );
}

function addLegacyLayoutChecks(add, P, fileBytes) {
  // 旧レイアウト（410バイト）と、期のずれ
  const f1310 = P.parseFanFile(fileBytes("fan1310"), { id: "fan1310" });
  add(
    "fan1310（410バイト・出身地なし）: 異常0、期は 2014年1期（10月分は翌年の1期）、出身地はnull",
    f1310.anomalies.length === 0 &&
      same(f1310.layout_bytes, [410]) &&
      f1310.period.year === 2014 &&
      f1310.period.no === 1 &&
      f1310.records.every((r) => r.hometown === null),
    JSON.stringify(f1310.anomalies),
  );
  const f0110 = P.parseFanFile(fileBytes("fan0110"), { id: "fan0110" });
  const r310 = f0110.records.find((r) => r.racer_id === 310);
  add(
    "fan0110（最古・410バイト）: 登番0310、生年月日 S6=1931-05-18、2002年1期（算出 2001-05-01〜2001-10-31）",
    f0110.anomalies.length === 0 &&
      r310.birth_date === "1931-05-18" &&
      same(f0110.period, {
        year: 2002,
        no: 1,
        calc_from: "2001-05-01",
        calc_to: "2001-10-31",
      }),
    JSON.stringify([r310?.birth_date, f0110.period, f0110.anomalies]),
  );
  const f1904 = P.parseFanFile(fileBytes("fan1904"), { id: "fan1904" });
  add(
    "fan1904（416バイト）: 異常0、期は 2019年2期（算出 2018-11-01〜2019-04-30）、出身地あり",
    f1904.anomalies.length === 0 &&
      same(f1904.period, {
        year: 2019,
        no: 2,
        calc_from: "2018-11-01",
        calc_to: "2019-04-30",
      }) &&
      f1904.records.every((r) => r.hometown),
  );
}

function addBadInputChecks(add, P, fileBytes) {
  // 想定外の入力
  const bad = fileBytes("fan2604").slice(0, 418 * 3 + 6); // 3人分の後で途中で切れる
  const partial = P.parseFanFile(bad, { id: "fan2604" });
  add(
    "途中で切れたレコードは握りつぶさず anomalies に残る",
    partial.anomalies.some((a) => /レコード長/.test(a.problem)),
    JSON.stringify(partial.anomalies),
  );
  const wrongName = P.parseFanFile(fileBytes("fan2604"), {
    id: "fan2504",
  });
  add(
    "ファイル名と期が一致しない場合は anomalies に残る（fan2504 に fan2604 の内容）",
    wrongName.anomalies.some((a) => /一致しません/.test(a.problem)),
  );
}

/**
 * パーサー・行変換に対する評価。fileBytes はフィクスチャの選手レコード → ファイルのバイト列。
 * @returns {Array<{label: string, pass: boolean, detail?: string}>}
 */
export function evaluate(P, R, fileBytes) {
  const results = [];
  const add = (label, pass, detail = "") =>
    results.push({ label, pass, detail });
  const fan = P.parseFanFile(fileBytes("fan2604"), { id: "fan2604" });
  addFan2604Header(add, fan);
  const views = parsedViews(R, fan);
  addSeasonChecks(add, views);
  addCourseChecks(add, views);
  addProfileChecks(add, views);
  addDbChecks(add, views);
  addLegacyLayoutChecks(add, P, fileBytes);
  addBadInputChecks(add, P, fileBytes);
  return results;
}
