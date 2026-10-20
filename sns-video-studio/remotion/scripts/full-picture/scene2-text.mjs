/**
 * 全貌動画の答えの文（2段）。
 * (1) 文型の版: facts だけから決まった文型で作る（各場面の build の lines）。比べる文はこれで固定する
 * (2) つないだ版: LLM は「前の拍とつなぐ語」（一方・さらに 等の決まった語）を選ぶだけ。文型の文は変えない。
 *     検査に落ちた拍はつなぐ語を付けない（文型の版のまま。全体は止めない）
 *     2026-10-20 オーナー決定: LLM が文を整える版はやめる（4レース178拍で文型と違った4拍が4拍とも劣化した。wording-editor）
 * 文は描画の前に1度だけ作って JSON に保存し、描画はその JSON から行う（同じ JSON なら同じ MP4）。評価役の LLM は関門にしない。
 */
import { execFileSync } from "node:child_process";
import { FACT_ITEMS } from "../../../../src/utils/analogyFacts.js";
import { t } from "./scene2-data.mjs";
import { checkRiskRules } from "../../../../scripts/lib/riskRules.js";
import { lineWidth } from "../../src/fullPicture/scene2Timeline.js";

export { MAX_WIDTH } from "./fit.mjs";
import { MAX_WIDTH } from "./fit.mjs";
export { lineWidth };
export const MAX_LINES = 2;
/**
 * 禁止表現は risk-rules.json（sns-video-studio/remotion/risk-rules.json）を正本にして読む。字幕と投稿本文で同じ判定にする。
 * 場面の型の規則（字幕で選手を「この選手」と呼ばない）だけはここに置く
 */
const CONTRACT_BANNED = ["この選手"];
export function bannedIn(text, platform = "x") {
  return [
    ...checkRiskRules(text, platform).map((r) => `禁止表現「${r.matchedPattern}」（${r.id}）`),
    ...CONTRACT_BANNED.filter((w) => text.includes(w)).map((w) => `型の禁止「${w}」`),
  ];
}
/** ぼかし語（数値で比べずに量を言う語） */
const VAGUE = ["半分", "多い", "少ない", "多め", "少なめ", "かなり", "やや", "ほぼ", "結構", "わりと", "圧倒的", "大差", "僅差", "わずか", "少し", "ちょっと", "大きく", "大幅"];
/**
 * 文に使ってよい語（facts の値・材料名・艇番・順位・数を除いた残り）。比べる語・向き・場面の決まった言い回しだけ。
 * LLM の文の残りがこの語と助詞・記号で区切り切れなければ「facts に無い言い回し」として文型の版に戻す
 * （「6艇で差がつく」のような、facts に無い主張・評価を止める。2026-10-20 オーケストレーター指摘）
 */
export const VOCAB = [
  // 比べる・並べる
  "2位以内", "項目", "最多", "最少", "次", "次いで", "2番手", "番手", "一番上", "最上位", "上位", "下位", "同じ", "同値", "並ぶ", "並び",
  "ほか", "すべて", "全て", "差", "ポイント", "未満", "以上", "以下", "上回る", "下回る", "上回り", "下回り", "高い", "低い", "高く", "低く",
  "より", "まで", "中", "全体", "今日", "1着率", "順位", "当てはめない", "当てはめず", "参考", "枠順", "近く", "点の順",
  "比べられない", "値が無い", "値が無く", "材料", "差が大きい", "差が小さい", "重なる", "記録", "無い", "なし",
  "とき", "場合", "次点", "各", "3つ", "以内",
  // 場面1（条件）
  // 場面6（機力と調子）
  "号機", "前走", "展示", "最速", "今節", "平均", "一番", "そのとき", "▲", "付いた", "札", "機力", "調子",
  // 場面5（相手）
  "なら", "最高", "相手",
  // 場面4（展開）
  "前付けあり（1号艇イン）", "前付けあり", "割合", "並び", "前付けがあっても", "インを守った", "内訳", "うち", "平均ST", "このコース", "一致", "一致する形が無い", "横一線", "候補", "を参考に", "逃げ", "結果", "内3艇そろう", "2コース凹み", "カド受け凹み", "カド一撃", "イン凹み", "ダッシュ",
  "6号艇だけ前付け", "5号艇だけ前付け", "5・6号艇が前付け", "その他の前付け",
  // 場面3（軸）
  "全国・級の並びが同じ", "級の並びが同じ", "準優勝戦", "優勝戦", "走", "1着率", "全会場", "単勝回収率", "複勝回収率", "回収率", "単勝", "複勝",
  // 場面2b（類似レース）
  "類似レース", "着", "3連単", "-",
  "全国", "連率", "逃げ率", "風", "この風", "風を問わず", "日", "R", "傾向", "会場", "未満",
  // 単位
  "秒", "%", "％", "点", "艇", "件",
];
/** 1字でよい語（助詞・記号）。これ以外の1字は語にしない（「差がつく」の「つ」「く」を通さない） */
const PARTICLES = new Set([..."はがのでともにをへや、。・，,（）()／/ 　→〜~-"]);

/** text を語と助詞で区切り切れるか（区切り切れない最初の部分を返す。切れれば null） */
export function uncovered(text, words) {
  const ws = [...new Set(words)].filter(Boolean).sort((a, b) => b.length - a.length);
  const chars = [...text];
  const ok = new Array(chars.length + 1).fill(false);
  ok[0] = true;
  for (let i = 0; i < chars.length; i++) {
    if (!ok[i]) continue;
    if (PARTICLES.has(chars[i]) || chars[i] === "＿") ok[i + 1] = true;
    const restText = chars.slice(i).join("");
    for (const w of ws) if (restText.startsWith(w)) ok[i + [...w].length] = true;
  }
  if (ok[chars.length]) return null;
  // 届いた一番先から、次に届く所までを返す
  let last = 0;
  for (let i = 0; i <= chars.length; i++) if (ok[i]) last = i;
  let end = last + 1;
  while (end < chars.length && !ok[end]) end++;
  return chars.slice(last, end).join("");
}

/** 数字を含む決まった言い回し（facts の数として数えない） */
const FIXED_NUMBER_PHRASES = /6艇|1着率|2番手|2連率|3連率|90日|1ポイント未満|[1-3]着/g;

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
      // 画面と同じ小数1桁で文に出す数（72 → 72.0）
      nums.add(v.toFixed(1));
      if (["boat", "leaders", "boats"].includes(key)) boats.add(v);
      if (["compareRanks", "todayRank", "withinRank", "todayRankRef"].includes(key)) ranks.add(`${v}位`);
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

/** facts の中の文字の値（数を除く。例 「準優勝戦の日」「0.12秒」の「秒」は単位の語で通る） */
function stringsOf(facts) {
  const out = [];
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === "object") return Object.values(v).forEach(walk);
    if (typeof v === "string" && !/^\d/.test(v)) out.push(v);
  };
  walk(facts);
  return out;
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
  why.push(...bannedIn(text));
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
  rest = rest.replace(FIXED_NUMBER_PHRASES, "＿");
  for (const m of rest.match(/\d+(?:\.\d+)?/g) ?? []) if (!nums.has(m)) why.push(`facts に無い数値「${m}」`);
  // 言い回し: facts の文字の値（例 準優勝戦の日）と決まった語・助詞だけで区切り切れること
  const masked = rest.replace(/\d+(?:\.\d+)?/g, "＿");
  const left = masked
    .split("\n")
    .map((l) => uncovered(l, [...VOCAB, ...CONNECTORS, ...stringsOf(facts)].map((w) => w.replace(/[1-6]号艇/g, "＿").replace(FIXED_NUMBER_PHRASES, "＿").replace(/\d+(?:\.\d+)?/g, "＿"))))
    .filter(Boolean);
  for (const u of left) why.push(`facts に無い言い回し「${u}」`);
  // 向き（高い・低い）は facts の向きと合う
  if (facts.direction && /高い|低い/.test(text) && !text.includes(facts.direction)) why.push(`向きが facts（${facts.direction}）と逆`);
  // 差1ポイント未満は向きを言わない（common.mjs の diffText。10/15 丸亀10R の整えた版が「0.2ポイント高い」と書いた。wording-editor 2026-10-20 P1）
  const small = [facts.diffPt, facts.usualDiffPt].some((d) => typeof d === "number" && d < 1);
  if (small && /ポイント(高い|低い|高く|低く)/.test(text)) why.push("差1ポイント未満で向き（高い・低い）を言った");
  // つなぐ語
  const head = lines[0];
  const conn = CONNECTORS.find((c) => head.startsWith(c));
  if (conn && !prev) why.push(`段の最初の拍でつなぐ語「${conn}」`);
  // 同じ材料か: 場面2は材料名（item）、段の場面は facts の種類（kind）で見る
  const topic = (f) => f?.item ?? f?.kind ?? null;
  if (conn && prev && SAME_ITEM_CONNECTORS.includes(conn) && (topic(prev) === null || topic(prev) !== topic(facts)))
    why.push(`「${conn}」だが前の拍と材料が違う（前: ${topic(prev) ?? "なし"}、今: ${topic(facts) ?? "なし"}）`);
  return why;
}

const PROMPT = (beats) => `あなたはボートレースのデータ動画の字幕に「前の拍とつなぐ語」を付ける係。字幕の文（lines）は決まっていて変えない。
各拍について、前の拍の答えとのつながりに合うつなぐ語を、次の語から1つ選ぶか、付けない（null）を選ぶ: ${CONNECTORS.join("・")}

規則:
- step が前の拍と違う拍（場面・段の最初）は null
- 「同じく」「こちらも」は前の拍と同じ材料（facts の item、無ければ kind）のときだけ
- 「逆に」は前の拍と向きが逆のときだけ。迷ったら null
- つなぐ語を付けると1行目が全角${MAX_WIDTH}字分を越える拍は null

出力は JSON だけ（前後に説明を書かない）: {"beats":[{"id":"…","connector":"一方"|null}]}

拍:
${JSON.stringify(beats.map(({ id, step, question, facts, template }) => ({ id, step, question, facts, lines: template })), null, 1)}`;

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

/** 全場面の拍（場面2 は beatsOf、段の場面は段ごと。答えの無い段＝場面8 のまとめカードは除く） */
export function allBeats(scenes) {
  return scenes.flatMap((x) =>
    x.kind === "scene2"
      ? beatsOf(x.data).map((b) => ({ ...b, step: `scene2-${b.step}` }))
      : (x.data?.steps ?? []).filter((s) => s.lines?.length).map((s) => ({ id: s.id, step: x.id, question: s.question, facts: s.facts, template: s.lines })),
  );
}

/** 文型の版の文の JSON（scene は場面2の材料、または allBeats の拍の並び） */
export function templateText(sceneOrBeats) {
  const beats = Array.isArray(sceneOrBeats) ? sceneOrBeats : beatsOf(sceneOrBeats);
  return {
    mode: "template",
    answers: Object.fromEntries(beats.map((b) => [b.id, b.template])),
    beats: beats.map((b) => ({ id: b.id, source: "template", lines: b.template })),
  };
}

/**
 * つないだ版の1拍の検査。文型の文は変えず、1行目の頭に決まったつなぐ語＋「、」を足しただけで、検査（checkLines）を通ること
 * @returns {string[]} 落ちた理由（空なら合格）
 */
export function checkConnected(connector, template, facts, prev) {
  if (connector === null || connector === undefined) return [];
  if (!CONNECTORS.includes(connector)) return [`決まったつなぐ語でない「${connector}」`];
  const lines = connectedLines(connector, template);
  return checkLines(lines, facts, prev);
}
export const connectedLines = (connector, template) =>
  connector ? [`${connector}、${template[0]}`, ...template.slice(1)] : template;

/**
 * つないだ版の文の JSON。LLM が使えない・JSON が壊れているときは全拍をつなぐ語なし（文型の版）にする（理由を残す）
 * @param {object[]|object} sceneOrBeats allBeats の拍の並び（または場面2の材料）
 * @param {(prompt: string) => string} llm
 */
export function connectedText(sceneOrBeats, llm = claudeCli) {
  const beats = Array.isArray(sceneOrBeats) ? sceneOrBeats : beatsOf(sceneOrBeats);
  let got = {};
  let callError = null;
  try {
    const parsed = parseJson(llm(PROMPT(beats)));
    got = Object.fromEntries((parsed.beats ?? []).map((b) => [b.id, b.connector ?? null]));
  } catch (e) {
    callError = e instanceof Error ? e.message : String(e);
  }
  const rows = beats.map((b, i) => {
    const prev = i > 0 && beats[i - 1].step === b.step ? beats[i - 1].facts : null;
    const c = got[b.id] ?? null;
    const reasons = callError ? [callError] : checkConnected(c, b.template, b.facts, prev);
    if (reasons.length) return { id: b.id, source: "template", lines: b.template, rejected: c, reasons };
    return { id: b.id, source: c ? "connected" : "template", connector: c, lines: connectedLines(c, b.template) };
  });
  return { mode: "connected", answers: Object.fromEntries(rows.map((r) => [r.id, r.lines])), beats: rows };
}
