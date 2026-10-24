/**
 * 入口版（X・Shorts）の場面の並び。hq 契約 10/24 v2（ファン役4人・デザイナー役の審査、オーナー 10/24「再生回数が伸びてなかったらすぐ改善」）。
 * 結論の数字3秒 →（会場の90日の棒: 全国との差が |z|>=1.96 の日だけ）→ 当日の水面5秒 → 重ね図の全体5秒 → 1号艇と、流れ図で2着が多い2艇を各4.5秒
 * → 結論の再掲5秒 → 「チャンネルの完全版へ」2秒。約34〜45秒。上帯の問いは残す（オーナーの決定）。
 * 冒頭の数字は、同じ並びの過去で1着最多の艇の割合（frame0 から確定値）。件数が HERO_MIN_N を下回る日は当日の水面の数字に替える。
 * 59秒を越えたら会場の棒、次に当日の水面を外す。それでも越えたら止める（投稿しない）
 */
import { fullPictureTimeline } from "../../src/fullPicture/fullPictureTimeline.js";

export const ENTRY_MAX_FRAMES = 59 * 30;
/** 入口版の最初の問い（レース名と、1つ目の答え＝会場の1号艇の1着率への問い） */
export const entryQuestion = (race) => `${race} 1号艇は堅い？`;
export const CONCLUSION_QUESTION = "同じ並びの過去は、どう決まった？";
/** 冒頭の数字に使う件数の下限。目安（根拠なし）。下回る日は当日の水面の数字に替える */
export const HERO_MIN_N = 30;
/** 冒頭の数字（3秒）・結論の再掲（5秒）・会場の棒と当日の水面（各5秒）・案内（2秒） */
const LEN = { hero: 90, cond: 150, conclusion: 150, cta: 60 };
/** 要点1つ（e03、25〜30秒）は部品を増やさず、冒頭の数字・根拠・結論をそれぞれ長く見せる */
const ONE_POINT_LEN = { hero: 180, cond: 270, conclusion: 270 };
const CTA_TEXT = "チャンネルの完全版へ";
/**
 * 入口版の並び（投稿の型、type-spec.mjs の TYPE_IMPL の entry）。default は v2 の型。
 * one_point: 冒頭の数字と根拠1つ（当日の条件）と結論。6艇比較・会場の棒を外す（e03）
 * cliffhanger: 冒頭の数字と結論の再掲を出さず、条件と6艇比較の後に「続きは完全版で」（e02）
 */
export const STRUCTURES = ["default", "one_point", "cliffhanger"];
const CLIFF_CTA = { lines: ["続きは完全版・龍神レーダーで"], sub: "どう決まったか・買い目の読みは本編で" };

/** 会場の1号艇の1着率と全国の差の z（1つの割合の検定。races が母数） */
export const venueZ = (f) => {
  if (!f || !Number.isFinite(f.rate) || !Number.isFinite(f.national) || !(f.races > 0)) return null;
  const p0 = f.national / 100;
  return (f.rate / 100 - p0) / Math.sqrt((p0 * (1 - p0)) / f.races);
};

/**
 * 冒頭の数字。同じ並びの過去の1着最多の艇（件数が HERO_MIN_N 以上）→ 当日の水面の1号艇の逃げ率 → 無し
 * @returns {{source: string, boat: number|null, label: string, value: string, base: string, title: string}|null}
 */
export function heroOf(scenes) {
  const by = Object.fromEntries(scenes.map((x) => [x.id, x]));
  const c = by.scene4?.data?.conclusion?.facts ?? null;
  if (c && c.n >= HERO_MIN_N) {
    const cond = c.form ? `${c.form}の並び` : "枠なり";
    return {
      source: "conclusion",
      boat: c.boat,
      label: `${c.form ? "同じ並びの過去" : "枠なりの過去"}で${c.boat}号艇の1着`,
      value: `${c.pct}%`,
      base: `過去${c.n.toLocaleString("ja-JP")}件・${cond}`,
      title: `${c.form ? "同じ並びの過去" : "枠なりの過去"}${c.n.toLocaleString("ja-JP")}件で${c.boat}号艇の1着${c.pct}%`,
    };
  }
  const d = (by.scene1?.data?.steps ?? []).find((s) => s.id === "s1-day")?.facts ?? null;
  if (d && d.races > 0) {
    return {
      source: "day",
      boat: 1,
      label: `今日の${d.venue} 1号艇の逃げ率`,
      // 水面の頁と同じ小数1桁（割り切れる日も「50.0%」）
      value: `${Number(d.nigeRate).toFixed(1)}%`,
      base: `確定${d.races}R中${d.nigeCount}R`,
      title: `今日の${d.venue}は1号艇が${d.races}R中${d.nigeCount}R逃げ`,
    };
  }
  return null;
}

/** 会場の90日の1着率を指す行（会場の棒を外した日は、画面に出ない数字を指すので出さない） */
const VENUE90_REF = /90日の1着率/;

/** 流れ図（1着→2着）で2着が多い艇（1号艇を除く）上位 k。同数は艇番の小さい順 */
export function secondBoats(conclusion, k = 2) {
  const count = new Map();
  for (const [stage, , b, n] of conclusion?.page?.links ?? []) if (stage === 0 && b !== 1) count.set(b, (count.get(b) ?? 0) + n);
  return [...count.entries()].sort((a, c) => c[1] - a[1] || a[0] - c[0]).slice(0, k).map(([b]) => b);
}

/**
 * @param {{id: string, kind: string, data: object}[]} scenes 完全版の場面（run-full.mjs の buildAll）
 * @param {object} answers 文の JSON の answers（拍の長さは答えの字数で決まる）
 * @param {{race?: string, question?: string|null, structure?: string}} opts race: 最初の問いに入れるレース見出し。
 *   question: 最初の問いを差し替える（型の選手名の問い）。structure: 並び（STRUCTURES）
 * @returns {{scenes: object[], answers: object, omitted: object[], total: number, hero: object|null}} answers は入口版で描く答え（会場の棒を外した日は当日の水面の答えから会場の90日の行を外す）
 */
export function entryScenes(scenes, answers = {}, { race = null, question = null, structure = "default" } = {}) {
  if (!STRUCTURES.includes(structure)) throw new Error(`入口版の並び ${structure} は無い`);
  const by = Object.fromEntries(scenes.map((x) => [x.id, x]));
  const omitted = [];
  const q = question ?? (race ? entryQuestion(race) : null);
  const s1 = by.scene1?.data?.steps ?? [];
  const venue0 = s1.find((s) => s.id === "s1-venue90");
  const z = venueZ(venue0?.facts);
  const venue = venue0 && z !== null && Math.abs(z) >= 1.96 ? { ...venue0, len: LEN.cond } : null;
  if (venue0 && !venue) omitted.push({ where: "entry.venue90", reason: `会場と全国の差を確認できない（|z|=${z === null ? "—" : Math.abs(z).toFixed(2)}<1.96）` });
  const day0 = s1.find((s) => s.id === "s1-wind") ?? s1.find((s) => s.id === "s1-day");
  const day = day0 ? { ...day0, len: LEN.cond } : null;
  // 会場の棒を外した日は、当日の水面の答えの「90日の1着率…より」を出さない（画面に出ない数字を指す。Orchestrate 10/24）
  // 入口版に会場の棒を出さない並び（要点1つ）も同じ（|z| だけで決めると、要点1つで根拠が2つになる。system-architect 2026-10-25 P2）
  const venueShown = Boolean(venue) && (structure === "default" || structure === "cliffhanger");
  const dayAnswer = day && !venueShown ? (answers[day.id] ?? day.lines ?? []).filter((l) => !VENUE90_REF.test(l)) : null;
  const entryAnswers = dayAnswer ? { ...answers, [day.id]: dayAnswer } : answers;
  const c0 = by.scene4?.data?.conclusion ?? null;
  // 当てはまる形が無い日は「同じ並び」と言わない（場面4が entryQuestion を持つ。BOA-979）
  const conclusion = c0 ? { ...c0, question: c0.entryQuestion ?? CONCLUSION_QUESTION, len: LEN.conclusion } : null;
  if (!conclusion) omitted.push({ where: "entry.conclusion", reason: "展開の着順の流れが無い（結論の拍を省いた）", mustReport: true });
  const hero = heroOf(scenes);
  if (!hero) omitted.push({ where: "entry.hero", reason: "冒頭の数字の材料が無い（結論・当日の水面とも無い）" });
  if (hero?.source === "day") omitted.push({ where: "entry.hero", reason: `同じ並びの件数が${HERO_MIN_N}件（目安・根拠なし）未満なので当日の水面の数字にした` });
  const heroStep = hero && structure !== "cliffhanger"
    ? { id: "entry-hero", question: q, page: { kind: "hero", boat: hero.boat, label: hero.label, value: hero.value, base: hero.base }, press: null, frames: [], lines: [], len: structure === "one_point" ? ONE_POINT_LEN.hero : LEN.hero }
    : null;
  const ctaPage = structure === "cliffhanger" ? { kind: "cta", ...CLIFF_CTA } : { kind: "cta", lines: [CTA_TEXT], sub: "展開・相手・展示後に見る所まで" };
  const cta = { id: "entry-cta", question: q, page: ctaPage, press: null, frames: [], lines: [], len: LEN.cta };
  const keep = [1, ...secondBoats(c0)];
  const s2 = by.scene2?.data
    ? { ...by.scene2.data, radarOnly: true, radar: { ...by.scene2.data.radar, focus: (by.scene2.data.radar?.focus ?? []).filter((f) => keep.includes(f.boat)) } }
    : null;
  // 型ごとに出す部品（one_point は根拠を当日の条件1つに、cliffhanger は結論を出さない）
  const useS2 = structure === "default" || structure === "cliffhanger";
  const useConclusion = structure === "default" || structure === "one_point";
  const build = (cond) => [
    { id: "scene1", kind: "step", data: { id: "scene1", steps: [heroStep, ...cond].filter(Boolean).map((s, i) => ({ ...s, question: i === 0 && q ? q : s.question, samePage: false })), omitted: [] } },
    { id: "scene2", kind: "scene2", data: useS2 ? s2 : null },
    { id: "conclusion", kind: "step", data: { id: "conclusion", steps: [useConclusion && conclusion ? (structure === "one_point" ? { ...conclusion, len: ONE_POINT_LEN.conclusion } : conclusion) : null, cta].filter(Boolean), omitted: [] } },
  ];
  let cond = structure === "one_point" ? [day && { ...day, len: ONE_POINT_LEN.cond }].filter(Boolean) : [venue, day].filter(Boolean);
  let out = build(cond);
  let total = fullPictureTimeline(out, entryAnswers).total;
  while (total > ENTRY_MAX_FRAMES && cond.length) {
    omitted.push({ where: "entry.scene1", id: cond[0].id, reason: `59秒を越えるので外した（${(total / 30).toFixed(1)}秒）` });
    cond = cond.slice(1);
    out = build(cond);
    total = fullPictureTimeline(out, entryAnswers).total;
  }
  if (total > ENTRY_MAX_FRAMES) throw new Error(`入口版が59秒を越える（${(total / 30).toFixed(1)}秒）。投稿しない`);
  return { scenes: out, answers: entryAnswers, omitted, total, hero };
}
