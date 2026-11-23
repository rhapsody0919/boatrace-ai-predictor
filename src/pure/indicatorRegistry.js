/**
 * 指標の登録簿（ADR-0108）。指標の定義の正はここに並ぶ定義だけ。
 * 定義の型と決まりは docs/design/indicator-parts/plan.md §3。
 *
 * - getIndicator: id から定義を引く。改名した id は ALIASES（旧 id → 新 id）で読み替える
 * - bestOfIndicator: 定義の比べ方（向き・表示の桁・hidden の除外）で6艇の最良を返す
 * - formatIndicatorParts: 定義の書き方（src/pure/dataFormat.js の関数の名前）で { text, unit } を返す
 */
import { bestOf } from "./bestOf.js";
import * as dataFormat from "./dataFormat.js";
import { MOTOR_INDICATORS } from "./indicatorMotor.js";
import { RACER_POWER_INDICATORS } from "./indicatorRacerPower.js";

export const INDICATORS = [...RACER_POWER_INDICATORS, ...MOTOR_INDICATORS];

/** 改名した id の読み替え（旧 id → 新 id）。保存された並べ方の中の id を消さないため */
export const ALIASES = {};

const BY_ID = new Map(INDICATORS.map((def) => [def.id, def]));

/** @returns {object|null} 定義。知らない id は null（呼び手はその id だけを描かない） */
export const getIndicator = (id) => BY_ID.get(ALIASES[id] ?? id) ?? null;

/**
 * @param {object} def 指標の定義
 * @param {Map<number, {value: number|null, hidden?: boolean}>} values select の戻り値
 * @returns {Set<number>} 最良の艇番（比べない指標・差が無いときは空）
 */
export function bestOfIndicator(def, values) {
  const { direction, digits } = def.compare ?? {};
  if (!direction) return new Set();
  const candidates = [...(values ?? new Map())].map(([boat, v]) => ({
    boat,
    value: v?.value ?? null,
    hidden: Boolean(v?.hidden),
  }));
  return bestOf(candidates, direction, { digits });
}

/**
 * @returns {{text: string, unit: string}} 単位の無い書き方は unit が空
 */
export function formatIndicatorParts(def, value) {
  const format = dataFormat[def.format];
  if (typeof format !== "function") {
    throw new Error(`指標 ${def.id} の書き方 ${def.format} が dataFormat に無い`);
  }
  const out = format(value, def.compare?.digits);
  return typeof out === "string" ? { text: out, unit: "" } : out;
}
