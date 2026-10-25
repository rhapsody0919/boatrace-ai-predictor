/**
 * 入口版の冒頭の答え（v2r1-answer-fill-explain、関門の台本 docs/design/full-picture-type-gate/candidates/v2r1-answer-fill-explain/script.md）。
 * 題の問い「1号艇は堅い？」に言葉で答える。言葉は数字から機械で選ぶ（毎日自動で作るので作文しない）。
 * p＝今日の予想の形と同じ本番のスタートの形だった過去で1号艇が1着の割合、p0＝同じ範囲（同じ会場・級の組み合わせ・期間・枠なり）のどの形でもの割合。
 * 段は p の Wilson 95% 区間と p0 で決める。データが薄いレース（同じ形の過去が MIN_N 件未満、形が無い）は作らない（オーナー 10/25）。
 */
import { SLIT_FORMS } from "./analogyScenario.js";

/** 段を出す件数の下限・区間の z。目安（根拠なし）。BOA-1096 の統計検証で見直す */
export const ANSWER_RULE = { minN: 30, z: 1.96 };

const pct1 = (k, n) => Math.round((k / n) * 1000) / 10;
/** 1号艇が1着の件数（3連単の件数の表から） */
const win1 = (cell) => Object.entries(cell?.tri ?? {}).filter(([k]) => k.startsWith("1-")).reduce((s, [, c]) => s + c, 0);

/** Wilson の区間（割合 0〜1） */
export function wilson(k, n, z = ANSWER_RULE.z) {
  if (!(n > 0)) return null;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [c - h, c + h];
}

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
 * @param {{cells: object, period?: string[]}} sc 材料の api.scenario.scenario
 * @param {string|null} form 今日の予想の形のキー（scene4 の形。null は形が無い）
 * @returns {{stage: "A"|"B"|"C"|null, reason?: string, n?: number, k?: number, p?: number, n0?: number, k0?: number, p0?: number, label?: string, small?: string}}
 */
export function answerOf(sc, form) {
  const forms = sc?.cells?.waku?.forms ?? null;
  // kind は hq が日ごとの減りを数える固定の語（daily.mjs の reasons に type_unsupported:<kind> で出る）
  if (!forms?.any?.n) return { stage: null, kind: "thin_data", reason: "どの形でもの集計が無い" };
  if (!form || !SLIT_FORMS.includes(form)) return { stage: null, kind: "no_form", reason: "今日の平均STがどの形にも当てはまらない" };
  const cell = forms[form];
  const n = cell?.n ?? 0;
  if (n < ANSWER_RULE.minN) return { stage: null, kind: "thin_data", reason: `同じ形の過去が${n}件（${ANSWER_RULE.minN}件未満）` };
  const k = win1(cell);
  const n0 = forms.any.n;
  const k0 = win1(forms.any);
  const [lo, hi] = wilson(k, n);
  const p0r = k0 / n0;
  const stage = lo > p0r ? "A" : hi < p0r ? "C" : "B";
  const p = pct1(k, n);
  const p0 = pct1(k0, n0);
  const wari = Math.round(k / n * 10);
  const y = Math.round((k0 / n0) * 100);
  const word = { A: "いつもより堅い寄り", B: "いつもと同じ程度", C: "崩れやすい寄り" }[stage];
  const small = { A: `どの形でもの${y}%より多い（過去の割合）`, B: `はっきりした差は無い（どの形でも${y}%と比べて）`, C: `どの形でもの${y}%より少ない（過去の割合）` }[stage];
  return { stage, n, k, p, n0, k0, p0, lo, hi, label: `過去の1号艇の1着は約${wari}割、${word}`, small };
}
