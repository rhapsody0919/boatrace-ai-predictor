/**
 * 入口版の冒頭の答え（v2r1-answer-fill-explain、関門の台本 docs/design/full-picture-type-gate/candidates/v2r1-answer-fill-explain/script.md）。
 * 題の問い「1号艇は堅い？」に言葉で答える。言葉は数字から機械で選ぶ（毎日自動で作るので作文しない）。
 * 答えは形を問わない割合（同じ範囲＝同じ会場か全国・級の組み合わせ・期間・枠なり）。データが薄いレース（過去が MIN_N 件未満）は作らない（オーナー 10/25）。
 */
import { SLIT_FORMS } from "../../../../src/utils/analogyScenario.js";

/** 答えを出す件数の下限。目安（根拠なし）。BOA-1096 で段 N（形を問わない割合）の n は最少300で、毎日の4本では下回らなかった */
export const ANSWER_RULE = { minN: 30 };

const pct1 = (k, n) => Math.round((k / n) * 1000) / 10;
/** 1号艇が1着の件数（3連単の件数の表から） */
const win1 = (cell) => Object.entries(cell?.tri ?? {}).filter(([k]) => k.startsWith("1-")).reduce((s, [, c]) => s + c, 0);

/** 範囲の札（例「住之江・級の組み合わせが同じ・2019/4〜2026/10・枠なり」）。scope は "VC:12:..."（会場）か "NC:..."（全国） */
export function scopeLabel(scope, period, venueName) {
  const where = String(scope ?? "").startsWith("VC:") ? venueName : "全国";
  const ym = (d) => (d ? `${Number(d.slice(0, 4))}/${Number(d.slice(5, 7))}` : null);
  const span = period?.[0] && period?.[1] ? `・${ym(period[0])}〜${ym(period[1])}` : "";
  return `${where}・級の組み合わせが同じ${span}・枠なり`;
}
/** 範囲の札を2行に分ける（場所と級／期間と枠なり。画面の幅 880px に1行ずつ収める） */
export const scopeLines = (label) => {
  const [where, cls, ...rest] = label.split("・");
  return [`${where}・${cls}`, rest.join("・")].filter(Boolean);
};

/**
 * 冒頭の答え。全レースで形を問わない割合（この組み合わせの過去で1号艇が1着の割合）で答える（オーナー 10/25「1でよい」）。
 * 予想の形の過去の割合は、今日の結果に引き継がれない（BOA-1096、docs/design/full-picture-type-gate/analysis/answer-stage.md）ので、
 * 答えには使わず、形の事実（本番がその形だった過去）として添えるだけにする。評価の言葉（堅い寄り等）は使わない
 * @param {{cells: object, period?: string[]}} sc 材料の api.scenario.scenario
 * @param {string|null} form 今日の予想の形のキー（scene4 の形。null は形が無い）
 * @returns {{ok: boolean, kind?: string, reason?: string, n0?: number, k0?: number, p0?: number, label?: string, small?: string, form?: {key: string, n: number, k: number, p: number}|null}}
 */
export function answerOf(sc, form) {
  const forms = sc?.cells?.waku?.forms ?? null;
  // kind は hq が日ごとの減りを数える固定の語（daily.mjs の reasons に type_unsupported:<kind> で出る）
  const n0 = forms?.any?.n ?? 0;
  if (n0 < ANSWER_RULE.minN) return { ok: false, kind: "thin_data", reason: `この組み合わせの過去が${n0}件（${ANSWER_RULE.minN}件未満）` };
  const k0 = win1(forms.any);
  const cell = form && SLIT_FORMS.includes(form) ? forms[form] : null;
  // 形の事実は件数が足りるときだけ（少ない件数の割合は出さない）
  const fact = cell?.n >= ANSWER_RULE.minN ? { key: form, n: cell.n, k: win1(cell), p: pct1(win1(cell), cell.n) } : null;
  return {
    ok: true,
    n0,
    k0,
    p0: pct1(k0, n0),
    label: `この組み合わせの過去で、1号艇の1着は約${Math.round((k0 / n0) * 10)}割`,
    small: "過去の割合で、今日の結果を示すものではない",
    form: fact,
    hasForm: Boolean(cell),
  };
}
