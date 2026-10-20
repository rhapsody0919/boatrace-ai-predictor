/**
 * 場面1「条件」の材料（型: ~/hq/drafts/full-picture-scene-contract.md「場面1 条件」）。
 * ① 会場ページ「この会場の特徴（過去90日）」: 枠番別1着率の棒＋全国平均の目印。囲う: 1号艇の行
 * ② 「枠番別の連対率」: 1着率・2連率・3連率の3列を一斉に囲う
 * ③ 「この日の水面傾向（確定{n}R時点）」: 平均配当・万舟率・1号艇の逃げ率。囲う: 1号艇の逃げ率。確定Rが無ければ省く
 * ④ 上帯「今日の風の傾向は？」: 傾向を押して比較表を開く →「風を問わず」→「この風」へ枠を移す。展示前で出なければ省く
 * 数値は画面と同じ関数（venuePlaceRates・analogyFacts の windWaveView・usualOf）で出す。
 * 画面との違い: ③ は撮影時と同じく「このレースより前に確定したレース」で数える（画面は見た時点までの確定レース）
 */
import { placeRatesByBoat } from "../../../../../src/utils/venuePlaceRates.js";
import { usualOf, windWaveView } from "../../../../../src/utils/analogyFacts.js";
import { windBand } from "../../../../../src/utils/analogyScenario.js";
import { BUTTON, barsRow, statsRow, tableColsBox } from "../../../src/fullPicture/pageLayout.js";
import { BOATS, diffOf, diffText, pct1, venueName } from "./common.mjs";
import { fitFirst } from "../fit.mjs";

const fmt1 = (v) => (v === null ? "—" : `${v.toFixed(1)}%`);
/** 小数1桁の文字（72 → "72.0"）。画面の表と同じ桁で文に出す */
const d1 = (v) => (v === null || v === undefined ? null : v.toFixed(1));
/** 表・棒と同じ丸め（toFixed(1)）で数にする。丸めは1回だけ（Math.round の後に toFixed すると表と答えがずれる） */
const round1 = (v) => (v === null || v === undefined ? null : Number(v.toFixed(1)));

/** 24会場の過去90日の合計 → 枠番ごとの全国の割合（画面の getNationalAverageOutcomeDistribution と同じ: 件数の合計で割る） */
function nationalRates(outcomeByVenue) {
  const sum = { total: 0, data: {} };
  for (const o of Object.values(outcomeByVenue ?? {})) {
    if (!o?.total_races) continue;
    sum.total += o.total_races;
    for (const [first, pats] of Object.entries(o.data ?? {})) (sum.data[first] ??= []).push(...pats);
  }
  return placeRatesByBoat({ total_races: sum.total, data: sum.data });
}

/** この日の水面傾向（画面の getVenueDaySummary と同じ数え方。このレースより前に確定したレースだけ） */
function daySummary(races, raceNumber) {
  const done = (races ?? []).filter(
    (r) => r.raceNumber < raceNumber && r.result?.finished && !r.result.isNoRace && r.result.raceStatus !== "no_race" && r.result.rank1 != null,
  );
  const pays = done.map((r) => r.result.payoutTrio).filter((v) => v !== null && v !== undefined);
  return {
    raceCount: done.length,
    payoutCount: pays.length,
    avgPayout: pays.length ? pays.reduce((a, b) => a + b, 0) / pays.length : null,
    manshuRate: pays.length ? pays.filter((v) => v >= 10000).length / pays.length : null,
    nigeCount: done.filter((r) => r.result.rank1 === 1 && r.result.winningTechnique === "逃げ").length,
  };
}

/** @param {object} m 材料 JSON（fetch-materials.mjs） */
export function buildScene1(m) {
  const omitted = [];
  const venue = venueName(m.venueCode);
  const q = `${venue}の傾向`;
  const steps = [];
  const outcome = m.api.outcome?.[m.venueCode] ?? null;
  const rates = placeRatesByBoat(outcome);
  const nat = nationalRates(m.api.outcome);
  const natOf = (b, k) => nat?.find((r) => r.boat === b)?.[k] ?? null;
  const rateOf = (b, k) => rates?.find((r) => r.boat === b)?.[k] ?? null;
  const total = outcome?.total_races ?? 0;

  if (rates) {
    // ① 枠番別の1着率と全国平均
    const v1 = round1(rateOf(1, "winRate"));
    const n1 = round1(natOf(1, "winRate"));
    const f = { kind: "venue90", boat: 1, venue, rate: v1, national: n1, races: total, ...diffOf(v1, n1) };
    steps.push({
      id: "s1-venue90",
      question: q,
      page: {
        kind: "bars",
        title: "この会場の特徴（過去90日）",
        sub: `枠番ごとの1着率（${total.toLocaleString("ja-JP")}レース）`,
        max: Math.max(...BOATS.map((b) => Math.max(rateOf(b, "winRate"), natOf(b, "winRate") ?? 0))) * 1.1,
        markLabel: "全国平均",
        rows: BOATS.map((b) => ({ boat: b, label: "", value: rateOf(b, "winRate"), mark: natOf(b, "winRate"), text: fmt1(rateOf(b, "winRate")) })),
      },
      press: null,
      frames: [barsRow(0)],
      facts: f,
      // 会場（全選手）の集計と分かるように（今日の1号艇の選手の成績と読まれない。2026-10-20 オーナー）
      lines: fitFirst([`${venue}の1号艇（全選手）の1着率${d1(v1)}%`, diffText(`全国の${d1(n1)}%`, f)], [`${venue}の1号艇の1着率${d1(v1)}%`, diffText(`全国の${d1(n1)}%`, f)]),
    });
    // ② 枠番別の連対率（3列を一斉に囲う）
    const t2 = round1(rateOf(1, "top2Rate"));
    const t3 = round1(rateOf(1, "top3Rate"));
    const n2 = round1(natOf(1, "top2Rate"));
    const f2 = { kind: "place", boat: 1, venue, top2: t2, top3: t3, national2: n2, ...diffOf(t2, n2) };
    steps.push({
      id: "s1-place",
      question: q,
      page: {
        kind: "table",
        title: "枠番別の連対率",
        sub: `2連率は2着以内、3連率は3着以内（${total.toLocaleString("ja-JP")}レース）`,
        cols: ["1着率", "2連率", "3連率"],
        rows: BOATS.map((b) => ({ boat: b, cells: ["winRate", "top2Rate", "top3Rate"].map((k) => fmt1(rateOf(b, k))) })),
      },
      press: null,
      frames: [tableColsBox([1, 2, 3], 3)],
      facts: f2,
      lines: fitFirst(
        [`${venue}の1号艇（全選手）は2連率${d1(t2)}%・3連率${d1(t3)}%`, diffText(`全国の2連率${d1(n2)}%`, f2)],
        [`全選手の1号艇は2連率${d1(t2)}%・3連率${d1(t3)}%`, diffText(`全国の2連率${d1(n2)}%`, f2)],
      ),
    });
  } else omitted.push({ where: "scene1.venue90", reason: "会場の過去90日の集計が無い" });

  // ③ この日の水面傾向（確定レースが無ければ省く）
  const race = (m.api.races ?? []).find((r) => r.raceId === m.raceId);
  const day = daySummary(m.api.races, race?.raceNumber ?? 0);
  if (day.raceCount > 0) {
    const nige = pct1(day.nigeCount / day.raceCount);
    const v1 = rates ? round1(rateOf(1, "winRate")) : null;
    const f3 = { kind: "day", boat: 1, venue, races: day.raceCount, nigeCount: day.nigeCount, nigeRate: nige, venueRate: v1, ...diffOf(nige, v1) };
    steps.push({
      id: "s1-day",
      question: q,
      page: {
        kind: "stats",
        title: `この日の水面傾向（確定${day.raceCount}R時点）`,
        sub: venue,
        rows: [
          { label: "平均配当", value: day.avgPayout === null ? "—" : `${Math.round(day.avgPayout).toLocaleString("ja-JP")}円` },
          { label: "万舟率", value: day.manshuRate === null ? "—" : `${pct1(day.manshuRate)}%` },
          { label: "1号艇の逃げ率", value: `${d1(nige)}%`, note: `${day.nigeCount}/${day.raceCount}R` },
        ],
      },
      press: null,
      frames: [statsRow(2)],
      facts: f3,
      lines: fitFirst(
        [`今日の${venue}の1号艇（全選手）の逃げ率${d1(nige)}%（${day.nigeCount}/${day.raceCount}R）`, v1 === null ? null : diffText(`90日の1着率${d1(v1)}%`, f3)],
        [`今日のレースの1号艇の逃げ率${d1(nige)}%（${day.nigeCount}/${day.raceCount}R）`, v1 === null ? null : diffText(`90日の1着率${d1(v1)}%`, f3)],
      ),
    });
  } else omitted.push({ where: "scene1.day", reason: "このレースより前に確定したレースが無い" });

  // ④ 今日の風（展示後に風が出ていれば。思考アシストの「風 …m 傾向」と同じ表）
  const facts = m.api.facts;
  const vaKey = facts?.today?.scope_keys?.["1"]?.VA;
  const vaFacts = vaKey ? facts?.facts?.[vaKey] : null;
  const w = race?.weather ?? null;
  const post = Boolean(race?.exhibitionData?.some?.((e) => e.exhibitionTime != null));
  const view = post && vaFacts && w?.windSpeed != null ? windWaveView(vaFacts, { wind_speed: w.windSpeed, wave_height: w.waveHeight ?? null }) : null;
  if (view) {
    const rows = BOATS.map((b) => {
      const x = view.rows[String(b)]?.win;
      const u = usualOf(vaFacts, b, 1);
      return { boat: b, p: x?.[1] ? (x[0] / x[1]) * 100 : null, base: u?.[1] ? (u[0] / u[1]) * 100 : null };
    });
    const r1 = rows[0];
    const p1 = r1.p === null ? null : round1(r1.p);
    const b1 = r1.base === null ? null : round1(r1.base);
    const band = view.wind ?? windBand(w.windSpeed);
    const f4 = { kind: "wind", boat: 1, venue, wind: `${w.windSpeed}m`, band, rate: p1, base: b1, races: view.n, ...diffOf(p1, b1) };
    steps.push({
      id: "s1-wind",
      question: "今日の風の傾向は？",
      page: {
        kind: "table",
        title: `風 ${w.windDirection ?? ""}${w.windSpeed}m`,
        sub: `${venue}・この風 ${view.n.toLocaleString("ja-JP")}件`,
        button: "傾向 ›",
        cols: ["風を問わず", "この風"],
        rows: rows.map((r) => ({ boat: r.boat, cells: [fmt1(r.base === null ? null : r.base), fmt1(r.p === null ? null : r.p)] })),
      },
      press: { x: BUTTON.x + BUTTON.w / 2, y: BUTTON.y + BUTTON.h / 2 },
      revealOnPress: true,
      frames: [tableColsBox([1], 2), tableColsBox([2], 2)],
      facts: f4,
      lines: fitFirst([`この風の1号艇（全選手）の1着率${d1(p1)}%`, diffText(`風を問わず${d1(b1)}%`, f4)], [`この風の1号艇の1着率${d1(p1)}%`, diffText(`風を問わず${d1(b1)}%`, f4)]),
    });
  } else omitted.push({ where: "scene1.wind", reason: post ? "風・会場の集計が無い" : "展示前（風の傾向が出ていない）" });

  return { id: "scene1", steps, omitted };
}
