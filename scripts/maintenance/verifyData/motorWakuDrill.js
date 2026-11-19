/**
 * motorWakuDrill.js - モーターのドリルダウン（MotorConditionDrill.jsx の MotorMain）を ja の文言で描き、
 * 枠番別成績の表・選手×枠・注記を DOM から取り出す（verify の部品。verify-motor-waku-generation.js が使う）。
 * 部品の本文の字は読まない。描くのは scripts/lib/renderJsx.js（module hooks は呼ぶ側が先に登録する）
 */
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { renderJsx } from "../../lib/renderJsx.js";
import ja from "../../../src/locales/ja/common.json" with { type: "json" };

await i18next.use(initReactI18next).init({
  lng: "ja",
  resources: { ja: { common: ja } },
  defaultNS: "common",
  ns: ["common"],
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});
export const t = i18next.t.bind(i18next);

// 横スクロールの目印の hook が使う（jsdom に無い）
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
globalThis.cancelAnimationFrame = clearTimeout;

const rates = { winRate: 50, top2Rate: 50, top3Rate: 50 };
const wakuRow = (course, raceCount) => ({
  course,
  raceCount,
  ...rates,
  avgExhibitionTime: null,
  exhibitionTrend: [],
});
const racerRow = (course, racerId, raceCount) => ({
  course,
  racerId,
  raceCount,
  playerName: "選手",
  ...rates,
});

/** 表の行は 1コース（2走＝小標本）・2コース（12走）。選手×枠は 1コースに 2走・12走の2人、2コースに1人 */
const motorProps = (motor, generationStart, selectedWakuCourse) => ({
  m: {
    loading: false,
    error: null,
    drillDownMotor: motor,
    drillPreGeneration: false,
    breakdown: [],
    setDrillDownMotor() {},
    selectedRace: null,
    powerIndex: null,
    generationStart,
    periodDays: 90,
    venueMotorStats: null,
    venueMotorRanking: null,
    championshipHistory: { wins: [], generationStart },
    trendData: null,
    usageHistory: [],
    partsHistory: [],
    embedded: false,
    selectedWakuCourse,
    setSelectedWakuCourse() {},
    motorWakuStats: {
      rows: [wakuRow(1, 2), wakuRow(2, 12)],
      generationStart,
      fetchFailed: false,
    },
    motorRacerWakuStats: {
      rows: [racerRow(1, 4001, 2), racerRow(1, 4002, 12), racerRow(2, 4003, 2)],
    },
  },
  v: {
    todayHighlightCourse: null,
    chartData: [],
    drillTallyState: null,
    firstRatedIndex: -1,
    emptyKey: (k) => k,
    exhibitionChartData: [],
    exhibitionAxis: null,
    usageHistoryChartData: [],
  },
});

/**
 * 世代（generationStart）と選んだ枠（selectedWakuCourse、null なら枠番別成績の表）で描く。
 * @returns {Promise<{text: string, tableRows: number, racers: number[], notes: string[]}>}
 *   racers = 選手×枠の行ごとの小標本の色の付いた率の数
 */
export async function drawMotorDrill(
  motor,
  generationStart,
  selectedWakuCourse = null,
) {
  const { createElement } = await import("react");
  const { MotorMain } =
    await import("../../../src/components/analysis/MotorConditionDrill.jsx");
  // 選手×枠の名前は Link なので、MemoryRouter の子として描く
  const view = await renderJsx(
    new URL(import.meta.resolve("react-router-dom")),
    {
      children: createElement(
        MotorMain,
        motorProps(motor, generationStart, selectedWakuCourse),
      ),
    },
    { exportName: "MemoryRouter" },
  );
  const { container } = view;
  const out = {
    text: container.textContent,
    tableRows: container.querySelectorAll(".motor-waku-table tbody tr").length,
    racers: [...container.querySelectorAll(".motor-racer-waku-list li")].map(
      (li) => li.querySelectorAll(".usage-history-rate.is-small-sample").length,
    ),
    notes: [...container.querySelectorAll(".table-note")].map(
      (e) => e.textContent,
    ),
  };
  await view.unmount();
  return out;
}
