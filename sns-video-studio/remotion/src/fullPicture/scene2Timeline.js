/**
 * 全貌動画 場面2 の拍の並び（純粋関数）。材料（scripts/full-picture/scene2-data.mjs の出力）から、
 * 拍ごとの開始フレームと長さを決める。型: 1拍に1つ（押す→変わる→0.5秒→枠→答え）。
 */
export const FPS = 30;

/** 拍の中の時刻（フレーム、拍の頭から） */
export const BEAT = {
  /** 指が入って押すまで */
  press: 8,
  /** 押した後、図が変わり終わるまで */
  change: 10,
  /** 変わってから枠まで（0.5秒） */
  pause: 15,
  /** 枠が出切るまで */
  frameIn: 6,
  /** 枠から答えまで */
  answerGap: 3,
};
/** カードの頁を送る（縦スクロール）長さ */
export const CARD_SCROLL = 18;

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
/** 6艇全体の拍: 線が出切る時刻と、枠・答えの時刻 */
export const DRAW_END = 24;
export const OVERVIEW_FRAME_AT = DRAW_END + BEAT.pause;
export const OVERVIEW_ANSWER_AT = OVERVIEW_FRAME_AT + BEAT.frameIn + BEAT.answerGap;
/** カードの拍: 頁を送り終えてから 0.5秒で枠、続いて答え（最初のカードは前の拍で送り終えている） */
export const cardFrameAt = (i) => (i === 0 ? 0 : CARD_SCROLL) + BEAT.pause;
export const cardAnswerAt = (i) => cardFrameAt(i) + BEAT.frameIn + BEAT.answerGap;

/**
 * @param {{radar: {focus: {boat:number}[]}, cards: {items: unknown[], empty: object|null}}} scene
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

/**
 * 答えの吹き出しが出ている区間（フレーム）。答えは次の拍で押すまで残し（読む時間を拍の長さに近づける）、
 * 図が変わる間に消す。カードの答えは頁と一緒に送られて消える
 * @returns {{kind: string, index: number, start: number, hold: number, end: number}[]} hold まで不透明、end で消え切る
 */
export function answerWindows(beats) {
  const out = [];
  beats.forEach((b, k) => {
    const next = beats[k + 1];
    if (b.kind === "overview" || b.kind === "focus") {
      const start = b.from + (b.kind === "overview" ? OVERVIEW_ANSWER_AT : ANSWER_AT);
      const hold = next.kind === "focus" ? next.from + PRESS_AT : next.from;
      const end = next.kind === "focus" ? next.from + CHANGE_END : next.from + next.len;
      out.push({ kind: b.kind, index: b.index, start, hold, end });
    } else if (b.kind === "card") {
      const start = b.from + cardAnswerAt(b.index);
      const stop = next?.kind === "card" ? next.from + CARD_SCROLL : b.from + b.len;
      out.push({ kind: b.kind, index: b.index, start, hold: stop, end: stop });
    } else if (b.kind === "empty") {
      out.push({ kind: b.kind, index: 0, start: b.from + 20, hold: b.from + b.len, end: b.from + b.len });
    }
  });
  return out;
}

/** 場面2の長さ（フレーム） */
export const scene2Duration = (scene) => scene2Timeline(scene).total;
