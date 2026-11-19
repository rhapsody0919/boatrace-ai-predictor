/**
 * verify-monthly-schedule.js の期待値（実データ）と、パーサー（P）の評価。verify ではない。
 * 変異検証で、壊した版のパーサーにも同じ評価をかける。ファイルの読みは verify 側（io）に残す。
 */

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 本番DB races の連続開催日（2026-09-21 SELECT。2026-08-20〜09-19、会場ごと。"会場:開始~終了" を ; 区切り）
const DB_RUNS =
  "1:2026-08-25~2026-08-30;1:2026-09-06~2026-09-10;2:2026-08-20~2026-08-23;2:2026-09-04~2026-09-06;2:2026-09-12~2026-09-14;2:2026-09-18~2026-09-19;5:2026-08-20~2026-08-20;5:2026-08-28~2026-09-02;5:2026-09-10~2026-09-13;5:2026-09-16~2026-09-19;6:2026-08-21~2026-08-26;6:2026-08-31~2026-09-04;6:2026-09-12~2026-09-15;6:2026-09-19~2026-09-19;7:2026-08-21~2026-08-24;7:2026-08-27~2026-09-01;7:2026-09-05~2026-09-08;7:2026-09-13~2026-09-18;8:2026-08-22~2026-08-27;8:2026-08-31~2026-09-03;8:2026-09-12~2026-09-17;12:2026-09-02~2026-09-06;12:2026-09-12~2026-09-16;12:2026-09-18~2026-09-19;18:2026-08-20~2026-08-20;18:2026-08-23~2026-08-27;18:2026-08-31~2026-09-05;18:2026-09-12~2026-09-17;20:2026-08-20~2026-08-20;20:2026-08-22~2026-08-26;20:2026-08-31~2026-09-05;20:2026-09-10~2026-09-15"
    .split(";")
    .map((s) => {
      const [v, r] = s.split(":");
      const [a, b] = r.split("~");
      return { v: Number(v), a, b };
    });

/** 3か月分のページと節の確定 */
function evaluatePages(P, io, add) {
  const pages = ["202608", "202609", "202610"].map((ym) =>
    P.parseMonthlySchedule(io.html(ym), ym),
  );
  add(
    "3か月分のページ: 異常0、会場9、窓は前後4日を含む（30日の月は38列、31日の月は39列）",
    pages.every((p) => p.anomalies.length === 0 && p.venues.length === 9) &&
      pages[1].window.from === "2026-08-28" &&
      pages[1].window.to === "2026-10-04" &&
      pages[0].window.from === "2026-07-28" &&
      pages[2].window.to === "2026-11-04",
    JSON.stringify(pages.map((p) => [p.window, p.anomalies.length])),
  );
  const merged = P.mergeMonthlySchedules(pages);
  add(
    "節の確定: 異常0",
    merged.anomalies.length === 0,
    JSON.stringify(merged.anomalies.slice(0, 2)),
  );
  return merged;
}

/** a. 公式の raceindex（2026-09-21取得）: 住之江 9/1 初日〜9/6 最終日 */
function evaluateSuminoe(merged, add) {
  const suminoe = merged.series.find(
    (s) => s.venue_code === 12 && s.start_date === "2026-09-01",
  );
  add(
    "公式の raceindex と一致: 住之江 9/1初日〜9/6最終日（6日）、節名",
    suminoe &&
      suminoe.end_date === "2026-09-06" &&
      suminoe.total_days === 6 &&
      suminoe.title === "日刊スポーツ杯争奪第３０回ブルースターカップ",
    JSON.stringify(suminoe),
  );
}

/** b. Kファイル（2019-04-15）: 蒲郡 第4日・多摩川 第3日 */
function evaluateKFile(P, io, add) {
  const p1904 = P.parseMonthlySchedule(io.html("201904"), "201904");
  const m1904 = P.mergeMonthlySchedules([p1904]);
  const k = io.readK();
  const kDays = {};
  for (const v of k.venues) {
    const s = m1904.series.find(
      (x) =>
        x.venue_code === v.venue_code &&
        x.start_date <= "2019-04-15" &&
        x.end_date >= "2019-04-15",
    );
    kDays[v.venue_code] = {
      k: v.series_day,
      bar: s ? P.daysBetween(s.start_date, "2019-04-15") + 1 : null,
    };
  }
  add(
    "Kファイル（2019-04-15）の日目と一致: 蒲郡=4日目、多摩川=3日目（月間スケジュールから導出）",
    same(kDays, { 5: { k: 3, bar: 3 }, 7: { k: 4, bar: 4 } }),
    JSON.stringify(kDays),
  );
}

/** 節1つを DB の連続開催日と突き合わせる: "exact" | "firstDayMissing" | 不一致の文 */
function matchDbRun(P, s) {
  const run = DB_RUNS.find((r) => r.v === s.venue_code && r.b === s.end_date);
  if (run && run.a === s.start_date) return "exact";
  if (run && run.a === P.addDays(s.start_date, 1)) return "firstDayMissing";
  return `${s.venue_code} ${s.start_date}~${s.end_date} DB=${JSON.stringify(run)}`;
}

/** c. 本番DB races の連続開催日との突合（8/20以降に始まり、9/19までに終わった節） */
function evaluateDbRuns(P, merged, add) {
  const done = merged.series.filter(
    (s) => s.start_date >= "2026-08-20" && s.end_date <= "2026-09-19",
  );
  let exact = 0;
  let firstDayMissing = 0;
  const bad = [];
  for (const s of done) {
    const m = matchDbRun(P, s);
    if (m === "exact") exact++;
    else if (m === "firstDayMissing") firstDayMissing++;
    else bad.push(m);
  }
  add(
    "本番DBの連続開催日と、節の終了日が全て一致（開始日は、一致か、DBに初日の races が無い1日ずれのみ）",
    done.length > 0 &&
      bad.length === 0 &&
      exact + firstDayMissing === done.length,
    `節${done.length} 一致${exact} DB初日欠落${firstDayMissing} 不一致${bad.join(" / ")}`,
  );
  add(
    "DBの初日欠落を検出できる（節の初日でDBに races が無い日が、この9会場・期間で複数ある）",
    firstDayMissing >= 5,
    `firstDayMissing=${firstDayMissing}`,
  );
}

/** 3. 節の確定: 範囲の外の端だけが unresolved に残る */
function evaluateUnresolved(merged, add) {
  add(
    "端の断片は隣の月で解消し、未確定は範囲の外の端（8月前端・10月後端）のみ",
    merged.unresolved.length > 0 &&
      merged.unresolved.every(
        (u) =>
          u.seen_from < "2026-08-01" ||
          u.seen_to > "2026-10-31" ||
          u.seen_from < "2026-07-31",
      ),
    JSON.stringify(
      merged.unresolved
        .filter(
          (u) => !(u.seen_from < "2026-08-01" || u.seen_to > "2026-10-31"),
        )
        .slice(0, 3),
    ),
  );
  add(
    "範囲の外の端は確定扱いにしない: 8月ページの左端（7/28）と10月ページの右端（11/4）の断片が、それぞれ未確定として残る",
    merged.unresolved.some(
      (u) => u.seen_from === "2026-07-28" && /開始日/.test(u.reason),
    ) &&
      merged.unresolved.some(
        (u) => u.seen_to === "2026-11-04" && /終了日/.test(u.reason),
      ),
    JSON.stringify(merged.unresolved.slice(0, 3)),
  );
  add(
    "9月に始まる節は全て確定している（未確定なし）",
    !merged.unresolved.some(
      (u) => u.seen_from >= "2026-09-01" && u.seen_from <= "2026-09-30",
    ) &&
      merged.series.filter((s) => s.start_date.startsWith("2026-09")).length >
        0,
  );
}

/** 種別と総日数 */
function evaluateKindsAndDays(P, merged, add) {
  const kinds = new Map(merged.series.map((s) => [s.class_code, s]));
  add(
    "色分けの種別: SG・G1・Lady・Venus・Rookie・Takumi・Ippan を区別し、グレードが確定するのは SG/G1/G2/G3/Ippan のみ",
    ["Lady", "Venus", "Rookie", "Takumi"].every(
      (c) => kinds.get(c)?.grade === null,
    ) &&
      kinds.get("G1")?.grade === "G1" &&
      kinds.get("Ippan")?.grade === "ippan" &&
      kinds.get("Takumi")?.kind === "masters" &&
      kinds.get("Lady")?.kind === "lady",
    JSON.stringify([...kinds.entries()].map(([c, s]) => [c, s.grade, s.kind])),
  );
  add(
    "総日数 = 終了日 − 開始日 + 1（全節）",
    merged.series.every(
      (s) => s.total_days === P.daysBetween(s.start_date, s.end_date) + 1,
    ) && merged.series.every((s) => s.total_days >= 1 && s.total_days <= 8),
    JSON.stringify(
      merged.series
        .filter((s) => s.total_days > 8 || s.total_days < 1)
        .slice(0, 2),
    ),
  );
}

/**
 * パーサー（P）に対する評価。io は { html(ym), readK() }（読みは verify 側）。
 * @returns {Array<{label: string, pass: boolean, detail?: string}>}
 */
export function evaluate(P, io) {
  const out = [];
  const add = (label, pass, detail = "") => out.push({ label, pass, detail });
  const merged = evaluatePages(P, io, add);
  evaluateSuminoe(merged, add);
  evaluateKFile(P, io, add);
  evaluateDbRuns(P, merged, add);
  evaluateUnresolved(merged, add);
  evaluateKindsAndDays(P, merged, add);
  return out;
}
