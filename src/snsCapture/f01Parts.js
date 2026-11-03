/**
 * 完全版 f01 の撮影用の頁（/sns-capture/f01/{part}、docs/design/f01-stable-capture/）の部品の表と props（純関数）。
 * 頁（F01Capture.jsx）はこの props を本番と同じ部品に渡して描くだけ。node からも読める（verify-f01-capture-contract.js が
 * 部品の引数と照合する）ので、JSX・import.meta を読まない。
 *
 * 材料（materials.json の api.*）だけから作る。ネットへの読み取りはしない。状態（押す前・押した後・選んだ艇）は URL の引数で決める。
 */
import {
  radarAxisItems,
  radarBoats,
  todayValues,
} from "../utils/analogyFacts.js";
import { similarSlice } from "../utils/analogyAggregate.js";
import {
  SLIT_FORMS,
  hintBadgeByForm,
  hintRows,
} from "../utils/analogyScenario.js";
import { axisMarks, winFollowers } from "../utils/assistSummary.js";
import { wilsonInterval } from "../utils/wilson.js";
import {
  SANKEY_VIEW,
  SANKEY_W,
  SANKEY_X,
  sankeyLayout,
} from "../components/race/analogy/sankeyLayout.js";

/** 撮る画面の幅（CSS px）。龍神のサイトの media query（480px 以下・1024px 以上）に合わせて、横長の部品はスマホ幅、着順の流れは PC 幅 */
export const VIEWPORTS = {
  narrow: { width: 430, height: 1400 },
  wide: { width: 1280, height: 1400 },
};

/**
 * 部品の表。component は描く部品（file の名前付き export）、props は渡す引数の名前（verify が部品の引数と照合する）、
 * view は撮る幅、wrap は CSS の文脈（本番で部品を包む箱のクラス）、content は部品の幅（本番のスマホ幅・PC 幅での実測）、pad は撮る箱の余白
 */
export const F01_PARTS = {
  radar: {
    component: "RadarFigure",
    file: "src/components/race/analogy/FactRadar.jsx",
    props: ["boats", "items", "picks", "axisSel", "onAxis"],
    view: "narrow",
    wrap: "facts",
    content: 414,
    pad: 8,
  },
  rows: {
    component: "RadarBoatLegend",
    file: "src/components/race/analogy/FactRadar.jsx",
    props: ["boats", "items", "picks", "main", "onPress"],
    view: "narrow",
    wrap: "facts",
    content: 414,
    pad: 8,
  },
  winBars: {
    component: "SimilarWinBars",
    file: "src/components/race/analogy/SimilarRacesTab.jsx",
    props: ["sim", "ag", "target", "boat", "onSelect"],
    view: "narrow",
    wrap: "similar",
    content: 414,
    pad: 8,
  },
  flow: {
    component: "SankeyFigure",
    file: "src/components/race/analogy/FinishSankey.jsx",
    props: [
      "tri",
      "first",
      "not1",
      "sel",
      "onPickFirst",
      "onPickFirstKey",
      "onToggleLink",
    ],
    view: "wide",
    wrap: "flow",
    content: 440,
    pad: 0,
  },
  pattern: {
    component: "SlitShapeCard",
    file: "src/components/race/analogy/SlitShapePicker.jsx",
    props: ["f", "forms", "pressed", "onSlit", "hint", "today"],
    view: "narrow",
    wrap: "pattern",
    content: 414,
    pad: 4,
  },
  followTop: {
    component: "FollowTop",
    file: "src/components/race/assist/WinFollowers.jsx",
    props: ["f", "axis", "onAxis", "auto"],
    view: "narrow",
    wrap: "assist",
    content: 380,
    pad: 8,
  },
  followTable: {
    component: "FollowTable",
    file: "src/components/race/assist/WinFollowers.jsx",
    props: ["f", "axis", "marks"],
    view: "narrow",
    wrap: "assist",
    content: 380,
    pad: 8,
  },
};

const noop = () => {};
const int = (v, name) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 6)
    throw new Error(`引数 ${name} は1〜6の艇番（${v}）`);
  return n;
};
const need = (v, what) => {
  if (v === undefined || v === null) throw new Error(`材料に ${what} が無い`);
  return v;
};

/** 材料の応答（fixture は { data: 応答 } で包んだ物がある。verify-full-picture-scene2.js と同じ読み方） */
const api = (m, key) => {
  const v = m.api?.[key];
  return v?.data ?? v;
};

/** 頁の URL の引数（URLSearchParams か object）を object にする */
const paramsOf = (q) =>
  q instanceof URLSearchParams ? Object.fromEntries(q.entries()) : { ...q };

/** 差がつく材料の七角形と艇の行の材料（ConditionFactsTab と同じ関数。主役は1号艇・着順は1着・範囲は既定） */
function radarInputs(m, stage) {
  const data = need(api(m, "facts"), "api.facts");
  const today = need(data.today, "api.facts.today");
  const items = radarAxisItems(today, stage === "exhibition");
  const boats = radarBoats(
    today,
    data.facts,
    todayValues(today, data.exhibition),
    items,
    1,
    null,
  );
  return { boats, items };
}

/** 展開シナリオの既定の範囲の応答（AnalogyFinderSection の useAnalogyScenario(raceId, null, ...)） */
const scenarioOf = (m) => need(api(m, "scenario"), "api.scenario");

/** 着順の流れの3連単（類似レース＝既定の件数まで、展開シナリオ＝枠なり・選んだ形） */
function flowTri(m, q) {
  if (q.tab === "similar")
    return similarSlice(
      need(api(m, "similar")?.similar?.neighbors, "api.similar.similar.neighbors"),
    ).ag.tri;
  if (q.tab === "scenario") {
    const forms = need(
      scenarioOf(m).scenario?.cells?.waku?.forms,
      "api.scenario.scenario.cells.waku.forms",
    );
    return need(forms[q.form]?.tri, `展開シナリオの形 ${q.form} の3連単`);
  }
  throw new Error(`引数 tab は similar か scenario（${q.tab}）`);
}

/**
 * 部品の props（名前は F01_PARTS[part].props と同じ）
 * @param {keyof typeof F01_PARTS} part
 * @param {object} m 材料 JSON
 * @param {URLSearchParams|Record<string, string>} query URL の引数。stage（racecard|exhibition）、
 *   flow: tab（similar|scenario）・form（形のキー）・first（押した1着の艇、無ければ押す前）、pattern: form、
 *   followTop・followTable: axis（軸の艇）
 * @returns {Record<string, unknown>}
 */
export function f01PartProps(part, m, query) {
  const q = paramsOf(query);
  const stage = q.stage === "exhibition" ? "exhibition" : "racecard";
  switch (part) {
    case "radar":
      return { ...radarInputs(m, stage), picks: [1], axisSel: null, onAxis: noop };
    case "rows":
      return { ...radarInputs(m, stage), picks: [1], main: 1, onPress: noop };
    case "winBars": {
      const sim = need(api(m, "similar")?.similar, "api.similar.similar");
      // 押せる棒（onSelect あり）で描く。本番の棒は押せるので、押せない形（onSelect 無し）にすると見た目が変わる
      return {
        sim,
        ag: similarSlice(sim.neighbors).ag,
        target: 1,
        boat: null,
        onSelect: noop,
      };
    }
    case "flow":
      return {
        tri: flowTri(m, q),
        first: q.first ? int(q.first, "first") : null,
        not1: false,
        sel: null,
        onPickFirst: noop,
        onPickFirstKey: noop,
        onToggleLink: noop,
      };
    case "pattern": {
      const data = scenarioOf(m);
      if (!SLIT_FORMS.includes(q.form))
        throw new Error(`引数 form は ${SLIT_FORMS.join("・")}（${q.form}）`);
      // 札の印（ScenarioTab と同じ: 枠なりの進入・手がかりの版は既定の course、展示後は今日の展示の形）
      const badges = hintBadgeByForm(
        hintRows(
          data.scenario?.hints,
          data.hints?.course,
          "course",
          wilsonInterval,
        ),
      );
      const exh = stage === "exhibition" ? data.exhibition : null;
      const today = exh && !exh.forms_excluded ? (exh.forms ?? []) : [];
      return {
        f: q.form,
        forms: need(
          data.scenario?.cells?.waku?.forms,
          "api.scenario.scenario.cells.waku.forms",
        ),
        pressed: false,
        onSlit: noop,
        hint: Boolean(badges[q.form]),
        today: today.includes(q.form),
      };
    }
    case "followTop":
    case "followTable": {
      // 思考アシスト＞相手（ThinkingAssistPage と同じ: 範囲は会場の全レース＝ scenario の VA）
      const va = need(api(m, "scenarioVA")?.scenario, "api.scenarioVA.scenario");
      const axis = int(q.axis ?? 1, "axis");
      const f = need(winFollowers(va, axis), `${axis}号艇を軸にしたときの2着`);
      return part === "followTop"
        ? { f, axis, onAxis: noop, auto: false }
        : { f, axis, marks: axisMarks(va, f, axis) };
    }
    default:
      throw new Error(
        `撮影用の部品 ${part} は無い（${Object.keys(F01_PARTS).join("・")}）`,
      );
  }
}

/**
 * 着順の流れの1着の四角（b 号艇）の箱。viewBox の単位（SANKEY_VIEW 四方）。カーソルの先。
 * 図と同じ絞り（first）で配置を出す（押した後の図なら、押した艇の四角だけがある）
 * @param {Record<string, number>} tri @param {number} b @param {number|null} [first]
 * @returns {{x: number, y: number, w: number, h: number}}
 */
export function sankeyFirstBox(tri, b, first = null) {
  const { pos } = sankeyLayout(tri, { first });
  const r = pos[0][b];
  if (!r?.h) throw new Error(`着順の流れに ${b}号艇の1着の四角が無い`);
  return { x: SANKEY_X[0], y: r.y, w: SANKEY_W, h: r.h };
}

export { SANKEY_VIEW };
