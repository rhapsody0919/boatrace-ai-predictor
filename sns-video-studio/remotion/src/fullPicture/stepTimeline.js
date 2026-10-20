/**
 * 段（STEP）で進む場面の拍の並び（純粋関数）。場面1・2b・3〜8 が使う（場面2は scene2Timeline.js）。
 * 型: 1つの STEP は同じ位置・大きさ、次へは縦スクロール。1拍に1つ（押す→変わる→0.5秒→枠→答え）。操作だけの区間を作らない。
 * 1つの段の拍: [頁を送る] → [押す（あれば）→ 変わる] → 0.5秒 → 枠（複数なら順に移す）→ 答え。
 * 答えは次の段で頁を送るまで残す。
 */
import { BEAT } from "./scene2Timeline.js";

export const SCROLL = 18;
/** 枠を次の所へ移す間 */
export const FRAME_STEP = 24;
/** 1つの段の長さ（場面2の1艇と同じ4.5秒。枠が複数なら枠の数だけ伸ばす） */
export const STEP_LEN = 135;

/**
 * その段の中の時刻（段の頭から）
 * @param {{press?: object|null, frames?: unknown[]}} step
 * @param {boolean} first 場面の最初の段か（頁を送らない）
 */
export function stepTimes(step, first) {
  // 同じ頁の続き（軸のボタンを順に押す等）は頁を送らない
  const scroll = first || step.samePage ? 0 : SCROLL;
  const press = step.press ? scroll + BEAT.press : null;
  const changed = step.press ? press + BEAT.change : scroll;
  // 表を縦に伸ばす段は、伸び切ってから 0.5秒で枠
  const grow = step.page?.grow ?? 0;
  const frame0 = changed + grow + BEAT.pause;
  const nFrames = Math.max(1, step.frames?.length ?? 0);
  const frames = Array.from(
    { length: nFrames },
    (_, i) => frame0 + i * FRAME_STEP,
  );
  const answer = frames[nFrames - 1] + BEAT.frameIn + BEAT.answerGap;
  // 短い段（重点でない艇、約2秒）は step.len で決める
  const len = step.len ?? STEP_LEN + (nFrames - 1) * FRAME_STEP + grow;
  return { scroll, press, changed, frames, answer, len };
}

/**
 * @param {{steps: {press?: object|null, frames?: unknown[]}[]}} scene
 * @returns {{beats: {index:number, from:number, len:number, times: ReturnType<typeof stepTimes>}[], total:number}}
 */
export function stepTimeline(scene) {
  let at = 0;
  const beats = (scene?.steps ?? []).map((s, i) => {
    const times = stepTimes(s, i === 0);
    const b = { index: i, from: at, len: times.len, times };
    at += times.len;
    return b;
  });
  return { beats, total: at };
}

/** その時刻の段 */
export function stepAt(beats, frame) {
  let cur = beats[0];
  for (const b of beats) if (frame >= b.from) cur = b;
  return cur;
}

/** 答えの出ている区間（次の段で頁を送り終えるまで残す。最後の段は場面の終わりまで） */
export function stepAnswerWindows(beats) {
  return beats.map((b, k) => {
    const next = beats[k + 1];
    const start = b.from + b.times.answer;
    const end = next ? next.from + next.times.scroll : b.from + b.len;
    return { index: b.index, start, hold: end, end };
  });
}

/** 縦スクロールの量（頁の数で。0 が最初の段） */
export function scrollPages(beats, frame, ease = (x) => x) {
  const b = stepAt(beats, frame);
  if (!b) return 0;
  const t = frame - b.from;
  if (b.index === 0 || t >= b.times.scroll) return b.index;
  return b.index - 1 + ease(t / b.times.scroll);
}
