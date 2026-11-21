/**
 * verify-race-detail-boa711.js の道具（レース詳細の部品を ja の訳で描いて見る）。verify ではない。
 * DB・公式・ネットには繋がない。取得（services・hooks）は渡した値を返す写しに差し替える。
 *
 * - recharts の ResponsiveContainer は jsdom では大きさ0で中身を描かないので、ResizeObserver を何もしない物で足し、
 *   ResponsiveContainer の枠（.recharts-responsive-container）だけ 600×300 を返す（他の要素は 0。文字の幅で目盛りを間引かせない）
 * - framer-motion は、motion.* を渡された animate を data-animate に書く span 等へ差し替える（波紋の大きさは渡す値で見る）
 * - 差し替えの hooks は process に1度しか登録できない（registerJsxPageStubs）ので、この道具が全部の写しを1度に登録する
 */
import { act, createElement } from "react";
import { register } from "node:module";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { renderJsx } from "../../lib/renderJsx.js";
import { quietly, registerJsxPageStubs } from "./jsx-page-stubs.js";
import { renderPage } from "./jsx-page-render.js";
import ja from "../../../src/locales/ja/common.json" with { type: "json" };

const ROUTER = new URL(import.meta.resolve("react-router-dom"));
const SRC = new URL("../../../src/", import.meta.url);
const HOLDER = "__raceDetailBoa711";
// data: の写しは裸の指定子（"react"）を解けないので、解いた先の URL で import する
const REACT = import.meta.resolve("react");
const dataUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const held = (name) => `globalThis.${HOLDER}.${name}`;
const noops = (names) => names.map((n) => `export const ${n} = async () => null;`).join("\n");

const SERVICE_STUBS = {
  "hooks/useRaceAnalysisData.js": `export const useRaceAnalysisData = () => ${held("analysis")};\nexport const prefetchRaceAnalysisData = () => {};`,
  "components/race/RaceBeforeInfoTabFetch.jsx": `export const useBeforeInfoFetches = () => ${held("fetched")};`,
  // 直前情報の表の外（グラフ・カード・気象）は、表の金枠を見るのに要らないので描かない
  "components/race/RaceBeforeInfoTabChart.jsx": "export default () => null;",
  "components/race/RaceBeforeInfoTabCards.jsx": "export default () => null;",
  "components/race/RaceBeforeInfoTabWeather.jsx": "export default () => null;",
  "hooks/useUnifiedVolatilityAccuracy.js": "export const useUnifiedVolatilityAccuracy = () => ({ stats: null, loading: false });",
  "services/venueQueries.js": `${noops(["getVenueTechniquePeriodStats", "getVenueCharacteristics", "getNationalAverageOutcomeDistribution", "getOutcomeDistribution", "getCourseWinRateBaseline"])}
export const getWinningTechniqueStats = async () => ${held("winning")};`,
  "services/venueQueries2.js": `${noops(["getTodaysVenueRanking", "getVenueDaySummary", "getVenueFirstWinRateRanking", "getTopStartStats", "getStCourseBaseline"])}
export const getLosingTechniqueStats = async () => ${held("losing")};`,
  "services/raceQueries3.js": `${noops(["getRaceFinalOdds", "getRaceEntriesDetail", "getRaceResultSummary", "getRaceRacerBoatReturnRate"])}
export const getRaceTechniqueProfileBreakdown = async () => ${held("profile")};`,
  "hooks/useVenueRaceSelector.js": `import { useState } from "${REACT}";
export function useVenueRaceSelector() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  return { venues: [], selectedVenue: null, setSelectedVenue() {}, races: [], selectedRace: "2026-10-03-20-01", setSelectedRace() {}, loading, setLoading, error, setError };
}`,
};

// framer-motion の写し: motion.span 等は渡された animate を data-animate（JSON）に書いた素の要素
const FRAMER_STUB = `import { createElement, forwardRef } from "${REACT}";
const strip = ({ animate, initial, exit, transition, whileHover, whileTap, layout, ...rest }) => ({ ...rest, "data-animate": JSON.stringify(animate ?? null) });
export const motion = new Proxy({}, { get: (_, tag) => forwardRef((props, ref) => createElement(tag, { ...strip(props), ref })) });
export const useReducedMotion = () => false;
export const AnimatePresence = ({ children }) => children;
`;
const FRAMER_HOOKS = `
export async function resolve(specifier, context, next) {
  if (specifier === "framer-motion") return { url: ${JSON.stringify(dataUrl(FRAMER_STUB))}, shortCircuit: true };
  return next(specifier, context);
}
`;

let ready = null;

/** ja の訳・jsdom に無い物・差し替えを1度だけ用意する */
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
    boot.window.scrollTo = () => {};
    globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
    globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    const zero = { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0 };
    boot.window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      return this.classList?.contains("recharts-responsive-container")
        ? { ...zero, width: 600, height: 300, right: 600, bottom: 300 }
        : zero;
    };
    await boot.unmount();
    globalThis[HOLDER] = {};
    registerJsxPageStubs({ stubs: SERVICE_STUBS });
    register(dataUrl(FRAMER_HOOKS), { parentURL: import.meta.url });
  });
  return ready;
}

/** src/ からの相対の部品を MemoryRouter の中に描き、取得の後まで待って view を返す（呼ぶ側が unmount する） */
async function draw(rel, props, { exportName = "default", values = {} } = {}) {
  await setup();
  Object.assign(globalThis[HOLDER], values);
  return quietly(async () => {
    const Component = (await import(new URL(rel, SRC).href))[exportName];
    const view = await renderJsx(ROUTER, { children: createElement(Component, props) }, { exportName: "MemoryRouter" });
    await view.act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    return view;
  });
}

/** fn(container) の結果を返し、描いた物は片付ける */
async function inspect(rel, props, options, fn) {
  const view = await draw(rel, props, options);
  try {
    return fn(view.container, view);
  } finally {
    await view.unmount();
  }
}

// ---- ST考察 ----

/**
 * ST考察のカードを描き、行（安定率・抜出・出遅率）ごとに6艇の差の文と色（better・worse・null）、行の「〜ほど良い」の文を返す。
 * players は [{ number, racerId, grade }]、records は racerId → getRacerScopedRaceStats の形、baseline は st_course_baseline の行
 */
export async function stConsiderationRows({ players, records, baseline }) {
  const props = { players, scopedByRacer: records, baseline, entryCourseOf: (p) => p.number };
  return inspect("components/race/RaceStConsiderationCard.jsx", props, {}, (container) =>
    [...container.querySelectorAll(".rsc-grid tbody tr")].slice(2).map((tr) => ({
      dir: tr.querySelector(".rsc-dir")?.textContent ?? null,
      diffs: [...tr.querySelectorAll("td")].map((td) => {
        const d = td.querySelector(".rsc-diff");
        if (!d) return null;
        const tone = d.classList.contains("is-better") ? "better" : d.classList.contains("is-worse") ? "worse" : null;
        return { text: d.textContent, tone };
      }),
    })),
  );
}

// ---- グラフ（recharts） ----

/** 推移の折れ線（TrendLineChart）を描き、横軸の最初の目盛りの x と縦軸の線の x を返す */
export async function trendChartAxis(props) {
  return inspect("components/analysis/TrendLineChart.jsx", props, {}, (container) => {
    const ticks = [...container.querySelectorAll(".recharts-xAxis-tick-labels text")].map((t) => Number(t.getAttribute("x")));
    const yLine = container.querySelector(".recharts-yAxis .recharts-cartesian-axis-line");
    return { firstTickX: ticks[0] ?? null, yAxisX: yLine ? Number(yLine.getAttribute("x1")) : null, tickCount: ticks.length };
  });
}

const CHARTS = {
  winning: "components/analysis/WinningTechniqueChart.jsx",
  losing: "components/analysis/LosingTechniqueChart.jsx",
  profile: "components/analysis/RacerTechniqueProfileChart.jsx",
};

/** 決まり手のグラフ（winning・losing・profile）を、渡した取得の値で描き、凡例の項目の文と文字の色（style の color）を返す */
export async function techniqueLegend(kind, value) {
  const props = kind === "profile" ? { embedded: true, initialRaceId: "2026-10-03-20-01" } : { initialVenueCode: 20 };
  return inspect(CHARTS[kind], props, { values: { [kind]: value } }, (container) =>
    [...container.querySelectorAll(".recharts-legend-item-text")].map((el) => {
      const styled = el.querySelector("[style]");
      return { text: el.textContent, color: styled?.style.getPropertyValue("color") || el.style.getPropertyValue("color") || null };
    }),
  );
}

// ---- 結果・イン崩れ ----

/** スタート隊形の絵を描き、艇の形（.rr-fm-hull）ごとに stroke を返す（並びは rows の順） */
export async function formationHullStrokes(rows) {
  return inspect("components/race/RaceStartFormation.jsx", { rows }, {}, (container) =>
    [...container.querySelectorAll(".rr-fm-hull")].map((el) => el.getAttribute("stroke")),
  );
}

/** イン崩れの波紋（RaceMoodEffect）を level で描き、輪ごとの animate の scale の最大を返す */
export async function moodRingScales(level) {
  return inspect("components/race/RaceMoodEffect.jsx", { level }, {}, (container) =>
    [...container.querySelectorAll(".race-mood-effect-ring")].map((el) => {
      const scale = JSON.parse(el.getAttribute("data-animate"))?.scale ?? [];
      return Math.max(...scale);
    }),
  );
}

/** イン崩れ注意度のカード（VolatilityDisplay）を描き、カードの地（background）と比較バーの値の文を返す */
export async function volatilityCard(percentile) {
  const props = { percentile, reasons: [], isFallback: false, venueCode: 20, raceId: "2026-10-03-20-01" };
  return inspect("components/race/VolatilityDisplay.jsx", props, {}, (container) => {
    const card = container.querySelector(".volatility-display");
    return {
      level: [...(card?.classList ?? [])].find((c) => c.startsWith("volatility-display-"))?.slice("volatility-display-".length) ?? null,
      background: card?.getAttribute("style")?.match(/background:\s*([^;]+)/)?.[1]?.trim() ?? null,
      barValue: container.querySelector(".vpb-value")?.textContent ?? null,
      barMax: container.querySelector(".vpb-value-max")?.textContent ?? null,
    };
  });
}

// ---- 直前情報 ----

/**
 * 直前情報の表（RaceBeforeInfoTab）を描き、行の見出し → 金枠（.ind-best）の付いた艇番の一覧を返す。
 * fetched は useBeforeInfoFetches の戻りの形、analysis は useRaceAnalysisData の戻りの形
 */
export async function beforeInfoBest({ players, fetched, analysis }) {
  const props = { raceId: "2026-10-03-20-01", venueCode: 20, players, weather: null };
  return inspect("components/race/RaceBeforeInfoTab.jsx", props, { values: { fetched, analysis } }, (container) =>
    Object.fromEntries(
      [...container.querySelectorAll(".race-before-info-tab tbody tr")].map((tr) => {
        const cells = [...tr.children];
        const best = cells.slice(1).flatMap((td, i) => (td.querySelector(".ind-best") ? [players[i].number] : []));
        return [cells[0]?.textContent ?? "", { best, text: tr.textContent }];
      }),
    ),
  );
}

// ---- 使い方ページ ----

/** 使い方ガイド（HowToUse）を描き、ステップを1つずつ開いて、全部のステップの本文をつないで返す（steps は開いたステップの数） */
export async function howToUseText() {
  await setup();
  const page = await renderPage("pages/HowToUse.jsx", { path: "/how-to-use" });
  try {
    const navs = () => [...page.container.querySelectorAll(".steps-navigation .step-nav-btn")];
    const texts = [];
    for (let i = 0; i < navs().length; i += 1) {
      await quietly(() => act(async () => navs()[i].click()));
      texts.push(page.container.textContent);
    }
    return { text: texts.join("\n"), steps: texts.length };
  } finally {
    await page.unmount();
  }
}
