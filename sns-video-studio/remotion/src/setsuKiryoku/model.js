/**
 * YouTube Shorts「節の機力」（format setsu_kiryoku_short）の型の決まり。描画（SetsuKiryoku.jsx）と検査（verify-setsu-kiryoku.js）が同じ関数を使う。
 * remotion を import しない（CI の Node から読むため）。
 *
 * 依頼の正本: hq drafts/venue-shorts-request-20261031.md（10/31 オーナー承認）。bundle.json は hq が置き、ここは値だけで描く（LLM なし）。
 * 型は3つ: motor_gap（予選2〜3日目）・motor_up（予選4日目以降）・final_six（優勝戦の前日）。
 *
 * texts.hook・texts.close の要素は文字列（白）か { "text": "…", "em": true }（金・大きい字）。
 * final_six の6艇は bundle.six（この型で足した形。hq の束の形が決まったら合わせる）:
 *   [{ "boat": 6, "racer": "金田 智博", "motor": 60, "runs": [run...], "semi": run|null }]（run は runs と同じ形）
 *
 * 4つ目の型 border（「準優に残れるか」、SG/G1 の予選最終日の朝だけ。hq drafts/shorts-border-person-20261031.md、10/31 オーナー決定）。
 * 節の機力とは別の型だが、同じ composition の variant にした。この型で足した形（hq の束の形が決まったら合わせる）:
 *   "border": { "cut": 18, "line": 6.0 }（準優に残れる人数と、前夜のその順位の得点率）
 *   "racers": [{ "rank": 19, "racer": "峰 竜太", "rate": 5.8, "race": "11R", "boat": 4, "need": "2着以上", "tied": false }]（ボーダー際の3人。tied は任意、true で「同率20位」）
 *   need（要る着）は hq の集計が出す。ここでは形（「N着以上」「1着だけ」）と並び（順位は cut より下・得点率は line より下）だけ確かめる
 */

export const W = 1080;
export const H = 1920;
export const FPS = 30;
/** 文字を置いてよい範囲（Shorts の下の帯 y1450〜と右のボタン列 x960〜を避ける。依頼の done_when） */
export const SAFE = { right: 940, bottom: 1400 };
/** 字の最小（video-composition.md「字は最小36px相当」） */
export const MIN_FONT = 36;
/** 中央寄せの文の中心と幅（右の 940 を越えないよう 540±360） */
export const CX = 540;
export const CENTER_MAX_W = 720;
/** 左寄せの文の幅（60〜900） */
export const LEFT = 60;
export const RIGHT = 900;

export const VARIANTS = ["motor_gap", "motor_up", "final_six", "border"];

/** 章（秒）。依頼文 1節の表どおり。final_six は見本（hq trial）の 3.2/6.5/3.5/2.8 を15秒に詰めた */
export const CHAPTERS = {
  motor_gap: [
    { id: "hook", sec: 3 },
    { id: "runs", sec: 5 },
    { id: "rate", sec: 4 },
    { id: "close", sec: 3 },
  ],
  motor_up: [
    { id: "hook", sec: 3 },
    { id: "chart", sec: 6 },
    { id: "halves", sec: 3 },
    { id: "close", sec: 3 },
  ],
  final_six: [
    { id: "hook", sec: 3 },
    { id: "six", sec: 6.5 },
    { id: "semi", sec: 3 },
    { id: "close", sec: 2.5 },
  ],
  // 見本 hq drafts/shorts-border-person/sheet-border.png の 0〜4・4〜11・11〜15秒
  border: [
    { id: "hook", sec: 4 },
    { id: "three", sec: 7 },
    { id: "close", sec: 4 },
  ],
};

export function timeline(variant) {
  const list = CHAPTERS[variant];
  if (!list) throw new Error(`知らない型: ${variant}`);
  let from = 0;
  const chapters = list.map((c) => {
    const len = Math.round(c.sec * FPS);
    const out = { ...c, from, len };
    from += len;
    return out;
  });
  return { chapters, total: from };
}

/** 各章の代表のコマ（静止画の見本用）。章の動きが済んだ後 */
export const stillFrames = (variant) =>
  timeline(variant).chapters.map((c) => ({
    id: c.id,
    frame: c.from + c.len - 12,
  }));

// ---------- 文字の幅（推定。描画と検査で同じ値を使う。実際の幅は描画のときに DOM で確かめる） ----------

/** 1字の幅（字の大きさに対する比）。英数字・記号は半角で 0.62、空白 0.3、他は全角 1.0（Noto Sans JP の太字より広めに見る） */
function charUnit(ch) {
  if (ch === " ") return 0.3;
  if (/[\x21-\x7e]/.test(ch)) return 0.62;
  return 1;
}
export const textUnits = (s) => [...s].reduce((a, ch) => a + charUnit(ch), 0);
export const estWidth = (s, size) => textUnits(s) * size;

/** 幅に収まる大きさ（max まで）。min（36px）を下回るなら null */
export function fitSize(text, maxW, max, min = MIN_FONT) {
  const u = textUnits(text);
  const size = u ? Math.min(max, Math.floor(maxW / u)) : max;
  return size >= min ? size : null;
}

// ---------- 値の整形 ----------

export const lineText = (l) => (typeof l === "string" ? l : l.text);
export const lineEm = (l) => typeof l !== "string" && l.em === true;
/** 平均の順位: 3 → "3.0"、1.25 → "1.25" */
export const fmtAvg = (v) =>
  Math.round(v * 100) % 10 === 0 ? v.toFixed(1) : v.toFixed(2);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
export const courseAvg = (courses) => Math.round(mean(courses) * 10) / 10;
/** 日の札: 1日なら「27日」、2日なら「27・28日」、3日以上なら「29〜31日」 */
export function daysLabel(runs) {
  const days = [...new Set(runs.map((r) => String(r.day).replace(/日$/, "")))];
  if (days.length === 1) return `${days[0]}日`;
  // 月をまたぐ節（30・31・1日）は日の数が戻るので「〜」にしない（逆向きの範囲に読める。/code-review）
  const rising = days.every(
    (d, i) => i === 0 || Number(d) === Number(days[i - 1]) + 1,
  );
  if (days.length === 2 || !rising) return `${days.join("・")}日`;
  return `${days[0]}〜${days[days.length - 1]}日`;
}
/** motor_up の前半・後半（halves の courses の数で runs を切る） */
export function splitHalves(b) {
  const k = b.halves.early.courses.length;
  return { early: b.runs.slice(0, k), late: b.runs.slice(k) };
}
/** final_six の1行の数（走数・1位の回数・平均） */
export function sixStats(row) {
  const n = row.runs.length;
  return {
    n,
    wins: row.runs.filter((r) => r.rank === 1).length,
    avg: mean(row.runs.map((r) => r.rank)),
  };
}
export const tagText = (b) =>
  b.variant === "final_six"
    ? `${b.venue} 優勝戦の前日`
    : b.variant === "border"
      ? `${b.venue} ${b.grade} 予選最終日`
      : `${b.venue} ${b.grade} 開催中`;
export const closeTail = (b) =>
  b.variant === "border"
    ? "得点率の表は 龍神レーダーで"
    : "節の機力は龍神レーダーで";
/** 得点率の書き方（6 → "6.00"） */
export const fmtRate = (v) => v.toFixed(2);
/** border の順位の札。tied（同率、hq の BR02 が出す）なら「同率20位」 */
export const rankLabel = (r) => `${r.tied === true ? "同率" : ""}${r.rank}位`;

// ---------- 配置（描画と検査で同じ値） ----------

/**
 * 中央寄せの文の並び（hook・close）。各行の大きさと y。
 * afterEm: 金の行より後の白い行（close の「準優・優勝戦の展示も見る」等の添え）の大きさの上限と、前の空き（見本 mk.py と同じ間）
 */
export function stackLayout(
  lines,
  { top, plainMax, emMax, gap = 0.3, afterEm = null },
) {
  let y = top;
  let seenEm = false;
  return lines.map((l) => {
    const text = lineText(l);
    const em = lineEm(l);
    const note = afterEm && seenEm && !em;
    if (note) y += afterEm.space;
    const size = fitSize(
      text,
      CENTER_MAX_W,
      em ? emMax : note ? afterEm.max : plainMax,
    );
    const box = { text, em, size, y };
    y += (size ?? MIN_FONT) * (1 + gap);
    seenEm = seenEm || em;
    return box;
  });
}

export function hookLayout(b) {
  const lines = stackLayout(b.texts.hook, {
    top: 320,
    plainMax: 72,
    emMax: 120,
    gap: 0.4,
  });
  const last = lines[lines.length - 1];
  const subY = last ? last.y + (last.size ?? MIN_FONT) * 1.3 + 40 : 320;
  const sub =
    b.variant === "final_six" || b.variant === "border"
      ? null
      : `${b.racer} ・ モーター${b.motor}`;
  return {
    lines,
    sub: sub
      ? { text: sub, size: fitSize(sub, CENTER_MAX_W, 56), y: subY }
      : null,
  };
}

export function closeLayout(b) {
  const lines = stackLayout(b.texts.close, {
    top: 480,
    plainMax: 80,
    emMax: 100,
    gap: 0.3,
    afterEm: { max: 56, space: 100 },
  });
  const last = lines[lines.length - 1];
  const tailY = Math.max(
    1100,
    last ? last.y + (last.size ?? MIN_FONT) * 1.25 + 120 : 1100,
  );
  return { lines, tail: { text: closeTail(b), size: 48, y: tailY } };
}

/** motor_gap の表: 行の高さ（7走で140、多いと詰める） */
export const RUNS_TOP = 390;
export const runsRowH = (n) => Math.min(140, Math.floor((1360 - RUNS_TOP) / n));

/** 2連率の棒（x 90〜890、基準の線 y1250、最大の棒の高さ 620） */
export const BARS = { x0: 90, x1: 890, base: 1250, maxH: 620 };
export function barsLayout(b) {
  const all = [...b.motor_2rate.all].sort((a, c) => a - c);
  const n = all.length;
  const pitch = (BARS.x1 - BARS.x0) / n;
  const max = all[n - 1];
  const idx = b.motor_2rate.rank_from_bottom - 1;
  const bars = all.map((v, i) => ({
    x: BARS.x0 + i * pitch,
    w: Math.max(2, pitch * 0.72),
    h: (v / max) * BARS.maxH,
    hit: i === idx,
  }));
  const hit = bars[idx];
  const label = `${b.motor_2rate.value}%`;
  const sub = `下から${b.motor_2rate.rank_from_bottom}番目`;
  const labelW = Math.max(estWidth(label, 56), estWidth(sub, 40));
  const cx = Math.min(
    Math.max(hit.x + hit.w / 2, LEFT + labelW / 2),
    RIGHT - labelW / 2,
  );
  return {
    bars,
    label,
    sub,
    labelX: cx - labelW / 2,
    labelW,
    labelY: BARS.base - hit.h - 150,
  };
}

/** motor_up の線（x 150〜880、1位 y420〜6位 y1180） */
export const CHART = { x0: 210, x1: 880, y0: 420, y1: 1180 };
export function chartPoints(runs) {
  const n = runs.length;
  return runs.map((r, i) => ({
    x:
      n === 1
        ? (CHART.x0 + CHART.x1) / 2
        : CHART.x0 + (i * (CHART.x1 - CHART.x0)) / (n - 1),
    y: CHART.y0 + ((r.rank - 1) * (CHART.y1 - CHART.y0)) / 5,
    ...r,
  }));
}

/** final_six の表（6行、順位の札は x440 から） */
export const SIX = {
  top: 340,
  rowH: 155,
  chipX: 440,
  chipRight: 920,
  chipW: 62,
};
/** 札の間隔: 最後の札の右端（chipX + (n-1)×間隔 + 札の幅）が chipRight を越えない最大（72まで） */
export function sixPitch(maxRuns) {
  const span = SIX.chipRight - SIX.chipX;
  const thin = Math.floor((span + 8) / maxRuns); // 札の幅 = 間隔 − 8 のとき
  const wide =
    maxRuns > 1 ? Math.floor((span - SIX.chipW) / (maxRuns - 1)) : 72; // 札の幅 = 62 のとき
  // 両方の上限の小さい方なら、札の幅がどちらになっても右端を越えない
  return Math.min(72, thin, wide);
}
/** 札の幅（間を8px以上空ける。走が多いと札を細くする。/code-review: 8走で札が重なった） */
export const sixChipW = (pitch) => Math.min(SIX.chipW, pitch - 8);

// ---------- 検査（P0: 事実の誤り・禁止語・数字の不一致）。理由の配列を返す（空なら通る） ----------

/** 依頼文 5節の言い切りの語（画面・題・説明欄に書かない）。risk-rules.json の外の、この型の決まり */
export const ASSERTIVE_WORDS = [
  "足が良い",
  "足がいい",
  "上がった",
  "化けた",
  "節イチ",
];
/** リポジトリの言い方の規則の禁止語（AGENTS.md「言い方の規則」・docs/knowledge/glossary.md）。risk-rules.json に無いのでここで見る（Codex P1、#2076） */
export const BANNED_WORDS = ["数え", "似た", "似て", "ふつう", "いつも"];

/** 全角の英数字を半角に（数の照合・語の照合の前） */
const norm = (t) =>
  String(t).replace(/[Ａ-Ｚａ-ｚ０-９．]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

function runReasons(r, where) {
  const out = [];
  if (!r || typeof r !== "object") return [`${where}: 走が無い`];
  if (typeof r.day !== "string" || !/^\d{1,2}日$/.test(r.day))
    out.push(`${where}.day が「27日」の形でない: ${r.day}`);
  if (!isInt(r.course, 1, 6))
    out.push(`${where}.course が1〜6でない: ${r.course}`);
  if (!isInt(r.rank, 1, 6)) out.push(`${where}.rank が1〜6でない: ${r.rank}`);
  if (typeof r.time !== "number" || r.time < 6 || r.time > 8)
    out.push(`${where}.time が展示タイムの値でない: ${r.time}`);
  return out;
}

/** 画面に出る文（数字の照合と禁止語の対象） */
export function screenTexts(b) {
  const t = [...(b.texts?.hook ?? []), ...(b.texts?.close ?? [])].map(lineText);
  if (b.variant === "final_six")
    for (const r of b.six ?? []) t.push(String(r.racer ?? ""));
  else if (b.variant === "border")
    for (const r of b.racers ?? [])
      t.push(String(r.racer ?? ""), String(r.need ?? ""));
  else t.push(String(b.racer ?? ""));
  return t;
}

/** hook・close の文に出してよい数（bundle の値から作る）。ここに無い数が出たら「数字の不一致」 */
export function allowedNumbers(b) {
  const s = new Set(["1", "2", "3", "4", "5", "6"]);
  const add = (v) => v != null && s.add(String(v));
  const runsOf = (runs) => {
    add(runs.length);
    add(runs.filter((r) => r.rank === 1).length);
    for (const r of runs) add(String(r.day).replace(/日$/, ""));
  };
  if (b.variant === "border") {
    add(b.border?.cut);
    if (typeof b.border?.line === "number")
      [fmtRate(b.border.line), b.border.line.toFixed(1), b.border.line].forEach(
        add,
      );
    add((b.racers ?? []).length);
    for (const r of b.racers ?? []) {
      add(r.rank);
      if (typeof r.rate === "number")
        [fmtRate(r.rate), r.rate.toFixed(1), r.rate].forEach(add);
      add(String(r.race ?? "").replace(/R$/, ""));
      add(r.boat);
    }
  } else if (b.variant === "final_six") {
    for (const r of b.six ?? []) {
      runsOf(r.runs ?? []);
      add(r.motor);
      add(fmtAvg(sixStats(r).avg));
    }
    add((b.six ?? []).length);
  } else {
    runsOf(b.runs ?? []);
    add(b.motor);
  }
  if (b.variant === "motor_gap" && b.motor_2rate) {
    const v = b.motor_2rate.value;
    [
      v,
      Math.floor(v),
      Math.round(v),
      b.motor_2rate.rank_from_bottom,
      b.motor_2rate.n,
    ].forEach(add);
  }
  if (b.variant === "motor_up" && b.halves && b.runs) {
    const { early, late } = splitHalves(b);
    for (const h of [early, late]) runsOf(h);
    for (const k of ["early", "late"]) {
      add(fmtAvg(b.halves[k].avg));
      add(courseAvg(b.halves[k].courses));
      add(courseAvg(b.halves[k].courses).toFixed(1)); // 画面（Halves）は 3.0 の形で出す
    }
  }
  return s;
}

export function checkBundle(b, { rules = [], matchRiskRules = null } = {}) {
  const why = [];
  if (!b || typeof b !== "object") return ["bundle が無い"];
  if (b.format !== "setsu_kiryoku_short")
    why.push(`format が setsu_kiryoku_short でない: ${b.format}`);
  if (!VARIANTS.includes(b.variant))
    return [...why, `variant が ${VARIANTS.join("|")} でない: ${b.variant}`];
  for (const k of ["date", "venue", "as_of"])
    if (typeof b[k] !== "string" || !b[k]) why.push(`${k} が無い`);
  if (b.variant !== "final_six" && (typeof b.grade !== "string" || !b.grade))
    why.push("grade が無い");
  if (!Array.isArray(b.texts?.hook) || !b.texts.hook.length)
    why.push("texts.hook が無い");
  if (!Array.isArray(b.texts?.close) || !b.texts.close.length)
    why.push("texts.close が無い");
  for (const k of ["hook", "close"])
    (Array.isArray(b.texts?.[k]) ? b.texts[k] : []).forEach((l, i) => {
      const ok =
        typeof l === "string"
          ? l.length > 0
          : l &&
            typeof l === "object" &&
            typeof l.text === "string" &&
            l.text.length > 0;
      if (!ok)
        why.push(
          `texts.${k}[${i}] が文字列か { text, em } でない: ${JSON.stringify(l)}`,
        );
    });
  if (typeof b.youtube?.title !== "string" || !b.youtube.title)
    why.push("youtube.title が無い");
  if (typeof b.youtube?.description !== "string" || !b.youtube.description)
    why.push("youtube.description が無い");
  if (why.length) return why;

  if (b.variant === "border") {
    const bd = b.border;
    if (
      !bd ||
      !isInt(bd.cut, 1, 52) ||
      typeof bd.line !== "number" ||
      bd.line < 0 ||
      bd.line > 10
    )
      return [
        `border の cut（人数）・line（得点率）が無いか範囲の外: ${JSON.stringify(bd)}`,
      ];
    if (!Array.isArray(b.racers) || b.racers.length !== 3)
      return [`racers が3人でない: ${b.racers?.length}`];
    b.racers.forEach((r, i) => {
      if (typeof r.racer !== "string" || !r.racer)
        why.push(`racers[${i}].racer が無い`);
      if (!isInt(r.rank, bd.cut + 1, 60))
        why.push(`racers[${i}].rank（${r.rank}）が ${bd.cut} 位より下でない`);
      if (typeof r.rate !== "number" || r.rate >= bd.line || r.rate < 0)
        why.push(
          `racers[${i}].rate（${r.rate}）が線 ${fmtRate(bd.line)} より下でない`,
        );
      if (typeof r.race !== "string" || !/^([1-9]|1[0-2])R$/.test(r.race))
        why.push(`racers[${i}].race が「11R」の形でない: ${r.race}`);
      if (!isInt(r.boat, 1, 6))
        why.push(`racers[${i}].boat が1〜6でない: ${r.boat}`);
      if (r.tied !== undefined && typeof r.tied !== "boolean")
        why.push(`racers[${i}].tied が true・false か無しでない: ${JSON.stringify(r.tied)}`);
      if (typeof r.need !== "string" || !/^(1着だけ|[2-5]着以上)$/.test(r.need))
        why.push(`racers[${i}].need が「N着以上」「1着だけ」でない: ${r.need}`);
    });
    for (let i = 1; i < b.racers.length; i++)
      // 同じ順位は、両方が同率（tied）のときだけ許す
      if (b.racers[i].rank < b.racers[i - 1].rank || (b.racers[i].rank === b.racers[i - 1].rank && !(b.racers[i].tied === true && b.racers[i - 1].tied === true)))
        why.push("racers が順位の順でない");
  } else if (b.variant === "final_six") {
    if (!Array.isArray(b.six) || b.six.length !== 6)
      return [`six が6艇でない: ${b.six?.length}`];
    b.six.forEach((r, i) => {
      if (typeof r.racer !== "string" || !r.racer)
        why.push(`six[${i}].racer が無い`);
      if (r.boat != null && !isInt(r.boat, 1, 6))
        why.push(`six[${i}].boat が1〜6でない: ${r.boat}`);
      if (!Array.isArray(r.runs) || !r.runs.length)
        why.push(`six[${i}].runs が無い`);
      else
        r.runs.forEach((x, j) =>
          why.push(...runReasons(x, `six[${i}].runs[${j}]`)),
        );
      if (r.semi != null) why.push(...runReasons(r.semi, `six[${i}].semi`));
    });
  } else {
    if (typeof b.racer !== "string" || !b.racer) why.push("racer が無い");
    if (!Number.isInteger(b.motor)) why.push(`motor が整数でない: ${b.motor}`);
    if (!Array.isArray(b.runs) || !b.runs.length)
      return [...why, "runs が無い"];
    b.runs.forEach((x, j) => why.push(...runReasons(x, `runs[${j}]`)));
  }

  if (b.variant === "motor_gap") {
    const m = b.motor_2rate;
    if (!m || !Array.isArray(m.all) || !m.all.length)
      why.push("motor_2rate.all が無い");
    else {
      if (m.n !== m.all.length)
        why.push(`motor_2rate.n（${m.n}）が all の数（${m.all.length}）と違う`);
      if (!m.all.includes(m.value))
        why.push(`motor_2rate.value（${m.value}）が all に無い`);
      const fromBottom = 1 + m.all.filter((v) => v < m.value).length;
      if (m.rank_from_bottom !== fromBottom)
        why.push(
          `motor_2rate.rank_from_bottom（${m.rank_from_bottom}）が all から求めた ${fromBottom} と違う`,
        );
    }
  }
  if (b.variant === "motor_up") {
    const h = b.halves;
    if (!h?.early?.courses?.length || !h?.late?.courses?.length)
      why.push("halves.early・late の courses が無い");
    else if (h.early.courses.length + h.late.courses.length !== b.runs.length)
      why.push(
        `halves の走数（${h.early.courses.length}+${h.late.courses.length}）が runs の数（${b.runs.length}）と違う`,
      );
    else {
      const { early, late } = splitHalves(b);
      for (const [k, rs] of [
        ["early", early],
        ["late", late],
      ]) {
        const avg = mean(rs.map((r) => r.rank));
        if (Math.abs(avg - h[k].avg) > 0.005)
          why.push(
            `halves.${k}.avg（${h[k].avg}）が runs から求めた ${fmtAvg(avg)} と違う`,
          );
        if (rs.map((r) => r.course).join() !== h[k].courses.join())
          why.push(
            `halves.${k}.courses（${h[k].courses.join("・")}）が runs のコースと違う`,
          );
      }
    }
  }

  // 数字の不一致: hook・close に bundle の値から作れない数が出ていないか
  const ok = allowedNumbers(b);
  for (const t of [...b.texts.hook, ...b.texts.close].map(lineText).map(norm))
    for (const num of t.match(/\d+(?:\.\d+)?/g) ?? [])
      if (!ok.has(num))
        why.push(`画面の文の数「${num}」が bundle の値に無い: ${t}`);

  // 禁止語・言い切り・z（画面・題・説明欄）
  const screen = screenTexts(b);
  const all = [...screen, b.youtube.title, b.youtube.description];
  for (const t0 of all) {
    // 全角・空白の揺れで抜けないよう、risk-rules と同じく全角英数を半角に、空白を除いてから見る
    const t = norm(t0).replace(/[ \u3000]/g, "");
    for (const w of ASSERTIVE_WORDS)
      if (t.includes(w)) why.push(`言い切りの語「${w}」: ${t0.slice(0, 40)}`);
    for (const w of BANNED_WORDS)
      if (t.includes(w)) why.push(`禁止語「${w}」: ${t0.slice(0, 40)}`);
    if (/(^|[^A-Za-z])[zZ][=＝]/.test(t))
      why.push(`z を出している: ${t.slice(0, 40)}`);
  }
  if (matchRiskRules) {
    const fields = [
      ...screen.map((text) => ({ text, field: "body" })),
      { text: b.youtube.title, field: "body" },
      { text: b.youtube.description, field: "description" },
    ];
    for (const v of matchRiskRules(fields, "youtube", rules))
      why.push(`禁止表現（${v.id}）「${v.matchedPattern}」`);
  }

  // 字が最小の大きさで収まるか
  const fits = [
    ...hookLayout(b).lines,
    ...closeLayout(b).lines,
    closeLayout(b).tail,
  ];
  const sub = hookLayout(b).sub;
  if (sub) fits.push(sub);
  for (const l of fits)
    if (l.size == null)
      why.push(
        `文が ${CENTER_MAX_W}px に ${MIN_FONT}px で収まらない: ${l.text}`,
      );
  for (const l of fits)
    if (l.size != null && l.y + l.size * 1.3 > SAFE.bottom)
      why.push(`文が y${SAFE.bottom} を越える: ${l.text}`);
  if (b.variant === "final_six") {
    const maxRuns = Math.max(...b.six.map((r) => r.runs.length));
    if (sixPitch(maxRuns) < 50)
      why.push(`final_six の走数（${maxRuns}）が多く順位の札が入らない`);
  }
  return why;
}
