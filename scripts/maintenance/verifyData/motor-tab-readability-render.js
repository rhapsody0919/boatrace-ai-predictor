/**
 * verify-motor-tab-readability.js の道具（モータ情報タブ・選手ページのモーター状況を ja の訳で描いて見る）。verify ではない。
 * 部品の本文の字は読まない。画面の値は本物の useMotorView（motorConditionView.jsx、hook を使わない関数）で導き、
 * 部品を scripts/lib/renderJsx.js で描く。取得（サービス層）は呼ぶ側の偽の DB（fakeServiceSupabase.js）の上で動く。
 *
 * recharts の ResponsiveContainer は jsdom では大きさ0で中身を描かないので、ResizeObserver を何もしない物で足し、
 * ResponsiveContainer の枠（.recharts-responsive-container）だけ 320×300（375px の画面のグラフの幅に近い値）を返す。目盛りの文字の幅は1字 8px で測らせる（間引きを見る）。
 */
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { renderJsx } from "../../lib/renderJsx.js";
import { quietly } from "./jsx-page-stubs.js";
import ja from "../../../src/locales/ja/common.json" with { type: "json" };

const ROUTER = new URL(import.meta.resolve("react-router-dom"));
const SRC = new URL("../../../src/", import.meta.url);
const SCROLL = { hasMore: false, hasLess: false, scrollRight() {}, scrollLeft() {}, update() {} };

let ready = null;

/** ja の訳と jsdom に無い物（rAF・ResizeObserver・グラフの枠の大きさ）を1度だけ用意する */
function setup() {
  ready ??= quietly(async () => {
    await i18next.use(initReactI18next).init({
      lng: "ja",
      resources: { ja: { common: ja } },
      defaultNS: "common",
      ns: ["common"],
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    });
    const boot = await renderJsx(ROUTER, { children: null }, { exportName: "MemoryRouter" });
    globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
    globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    const zero = { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0 };
    // recharts は目盛りの文字の幅を隠した span（recharts_measurement_span）で測り、重なる目盛りを間引く。
    // ブラウザに近い間引きにするため、その span だけ1字 8px・高さ 14px を返す
    boot.window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (this.classList?.contains("recharts-responsive-container")) return { ...zero, width: 320, height: 300, right: 320, bottom: 300 };
      if (this.id === "recharts_measurement_span") {
        const width = (this.textContent ?? "").length * 8;
        return { ...zero, width, height: 14, right: width, bottom: 14 };
      }
      return zero;
    };
    await boot.unmount();
  });
  return ready;
}

/** ja の訳（verify の期待値に使う） */
export const tJa = (key, options) => i18next.t(key, options);

const mod = (rel) => import(new URL(rel, SRC).href);

/** element を MemoryRouter の中に描き、fn(container) の結果を返して片付ける */
async function inspect(element, fn) {
  await setup();
  return quietly(async () => {
    const view = await renderJsx(ROUTER, { children: element }, { exportName: "MemoryRouter" });
    await view.act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    try {
      return await fn(view.container, view);
    } finally {
      await view.unmount();
    }
  });
}

/** 一覧・ドリルダウンの state（m）。over で上書きする */
export function motorState(over = {}) {
  return {
    t: tJa,
    loading: false,
    error: null,
    breakdown: [],
    freshness: null,
    selectedVenue: 15,
    selectedRace: null,
    venueRanks: null,
    generationStart: "2026-01-01",
    venues: [15],
    drillDownMotor: null,
    drillPreGeneration: false,
    racePreGeneration: false,
    meetParts: null,
    partsBoat: null,
    powerIndex: null,
    usageHistory: [],
    partsHistory: [],
    trendData: null,
    explainBoat: null,
    periodDays: 90,
    focusedBoat: null,
    onFocusBoat: null,
    embedded: false,
    venueMotorStats: null,
    venueMotorRanking: null,
    championshipHistory: { wins: [], generationStart: "2026-01-01" },
    selectedWakuCourse: null,
    motorWakuStats: { rows: [], generationStart: "2026-01-01", fetchFailed: false },
    motorRacerWakuStats: { rows: [] },
    setDrillDownMotor() {},
    setPartsBoat() {},
    setExplainBoat() {},
    setSelectedWakuCourse() {},
    ...over,
  };
}

/** モータ情報（一覧かドリルダウン。m.drillDownMotor で決まる）を本物の useMotorView の値で描き、fn(container, v) を返す */
export async function drawMotor(over, fn) {
  await setup();
  const [{ createElement }, { useMotorView }, { MotorMain, MotorFooterNotes }] = await Promise.all([
    import("react"),
    mod("components/analysis/motorConditionView.jsx"),
    mod("components/analysis/MotorConditionDrill.jsx"),
  ]);
  const m = motorState(over);
  const v = useMotorView(m);
  const element = createElement("div", null,
    createElement(MotorMain, { m, v, scroll: SCROLL, scrollRef: null }),
    createElement(MotorFooterNotes, { m, v }));
  return inspect(element, (container) => fn(container, v));
}

/** 部品（src/ からの相対・export の名前）を props で描き、fn(container) を返す */
export async function drawPart(rel, props, fn, exportName = "default") {
  await setup();
  const { createElement } = await import("react");
  const Component = (await mod(rel))[exportName];
  return inspect(createElement(Component, props), fn);
}

/** 描いたグラフ（recharts）の読み: 横軸の目盛りの文・縦軸の目盛りの文と y・線の型・縦軸の名前の揃え・ツールチップの地 */
export function chartFacts(root) {
  const texts = (sel) => [...root.querySelectorAll(sel)].map((el) => el.textContent);
  const yTicks = [...root.querySelectorAll(".recharts-yAxis-tick-labels text")];
  const xTicks = [...root.querySelectorAll(".recharts-xAxis-tick-labels text")];
  return {
    xTicks: texts(".recharts-xAxis-tick-labels text"),
    xTickTransforms: xTicks.map((el) => el.getAttribute("transform") ?? ""),
    yTicks: yTicks.map((el) => el.textContent),
    yTickYs: yTicks.map((el) => Number(el.getAttribute("y"))),
    curves: [...root.querySelectorAll("path.recharts-curve.recharts-line-curve")].map((el) => el.getAttribute("d") ?? ""),
    // 縦軸の名前の揃え（YAxis の label の style.textAnchor）
    yLabelAnchor: root.querySelector("text.recharts-label")?.style.getPropertyValue("text-anchor") || null,
    tooltip: root.querySelector(".recharts-default-tooltip")?.getAttribute("style") ?? "",
    tooltipLabel: root.querySelector(".recharts-tooltip-label")?.getAttribute("style") ?? "",
  };
}

/** 見出し（h3.selected-motor-heading の文）→ その下に描いたグラフ（無ければ null） */
export function chartsByHeading(container) {
  const out = {};
  let heading = null;
  for (const el of container.querySelectorAll("h3.selected-motor-heading, .recharts-responsive-container")) {
    if (el.matches("h3")) {
      heading = el.textContent;
      out[heading] = null;
    } else if (heading !== null) out[heading] = chartFacts(el);
  }
  return out;
}

/** 見出しの下の、次の見出しまでの文（節の本文） */
export function sectionText(container, headingText) {
  const nodes = [...container.querySelectorAll("h3.selected-motor-heading")];
  const at = nodes.findIndex((h) => h.textContent === headingText);
  if (at === -1) return null;
  const parts = [];
  for (let el = nodes[at].nextElementSibling; el && !el.matches("h3.selected-motor-heading"); el = el.nextElementSibling) {
    parts.push(el.textContent);
  }
  return parts.join("\n");
}

/**
 * ドリルダウンの取得（motorConditionLoad.js の useDrillLoad）を小さな部品の中で回し、setter に渡った値を返す。
 * 取得は呼ぶ側の偽の DB の上のサービス層。over は m の上書き（selectedVenue・selectedRace・drillDownMotor 等）
 */
export async function runDrillLoad(over) {
  await setup();
  const [{ createElement }, { useDrillLoad }] = await Promise.all([
    import("react"),
    mod("components/analysis/motorConditionLoad.js"),
  ]);
  const got = {};
  const setter = (name) => (value) => {
    got[name] = value;
  };
  const names = ["Loading", "Error", "DrillPreGeneration", "TrendData", "PowerIndex", "UsageHistory", "PartsHistory",
    "VenueMotorStats", "ChampionshipHistory", "VenueMotorRanking", "MotorWakuStats", "MotorRacerWakuStats"];
  const m = { t: tJa, periodDays: 90, ...Object.fromEntries(names.map((n) => [`set${n}`, setter(n)])), ...over };
  function Probe() {
    useDrillLoad(m);
    return null;
  }
  await inspect(createElement(Probe), (container, view) => view.act(() => new Promise((resolve) => setTimeout(resolve, 200))));
  return got;
}
