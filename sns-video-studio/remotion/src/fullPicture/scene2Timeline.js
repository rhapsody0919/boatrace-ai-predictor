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

/**
 * 答えを読む時間（visual-designer 2026-10-20 P1）。答えの字数（全角1・半角0.55）を毎秒8字で読める長さだけ、
 * 答えを不透明で出す。拍の長さは決まった長さを下限に、足りなければ伸ばす（文が決まってから長さが決まる）
 */
export const READ_CPS = 8;
export const lineWidth = (l) => [...l].reduce((w, c) => w + (/[\x20-\x7e]/.test(c) ? 0.55 : 1), 0);
/** その答えを読むのに要るフレーム数 */
export const readFrames = (lines) => Math.ceil((((lines ?? []).reduce((w, l) => w + lineWidth(l), 0)) / READ_CPS) * FPS);
/** 答えの文（文の JSON にあればそれ、無ければ文型の版） */
const linesOf = (scene, id, template) => scene?.answers?.[id] ?? template;

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
 * @param {{radar: {overview?: object, focus: object[]}, cards: {items: object[], empty: object|null}, radarOnly?: boolean, answers?: object}} scene
 *   radarOnly: 重ね図だけ（入口版。カードの頁へ送らない）。answers: 文の JSON（拍の長さを答えの字数に合わせる）
 * @returns {{beats: {kind: string, index: number, from: number, len: number}[], total: number}}
 */
export function scene2Timeline(scene) {
  const focus = scene?.radar?.focus ?? [];
  const cards = scene?.radar && !scene.radarOnly ? (scene?.cards?.items ?? []) : [];
  // 拍の長さ = 決まった長さと「答えが出てから、次の拍で消し始めるまでに読める長さ」の長い方
  const fit = (base, answerAt, lines, holdAfterNext) => Math.max(base, answerAt + readFrames(lines) - holdAfterNext);
  const beats = [];
  let at = 0;
  const push = (kind, index, len) => {
    beats.push({ kind, index, from: at, len });
    at += len;
  };
  const ov = scene?.radar?.overview;
  push("overview", 0, fit(LEN.overview, OVERVIEW_ANSWER_AT, linesOf(scene, ov?.id, ov?.lines), focus.length ? PRESS_AT : 0));
  focus.forEach((f, i) => push("focus", i, fit(LEN.focus, ANSWER_AT, linesOf(scene, f?.id, f?.lines), i < focus.length - 1 ? PRESS_AT : 0)));
  if (!scene?.radarOnly) {
    push("toCards", 0, LEN.toCards);
    if (cards.length)
      cards.forEach((c, i) => push("card", i, fit(LEN.card, cardAnswerAt(i), linesOf(scene, c?.id, c?.answer), i < cards.length - 1 ? CARD_SCROLL : 0)));
    else push("empty", 0, fit(LEN.empty, 20, linesOf(scene, scene?.cards?.empty?.id, scene?.cards?.empty?.lines), 0));
  }
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
      // 入口版（重ね図だけ）の最後の艇は、場面の終わりまで残す
      const hold = !next ? b.from + b.len : next.kind === "focus" ? next.from + PRESS_AT : next.from;
      const end = !next ? b.from + b.len : next.kind === "focus" ? next.from + CHANGE_END : next.from + next.len;
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
