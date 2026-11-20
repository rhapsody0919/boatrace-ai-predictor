/**
 * verify-thinking-assist-model.js - 思考アシスト（BOA-430）の画面のモデル（src/utils/assistModel.js）
 *
 * 固定データは 2026-10-06 徳山10R（準優勝戦・1号艇B1）の本番 v16 API の値
 * （scripts/lib/__fixtures__/thinking-assist/tokuyama-2026-10-06-10r.json）。モック v7・spec の数字と一致することを見る:
 *   全国・級の並びが同じ 3,276件・1号艇の1着 1,074・万舟 713、準優勝戦に絞ると 112件・65・23、類似レース 63件・万舟 11件
 *
 * 実行: node scripts/maintenance/verify-thinking-assist-model.js
 */



import { build } from "esbuild";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  baseVerdict,
  bestBoats,
  classLineup,
  raceRound,
  roughCard,
  roughWithInCaution,
  sameClassLabel,
  sameClassScope,
  similarSummary,
  venueTechniqueTrend,
} from "../../src/utils/assistModel.js";
import { runThinkingAssistModelScenes1 } from "./verifyData/thinking-assist-model-scenes-1.js";
import { runThinkingAssistModelScenes2 } from "./verifyData/thinking-assist-model-scenes-2.js";
import { runThinkingAssistModelScenes3 } from "./verifyData/thinking-assist-model-scenes-3.js";
import { runThinkingAssistModelScenes4 } from "./verifyData/thinking-assist-model-scenes-4.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(
  fs.readFileSync(
    path.join(
      here,
      "../lib/__fixtures__/thinking-assist/tokuyama-2026-10-06-10r.json",
    ),
  ),
);

let failures = 0;
const check = (label, pass, detail = "") => {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
};
const pct = (x) => Math.round(x * 100);

// ---- ラウンド（D-36 (4)）----
check(
  "raceRound: v16 の round が優先、無ければ raceStage（準優勝戦・優勝戦・準優進出戦は対象外）",
  raceRound({ round: "junyu" }, null) === "junyu" &&
    raceRound(null, "準優勝戦") === "junyu" &&
    raceRound(null, "優勝戦") === "yusho" &&
    raceRound(null, "準優進出戦") === null &&
    raceRound({ round: "yosen" }, "一般") === null,
);
// v16 がラウンドを持つときは出走表より優先する（予選と言っているのに出走表の準優勝戦へ戻さない。Codex 依頼25 F01）
check(
  "raceRound: v16 の round が優勝戦・準優勝戦以外なら、出走表が準優勝戦・優勝戦でも null",
  raceRound({ round: "yosen" }, "準優勝戦") === null &&
    raceRound({ round: "other" }, "優勝戦") === null &&
    raceRound({ round: null }, "優勝戦") === "yusho",
);

// ---- 全国・級の並びが同じ（D-37）----
const scope = sameClassScope({ today: fx.today, scenarios: fx.scenario });
check(
  "準優勝戦の日は同じラウンド（NCR）: 112件・1号艇の1着 65・万舟 23、呼び名「全国・級の並びが同じ準優勝戦」",
  scope?.kind === "NCR" &&
    scope.cell.n === 112 &&
    scope.cell.b1_win === 65 &&
    scope.cell.manshu === 23 &&
    !scope.few &&
    sameClassLabel(scope) === "全国・級の並びが同じ準優勝戦",
  JSON.stringify({ kind: scope?.kind, n: scope?.cell?.n }),
);
check(
  "開いた中の「予選も含めると」はラウンドを問わない NC: 3,276件・1,074（33%）",
  scope?.withoutRound?.n === 3276 &&
    scope.withoutRound.b1_win === 1074 &&
    pct(scope.withoutRound.b1_win / scope.withoutRound.n) === 33,
);
const na = fx.scenario.NA.scenario.cells.all.forms.any;
const card = roughCard(scope, na);
check(
  "準優勝戦 112件の1号艇の1着 58% は全国の全レース 55% と差ははっきりしない（矢印なし）",
  pct(card.b1.rate) === 58 &&
    pct(card.b1.base) === 55 &&
    card.b1.verdict === "unclear",
  JSON.stringify(card.b1),
);

// BOA-822（FR-4）: 1着のバーはイン崩れ注意度の裏返し。AI予想タブの注意度と足して 100%（丸め直さない）
// 2026-10-11 戸田4R の値（pct 64.8% → 65、35,181件）。nonWin/n の丸めと pct がずれる .5 の境目も見る
const icToda = {
  pct: 65,
  n: 35181,
  nonWin: 22797,
  basePct: 45,
  lowSample: false,
};
const icCard = roughWithInCaution(card, icToda);
check(
  "注意度 65% の1着のバーは 35%（和が 100%）、基準は 100 − 45 = 55%、万舟は級の並びのまま",
  pct(icCard.b1.rate) === 35 &&
    pct(icCard.b1.base) === 55 &&
    icCard.b1.verdict === "low" &&
    icCard.manshu === card.manshu &&
    icCard.inCaution.n === 35181 &&
    icCard.inCaution.round === null,
  JSON.stringify(icCard.b1),
);
// nonWin/n = 50.5%（pct は四捨五入で 51）。1着を k/n で丸めると 50 になり、和が 101 になる
const icHalf = roughWithInCaution(card, {
  pct: 51,
  n: 200,
  nonWin: 101,
  basePct: 45,
  lowSample: true,
});
check(
  "pct 51（nonWin 50.5%）の1着は 49%（k/n を丸め直すと 50 で和が 101）。件数少なめは矢印なし",
  pct(icHalf.b1.rate) === 49 &&
    icHalf.b1.verdict === null &&
    icHalf.inCaution.lowSample === true,
  JSON.stringify(icHalf.b1),
);
check(
  "準優勝戦の注意度はラウンドの名前を持つ（1着の行に「勝率差が同じくらいの準優勝戦」）",
  roughWithInCaution(card, { ...icToda, round: "junyu" }).inCaution.round ===
    "準優勝戦",
);
check(
  "注意度が無い（null・pct なし）か rough が無ければ、今の値のまま",
  roughWithInCaution(card, null) === card &&
    roughWithInCaution(card, { pct: null, n: 0 }) === card &&
    roughWithInCaution(null, icToda) === null,
);

// NCR が30件未満なら NC に戻して few（矢印・言葉なし。D-37）
const keys = fx.today.scope_keys["1"];
const fewScenarios = {
  ...fx.scenario,
  [keys.NCR]: {
    scenario: {
      cells: {
        all: {
          forms: {
            any: { n: 29, b1_win: 20, manshu: 3, payout_known: 29 },
          },
        },
      },
    },
  },
};
const fewScope = sameClassScope({
  today: fx.today,
  scenarios: fewScenarios,
});
const fewCard = roughCard(fewScope, na);
check(
  "NCR が30件未満なら NC（3,276件）に戻し、few で verdict は null（D-37 を維持）",
  fewScope.kind === "NC" &&
    fewScope.cell.n === 3276 &&
    fewScope.few === true &&
    fewCard.b1.verdict === null &&
    fewCard.manshu.verdict === null &&
    fewCard.few === true &&
    sameClassLabel(fewScope) === "全国・級の並びが同じ",
);
// BOA-893: 実際のカードを SSR し、NC の件数と NCR 不足の説明を分けて検査する。
// ブラウザの見た目・親ページからの取得経路は E2E で別に確認する。
const componentBundle = await build({
  entryPoints: [path.join(here, "../../src/components/race/assist/RoughCard.jsx")],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  packages: "external",
  jsx: "automatic",
  loader: { ".css": "empty" },
  define: { "import.meta.env": "{}" },
});
const componentModule = { exports: {} };
new Function("require", "module", "exports", componentBundle.outputFiles[0].text)(
  createRequire(import.meta.url),
  componentModule,
  componentModule.exports,
);
const RoughCard = componentModule.exports.default;
const renderRough = (scope, inCautionMode, inCaution = null) => {
  const rough = roughCard(scope, na);
  return renderToStaticMarkup(createElement(RoughCard, {
    scope,
    rough: inCaution ? roughWithInCaution(rough, inCaution) : rough,
    lineup: null,
    classes: null,
    status: "ready",
    onOpen: () => {},
    inCautionMode,
  }));
};
for (const [round, label] of [["junyu", "準優勝戦"], ["yusho", "優勝戦"]]) {
  const fallback = sameClassScope({
    today: { ...fx.today, round }, scenarios: fewScenarios,
  });
  for (const mode of [false, true]) {
    const html = renderRough(fallback, mode);
    check(
      `${label} NCR29件→NC3,276件（注意度モード${mode}）: 件数少なめを付けず、広げた理由と矢印なしを説明`,
      !html.includes("件数少なめ") && html.includes("3,276件") &&
        html.includes(`${label}だけでは30件未満のため、全ラウンドの値（矢印なし）`),
    );
  }
}
const lowSampleHtml = renderRough(fewScope, true, {
  pct: 51, n: 200, nonWin: 101, basePct: 45, lowSample: true,
});
check(
  "注意度の lowSample の件数少なめは残し、万舟の NC3,276件には付けない",
  (lowSampleHtml.match(/件数少なめ/g) ?? []).length === 1 &&
    lowSampleHtml.includes("件数少なめ・勝率差が同じくらい 200件") &&
    lowSampleHtml.includes("級の並びが同じ 3,276件"),
);
for (const n of [30, 112]) {
  const scenarios = structuredClone(fx.scenario);
  Object.assign(scenarios[keys.NCR].scenario.cells.all.forms.any, {
    n, b1_win: Math.round(n * 0.58), manshu: Math.round(n * 0.21), payout_known: n,
  });
  const enough = sameClassScope({ today: fx.today, scenarios });
  const html = renderRough(enough, true);
  check(
    `NCR${n}件は同じラウンドのまま、広げた理由を出さない`,
    enough.kind === "NCR" && !enough.few &&
      roughCard(enough, na).manshu.verdict !== null &&
      html.includes(`級の並びが同じ準優勝戦 ${n}件`) &&
      !html.includes("全ラウンドの値"),
  );
}
const qualifying = sameClassScope({
  today: { ...fx.today, round: "yosen" }, scenarios: fx.scenario,
});
check(
  "予選（round=null）は NC のまま、広げた理由を出さない",
  qualifying.round === null && !qualifying.few &&
    roughCard(qualifying, na).manshu.verdict !== null &&
    !renderRough(qualifying, true).includes("全ラウンドの値"),
);
const noNcrToday = {
  ...fx.today,
  scope_keys: { 1: { ...keys, NCR: undefined } },
};
check(
  "NCR のキーが無い準優勝戦も NC に戻して few",
  sameClassScope({ today: noNcrToday, scenarios: fx.scenario })?.few === true,
);

// 予選のレース（round なし）は NC のまま、3,276件の1号艇の1着 33% は全国 55% より低め（モック v7 の「33% ↓」）
const yosenScope = sameClassScope({
  today: { ...fx.today, round: null },
  raceStage: "予選",
  scenarios: fx.scenario,
});
const yosenCard = roughCard(yosenScope, na);
check(
  "予選の日は NC: 1号艇の1着 33% は全国の全レース 55% より低め、万舟は 713/3,276",
  yosenScope.kind === "NC" &&
    !yosenScope.few &&
    pct(yosenCard.b1.rate) === 33 &&
    yosenCard.b1.verdict === "low" &&
    yosenCard.manshu.k === 713 &&
    yosenCard.manshu.n === 3276,
  JSON.stringify(yosenCard),
);
check(
  "baseVerdict: n=0 は null（行を出さない）、基準より上に外れれば高め",
  baseVerdict(0, 0, 0.5) === null &&
    baseVerdict(90, 100, 0.5).verdict === "high",
);

// ---- 類似レース（D-35・D-36 (3)）----
const sim = similarSummary(fx.similar);
check(
  "類似レース: 層が63件（400件以下）なので全件、63件・万舟 11/63、1号艇の1着 34",
  sim.n === 63 &&
    sim.nLayer === 63 &&
    sim.allInLayer &&
    sim.manshu.k === 11 &&
    sim.manshu.n === 63 &&
    sim.win[0] === 34,
  JSON.stringify({ n: sim.n, manshu: sim.manshu, win1: sim.win[0] }),
);
check(
  "類似レース: よく出た3連単は上位3組に件数",
  sim.topTrifecta.length === 3 &&
    sim.topTrifecta.every(([combo, c]) => combo.length === 3 && c > 0),
);
// 着順が無効の件・払戻 null の件・層 > 400（D-36 (3)）
const synthetic = {
  n_layer: 1000,
  neighbors: Array.from({ length: 500 }, (_, i) => ({
    finish: i === 0 ? [1, 1] : [1, 2, 3, 4, 5, 6],
    technique: "逃げ",
    payout_3tan: i === 1 ? null : i < 10 ? 12000 : 800,
  })),
};
const s2 = similarSummary(synthetic);
check(
  "類似レース: 層 > 400 は上位400件、件数は着順が有効な件（399）、万舟は払戻のある件（399件中9件。着順が無効でも払戻があれば数える）",
  s2.n === 399 && !s2.allInLayer && s2.manshu.n === 399 && s2.manshu.k === 9,
  JSON.stringify({ n: s2.n, manshu: s2.manshu }),
);

// ---- 級の並び（D-31）----
const lineup = classLineup(fx.today.classes, 1);
check(
  "級の並び: 1号艇 B1 固定、残りは今日の艇番順（A2・A1・A2・A1・B1）",
  lineup.map((x) => x.cls).join(",") === "B1,A2,A1,A2,A1,B1" &&
    lineup
      .filter((x) => x.fixed)
      .map((x) => x.boat)
      .join() === "1",
);

// ---- 最良の金枠（FR-3a）----
const v = (arr) => arr.map((value, i) => ({ boat: i + 1, value }));
check(
  "bestBoats: 全国勝率は max・2桁（同値の最良は全部）",
  [...bestBoats("nat_win", v([5.1, 6.333, 6.33, 4, null, 5]))].join() === "2,3",
);
check(
  "bestBoats: 平均ST は min・3桁",
  [
    ...bestBoats("st_mean30", v([0.15, 0.131, 0.14, 0.2, 0.16, 0.18])),
  ].join() === "2",
);
check(
  "bestBoats: 当地勝率の 0.00 は記録なし（最良にも比べる値にもしない）",
  [...bestBoats("loc_win", v([0, 0, 0, 0, 0, 5.2]))].join() === "" &&
    [...bestBoats("loc_win", v([0, 4.1, 6.2, null, 3, 5.2]))].join() === "3",
);
check(
  "bestBoats: 展示ST の F は候補から外す",
  [
    ...bestBoats("exh_st", [
      { boat: 1, value: 0.01, flying: true },
      { boat: 2, value: 0.08 },
      { boat: 3, value: 0.12 },
    ]),
  ].join() === "2",
);
check(
  "bestBoats: 走数が少ない最良には付けず、次の艇にも繰り下げない",
  [
    ...bestBoats("course_win", [
      { boat: 1, value: 80, runs: 3 },
      { boat: 2, value: 40, runs: 20 },
      { boat: 3, value: 20, runs: 20 },
    ]),
  ].join() === "",
);
check(
  "bestBoats: 優勝戦・準優勝戦の今節の平均着順点には付けない",
  bestBoats("series_score", v([8.57, 7, 6, 5, 4, 3]), { finalRound: true })
    .size === 0 &&
    [...bestBoats("series_score", v([8.57, 7, 6, 5, 4, 3]))].join() === "1",
);

// ---- 会場の決まり手（D-37 U-18）----
const row = (days, technique, count, total) => ({
  period_days: days,
  winning_technique: technique,
  race_count: count,
  total_races: total,
});
// 徳山（2026-10-05 時点）: 365日 2,592件・逃げ 1,516、90日 612件・逃げ 339
const tokuyama = venueTechniqueTrend([
  row(365, "逃げ", 1516, 2592),
  row(365, "差し", 317, 2592),
  row(365, "まくり", 332, 2592),
  row(365, "まくり差し", 240, 2592),
  row(365, "抜き", 175, 2592),
  row(365, "恵まれ", 12, 2592),
  row(90, "逃げ", 339, 612),
  row(90, "差し", 79, 612),
  row(90, "まくり", 80, 612),
  row(90, "まくり差し", 58, 612),
  row(90, "抜き", 52, 612),
  row(90, "恵まれ", 4, 612),
]);
const nige = tokuyama.rows.find((r) => r.technique === "逃げ");
check(
  "会場の決まり手: 徳山 365日 逃げ 58%（1,516/2,592）、90日 55%、前の275日 59%。印は付かない",
  tokuyama.total365 === 2592 &&
    pct(nige.rate365) === 58 &&
    pct(nige.rate90) === 55 &&
    pct(nige.ratePrev) === 59 &&
    tokuyama.rows.every((r) => r.mark === null),
  JSON.stringify(nige),
);
// 平和島の逃げ（実測 44.4%→36.6%）のように、90日と前の275日のぶれ幅が重ならなければ「最近↓」
const heiwajima = venueTechniqueTrend([
  row(365, "逃げ", 1000 * 0.42, 1887),
  row(90, "逃げ", 220, 600),
  row(365, "差し", 1467, 1887),
  row(90, "差し", 380, 600),
]);
const hNige = heiwajima.rows.find((r) => r.technique === "逃げ");

// ---- 後半の場面（verifyData/thinking-assist-model-scenes-1.js・thinking-assist-model-scenes-2.js・thinking-assist-model-scenes-3.js・thinking-assist-model-scenes-4.js） ----
runThinkingAssistModelScenes1({ fx, check, row, hNige });
runThinkingAssistModelScenes2({ fx, check });
runThinkingAssistModelScenes3({ check });
runThinkingAssistModelScenes4({ check });

if (failures > 0) {
  console.error(`\n${failures}件の失敗`);
  process.exit(1);
}
console.log("\n全ての検証に成功しました");
