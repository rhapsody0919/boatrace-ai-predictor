/**
 * 選手ページの集計の表の判定の材料のうち、特別な節（同じ開催日に2つの格が混ざる節・公式が別の格で数えた節）の
 * 見つけ方とレースごとのグレードの補正、期間の分け方（純関数）。racerCareerJob.js から分けた（大きさの関所）。
 * racerCareerJob.js が同じ名前で export し直すので、呼び出し側は racerCareerJob.js から読んでよい。
 */
import { isCareerFinalStage } from "../../src/pure/racerCareerStats.js";
import { KB_FIRST_DATE, KB_LAST_DATE } from "./kbArchiveBoundary.js";

/**
 * 種別の原文のうち、優勝戦に当たるものだけを返す（RPC の p_final_stages）。
 * @param {unknown[]} stages
 * @returns {string[]}
 */
export function finalStagesOf(stages) {
  if (!Array.isArray(stages)) throw new Error("種別の一覧が配列ではない");
  return [
    ...new Set(stages.filter((s) => typeof s === "string" && isCareerFinalStage(s))),
  ].sort();
}

const nfkc = (s) => (typeof s === "string" ? s.normalize("NFKC") : "");

/**
 * 同じ開催日に2つの格のレースが混ざる節と、公式が別の格で数えた節（official-data-spec、2026-10-28）。
 *   split:  選手のつながり（同じレースに出た選手を結ぶ）で2つの組に分け、seed のレースを含む組を primary にする。
 *           QC は12人だけがトライアル・順位決定・賞金女王決定に出る。CC は最終日の12Rが SG の優勝戦（11R はレディースCC）
 *   whole:  節の全レースを grade にする
 */
export const SPECIAL_SERIES_RULES = Object.freeze([
  {
    id: "qc",
    match: (t) => t.includes("クイーンズクライマックス") && t.includes("QC"),
    kind: "split",
    primaryGrade: "G1",
    otherGrade: "G3",
    isSeed: (race) => nfkc(race.stage).includes("トライアル"),
  },
  {
    id: "cc",
    match: (t) => t.includes("チャレンジカップ") && t.includes("レディース"),
    kind: "split",
    primaryGrade: "SG",
    otherGrade: "G2",
    isSeed: (race, ctx) =>
      race.race_number === 12 && race.race_id.startsWith(ctx.lastDay),
  },
  {
    id: "karatsu-2024-battle",
    match: (t, day) =>
      t.includes("バトルトーナメント") &&
      day.venue_code === 23 &&
      day.race_date >= "2024-10-12" &&
      day.race_date <= "2024-10-14",
    kind: "whole",
    grade: "G1",
  },
]);

const pad2 = (n) => String(n).padStart(2, "0");
/** 'YYYY-MM-DD-VV'（kb_archive_venue_days.venue_day_id と race_id の先頭と同じ形） */
export const venueDayIdOf = (day) =>
  `${String(day.race_date).slice(0, 10)}-${pad2(day.venue_code)}`;

export const addDays = (date, n) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** 節の中で欠けてよい日数（中止・順延で丸一日開催が無い日） */
export const SERIES_GAP_DAYS = 2;

/**
 * 開催日の一覧（{venue_code, race_date, title}）から、特別な節を見つけ、同じ会場の近い日を1つの節にまとめる。
 * @param {Array<{venue_code: number, race_date: string, title: string|null}>} series
 * @returns {Array<{rule: object, venueDays: string[], lastDay: string}>}
 */

export function specialSeriesGroups(series) {
  if (!Array.isArray(series)) throw new Error("開催日の一覧が配列ではない");
  const hits = [];
  for (const day of series) {
    const t = nfkc(day.title);
    const rule = SPECIAL_SERIES_RULES.find((r) =>
      r.match(t, { ...day, race_date: String(day.race_date).slice(0, 10) }),
    );
    if (rule)
      hits.push({
        rule,
        day: { ...day, race_date: String(day.race_date).slice(0, 10) },
        title: t,
      });
  }
  // main は「レースごとの題」で日を拾うので、同じ開催日が題を変えて2回来ることがある。開催日で1つにする
  const seen = new Set();
  const unique = hits.filter((h) => {
    const k = `${h.rule.id}|${venueDayIdOf(h.day)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  unique.sort(
    (a, b) =>
      a.day.venue_code - b.day.venue_code ||
      a.day.race_date.localeCompare(b.day.race_date),
  );
  // 同じ規則・同じ会場で、間が SERIES_GAP_DAYS 日以内なら同じ節（丸一日の中止で日が欠けても割らない）
  const groups = [];
  for (const h of unique) {
    const last = groups.at(-1);
    if (
      last &&
      last.rule === h.rule &&
      last.venueCode === h.day.venue_code &&
      h.day.race_date <= addDays(last.lastDate, SERIES_GAP_DAYS + 1)
    ) {
      last.venueDays.push(venueDayIdOf(h.day));
      last.lastDate = h.day.race_date;
    } else {
      groups.push({
        rule: h.rule,
        venueCode: h.day.venue_code,
        title: h.title,
        venueDays: [venueDayIdOf(h.day)],
        lastDate: h.day.race_date,
      });
    }
  }
  return groups.map((g) => ({
    rule: g.rule,
    title: g.title,
    venueDays: g.venueDays,
    lastDay: venueDayIdOf({ race_date: g.lastDate, venue_code: g.venueCode }),
  }));
}

/**
 * 選手のつながりで、seed のレースと同じ組のレースの集合を返す（union-find）。
 * @param {Array<{race_id: string, racer_ids: number[]}>} races
 * @param {(race: object) => boolean} isSeed
 * @returns {{primary: Set<string>, judged: Set<string>, primaryRacers: number, otherRacers: number}}
 */
export function splitByRacerLinks(races, isSeed) {
  const parent = new Map();
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const race of races) {
    for (const id of race.racer_ids) if (!parent.has(id)) parent.set(id, id);
    for (let i = 1; i < race.racer_ids.length; i++)
      union(race.racer_ids[0], race.racer_ids[i]);
  }
  const seedRoots = new Set(
    races
      .filter((r) => isSeed(r) && r.racer_ids.length > 0)
      .map((r) => find(r.racer_ids[0])),
  );
  const primary = new Set();
  const judged = new Set();
  const racersByRoot = new Map();
  for (const id of parent.keys()) {
    const root = find(id);
    racersByRoot.set(root, (racersByRoot.get(root) ?? 0) + 1);
  }
  for (const race of races) {
    if (race.racer_ids.length === 0) continue; // 出た選手が分からない（中止等）。グレードを補正しない
    judged.add(race.race_id);
    if (seedRoots.has(find(race.racer_ids[0]))) primary.add(race.race_id);
  }
  let primaryRacers = 0;
  let otherRacers = 0;
  for (const [root, n] of racersByRoot) {
    if (seedRoots.has(root)) primaryRacers += n;
    else otherRacers += n;
  }
  return { primary, judged, primaryRacers, otherRacers };
}

/**
 * 特別な節のレースごとのグレード（RPC の p_override_race_ids・p_override_grades）。
 * @param {ReturnType<typeof specialSeriesGroups>} groups
 * @param {Array<{race_id: string, race_number: number, stage: string|null, racer_ids: number[]}>} races
 * @returns {{raceIds: string[], grades: string[], report: object[]}}
 */
export function gradeOverridesOf(groups, races) {
  const byDay = new Map();
  for (const race of races) {
    const day = race.race_id.slice(0, 13);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(race);
  }
  const out = new Map();
  const report = [];
  for (const g of groups) {
    const groupRaces = g.venueDays.flatMap((d) => byDay.get(d) ?? []);
    if (groupRaces.length === 0) {
      report.push({ rule: g.rule.id, venueDays: g.venueDays, races: 0 });
      continue;
    }
    if (g.rule.kind === "whole") {
      for (const r of groupRaces) out.set(r.race_id, g.rule.grade);
      report.push({
        rule: g.rule.id,
        venueDays: g.venueDays,
        races: groupRaces.length,
        grade: g.rule.grade,
      });
      continue;
    }
    const split = splitByRacerLinks(groupRaces, (r) =>
      g.rule.isSeed(r, { lastDay: g.lastDay }),
    );
    // 基準のレースがまだ無い（main で、開催中の QC のトライアルの前など）。補正せずに元のグレードのまま数え、
    // 報告に seedMissing を残す（その節の選手は出走中なので、基準のレースが入った後の晩に数え直される）。
    // kb は終わった節だけなので、runKbEra が seedMissing を見つけたら止める
    if (split.primary.size === 0) {
      report.push({ rule: g.rule.id, venueDays: g.venueDays, races: groupRaces.length, seedMissing: true });
      continue;
    }
    for (const r of groupRaces) {
      if (!split.judged.has(r.race_id)) continue;
      out.set(
        r.race_id,
        split.primary.has(r.race_id) ? g.rule.primaryGrade : g.rule.otherGrade,
      );
    }
    report.push({
      rule: g.rule.id,
      venueDays: g.venueDays,
      races: groupRaces.length,
      primaryRaces: split.primary.size,
      primaryRacers: split.primaryRacers,
      otherRacers: split.otherRacers,
    });
  }
  const raceIds = [...out.keys()].sort();
  return { raceIds, grades: raceIds.map((id) => out.get(id)), report };
}

/**
 * 期間を chunkDays 日ごとの [from, to) に分ける（kb は race_id の範囲読み。1回の RPC を 8秒の打ち切りより十分短くする）。
 * 月の頭と16日で切る（同じ節を細かく分けすぎない。数え方は足し算なので節をまたいでもよい）。
 * @returns {Array<{from: string, to: string}>}
 */
export function halfMonthRanges(from, lastInclusive) {
  const out = [];
  let cur = from;
  const end = addDays(lastInclusive, 1);
  while (cur < end) {
    const [y, m, d] = cur.split("-").map(Number);
    const next =
      d < 16
        ? `${y}-${pad2(m)}-16`
        : m === 12
          ? `${y + 1}-01-01`
          : `${y}-${pad2(m + 1)}-01`;
    out.push({ from: cur, to: next < end ? next : end });
    cur = next;
  }
  return out;
}

/** kb の期間を暦年ごとの [from, to) に分ける（判定の材料の読み取り用） */
export function kbYearRanges() {
  const years = [];
  for (
    let y = Number(KB_FIRST_DATE.slice(0, 4));
    y <= Number(KB_LAST_DATE.slice(0, 4));
    y++
  )
    years.push({
      from:
        y === Number(KB_FIRST_DATE.slice(0, 4)) ? KB_FIRST_DATE : `${y}-01-01`,
      to:
        y === Number(KB_LAST_DATE.slice(0, 4))
          ? addDays(KB_LAST_DATE, 1)
          : `${y + 1}-01-01`,
    });
  return years;
}
