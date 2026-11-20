/**
 * verify-pre-race-parsers.js の (a)(c)(e) の評価（差し替え可能なモジュールに対して評価する。変異検証で、壊した版にも同じ評価をかける）。
 * verify-pre-race-parsers.js の evaluate を、意味の塊（出走表・直前情報・合成・締切予定時刻）の関数へ割ったもの。
 * フィクスチャの期待値・読み方（ctx）は verify から受け取る。
 */
import * as cheerio from "cheerio";

/** 出走表の1件: 全項目の解析と、行の組み立て（旧形式・拡張） */
function expectListCase(m, c, { readFixture, same }, expect) {
  const name = c.file.replace("racelist-", "").replace(".html", "");
  const page = m.parseRaceListPage(readFixture("raceInfo", c.file));
  const col = (key) => page.entries.map((e) => e[key]);
  expect(`${name}: 選手が6人`, page.entries.length === 6);
  expect(
    `${name}: 開催名・ステージ・日目・総日数・距離・ラベル`,
    same(
      {
        raceTitle: page.meta.raceTitle,
        raceStage: page.meta.raceStage,
        seriesDay: page.meta.seriesDay,
        totalDays: page.meta.totalDays,
        distanceM: page.meta.distanceM,
        labels: page.meta.labels,
      },
      c.meta,
    ),
  );
  expect(
    `${name}: 締切予定時刻（12レース分）`,
    page.deadlines.map((d) => d.time).join(",") === c.deadlines &&
      same(
        page.deadlines.map((d) => d.race_number),
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      ),
  );
  for (const key of [
    "is_absent",
    "weight_kg",
    "branch",
    "hometown",
    "f_count",
    "l_count",
    "avg_st",
    "local_win_rate",
    "boat_number_id",
  ]) {
    if (c[key]) expect(`${name}: ${key}`, same(col(key), c[key]));
  }
  expect(`${name}: 解析の異常なし`, page.anomalies.length === 0);

  // 行の組み立て（旧形式は新しい列を含めず、拡張は加える）
  const legacyRows = m.buildRaceEntryRows("R", page.entries);
  const extendedRows = m.buildRaceEntryRows("R", page.entries, {
    extended: true,
  });
  expect(
    `${name}: 旧形式の行は新しい列を含まない`,
    legacyRows.every((r) => !("weight_kg" in r) && !("is_absent" in r)),
  );
  expect(
    `${name}: 拡張の行は、旧形式の行に新しい列だけを加える`,
    extendedRows.every(
      (r, i) =>
        same(
          Object.fromEntries(
            Object.entries(r).filter(([k]) => k in legacyRows[i]),
          ),
          legacyRows[i],
        ) &&
        same(
          Object.keys(r)
            .filter((k) => !(k in legacyRows[i]))
            .sort(),
          [
            "branch",
            "f_count",
            "hometown",
            "is_absent",
            "l_count",
            "weight_kg",
          ],
        ),
    ),
  );
  const condRow = m.buildRaceConditionRow("R", page.meta, { extended: true });
  expect(
    `${name}: race_conditions の行に距離・ラベル`,
    condRow.race_distance_m === c.meta.distanceM &&
      same(
        condRow.race_labels,
        c.meta.labels.map((l) => l.text),
      ),
  );
  expect(
    `${name}: 旧形式の race_conditions の行は距離・ラベルを含まない`,
    !("race_distance_m" in m.buildRaceConditionRow("R", page.meta)) &&
      !("race_labels" in m.buildRaceConditionRow("R", page.meta)),
  );
}

/** 直前情報の1件: 全項目の解析と、exhibition_data の行（旧形式・拡張） */
function expectBeforeCase(m, c, { readFixture, same }, expect) {
  const name = c.file.replace("beforeinfo-", "").replace(".html", "");
  const page = m.parseBeforeInfoPage(readFixture("beforeinfo", c.file));
  const col = (key) => page.boats.map((b) => b[key]);
  expect(`${name}: 6艇`, page.boats.length === 6);
  expect(
    `${name}: 距離・ラベル`,
    page.distanceM === c.distanceM && same(page.labels, c.labels),
  );
  expect(
    `${name}: スタート展示の並び（コース順）と公開状態`,
    same(page.start_exhibition.order, c.order) &&
      page.start_exhibition.published === c.published,
  );
  for (const key of [
    "is_absent",
    "weight_kg",
    "exhibition_time",
    "tilt",
    "propeller_text",
    "parts_changed",
    "adjustment_weight",
    "prev_race_no",
    "prev_entry_course",
    "prev_start_timing",
    "prev_finish_mark",
    "prev_finish_rank",
    "exhibition_course",
    "start_timing",
    "start_flag",
  ]) {
    expect(`${name}: ${key}`, same(col(key), c[key]));
  }
  for (const [key, value] of Object.entries(c.conditions)) {
    expect(`${name}: 気象 ${key}`, page.conditions?.[key] === value);
  }
  expect(`${name}: 解析の異常なし`, page.anomalies.length === 0);

  const legacy = m.buildExhibitionRows("R", page.boats);
  const extended = m.buildExhibitionRows("R", page.boats, { extended: true });
  const hasValue = (b) => b.exhibition_time != null || b.start_timing != null;
  expect(
    `${name}: 旧形式の行は、展示タイム・STのある艇だけ`,
    same(
      legacy.map((r) => r.boat_number),
      page.boats.filter(hasValue).map((b) => b.boat_number),
    ),
  );
  // 展示前（当日体重・調整重量だけがある）の艇も、拡張では行を書く（BOA-500）。
  // 展示タイム・チルトは、後の窓（-33）で同じ行に埋まる
  const hasPreExhibition = (b) =>
    b.weight_kg != null || b.adjustment_weight != null;
  expect(
    `${name}: 拡張の行は、欠場艇と展示前（体重・調整重量だけ）の艇も含む`,
    same(
      extended.map((r) => r.boat_number),
      page.boats
        .filter((b) => hasValue(b) || b.is_absent || hasPreExhibition(b))
        .map((b) => b.boat_number),
    ),
  );
  expect(
    `${name}: 拡張の行の新しい列`,
    extended.every((r) => {
      const b = page.boats.find((x) => x.boat_number === r.boat_number);
      return (
        r.exhibition_course === b.exhibition_course &&
        r.start_flag === b.start_flag &&
        r.prev_finish_mark === b.prev_finish_mark &&
        r.is_absent === b.is_absent
      );
    }) &&
      legacy.every(
        (r) =>
          !("exhibition_course" in r) &&
          !("is_absent" in r) &&
          !("prev_finish_mark" in r),
      ),
  );
}

function expectSyntheticAbsent(m, expect) {
  // 合成: 欠場艇に体重が無い場合。実ページのフィクスチャでは欠場艇にも体重があるため、展示前の艇を拾う節
  // （BOA-500）が欠場艇も巻き込んで拾ってしまい、is_absent の節が効いているかを実ページでは確かめられない。
  // 体重も調整重量も読めない欠場艇を合成して、is_absent の節だけで行が書かれることを確かめる
  {
    const absentNoWeight = [
      {
        boat_number: 1,
        is_absent: true,
        weight_kg: null,
        adjustment_weight: null,
        exhibition_time: null,
        start_timing: null,
        tilt: null,
        propeller_text: null,
        parts_changed: [],
        prev_race_no: null,
        prev_entry_course: null,
        prev_start_timing: null,
        prev_finish_rank: null,
        exhibition_course: null,
        start_flag: null,
        prev_finish_mark: null,
      },
    ];
    expect(
      "合成: 欠場艇は、体重も調整重量も読めなくても拡張の行を書く（旧形式は書かない）",
      m.buildExhibitionRows("R", absentNoWeight, { extended: true }).length ===
        1 && m.buildExhibitionRows("R", absentNoWeight).length === 0,
    );
  }
}

function expectSyntheticMarks(m, { LIST_FILES, BEFORE_FILES, N, readFixture, same }, expect) {
  // 合成: 実ページで未観測の表記（L数が1以上・展示STのL表記・モーター・ボートの赤表示の疑い）。
  // 実ページの1件を書き換えたもの（フィクスチャではなく、その場で作る）
  {
    const html = readFixture("raceInfo", LIST_FILES.absent).replace(
      /L0(\s*<br\s*\/?>\s*0\.15)/,
      "L2$1",
    );
    const page = m.parseRaceListPage(html);
    expect(
      "合成: L数が2以上の表記（L2）を読む",
      same(
        page.entries.map((e) => e.l_count),
        [0, 2, 0, 0, 0, 0],
      ),
    );
  }
  {
    const $ = cheerio.load(readFixture("raceInfo", LIST_FILES.boatChanged));
    $(".table1 tbody.is-fs12")
      .eq(4)
      .find("td.is-lineH2")
      .eq(4)
      .addClass("is-fColor1");
    const page = m.parseRaceListPage($.html());
    expect(
      "合成: モーター・ボートのセルに赤の表示（is-fColor1）が現れたら anomalies に記録する",
      page.anomalies.length === 1 &&
        page.anomalies[0].startsWith("motor_boat_marker:is-fColor1"),
    );
  }
  {
    const html = readFixture("beforeinfo", BEFORE_FILES.stabilizer)
      .replace(
        /<span class="table1_boatImage1Time">\.04<\/span>/,
        '<span class="table1_boatImage1Time">L.05</span>',
      )
      .replace(
        /<span class="table1_boatImage1Time">\.07<\/span>/,
        '<span class="table1_boatImage1Time">L</span>',
      );
    const page = m.parseBeforeInfoPage(html);
    expect(
      "合成: 展示STのL表記（L.05・数字なしのL）",
      same(
        page.boats.slice(0, 2).map((b) => [b.start_timing, b.start_flag]),
        [
          [0.05, "L"],
          [N, "L"],
        ],
      ),
    );
  }
  {
    const empty = m.parseRaceListPage("<html><body></body></html>");
    const emptyBefore = m.parseBeforeInfoPage("<html><body></body></html>");
    expect(
      "空のページは、例外を投げず、選手・艇・締切時刻が空",
      empty.entries.length === 0 &&
        empty.deadlines.length === 0 &&
        emptyBefore.boats.length === 0 &&
        emptyBefore.start_exhibition.published === false,
    );
  }
}

function expectDeadlinePlan(m, { same }, expect) {
  // 締切予定時刻の追従
  {
    const at = (hm) => new Date(`2026-09-16T${hm}:00+09:00`);
    const schedule = ["12:04", "12:33"].map((hm, i) => ({
      race_id: `2026-09-16-23-${String(i + 8).padStart(2, "0")}`,
      venue_code: 23,
      race_no: i + 8,
      start_time: at(hm),
    }));
    schedule.push({
      race_id: "2026-09-16-05-08",
      venue_code: 5,
      race_no: 8,
      start_time: at("12:00"),
    });
    const deadlines = [
      { race_number: 8, time: "12:05" },
      { race_number: 9, time: "12:33" },
    ];
    const plan = m.planDeadlineUpdates(schedule, 23, deadlines);
    expect(
      "締切予定時刻: 違うレースだけ更新（同じ値・他会場は対象外）",
      same(plan.updates, [
        {
          race_id: "2026-09-16-23-08",
          start_time: "12:05:00",
          previous: "12:04",
        },
      ]),
    );
    const far = m.planDeadlineUpdates(schedule, 23, [
      { race_number: 8, time: "20:05" },
      { race_number: 9, time: null },
    ]);
    expect(
      "締切予定時刻: 大きく動く値（別の日・誤読の恐れ）と、空の時刻は更新しない",
      far.updates.length === 0 &&
        same(
          far.skipped.map((s) => s.reason),
          ["shift_too_large", "no_time"],
        ),
    );
  }
}

function expectDeadlineTable(m, { same }, expect) {
  // BOA-1122: 全体の行を比較し、余分な更新・スキップも検出する。
  {
    const race = (hm, raceNo = 1) => ({
      race_id: `2026-09-16-23-${String(raceNo).padStart(2, "0")}`,
      venue_code: 23,
      race_no: raceNo,
      start_time: new Date(`2026-09-16T${hm}:00+09:00`),
    });
    const empty = { updates: [], skipped: [] };
    const updated = (previous, time) => ({
      updates: [{ race_id: race("10:00").race_id, start_time: `${time}:00`, previous }],
      skipped: [],
    });
    const skipped = (reason, raceNo = 1) => ({
      updates: [],
      skipped: [{ race_id: race("10:00", raceNo).race_id, reason }],
    });
    const cases = [
      ["+180分は更新", [race("10:00")], [{ race_number: 1, time: "13:00" }], updated("10:00", "13:00")],
      ["+181分はスキップ", [race("10:00")], [{ race_number: 1, time: "13:01" }], skipped("shift_too_large")],
      ["-180分は更新", [race("13:00")], [{ race_number: 1, time: "10:00" }], updated("13:00", "10:00")],
      ["-181分はスキップ", [race("13:01")], [{ race_number: 1, time: "10:00" }], skipped("shift_too_large")],
      ["日付またぎは1420分の差", [race("23:50", 12)], [{ race_number: 12, time: "00:10" }], skipped("shift_too_large", 12)],
      ["空文字は no_time", [race("10:00")], [{ race_number: 1, time: "" }], skipped("no_time")],
      ["time 欄なしは no_time", [race("10:00")], [{ race_number: 1 }], skipped("no_time")],
      ["出走表に無い2Rは対象外", [race("10:00"), race("10:30", 2)], [{ race_number: 1, time: "10:05" }], updated("10:00", "10:05")],
      ["重複番号は後の値が勝つ", [race("10:00")], [{ race_number: 1, time: "10:05" }, { race_number: 1, time: "10:00" }], empty],
      ["文字列の番号は対象外", [race("10:00")], [{ race_number: "1", time: "10:05" }], empty],
      ["空配列", [], [], empty],
      ["上限0分では1分差もスキップ", [race("10:00")], [{ race_number: 1, time: "10:01" }], skipped("shift_too_large"), { maxShiftMin: 0 }],
      ["上限0分でも同じ時刻は何もしない", [race("10:00")], [{ race_number: 1, time: "10:00" }], empty, { maxShiftMin: 0 }],
    ];
    for (const [label, schedule, deadlines, expected, options] of cases) {
      expect(
        `締切予定時刻: ${label}`,
        same(m.planDeadlineUpdates(schedule, 23, deadlines, options), expected),
      );
    }
  }
}

/**
 * @param {{parseRaceListPage: Function, parseBeforeInfoPage: Function, buildRaceEntryRows: Function,
 *   buildRaceConditionRow: Function, buildExhibitionRows: Function, planDeadlineUpdates: Function}} m
 * @param {{LIST_CASES: object[], BEFORE_CASES: object[], LIST_FILES: object, BEFORE_FILES: object, N: null,
 *   readFixture: Function, same: Function}} ctx
 * @returns {string[]} 失敗した項目のラベル
 */
export function evaluateParsers(m, ctx) {
  const failed = [];
  const expect = (label, pass) => {
    if (!pass) failed.push(label);
  };

  for (const c of ctx.LIST_CASES) expectListCase(m, c, ctx, expect);
  for (const c of ctx.BEFORE_CASES) expectBeforeCase(m, c, ctx, expect);
  expectSyntheticAbsent(m, expect);
  expectSyntheticMarks(m, ctx, expect);
  expectDeadlinePlan(m, ctx, expect);
  expectDeadlineTable(m, ctx, expect);

  return failed;
}
