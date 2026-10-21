/**
 * 場面5「相手」の材料（型: 契約「場面5 相手（約20秒）」）。思考アシスト「相手」と同じ値。
 * 上帯「2着・3着に残るのは？」: 上段 2〜6号艇の2着以内（factsScope・b1Usual、その艇の級でそろえた範囲）。一番高い艇を囲う
 * 上帯「{N}号艇が勝ったら2着は？」: 下段の軸ボタンを1→6の順に押し、軸ごとに一番多い2着の棒を囲う（winFollowers、会場の全レース VA）
 * 重点: 場面2b で1着が多い上位2艇は約5秒、残り4艇は約2秒。よく出た3連単は映さない。
 */
import { b1Usual, factsScope, winFollowers } from "../../../../../src/utils/assistSummary.js";
import { defaultStepIndex, normalizeNeighbor, sliderSteps } from "../../../../../src/utils/analogyAggregate.js";
import { axisButtonBox, barsRow, followerRow } from "../../../src/fullPicture/pageLayout.js";
import { BOATS, venueName } from "./common.mjs";
import { fitFirst } from "../fit.mjs";

const p1 = (k, n) => (n ? ((k / n) * 100).toFixed(1) : "0.0");
const SHORT = 66;
const LONG = 150;

/** 場面2b の類似レースで1着が多い上位2艇（同じ件数・同じ順の数え方） */
function keyBoats(m) {
  const sim = m.api.similar?.similar;
  if (!sim?.neighbors?.length) return [1, 2];
  const all = sim.neighbors.map(normalizeNeighbor);
  const steps = sliderSteps(all.length);
  const nb = all.slice(0, steps[defaultStepIndex(steps)]);
  const c = BOATS.map((b) => nb.filter((x) => x.finish?.[0] === b).length);
  return [...BOATS].sort((a, b) => c[b - 1] - c[a - 1] || a - b).slice(0, 2);
}

/**
 * 重点でない艇の「1着なら2着の最多」をまとめた答え。2着の艇が同じ艇ごとにまとめ、2行に収まらなければ「1着→2着」の矢印で並べる
 * @param {{axis:number, second:number}[]} rest
 */
export function restLines(rest, venue = null) {
  const at = venue ? `${venue}で` : "";
  const groups = [];
  for (const r of rest) {
    const g = groups.find((x) => x.second === r.second);
    if (g) g.axes.push(r.axis);
    else groups.push({ second: r.second, axes: [r.axis] });
  }
  if (groups.length <= 2) return groups.map((g, i) => `${i === 0 ? at : ""}${g.axes.join("・")}号艇が1着なら2着は${g.second}号艇`);
  return [`${at}1着→2着の最多（号艇）`, rest.map((r) => `${r.axis}→${r.second}`).join("・")];
}

/** @param {object} m 材料 JSON */
export function buildScene5(m) {
  const omitted = [];
  const steps = [];
  const facts = m.api.facts;
  const today = facts?.today;
  const race = (m.api.races ?? []).find((r) => r.raceId === m.raceId);
  const round = ["yusho", "junyu"].includes(today?.round) ? today.round : null;
  // 上段: 2〜6号艇の2着以内
  const top2 = [2, 3, 4, 5, 6].map((b) => {
    const u = b1Usual(factsScope(facts?.facts, today, b, round), b, 2);
    return { boat: b, k: u?.k ?? null, n: u?.n ?? null, rate: u ? u.k / u.n : null };
  });
  const ok = top2.filter((x) => x.rate !== null);
  if (ok.length) {
    const best = ok.reduce((a, x) => (x.rate > a.rate ? x : a));
    const next = ok.filter((x) => x !== best).reduce((a, x) => (!a || x.rate > a.rate ? x : a), null);
    const f = { kind: "rivals", boats: [2, 3, 4, 5, 6], boat: best.boat, rate: p1(best.k, best.n), n: best.n, next: next ? { boat: next.boat, rate: p1(next.k, next.n) } : null };
    steps.push({
      id: "s5-place",
      question: "2着・3着に残るのは？",
      page: {
        kind: "bars",
        title: "相手: 2着以内の割合",
        sub: "その艇の級別がそろうレースで",
        max: Math.max(...ok.map((x) => x.rate)) * 1.15,
        rows: top2.map((x) => ({ boat: x.boat, label: "", value: x.rate ?? 0, mark: null, text: x.rate === null ? "—" : `${p1(x.k, x.n)}%` })),
      },
      press: null,
      frames: [barsRow(top2.indexOf(best))],
      facts: f,
      // 過去のレース（その艇の級別がそろうレース）の集計と分かるように（2026-10-20 オーナー）
      lines: fitFirst(
        [`同じ級別の過去のレースで2着以内の最高は${best.boat}号艇`, next ? `${f.rate}%、次は${next.boat}号艇の${f.next.rate}%` : `${f.rate}%`],
        [`過去のレースで2着以内の最高は${best.boat}号艇`, next ? `${f.rate}%、次は${next.boat}号艇の${f.next.rate}%` : `${f.rate}%`],
      ),
    });
    for (const x of top2) if (x.rate === null) omitted.push({ where: "scene5.place", boat: x.boat, reason: "その艇の2着以内の集計が無い" });
  } else omitted.push({ where: "scene5.place", reason: "2着以内の集計が無い" });

  // 下段: 軸ボタン 1→6
  const va = m.api.scenarioVA?.scenario ?? null;
  const keys = keyBoats(m);
  const venue = venueName(m.venueCode);
  let first = true;
  const rest = [];
  let last = null;
  for (const axis of BOATS) {
    const f = winFollowers(va, axis);
    if (!f) {
      omitted.push({ where: "scene5.followers", boat: axis, reason: "この艇が1着のレースが会場の集計に無い" });
      continue;
    }
    const rows = BOATS.filter((b) => b !== axis).map((b) => ({ boat: b, value: f.second[b - 1] / f.n, text: `${p1(f.second[b - 1], f.n)}%` }));
    const best = rows.reduce((a, x) => (x.value > a.value ? x : a));
    const key = keys.includes(axis);
    const fx = { kind: "followers", venue, boat: axis, second: { boat: best.boat, rate: best.text.replace("%", ""), k: f.second[best.boat - 1] }, n: f.n, key };
    steps.push({
      id: `s5-axis-${axis}`,
      question: `${axis}号艇が勝ったら2着は？`,
      samePage: !first,
      len: key ? LONG : SHORT,
      page: { kind: "followers", title: `${venue}で${axis}号艇が1着のとき`, sub: `${f.n.toLocaleString("ja-JP")}件の2着`, axis, rows, max: Math.max(...rows.map((r) => r.value)) * 1.15 },
      press: { x: axisButtonBox(axis).x + axisButtonBox(axis).w / 2, y: axisButtonBox(axis).y + 42, from: first ? undefined : { x: axisButtonBox(axis - 1).x + 60, y: axisButtonBox(axis - 1).y + 90 } },
      revealOnPress: false,
      frames: [followerRow(rows.indexOf(best))],
      facts: fx,
      // 重点でない艇（約2秒）は答えを出さず枠だけ移す。答えは最後にまとめて1枚（読む時間が足りないため。visual-designer 2026-10-20 P1）
      // 会場の過去のレースの集計と分かるように会場名を書く（2026-10-20 オーナー）
      lines: key ? fitFirst([`${venue}で${axis}号艇が1着なら2着は${best.boat}号艇`, `${f.n}件の${fx.second.rate}%（${fx.second.k}件）`], [`${axis}号艇が1着なら2着は${best.boat}号艇`, `${venue}の${f.n}件の${fx.second.rate}%（${fx.second.k}件）`]) : [],
    });
    if (!key) rest.push({ axis, second: best.boat, rate: fx.second.rate });
    last = steps[steps.length - 1];
    first = false;
  }
  if (rest.length) {
    const fr = { kind: "followersRest", venue, boats: [...new Set(rest.flatMap((r) => [r.axis, r.second]))], pairs: rest.map((r) => ({ axis: r.axis, second: r.second, rate: r.rate })) };
    steps.push({
      ...last,
      id: "s5-axis-rest",
      question: `${rest.map((r) => r.axis).join("・")}号艇が勝ったら2着は？`,
      samePage: true,
      len: undefined,
      press: null,
      frames: [],
      facts: fr,
      lines: restLines(rest, venue),
    });
  }
  if (!race) omitted.push({ where: "scene5", reason: "出走表にこのレースが無い" });
  return { id: "scene5", steps, omitted, keyBoats: keys };
}
