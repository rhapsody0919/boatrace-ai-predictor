/**
 * verify-motor-fresh-rate.js の道具（モータ情報の一覧 MotorListView を描いて見る）。verify ではない。
 * 画面の値は本物の useMotorView（motorConditionView.jsx、hook を使わない関数）で導き、一覧の部品を renderJsx で描く。
 * 取得（サービス層）は通らず、一覧の行（breakdown）と新しさ（freshness）を渡す。訳は react-i18next の既定（キーのまま）。
 */
import { renderJsx } from "../../lib/renderJsx.js";
import { quietly } from "./jsx-page-stubs.js";

const LIST = new URL("../../../src/components/analysis/MotorConditionList.jsx", import.meta.url);
const VIEW = new URL("../../../src/components/analysis/motorConditionView.jsx", import.meta.url);
const SCROLL = { hasMore: false, hasLess: false, scrollRight() {}, scrollLeft() {}, update() {} };

/** 一覧を描き、行ごとのセルの文と、押した操作の記録を返す */
export async function renderMotorList({ breakdown, freshness, selectedVenue = 17 }) {
  return quietly(async () => {
    globalThis.requestAnimationFrame ??= (callback) => setTimeout(() => callback(Date.now()), 0);
    globalThis.cancelAnimationFrame ??= (id) => clearTimeout(id);
    const { useMotorView: motorViewOf } = await import(VIEW.href);
    const calls = [];
    const m = {
      t: (key) => key,
      breakdown,
      freshness,
      selectedVenue,
      selectedRace: breakdown[0]?.race_id ?? null,
      venueRanks: null,
      generationStart: freshness?.generationStart ?? null,
      venues: [],
      drillDownMotor: null,
      meetParts: null,
      partsBoat: null,
      powerIndex: null,
      usageHistory: [],
      trendData: [],
      explainBoat: null,
      periodDays: 90,
      focusedBoat: null,
      onFocusBoat: null,
      embedded: false,
      setDrillDownMotor: (value) => calls.push(["drill", value]),
      setPartsBoat: () => {},
      setExplainBoat: (update) => calls.push(["explain", typeof update === "function" ? update(null) : update]),
    };
    const v = motorViewOf(m);
    const view = await renderJsx(LIST, { m, v, scroll: SCROLL, scrollRef: null }, { exportName: "MotorListView" });
    const { container } = view;
    const heads = [...container.querySelectorAll("thead th")].map((th) => th.textContent);
    const col = (key) => heads.indexOf(key);
    const rows = [...container.querySelectorAll("tbody tr")].map((tr) => {
      const cells = [...tr.children].map((td) => td.textContent);
      return {
        rate2: tr.querySelector(".rate-bar-label")?.textContent ?? null,
        priorRuns: tr.querySelector(".motor-fresh-prior-runs")?.textContent ?? null,
        ownMark: tr.querySelector(".motor-fresh-own-mark") !== null,
        rate3: cells[col("analysis.motor.rate3Header")],
        powerIndex: cells[col("analysis.motor.powerIndexHeader")],
        finalCount: cells[col("analysis.motor.finalCountHeader")],
        championshipCount: cells[col("analysis.motor.championshipCountHeader")],
      };
    });
    const banner = container.querySelector(".motor-fresh-banner") !== null;
    // 「※」を押す（押した艇の出どころを出す。行のドリルダウンは開かない）
    const mark = container.querySelector(".motor-fresh-own-mark");
    if (mark) await view.act(() => mark.dispatchEvent(new view.window.MouseEvent("click", { bubbles: true })));
    const markCalls = [...calls];
    // 行そのものを押すとドリルダウンを開く（※が止めているのは行への伝わりだけ、を比べるため）
    calls.length = 0;
    const firstRow = container.querySelector("tbody tr");
    if (firstRow) await view.act(() => firstRow.dispatchEvent(new view.window.MouseEvent("click", { bubbles: true })));
    const rowCalls = [...calls];
    await view.unmount();
    return { heads, rows, banner, markCalls, rowCalls };
  });
}

/** 過去レースの行（rate_source: "official"。motor_2rate/3rate は出走表時点の公式値） */
const past = (boat, o) => ({ rate_source: "official", race_id: "2026-10-06-17-07", boat_number: boat, motor_number: 10 + boat, ...o });

/**
 * 一覧の2連率・3連率は行ごとの motorRateView・motorRate3View、最初の節は帯・見出し・優出と優勝の「-」、
 * 「※」は行のドリルダウンを開かない、過去レースの機力指数は自前の値（generation_power_index）
 */
export async function motorListScenes({ check }) {
  const breakdown = [
    // 常滑 2026-10-06 7R の 20号機（公式0・0走）・35号機（公式0・1走で0回）・57号機（公式0・1走1回）
    past(1, { motor_2rate: 0, motor_3rate: 0, generation_runs: 0, generation_rate2: null, generation_rate3: null, final_count: 2, championship_count: 1 }),
    past(2, { motor_2rate: 0, motor_3rate: 0, generation_runs: 1, generation_rate2: 0, generation_rate3: 0, final_count: null, championship_count: null }),
    past(3, { motor_2rate: 0, motor_3rate: 0, generation_runs: 1, generation_rate2: 100, generation_rate3: 100, generation_power_index: 4.2, final_count: 3, championship_count: 0 }),
    // 唐津 2026-09-30 3R の 10号機（公式55.56・前の節まで9走）・7号機（公式2連率0・3連率28.57・8走で0回）
    past(4, { motor_2rate: 55.56, motor_3rate: 66.67, generation_runs: 9, generation_rate2: 55.56, prior_meet_runs: 9, final_count: 1, championship_count: 0 }),
    past(5, { motor_2rate: 0, motor_3rate: 28.57, generation_runs: 8, generation_rate2: 0, generation_rate3: 25, final_count: 0, championship_count: 0 }),
  ];
  const first = await renderMotorList({ breakdown, freshness: { firstMeet: true, generationStart: "2026-10-06" } });
  check(
    "一覧の2連率の列は行ごとの motorRateView（まだ走っていません・0%（N走）・自前の値と※・公式の値と前の節までの走数）",
    JSON.stringify(first.rows.map((r) => [r.rate2, r.ownMark, r.priorRuns])) ===
      JSON.stringify([
        ["analysis.motor.freshNotRun", false, null],
        ["analysis.motor.freshZeroRuns", false, null],
        ["100.0%analysis.motor.freshOwnMark", true, null],
        ["55.6%", false, "analysis.motor.freshPriorRuns"],
        ["analysis.motor.freshZeroRuns", false, null],
      ]),
  );
  check(
    "過去レースの3連率は motorRate3View（0走は「-」、2連率を自前にした艇は3連率も自前、公式の3連率はそのまま）",
    JSON.stringify(first.rows.map((r) => r.rate3)) === JSON.stringify(["-", "0.0", "100.0", "66.7", "28.6"]),
  );
  check(
    "最初の節は表の上に帯、2連率の見出しから「公式」を外し、優出・優勝は「-」",
    first.banner &&
      first.heads.includes("analysis.motor.freshRate2Header") &&
      !first.heads.includes("analysis.motor.officialRate2Header") &&
      first.rows.every((r) => r.finalCount === "-" && r.championshipCount === "-"),
  );
  const later = await renderMotorList({ breakdown, freshness: { firstMeet: false, generationStart: "2026-09-16" } });
  check(
    "最初の節でなければ帯は出さず、見出しは公式、優出・優勝は値（無ければ「-」）",
    !later.banner &&
      later.heads.includes("analysis.motor.officialRate2Header") &&
      !later.heads.includes("analysis.motor.freshRate2Header") &&
      JSON.stringify(later.rows.map((r) => [r.finalCount, r.championshipCount])) ===
        JSON.stringify([["2", "1"], ["-", "-"], ["3", "0"], ["1", "0"], ["0", "0"]]),
  );
  check(
    "「※」は押しても行のドリルダウンを開かない（行を押せば開く）",
    JSON.stringify(first.markCalls) === JSON.stringify([["explain", 3]]) &&
      first.rowCalls.some(([kind]) => kind === "drill"),
  );
  check(
    "過去レースの機力指数は、自前の値があれば出す（generation_power_index）",
    first.rows[2].powerIndex === "+4.2" && first.rows[0].powerIndex === "-",
  );
}
