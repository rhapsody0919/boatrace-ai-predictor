/**
 * 思考アシストの買い目などを、同じタブの中でレースごとに残す（sessionStorage）。
 * 龍神ソナー・出走表とタブへ移ってから戻る、再読み込みで消えないようにする（2026-10-11 ユーザーの不具合報告）。
 *
 * - キーはレースごと（別のレースへ持ち越さない）。接頭辞は boatai-user:（キャッシュの全削除 boatai:* で消えない名前空間）
 * - 残るのは同じタブの中だけ。タブ・ブラウザを閉じると消える（sessionStorage の性質）
 * - 残すのは買い目（1〜3着の候補）・予算・配分の方式・着順の切り替え・レンズ・相手レンズで選んだ軸の艇（BOA-845）。深掘り・シート・ガイドは残さない
 * - 読み書きの失敗（プライベートブラウズ・容量超過等）は無視して、ページ内だけの状態で動く
 */
import { LENSES } from "./assistModel.js";

export const ASSIST_SESSION_PREFIX = "boatai-user:assist:";
// 1つのタブで残すレースの数の上限。古いものから捨てる
export const ASSIST_SESSION_MAX = 20;

const MODES = ["equalPayout", "equal"];
const boatList = (v) =>
  Array.isArray(v)
    ? [...new Set(v.filter((b) => Number.isInteger(b) && b >= 1 && b <= 6))]
    : [];

/**
 * 保存した文字列 → 状態の一部。形が違う値は捨てる（壊れた保存でページを落とさない）
 * @param {string|null} raw
 * @returns {null | {bets: {1: Set<number>, 2: Set<number>, 3: Set<number>}, budget?: string, mode?: string, target?: number, lens?: string, placeAxis?: number}}
 */
export function parseAssistSession(raw) {
  if (!raw) return null;
  let v;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || !v.bets) return null;
  const out = {
    bets: {
      1: new Set(boatList(v.bets[1])),
      2: new Set(boatList(v.bets[2])),
      3: new Set(boatList(v.bets[3])),
    },
  };
  if (typeof v.budget === "string" && /^\d{0,7}$/.test(v.budget))
    out.budget = v.budget;
  if (MODES.includes(v.mode)) out.mode = v.mode;
  if ([1, 2, 3].includes(v.target)) out.target = v.target;
  if (LENSES.includes(v.lens)) out.lens = v.lens;
  if (Number.isInteger(v.placeAxis) && v.placeAxis >= 1 && v.placeAxis <= 6)
    out.placeAxis = v.placeAxis;
  return out;
}

/** 状態 → 保存する文字列 */
export const serializeAssistSession = (state) =>
  JSON.stringify({
    bets: {
      1: [...state.bets[1]],
      2: [...state.bets[2]],
      3: [...state.bets[3]],
    },
    budget: state.budget,
    mode: state.mode,
    target: state.target,
    lens: state.lens,
    placeAxis: state.placeAxis ?? null,
    at: Date.now(),
  });

const storage = () => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

/** そのレースの保存を読む。無い・読めないときは null */
export function loadAssistSession(raceId) {
  const s = storage();
  if (!s || !raceId) return null;
  try {
    return parseAssistSession(s.getItem(ASSIST_SESSION_PREFIX + raceId));
  } catch {
    return null;
  }
}

/** そのレースの状態を保存する。上限を超えたら古いレースから捨てる */
export function saveAssistSession(raceId, state) {
  const s = storage();
  if (!s || !raceId) return;
  try {
    s.setItem(ASSIST_SESSION_PREFIX + raceId, serializeAssistSession(state));
    const keys = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k?.startsWith(ASSIST_SESSION_PREFIX)) keys.push(k);
    }
    if (keys.length <= ASSIST_SESSION_MAX) return;
    const at = (k) => {
      try {
        return JSON.parse(s.getItem(k))?.at ?? 0;
      } catch {
        return 0;
      }
    };
    keys
      .sort((a, b) => at(a) - at(b))
      .slice(0, keys.length - ASSIST_SESSION_MAX)
      .forEach((k) => s.removeItem(k));
  } catch {
    // 容量超過・使えないブラウザでは残さない（ページ内の状態では動く）
  }
}
