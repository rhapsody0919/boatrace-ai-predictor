/**
 * 答えの文の幅（1行は全角22字分以内）。文型の版で、入らない行は決まった別の言い方に替える。
 */
import { lineWidth } from "../../src/fullPicture/scene2Timeline.js";

/** 1行の幅の上限（全角1・半角0.55で数える）。吹き出しの内側 816px を最小の 36px で割った 22.6 字分 */
export const MAX_WIDTH = 22;

/**
 * 候補（行の並び）のうち、すべての行が幅に入る最初のもの。どれも入らなければ最後の候補
 * @param {...(string|null)[][]} candidates
 */
export function fitFirst(...candidates) {
  const clean = candidates.map((c) => c.filter(Boolean));
  return clean.find((c) => c.every((l) => lineWidth(l) <= MAX_WIDTH)) ?? clean[clean.length - 1];
}
