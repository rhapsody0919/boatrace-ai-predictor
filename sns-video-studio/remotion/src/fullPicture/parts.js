/**
 * 全貌動画の場面で共通に使う定数と、文字の幅・大きさの関数（コンポーネント以外）。
 */
import { Easing } from "remotion";
import { FONT } from "../fonts.js";
import { fitHeadline } from "../textFit.js";
import { H, MIN_TEXT } from "./scene2Layout.js";

export const ORANGE = "#ff8a1f";
export const BG_TOP = "#12233a";
export const BG_BOTTOM = "#0a1424";
export const MUTED = "#a9b8cc";
export const CARD_BG = "#14263e";
export const PAGE = H;
export const fr = (rank) => (7 - rank) / 6;
export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };
export const ease = Easing.bezier(0.33, 1, 0.68, 1);

/** 文字幅（Chromium の実測。Remotion の描画は実ブラウザ内） */
let ctx = null;
export function textWidth(text, size, weight = 700) {
  if (!ctx && typeof document !== "undefined")
    ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return text.length * size;
  ctx.font = `${weight} ${size}px ${FONT}`;
  return ctx.measureText(text).width;
}

/** 1行に収まる最大の大きさ（36px まで縮める）。文の幅は検査で全角22字分以内にしてあるので、36px なら1行に入る */
export function fit1(text, maxWidth, maxFontSize, weight = 800) {
  return fitHeadline(text, {
    maxWidth,
    maxLines: 1,
    fontFamily: FONT,
    fontWeight: weight,
    maxFontSize,
    minFontSize: MIN_TEXT,
  });
}

/**
 * その拍の答えの文。scene.answers（文の JSON。描画の前に1度だけ作って保存したもの）にあればそれを、
 * 無ければ文型の版を使う。同じ JSON なら同じ絵になる
 */
export const answerOf = (scene, id, template) => scene.answers?.[id] ?? template;

