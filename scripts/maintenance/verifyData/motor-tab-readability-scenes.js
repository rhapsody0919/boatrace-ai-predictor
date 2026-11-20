/**
 * verify-motor-tab-readability.js の描く場面（motor-tab-readability-render.js で描き、描いた結果の読みを返す）。verify ではない。
 * 期待値は verify 側（sections1・sections2）に置く。訳は ja（tJa で引いて比べる）。
 */
import {
  chartFacts,
  chartsByHeading,
  drawMotor,
  drawPart,
  sectionText,
  tJa,
} from "./motor-tab-readability-render.js";

const texts = (root, sel) => [...root.querySelectorAll(sel)].map((el) => el.textContent);

// ---- 枠番別成績（MotorWakuStatsGrid）・選手×枠（MotorRacerWakuDrillDown） ----

/** 1コースは3走（小標本）・展示2点、2コースは12走・展示3点（6.7・6.9・6.8） */
export async function wakuGridScene() {
  const row = (course, raceCount, rates, times) => ({
    course,
    raceCount,
    ...rates,
    avgExhibitionTime: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null,
    exhibitionTrend: times.map((time, i) => ({ date: `2026-10-0${i + 1}`, time })),
  });
  const rows = [
    row(1, 3, { winRate: 200 / 3, top2Rate: 200 / 3, top3Rate: 100 }, [6.8, 6.9]),
    row(2, 12, { winRate: 50, top2Rate: 50, top3Rate: 75 }, [6.7, 6.9, 6.8]),
  ];
  const props = { rows, generationStart: "2026-01-01", fetchFailed: false, embedded: false, highlightCourse: null, onSelectCourse() {} };
  return drawPart("components/analysis/MotorWakuStatsGrid.jsx", props, (c) => ({
    hint: c.querySelector(".hscroll-hint .table-scroll") !== null,
    heads: texts(c, ".motor-waku-table thead th"),
    rows: [...c.querySelectorAll(".motor-waku-table tbody tr")].map((tr) => ({
      rates: [...tr.querySelectorAll("td.rate")].map((td) => td.firstChild?.textContent ?? ""),
      n: tr.querySelector(".motor-waku-n")?.textContent ?? null,
      sparkline: tr.querySelector(".motor-waku-sparkline polyline")?.getAttribute("points") ?? null,
    })),
  }));
}

/** 1コースの選手×枠: 3走（小標本）と12走の2人 */
export async function racerWakuScene() {
  const rows = [
    { course: 1, racerId: 4001, playerName: "選手 甲", raceCount: 3, winRate: 100 / 3, top2Rate: 200 / 3, top3Rate: 100 },
    { course: 1, racerId: 4002, playerName: "選手 乙", raceCount: 12, winRate: 25, top2Rate: 50, top3Rate: 75 },
  ];
  return drawPart("components/analysis/MotorRacerWakuDrillDown.jsx", { course: 1, rows, onBack() {} }, (c) =>
    [...c.querySelectorAll(".motor-racer-waku-list li")].map((li) => ({
      rates: texts(li, ".usage-history-rate"),
      n: li.querySelector(".motor-waku-n")?.textContent ?? null,
    })),
  );
}

// ---- 選手ページのモーター状況（RacerMotorStatusCard） ----

/** status（getRacerCurrentMotorStatus の戻りの形）で描き、見出し・説明文・機力指数の行・展示タイムのグラフを返す */
export async function racerCardScene(status) {
  return drawPart("components/racer/RacerMotorStatusCard.jsx", { status }, (c) => ({
    caption: c.querySelector(".racer-motor-status-chart-caption")?.textContent ?? null,
    index: c.querySelector(".racer-motor-status-index")?.textContent ?? null,
    indexClass: c.querySelector(".racer-motor-status-index")?.getAttribute("class") ?? null,
    chart: c.querySelector(".recharts-responsive-container")
      ? chartFacts(c.querySelector(".recharts-responsive-container"))
      : null,
  }));
}

// ---- モータ情報（一覧） ----

const todayRow = (boat, o) => ({
  race_id: "2026-11-20-15-03",
  boat_number: boat,
  motor_number: 10 + boat,
  rate_source: "recalc",
  motor_2rate: 40,
  motor_3rate: 60,
  sample_count: 10,
  power_index: 1,
  race_count: null,
  first_place_count: null,
  final_count: null,
  championship_count: null,
  ...o,
});

/**
 * 一覧を描き、見出し・行ごとの機力指数（文と色）・2連率のセル・下の注記を返す。
 * rows の既定: 1号艇は初下ろし（sample_count 0）、2号艇は4走で +9.5（小標本）、3号艇は13走で -0.04
 */
export async function motorListScene(extra = {}) {
  const breakdown = [
    todayRow(1, { sample_count: 0, motor_2rate: 0, power_index: null, ...extra[1] }),
    todayRow(2, { sample_count: 4, power_index: 9.5, ...extra[2] }),
    todayRow(3, { sample_count: 13, power_index: -0.04, ...extra[3] }),
  ];
  return drawMotor({ breakdown, selectedRace: "2026-11-20-15-03" }, (c) => ({
    heads: texts(c, ".motor-ranking-table thead th"),
    power: [...c.querySelectorAll("td.power-index")].map((td) => ({ text: td.textContent, cls: td.getAttribute("class") })),
    rate2: [...c.querySelectorAll("tbody tr")].map((tr) => tr.querySelector("td.rate")?.textContent ?? null),
    notes: texts(c, ".table-note"),
    text: c.textContent,
  }));
}

/** 過去レース（公式の値）の一覧。2連率・3連率が公式 0 の艇を含む */
export async function pastListScene() {
  const breakdown = [1, 2].map((boat) => todayRow(boat, {
    race_id: "2026-10-06-15-07",
    rate_source: "official",
    motor_2rate: boat === 1 ? 0 : 35,
    motor_3rate: boat === 1 ? 0 : 50,
    race_count: boat === 1 ? 0 : 20,
    first_place_count: boat === 1 ? 0 : 4,
  }));
  return drawMotor({ breakdown, selectedRace: "2026-10-06-15-07" }, (c) => ({ text: c.textContent }));
}

// ---- モータ情報（ドリルダウン） ----

const meet = (name, firstDate, rate2, races = []) => ({
  racerId: name.length,
  playerName: name,
  grade: "A1",
  firstDate,
  lastDate: firstDate,
  rate2,
  rate3: rate2 === null ? null : rate2 + 10,
  races,
});

/** ドリルダウンの既定の state。推移は先頭の1点が 0（入れ替え直後）、使用履歴は新しい順の2節 */
export function drillState(over = {}) {
  return {
    drillDownMotor: 24,
    selectedRace: "2026-11-20-15-03",
    breakdown: [todayRow(1, { motor_number: 24, race_count: 10 })],
    powerIndex: { power_index: -0.04, sample_count: 4 },
    venueMotorStats: { raceCount: 10, meetCount: 2, fetchFailed: false },
    trendData: {
      trend: [
        { date: "2026-10-01", motor_2rate: 0, motor_3rate: 0, exhibition_time: 6.8 },
        { date: "2026-10-05", motor_2rate: 30, motor_3rate: 50, exhibition_time: 6.9 },
        { date: "2026-10-09", motor_2rate: 35, motor_3rate: 55, exhibition_time: 6.75 },
      ],
    },
    usageHistory: [
      meet("新 二", "2026-11-01", 200 / 3, [{ rank: 1, date: "2026-11-01" }, { rank: null, date: "2026-11-02" }, { rank: null, date: "2099-01-01" }]),
      meet("旧 一", "2026-10-01", 50),
    ],
    partsHistory: [{ date: "2026-10-05", raceNos: [5, 11], parts: ["ピストン"], propellerChanged: false }],
    ...over,
  };
}

/** ドリルダウンを描き、見出し → グラフ、見出し → 節の本文、注記・機力指数の行・会場内順位の札を返す */
export async function drillScene(over = {}) {
  return drawMotor(drillState(over), (c) => {
    const headings = texts(c, "h3.selected-motor-heading");
    return {
      headings,
      charts: chartsByHeading(c),
      sections: Object.fromEntries(headings.map((h) => [h, sectionText(c, h)])),
      notes: texts(c, ".table-note"),
      empties: texts(c, ".empty-state"),
      summary: c.querySelector(".power-index-summary")?.textContent ?? null,
      summaryClass: c.querySelector(".power-index-summary")?.getAttribute("class") ?? "",
      usageRates: texts(c, ".history-list .usage-history-rate"),
      usageRanks: texts(c, ".usage-history-ranks"),
      parts: texts(c, ".history-list .history-date"),
      text: c.textContent,
    };
  });
}

/** 全部の点が 0 の推移で、会場公式の出走数（breakdown の race_count・venueMotorStats）を変えたときの推移の節 */
export async function allZeroTrendScene({ raceCount, venueHasStats = true, fetchFailed = false }) {
  const zero = (date) => ({ date, motor_2rate: 0, motor_3rate: 0, exhibition_time: 6.8 });
  const got = await drillScene({
    breakdown: [todayRow(1, { motor_number: 24, race_count: venueHasStats ? 10 : null })],
    venueMotorStats: { raceCount, meetCount: 1, fetchFailed },
    trendData: { trend: [zero("2026-10-01"), zero("2026-10-05")] },
  });
  const heading = tJa("analysis.motor.rateTrendHeading");
  return { chart: got.charts[heading], text: got.sections[heading] };
}
