/**
 * 場面2b「類似レース」の材料（型: 契約「場面2b 類似レース」）。
 * 類似度の図（円）→ 着順の流れ（サンキー図。1着の列で件数最大の艇を囲う → その帯を押して2・3着を出す）→ よく出た3連単（上位3つを一斉に囲う）。
 * 件数は画面と同じ（sliderSteps・defaultStepIndex＝既定400件、aggregateNeighbors・flowLinks・trifectaList）。
 * 「似た」等の言葉は使わず「類似レース」と書く。型に上帯の問いの文言が無いので「類似レースの結果は？」とした（報告に書く）。
 */
import {
  aggregateNeighbors,
  defaultStepIndex,
  flowLinks,
  normalizeNeighbor,
  sliderSteps,
  trifectaList,
  TOP_TRIFECTA,
} from "../../../../../src/utils/analogyAggregate.js";
import { sankeyLayout, sankeyNodeBox, sonarChipBox, triRowsBox } from "../../../src/fullPicture/sonarLayout.js";
import { BOATS } from "./common.mjs";

const Q = "類似レースの結果は？";
const p1 = (c, n) => (n ? ((c / n) * 100).toFixed(1) : "0.0");
const maxBoat = (arr) => arr.reduce((best, c, i) => (c > arr[best] ? i : best), 0) + 1;

/** 類似レースの集計（画面と同じ件数）。scene4 も同じ見せ方で使う */
export function sonarSteps(prefix, tri, n, question, { firstLine }) {
  const steps = [];
  const links = flowLinks(tri);
  const win = BOATS.map((b) => trifectaList(tri, { first: b }).reduce((s, [, c]) => s + c, 0));
  const b = maxBoat(win);
  const { nodes } = sankeyLayout(links, n);
  const node0 = nodes.find((x) => x.col === 0 && x.boat === b);
  const f1 = { kind: "flow1", boat: b, count: win[b - 1], n, pct: p1(win[b - 1], n) };
  steps.push({
    id: `${prefix}-flow`,
    question,
    page: { kind: "sankey", title: "着順の流れ", sub: `1着→2着→3着（${n}件）`, links, n },
    press: null,
    frames: [sankeyNodeBox(node0)],
    facts: f1,
    lines: [firstLine ?? `1着は${b}号艇が${win[b - 1]}件で最多`, `${n}件の${f1.pct}%`],
  });
  // その帯を押して2・3着を出す（1着の艇で絞る）
  const triB = Object.fromEntries(Object.entries(tri).filter(([k]) => k.startsWith(`${b}-`)));
  const linksB = flowLinks(triB);
  const nB = win[b - 1];
  const second = BOATS.map((x) => linksB.filter(([p, , to]) => p === 0 && to === x).reduce((s, l) => s + l[3], 0));
  const third = BOATS.map((x) => linksB.filter(([p, , to]) => p === 1 && to === x).reduce((s, l) => s + l[3], 0));
  const s2 = maxBoat(second);
  const s3 = maxBoat(third);
  const nodesB = sankeyLayout(linksB, nB).nodes;
  const node2 = nodesB.find((x) => x.col === 1 && x.boat === s2);
  const f2 = { kind: "flow2", boat: b, count: nB, second: { boat: s2, count: second[s2 - 1] }, third: { boat: s3, count: third[s3 - 1] } };
  steps.push({
    id: `${prefix}-flow-${b}`,
    question,
    page: { kind: "sankey", title: "着順の流れ", sub: `${b}号艇が1着の${nB}件`, links, n, linksAfter: linksB, nAfter: nB },
    press: { x: node0.x + 28, y: node0.y + Math.min(node0.h / 2, 300) },
    revealOnPress: true,
    frames: [sankeyNodeBox(node2)],
    facts: f2,
    lines: [`${b}号艇が1着の${nB}件、2着は${s2}号艇が${second[s2 - 1]}件`, `3着は${s3}号艇の${third[s3 - 1]}件が最多`],
  });
  // よく出た3連単（上位3つ）
  const top = trifectaList(tri).slice(0, TOP_TRIFECTA);
  if (top.length) {
    const f3 = { kind: "trifecta", n, top: top.map(([x, c]) => ({ combo: x.join("-"), boats: x, count: c, pct: p1(c, n) })) };
    steps.push({
      id: `${prefix}-tri`,
      question,
      page: { kind: "trifecta", title: "よく出た3連単", sub: `${n}件のうち`, rows: top.map(([x, c]) => ({ combo: x, count: c, pct: p1(c, n) })) },
      press: null,
      frames: [triRowsBox(top.length)],
      facts: f3,
      lines: [`最多は${top[0][0].join("-")}の${top[0][1]}件（${f3.top[0].pct}%）`, top[1] ? `次は${top[1][0].join("-")}の${top[1][1]}件` : null].filter(Boolean),
    });
  }
  return steps;
}

/** @param {object} m 材料 JSON */
export function buildScene2b(m) {
  const omitted = [];
  const sim = m.api.similar?.similar;
  if (!sim?.neighbors?.length) return { id: "scene2b", steps: [], omitted: [{ where: "scene2b", reason: "類似レースの材料が無い" }] };
  const all = sim.neighbors.map(normalizeNeighbor);
  const steps0 = sliderSteps(all.length);
  const N = steps0[defaultStepIndex(steps0)];
  const nb = all.slice(0, N);
  const ag = aggregateNeighbors(nb);
  const winners = nb.map((x) => x.finish?.[0] ?? null);
  const counts = BOATS.map((b) => winners.filter((w) => w === b).length);
  const b = maxBoat(counts);
  const sorted = [...BOATS].sort((x, y) => counts[y - 1] - counts[x - 1] || x - y);
  const b2 = sorted[1];
  const f0 = { kind: "sonar", n: N, top: { boat: b, count: counts[b - 1], pct: p1(counts[b - 1], N) }, next: { boat: b2, count: counts[b2 - 1] } };
  const steps = [
    {
      id: "s2b-sonar",
      question: Q,
      page: { kind: "sonar", title: "類似レース", sub: `似ている順の${N}件（中心ほど近い）`.replace("似ている", "類似度の高い"), winners, counts },
      press: null,
      frames: [sonarChipBox(b)],
      facts: f0,
      lines: [`類似レース${N}件で1着最多は${b}号艇`, `${counts[b - 1]}件（${f0.top.pct}%）、次は${b2}号艇の${counts[b2 - 1]}件`],
    },
    ...sonarSteps("s2b", ag.tri, ag.n, Q, {}),
  ];
  if (ag.n !== N) omitted.push({ where: "scene2b", reason: `結果の無い類似レースを除いた（${N}件中${ag.n}件）` });
  return { id: "scene2b", steps, omitted };
}
