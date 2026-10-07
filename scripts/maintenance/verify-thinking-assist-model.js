/**
 * verify-thinking-assist-model.js - 思考アシスト（BOA-430）の画面のモデル（src/utils/assistModel.js）
 *
 * 固定データは 2026-10-06 徳山10R（準優勝戦・1号艇B1）の本番 v16 API の値
 * （scripts/lib/__fixtures__/thinking-assist/tokuyama-2026-10-06-10r.json）。モック v7・spec の数字と一致することを見る:
 *   全国・級の並びが同じ 3,276件・1号艇の1着 1,074・万舟 713、準優勝戦に絞ると 112件・65・23、類似レース 63件・万舟 11件
 *
 * 実行: node scripts/maintenance/verify-thinking-assist-model.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  baseVerdict,
  bestBoats,
  classLineup,
  raceRound,
  roughCard,
  sameClassLabel,
  sameClassScope,
  similarSummary,
  stageFromExhibition,
  venueTechniqueTrend,
} from "../../src/utils/assistModel.js";

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
  "NCR が30件未満なら NC（3,276件）に戻し、few で verdict は null（「件数少なめ」）",
  fewScope.kind === "NC" &&
    fewScope.cell.n === 3276 &&
    fewScope.few === true &&
    fewCard.b1.verdict === null &&
    fewCard.few === true &&
    sameClassLabel(fewScope) === "全国・級の並びが同じ",
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
check(
  "会場の決まり手: 90日 37% 対 前の275日 15%台のように重ならなければ印、向きは90日の側から",
  hNige.mark === "up",
  JSON.stringify(hNige),
);
const down = venueTechniqueTrend([
  row(365, "逃げ", 838, 1887),
  row(90, "逃げ", 168, 459),
  row(365, "差し", 1049, 1887),
  row(90, "差し", 291, 459),
]);
check(
  "会場の決まり手: 90日 36.6% 対 前の275日 47.0% は「最近↓」",
  down.rows.find((r) => r.technique === "逃げ").mark === "down",
  JSON.stringify(down.rows[0]),
);
check(
  "会場の決まり手: 想定外の決まり手（逃げ抜き）は「その他」に寄せる、365日が無ければ null",
  venueTechniqueTrend([
    row(365, "逃げ", 10, 11),
    row(365, "逃げ抜き", 1, 11),
  ]).rows.some((r) => r.technique === "その他") &&
    venueTechniqueTrend([row(90, "逃げ", 1, 1)]) === null &&
    venueTechniqueTrend([]) === null,
);

// ---- 時点（D-36 (1)）----
const exh = [1, 2, 3, 4, 5, 6].map((boat) => ({ boat, time: 6.8 }));
check(
  "時点: 出走する艇の展示タイムが全部そろえば展示後、1艇でも欠ければ展示前、欠場の艇は数えない",
  stageFromExhibition(exh, [1, 2, 3, 4, 5, 6]) === "post" &&
    stageFromExhibition(exh.slice(0, 5), [1, 2, 3, 4, 5, 6]) === "pre" &&
    stageFromExhibition(exh.slice(0, 5), [1, 2, 3, 4, 5]) === "post" &&
    stageFromExhibition([], []) === "pre",
);

if (failures > 0) {
  console.error(`\n${failures}件の失敗`);
  process.exit(1);
}
console.log("\n全ての検証に成功しました");
