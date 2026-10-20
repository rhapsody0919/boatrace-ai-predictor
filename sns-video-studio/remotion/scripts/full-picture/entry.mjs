/**
 * 入口版（X・Shorts、59秒以内）の場面の並び。2026-10-20 オーナー決定: 完全版（約3分）は YouTube の通常の動画、
 * X・Shorts は59秒以内の入口を1本。中身は固定の型「条件＋6艇の重ね図＋最後に『どう決まったか』の結論1拍」。
 * - 条件: 場面1の「会場の1着率（過去90日）」と、今日の条件1つ（風があれば風、無ければこの日の水面傾向）
 * - 6艇の重ね図: 場面2の6艇全体と1艇ずつ（カードの頁へは送らない）
 * - 結論: 場面4「結果はどう決まった？」の着順の流れ（このコースの形のとき、1着最多の艇と割合）
 * 59秒を越えたら条件の2つ目を外す。それでも越えたら止める（投稿しない。尺の上限は投稿先の申し立てで消されるため）
 */
import { fullPictureTimeline } from "../../src/fullPicture/fullPictureTimeline.js";

export const ENTRY_MAX_FRAMES = 59 * 30;

/**
 * @param {{id: string, kind: string, data: object}[]} scenes 完全版の場面（run-full.mjs の buildAll）
 * @param {object} answers 文の JSON の answers（拍の長さは答えの字数で決まる）
 * @returns {{scenes: object[], omitted: object[], total: number}}
 */
export function entryScenes(scenes, answers = {}) {
  const by = Object.fromEntries(scenes.map((x) => [x.id, x]));
  const omitted = [];
  const s1 = by.scene1?.data?.steps ?? [];
  const venue = s1.find((s) => s.id === "s1-venue90");
  const today = s1.find((s) => s.id === "s1-wind") ?? s1.find((s) => s.id === "s1-day");
  const conclusion = by.scene4?.data?.conclusion ?? null;
  if (!conclusion) omitted.push({ where: "entry.conclusion", reason: "展開の着順の流れが無い（結論の拍を省いた）", mustReport: true });
  const build = (cond) => [
    { id: "scene1", kind: "step", data: { id: "scene1", steps: cond.map((s) => ({ ...s, samePage: false })), omitted: [] } },
    { id: "scene2", kind: "scene2", data: by.scene2?.data ? { ...by.scene2.data, radarOnly: true } : null },
    { id: "conclusion", kind: "step", data: { id: "conclusion", steps: conclusion ? [conclusion] : [], omitted: [] } },
  ];
  let cond = [venue, today].filter(Boolean);
  let out = build(cond);
  let total = fullPictureTimeline(out, answers).total;
  if (total > ENTRY_MAX_FRAMES && cond.length > 1) {
    omitted.push({ where: "entry.scene1", id: cond[1].id, reason: `59秒を越えるので条件の2つ目を外した（${(total / 30).toFixed(1)}秒）` });
    cond = cond.slice(0, 1);
    out = build(cond);
    total = fullPictureTimeline(out, answers).total;
  }
  if (total > ENTRY_MAX_FRAMES) throw new Error(`入口版が59秒を越える（${(total / 30).toFixed(1)}秒）。投稿しない`);
  return { scenes: out, omitted, total };
}
