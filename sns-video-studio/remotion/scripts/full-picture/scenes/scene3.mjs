/**
 * 場面3「軸」の材料（型: 契約「場面3 軸」）。上帯の問い「1号艇は信頼できる？」。答えに選手名。
 * ① 思考アシスト「このレースは堅い？荒れる？」: 「1号艇の1着」の「全国・級の並びが同じ {n}件 {x}%（全国 {y}%）」と棒をまとめて囲う
 *    （sameClassScope・roughCard。優勝戦・準優勝戦の日は同じラウンド、30件未満なら NC に戻す）
 * ② 1号艇の選手ページ「会場別成績 — 1号艇」: その日の会場の行を囲う。表を縦に伸ばし、約6秒
 * ③ 同じ選手ページ「枠番別回収率（過去180日）」: 枠番1の行を囲う（回収率として扱い、1着率と言わない）
 * 選手ページの集計は画面の aggregateRacerCrossStats・getRacerBoatReturnRate と同じ数え方（取得関数の中にあるので写した）。
 * 画面は見た日から730日・180日を数えるが、ここはレースの日から数え、このレースより前の走だけ（同じ材料なら同じ値）。
 */
import { roughCard, sameClassLabel, sameClassScope, anyCell } from "../../../../../src/utils/assistModel.js";
import { tallyWinPlaceShow } from "../../../../../src/utils/racerConditionStats.js";
import { isNoRaceResult } from "../../../../../scripts/lib/raceOutcomeFilters.js";
import { statsRow, tableRowBox, tableRowH } from "../../../src/fullPicture/pageLayout.js";
import { BOATS, diffOf, diffText, venueName } from "./common.mjs";

const Q = "1号艇は信頼できる？";
const d1 = (v) => (v === null || v === undefined ? "—" : v.toFixed(1));
/** 着欄の記号が数字でない（着順が付かない走）か（画面の isUnrankedFinishMark と同じ） */
const unranked = (mark) => typeof mark === "string" && mark !== "" && !/^[1-6]$/.test(mark);
/** 選手名（全角・半角の空白を除く） */
const nameOf = (s) => (s ?? "").replace(/[\s\u3000]+/g, "");

/** 選手ページの履歴の行（getRacerRaceHistory と同じ: 会場があり、不成立でなく1着がある結果だけ） */
function history(rows, date, days) {
  if (!rows) return [];
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  const cutoff = d.toISOString().slice(0, 10);
  const race = new Map(rows.races.map((r) => [r.race_id, r]));
  const result = new Map(rows.results.map((r) => [r.race_id, r]));
  const st = new Map(rows.st.map((r) => [`${r.race_id}-${r.boat_number}`, r]));
  return rows.entries
    .filter((e) => e.race_id >= cutoff)
    .map((e) => {
      const r = result.get(e.race_id);
      const info = race.get(e.race_id);
      if (!info?.venue_code || !r || isNoRaceResult(r) || r.rank1 === null) return null;
      return {
        raceId: e.race_id,
        venueCode: info.venue_code,
        boatNumber: e.boat_number,
        rank1: r.rank1,
        rank2: r.rank2,
        rank3: r.rank3,
        payoutWin: r.payout_win,
        payoutPlace1: r.payout_place_1,
        payoutPlace2: r.payout_place_2,
        unranked: unranked(st.get(`${e.race_id}-${e.boat_number}`)?.finish_mark),
        result: r,
      };
    })
    .filter(Boolean);
}

/** @param {object} m 材料 JSON */
export function buildScene3(m) {
  const omitted = [];
  const steps = [];
  const race = (m.api.races ?? []).find((r) => r.raceId === m.raceId);
  const name = nameOf(race?.entries?.find((e) => e.number === 1)?.name);
  const today = m.api.facts?.today;
  const keys = today?.scope_keys?.["1"] ?? {};
  const venue = venueName(m.venueCode);

  // ① 堅い？荒れる？の「1号艇の1着」
  const scenarios = {};
  if (keys.NC && m.api.scenarioNC) scenarios[keys.NC] = m.api.scenarioNC;
  if (keys.NCR && m.api.scenarioNCR) scenarios[keys.NCR] = m.api.scenarioNCR;
  const scope = sameClassScope({ today, raceStage: race?.raceStage ?? null, scenarios });
  const rough = roughCard(scope, anyCell(m.api.scenarioNA));
  if (rough?.b1) {
    const b = rough.b1;
    const x = Math.round(b.rate * 1000) / 10;
    const y = Math.round(b.base * 1000) / 10;
    const label = sameClassLabel(scope);
    const f = { kind: "rough", boat: 1, scopeLabel: label, shortLabel: label.replace("全国・", ""), n: b.k === undefined ? null : b.n, rate: x, national: y, ...diffOf(x, y) };
    steps.push({
      id: "s3-rough",
      question: Q,
      page: {
        kind: "stats",
        title: "このレースは堅い？荒れる？",
        sub: `${label} ${b.n.toLocaleString("ja-JP")}件`,
        rows: [{ label: "1号艇の1着", value: `${d1(x)}%`, note: `全国 ${d1(y)}%`, bar: { value: b.rate, mark: b.base } }],
      },
      press: null,
      frames: [statsRow(0)],
      facts: f,
      // 1行に収めるため「全国・」を除いた呼び名で書く（問いが1号艇なので「1号艇の」も省く）
      lines: [`${label.replace("全国・", "")}${b.n}件で1着${d1(x)}%`, diffText(`全国の${d1(y)}%`, f)].filter(Boolean),
    });
    if (scope.few) omitted.push({ where: "scene3.rough", reason: `同じラウンドが30件未満なので級の並びが同じ（NC）に戻した` });
  } else omitted.push({ where: "scene3.rough", reason: "級の並びが同じ・全国の集計が無い" });

  const rows = m.db?.racer1 ?? null;
  if (!rows) {
    omitted.push({ where: "scene3.racer", reason: "1号艇の選手の成績の材料が無い" });
    return { id: "scene3", steps, omitted };
  }
  // ② 会場別成績 — 1号艇（730日）
  const h730 = history(rows, m.date, 730).filter((r) => r.boatNumber === 1);
  const groups = new Map();
  for (const r of h730) {
    const g = groups.get(r.venueCode) ?? { n: 0, win: 0, top2: 0, top3: 0 };
    g.n += 1;
    tallyWinPlaceShow(g, r);
    groups.set(r.venueCode, g);
  }
  const all = [...groups.values()].reduce((a, g) => ({ n: a.n + g.n, win: a.win + g.win }), { n: 0, win: 0 });
  const here = groups.get(m.venueCode);
  if (here) {
    // 画面は会場の番号順。頁に収まるよう、走数の多い順で8会場まで（その日の会場は必ず入れる）
    const shown = [...groups.entries()]
      .sort((a, b) => b[1].n - a[1].n || a[0] - b[0])
      .slice(0, 8)
      .concat(groups.has(m.venueCode) && ![...groups.entries()].sort((a, b) => b[1].n - a[1].n || a[0] - b[0]).slice(0, 8).some(([v]) => v === m.venueCode) ? [[m.venueCode, here]] : [])
      .sort((a, b) => a[0] - b[0]);
    if (groups.size > shown.length) omitted.push({ where: "scene3.venues", reason: `走数の少ない${groups.size - shown.length}会場の行を省いた` });
    const idx = shown.findIndex(([v]) => v === m.venueCode);
    const rate = (g, k) => (g.n ? Math.round((g[k] / g.n) * 1000) / 10 : null);
    const hw = rate(here, "win");
    const aw = all.n ? Math.round((all.win / all.n) * 1000) / 10 : null;
    const f = { kind: "venueRecord", boat: 1, name, venue, runs: here.n, rate: hw, top2: rate(here, "top2"), allRuns: all.n, allRate: aw, ...diffOf(hw, aw) };
    steps.push({
      id: "s3-venue",
      question: Q,
      page: {
        kind: "table",
        title: `${name} 会場別成績 — 1号艇`,
        sub: "過去730日",
        firstW: 230,
        grow: 45,
        cols: ["走", "1着率", "2連率", "3連率"],
        rows: shown.map(([v, g]) => ({ label: venueName(v), cells: [String(g.n), `${d1(rate(g, "win"))}%`, `${d1(rate(g, "top2"))}%`, `${d1(rate(g, "top3"))}%`] })),
      },
      press: null,
      frames: [tableRowBox(idx, tableRowH(shown.length))],
      facts: f,
      lines: [`${name}の${venue}1号艇は${here.n}走で1着率${d1(hw)}%`, diffText(`全会場の${d1(aw)}%`, f)].filter(Boolean),
    });
  } else omitted.push({ where: "scene3.venue", reason: `${venue}で1号艇の走が730日に無い` });

  // ③ 枠番別回収率（180日）
  const h180 = history(rows, m.date, 180);
  const byBoat = new Map();
  for (const r of h180) {
    const s = byBoat.get(r.boatNumber) ?? { n: 0, win: 0, place: 0 };
    s.n += 1;
    if (r.rank1 === r.boatNumber) {
      s.win += r.payoutWin ?? 0;
      s.place += r.payoutPlace1 ?? 0;
    } else if (r.rank2 === r.boatNumber) s.place += r.payoutPlace2 ?? 0;
    byBoat.set(r.boatNumber, s);
  }
  const rr = (sum, n) => (n ? Math.round((sum / (n * 100)) * 1000) / 10 : null);
  const b1 = byBoat.get(1);
  if (b1) {
    const f = { kind: "returnRate", boat: 1, name, runs: b1.n, win: rr(b1.win, b1.n), place: rr(b1.place, b1.n) };
    steps.push({
      id: "s3-return",
      question: Q,
      page: {
        kind: "table",
        title: `${name} 枠番別回収率`,
        sub: "過去180日",
        cols: ["走", "単勝", "複勝"],
        rows: BOATS.map((b) => {
          const s = byBoat.get(b);
          return { boat: b, cells: s ? [String(s.n), `${d1(rr(s.win, s.n))}%`, `${d1(rr(s.place, s.n))}%`] : ["0", "—", "—"] };
        }),
      },
      press: null,
      frames: [tableRowBox(0)],
      facts: f,
      lines: [`${name}の1号艇は${b1.n}走`, `単勝回収率${d1(f.win)}%・複勝回収率${d1(f.place)}%`],
    });
  } else omitted.push({ where: "scene3.return", reason: "180日に1号艇の走が無い" });
  return { id: "scene3", steps, omitted };
}
