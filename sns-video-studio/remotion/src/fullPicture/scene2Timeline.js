/**
 * 全貌動画 場面2 の拍の並び（純粋関数）。材料（scripts/full-picture/scene2-data.mjs の出力）から、
 * 拍ごとの開始フレームと長さを決める。型: 1拍に1つ（押す→変わる→0.5秒→枠→答え）。
 */
export const FPS = 30;

/** 拍の中の時刻（フレーム、拍の頭から） */
export const BEAT = {
  /** 指が入って押すまで */
  press: 10,
  /** 押した後、図が変わり終わるまで */
  change: 12,
  /** 変わってから枠まで（0.5秒） */
  pause: 15,
  /** 枠が出切るまで */
  frameIn: 8,
  /** 枠から答えまで */
  answerGap: 6,
};

/** 拍の長さ（フレーム） */
const LEN = {
  overview: 150,
  focus: 135,
  toCards: 24,
  card: 150,
  empty: 120,
  tail: 15,
};

/** 押す拍の、枠と答えの出る時刻 */
export const PRESS_AT = BEAT.press;
export const CHANGE_END = BEAT.press + BEAT.change;
export const FRAME_AT = CHANGE_END + BEAT.pause;
export const ANSWER_AT = FRAME_AT + BEAT.frameIn + BEAT.answerGap;

/**
 * @param {{radar: {focus: {boat:number}[]}, cards: {items: unknown[], emptyLine: string|null}}} scene
 * @returns {{beats: {kind: string, index: number, from: number, len: number}[], total: number}}
 */
export function scene2Timeline(scene) {
  const beats = [];
  let at = 0;
  const push = (kind, index, len) => {
    beats.push({ kind, index, from: at, len });
    at += len;
  };
  push("overview", 0, LEN.overview);
  (scene?.radar?.focus ?? []).forEach((_, i) => push("focus", i, LEN.focus));
  push("toCards", 0, LEN.toCards);
  const cards = scene?.cards?.items ?? [];
  if (cards.length) cards.forEach((_, i) => push("card", i, LEN.card));
  else push("empty", 0, LEN.empty);
  at += LEN.tail;
  return { beats, total: at };
}

/** そのフレームの拍（最後の拍の後は最後の拍） */
export function beatAt(beats, frame) {
  let cur = beats[0];
  for (const b of beats) if (frame >= b.from) cur = b;
  return cur;
}
