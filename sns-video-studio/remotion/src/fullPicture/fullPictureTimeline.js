/**
 * 全貌動画（全場面）の長さ（純粋関数）。場面ごとの長さを足す。段の無い場面（材料が無い）は0フレームで飛ばす。
 */
import { scene2Timeline } from "./scene2Timeline.js";
import { stepTimeline } from "./stepTimeline.js";

/** @param {{kind: "scene2"|"step", data: object}} x */
export function sceneDuration(x) {
  if (x.kind === "scene2")
    return x.data?.radar?.axes?.length ? scene2Timeline(x.data).total : 0;
  return x.data?.steps?.length ? stepTimeline(x.data).total : 0;
}

/** 全体の長さと、場面ごとの開始フレーム */
export function fullPictureTimeline(scenes) {
  let at = 0;
  const starts = scenes.map((x) => {
    const s = { id: x.id, from: at, len: sceneDuration(x) };
    at += s.len;
    return s;
  });
  return { starts, total: at };
}
