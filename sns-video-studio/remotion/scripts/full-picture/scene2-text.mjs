/**
 * 全貌動画 場面2 の答えの文（2段）。
 * (1) 文型の版: facts だけから決まった文型で作る（scene2-data.mjs の templateLines）。必ず出せる下限
 * (2) 整えた版: LLM が facts だけを入力に1〜2行に整える。機械の検査に1つでも落ちた拍は文型の版に戻す（全体は止めない）
 * 文は描画の前に1度だけ作って JSON に保存し、描画はその JSON から行う（同じ JSON なら同じ MP4）。評価役の LLM は関門にしない。
 */
import { execFileSync } from "node:child_process";
import { FACT_ITEMS } from "../../../../src/utils/analogyFacts.js";
import { t } from "./scene2-data.mjs";

/**
 * 1行の幅の上限（全角1・半角0.55で数える）。吹き出しの内側 816px を最小の 36px で割った 22.6 字分
 */
export const MAX_WIDTH = 22.5;
export const lineWidth = (l) => [...l].reduce((w, c) => w + (/[\x20-\x7e]/.test(c) ? 0.55 : 1), 0);
export const MAX_LINES = 2;
/** 禁止表現（射幸心・保証・旧称・人を指す言い方） */
const BANNED = ["必ず当たる", "必ず", "絶対", "稼げる", "万舟", "儲か", "競艇", "この選手", "鉄板", "勝てる"];
/** ぼかし語（数値で比べずに量を言う語） */
const VAGUE = ["半分", "多い", "少ない", "多め", "少なめ", "かなり", "やや", "ほぼ", "結構", "わりと", "圧倒的", "大差", "僅差", "わずか", "少し", "ちょっと", "大きく", "大幅"];
/** 前の拍とつなぐ語。場面の各段の最初の拍では使えない。「同じく」「こちらも」は前の拍と同じ材料のときだけ */
const CONNECTORS = ["一方", "さらに", "同じく", "また", "ただ", "逆に", "それに", "こちらも", "続いて"];
const SAME_ITEM_CONNECTORS = ["同じく", "こちらも"];

/** 材料名（短い名前と正式名を同じ材料として扱う） */
const ITEM_NAMES = FACT_ITEMS.map((it) => ({
  short: t(`aiPredictionTab.analogy.facts.items.${it.key}.short`),
  label: t(`aiPredictionTab.analogy.facts.items.${it.key}.label`),
}));
const namesOf = (short) => {
  const it = ITEM_NAMES.find((x) => x.short === short);
  return it ? [it.short, it.label] : [short];
};

/** 拍の並び（場面の中の順。step は縦スクロールの段: 重ね図・カード） */
export function beatsOf(scene) {
  const out = [
    { id: scene.radar.overview.id, step: "radar", facts: scene.radar.overview.facts, template: scene.radar.overview.lines },
    ...scene.radar.focus.map((f) => ({ id: f.id, step: "radar", facts: f.facts, template: f.lines })),
  ];
  if (scene.cards.items.length)
    out.push(...scene.cards.items.map((c) => ({ id: c.id, step: "cards", facts: c.facts, template: c.answer })));
  else if (scene.cards.empty)
    out.push({ id: scene.cards.empty.id, step: "cards", facts: scene.cards.empty.facts, template: scene.cards.empty.lines });
  return out;
}

/** facts に出てくる数値（文字列）・艇番・材料名 */
function allowedOf(facts) {
  const nums = new Set();
  const boats = new Set();
  const items = new Set();
  const ranks = new Set();
  const walk = (v, key) => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, key));
    if (typeof v === "object") return Object.entries(v).forEach(([k, x]) => walk(x, k));
    if (typeof v === "number") {
      nums.add(String(v));
      if (["boat", "leaders", "boats"].includes(key)) boats.add(v);
      if (["compareRanks", "todayRank", "withinRank"].includes(key)) ranks.add(`${v}位`);
      return;
    }
    if (typeof v === "string") {
      for (const m of v.match(/\d+(?:\.\d+)?/g) ?? []) nums.add(m);
      if (key === "rank" || key === "role") v.match(/\d+/g)?.forEach((n) => ranks.add(`${n}位`));
      if (["item", "otherFirstItems"].includes(key)) namesOf(v).forEach((n) => items.add(n));
    }
  };
  walk(facts, "");
  return { nums, boats, items, ranks };
}

/**
 * 整えた版の1拍の検査。落ちた理由の一覧を返す（空なら合格）
 * @param {string[]} lines
 * @param {object} facts その拍の facts
 * @param {object|null} prev 同じ段の前の拍の facts（段の最初の拍は null）
 */
export function checkLines(lines, facts, prev) {
  const why = [];
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > MAX_LINES || lines.some((l) => typeof l !== "string" || !l.trim()))
    return [`行の数・形が不正（1〜${MAX_LINES}行の文字列）`];
  const text = lines.join("\n");
  lines.forEach((l, i) => {
    const w = Math.round(lineWidth(l) * 10) / 10;
    if (w > MAX_WIDTH) why.push(`${i + 1}行目の幅が全角${w}字分（上限${MAX_WIDTH}字分）`);
  });
  for (const w of BANNED) if (text.includes(w)) why.push(`禁止表現「${w}」`);
  for (const w of VAGUE) if (text.includes(w)) why.push(`ぼかし語「${w}」`);
  const { nums, boats, items, ranks } = allowedOf(facts);
  // 材料名: 文に出る材料は facts の材料だけ
  let rest = text;
  for (const it of ITEM_NAMES)
    for (const name of [it.label, it.short]) {
      if (!rest.includes(name)) continue;
      if (!items.has(name)) why.push(`facts に無い材料名「${name}」`);
      rest = rest.split(name).join("＿");
    }
  // 艇番
  for (const m of rest.matchAll(/([1-6])号艇/g)) if (!boats.has(Number(m[1]))) why.push(`facts に無い艇番「${m[0]}」`);
  rest = rest.replace(/[1-6]号艇/g, "＿");
  // 順位（N位）は facts の順位だけ
  for (const m of rest.matchAll(/(\d+)位(?!以内)/g)) if (!ranks.has(m[0])) why.push(`facts に無い順位「${m[0]}」`);
  rest = rest.replace(/\d+位(?!以内)/g, "＿");
  // 言い回しに入る決まった数（6艇・1着率・2位以内・2番手・N項目中）は facts の数として数えない
  rest = rest.replace(/6艇|1着率|2番手/g, "＿");
  for (const m of rest.match(/\d+(?:\.\d+)?/g) ?? []) if (!nums.has(m)) why.push(`facts に無い数値「${m}」`);
  // 向き（高い・低い）は facts の向きと合う
  if (facts.direction && /高い|低い/.test(text) && !text.includes(facts.direction)) why.push(`向きが facts（${facts.direction}）と逆`);
  // つなぐ語
  const head = lines[0];
  const conn = CONNECTORS.find((c) => head.startsWith(c));
  if (conn && !prev) why.push(`段の最初の拍でつなぐ語「${conn}」`);
  if (conn && prev && SAME_ITEM_CONNECTORS.includes(conn) && prev.item !== facts.item)
    why.push(`「${conn}」だが前の拍と材料が違う（前: ${prev.item ?? "なし"}、今: ${facts.item ?? "なし"}）`);
  return why;
}

const PROMPT = (beats) => `あなたはボートレースのデータ動画の字幕を整える係。下の各拍の facts（コードが計算した比較の結果）だけを使い、拍ごとに答えの字幕を1〜2行で書く。

規則:
- 1行は全角${MAX_WIDTH}字分以内（半角の数字・記号は0.55字分）、1〜${MAX_LINES}行
- 数値・艇番・材料名は facts にあるものだけ。計算し直さない、丸め直さない、足さない
- 「問いへの答え」と「このレースにとっての意味（向き）」を数値で比べて書く。書き写しだけにしない
- ぼかし語（半分・多い・少ない・かなり・やや・ほぼ 等）を使わない。予想の断定・保証（必ず・絶対・稼げる 等）、「競艇」「この選手」を使わない
- 前の拍の答えと自然につなぐ。step が変わった最初の拍は、つなぐ語（一方・さらに・同じく・また 等）で始めない。「同じく」「こちらも」は前の拍と同じ材料のときだけ
- 拍の種類: overview＝6艇全体で2位以内の項目の数、focus＝その艇が何で上位か、card＝1号艇の材料のカード（今日の順位のときの1着率、全体との差）、empty＝差が大きいカードが無い
- 文型の版（template）は参考。同じでもよい

出力は JSON だけ（前後に説明を書かない）: {"beats":[{"id":"…","lines":["…","…"]}]}

拍:
${JSON.stringify(beats.map(({ id, step, facts, template }) => ({ id, step, facts, template })), null, 1)}`;

/** 既定の LLM 呼び出し: Claude Code の非対話モード（API キー不要、ログイン済みの claude で動く） */
export function claudeCli(prompt, { model = "sonnet" } = {}) {
  const out = execFileSync("claude", ["-p", "--model", model, "--output-format", "json"], {
    input: prompt,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const res = JSON.parse(out);
  if (res.is_error) throw new Error(`LLM の呼び出しが失敗: ${res.result}`);
  return res.result;
}

function parseJson(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) throw new Error("LLM の出力に JSON が無い");
  return JSON.parse(m[0]);
}

/** 文型の版の文の JSON */
export function templateText(scene) {
  const beats = beatsOf(scene);
  return {
    mode: "template",
    answers: Object.fromEntries(beats.map((b) => [b.id, b.template])),
    beats: beats.map((b) => ({ id: b.id, source: "template", lines: b.template })),
  };
}

/**
 * 整えた版の文の JSON。LLM が使えない・JSON が壊れているときは全拍を文型の版に戻す（理由を残す）
 * @param {object} scene
 * @param {(prompt: string) => string} llm
 */
export function polishedText(scene, llm = claudeCli) {
  const beats = beatsOf(scene);
  let got = {};
  let callError = null;
  try {
    const parsed = parseJson(llm(PROMPT(beats)));
    got = Object.fromEntries((parsed.beats ?? []).map((b) => [b.id, b.lines]));
  } catch (e) {
    callError = e instanceof Error ? e.message : String(e);
  }
  const rows = beats.map((b, i) => {
    const prev = i > 0 && beats[i - 1].step === b.step ? beats[i - 1].facts : null;
    const draft = got[b.id];
    const reasons = callError ? [callError] : draft === undefined ? ["LLM の出力にこの拍が無い"] : checkLines(draft, b.facts, prev);
    return reasons.length
      ? { id: b.id, source: "template", lines: b.template, rejected: draft ?? null, reasons }
      : { id: b.id, source: "llm", lines: draft };
  });
  return { mode: "polished", answers: Object.fromEntries(rows.map((r) => [r.id, r.lines])), beats: rows };
}
