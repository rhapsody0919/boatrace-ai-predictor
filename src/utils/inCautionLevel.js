/**
 * BOA-822 イン崩れ注意度の段・帯の判定（生成 scripts/lib/inCaution.js と画面で同じ関数を使う）。
 * 定義は src/constants/inCautionConfig.js（Python の夜の集計 in_caution_bands.py と同じ値）。
 * docs/design/in-collapse-caution/plan.md §1。
 */
import { IN_CAUTION_CONFIG } from "../constants/inCautionConfig.js";
import { getRaceStageCategory } from "../constants/raceStageConfig.js";

/**
 * 画面に出す整数の%。整数だけで四捨五入する（浮動小数の rate × 100 を丸めると、保存の桁で 0.145 などの答えがずれる）。
 * @param {number} nonWin 1号艇が1着を逃した数
 * @param {number} n 件数
 * @returns {number|null} n が 0 以下なら null（0 で割らない）
 */
export function pctOf(nonWin, n) {
  if (!Number.isInteger(n) || n <= 0 || !Number.isInteger(nonWin)) return null;
  return Math.floor((200 * nonWin + n) / (2 * n));
}

/**
 * 段。35%未満は堅め（low）、55%未満は中くらい（mid）、それ以外は崩れやすい（high）。
 * 判定は表示する整数の%で行う（34.6% を「35%」と出して「35%未満」に入れない）。
 * @param {number|null} pct
 * @returns {"low"|"mid"|"high"|null}
 */
export function levelOf(pct) {
  if (!Number.isFinite(pct)) return null;
  const [low, high] = IN_CAUTION_CONFIG.thresholds;
  if (pct < low) return "low";
  if (pct < high) return "mid";
  return "high";
}

/**
 * 勝率（例 4.81）→ 1/100 の整数（481）。勝率が無い（null・undefined・空）だけ null。0.00 は 0（勝率として扱う）。
 * @param {number|string|null|undefined} rate
 * @returns {number|null}
 */
export function rateCents(rate) {
  if (rate === null || rate === undefined || rate === "") return null;
  const v = Number(rate);
  return Number.isFinite(v) ? Math.round(v * 100) : null;
}

/**
 * 勝率差（1/100 の整数）→ 帯。clamp(floor(g / 50), -8, 6)。
 * @param {number|null} gapCents
 * @returns {number|null}
 */
export function bandOf(gapCents) {
  if (!Number.isFinite(gapCents)) return null;
  const { bandWidthCents, bandMin, bandMax } = IN_CAUTION_CONFIG;
  return Math.min(
    Math.max(Math.floor(gapCents / bandWidthCents), bandMin),
    bandMax,
  );
}

/**
 * 帯の範囲（勝率差、0.5 刻み）。端の帯は片側だけ: 帯 -8 は「−3.5未満」（to だけ）、帯 6 は「+3.0以上」（from だけ）。
 * それ以外は [from, to)。文の組み立ては画面で行う（4言語）。
 * @param {number} band
 * @returns {{from: number|null, to: number|null}|null}
 */
export function bandRange(band) {
  if (!Number.isInteger(band)) return null;
  const { bandWidthCents, bandMin, bandMax } = IN_CAUTION_CONFIG;
  const w = bandWidthCents / 100;
  return {
    from: band <= bandMin ? null : band * w,
    to: band >= bandMax ? null : (band + 1) * w,
  };
}

/**
 * 表のラウンド。準優勝戦は junyu、優勝戦は yusho、それ以外（空を含む）は other。
 * Python の features.round_from_stage と同じ規則（getRaceStageCategory の semifinal・final）。
 * @param {string|null|undefined} raceStage race_conditions.race_stage
 * @returns {"junyu"|"yusho"|"other"}
 */
export function roundOf(raceStage) {
  const key = getRaceStageCategory(raceStage)?.key;
  if (key === "semifinal") return "junyu";
  if (key === "final") return "yusho";
  return "other";
}
