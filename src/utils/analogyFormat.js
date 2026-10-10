/**
 * アナロジー・ファインダー v16 の表記（BOA-271 screens「純粋関数」）。
 * 日付「2019/4/1」、平均ST「.133」・展示 F「F.09」、割合と件数「36%（16/45）」、進入「231/456」、
 * 範囲の名前（spec「数えるレース」の画面の名前）。文の組み立ては i18n の t を受け取る。
 */
import { STADIUM_NAMES } from "../constants/index.js";
import { parseScopeKey } from "./analogyFacts.js";

/** "2019-04-01" → "2019/4/1"（文字列の中の日付をすべて） */
export const fmtDate = (v) =>
  String(v ?? "").replace(
    /(\d{4})-(\d{2})(?:-(\d{2}))?/g,
    (_, y, m, d) => `${y}/${Number(m)}${d ? `/${Number(d)}` : ""}`,
  );

/** 0.1333 → ".133"（3桁）。無ければ "—" */
export const fmtSt3 = (v) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? "—"
    : `${v < 0 ? "-" : ""}.${String(Math.round(Math.abs(v) * 1000)).padStart(3, "0")}`;

/** 展示 ST（2桁）。F は負で持つので「F.09」 */
export const fmtExhSt = (v) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const s = `.${String(Math.round(Math.abs(v) * 100)).padStart(2, "0")}`;
  return v < 0 ? `F${s}` : s;
};

/** 割合（0〜1）→ "65.5%"（digits 桁）。null は "—" */
export const fmtPct = (p, digits = 0) =>
  p === null || p === undefined || !Number.isFinite(p)
    ? "—"
    : `${(p * 100).toFixed(digits)}%`;

/** 件数の区切り（1,134） */
export const fmtCount = (n) =>
  n === null || n === undefined ? "—" : Number(n).toLocaleString("ja-JP");

/** [当たり, 母数] → "36%（16/45）"。母数0は "—" */
export const fmtRateCount = (pair) =>
  pair && pair[1]
    ? `${fmtPct(pair[0] / pair[1])}（${fmtCount(pair[0])}/${fmtCount(pair[1])}）`
    : "—";

/**
 * 艇番順のコース → コース順の艇番の「231/456」。分からないコースは「-」
 * @param {(number|null)[]} courseByBoat
 */
export function fmtEntry(courseByBoat) {
  if (!Array.isArray(courseByBoat)) return "—";
  const byCourse = [1, 2, 3, 4, 5, 6].map((c) => {
    const b = courseByBoat.indexOf(c);
    return b >= 0 ? String(b + 1) : "-";
  });
  return `${byCourse.slice(0, 3).join("")}/${byCourse.slice(3).join("")}`;
}

/** 会場名（i18n の venues.{code}、無ければ日本語の名前） */
export const venueLabel = (code, t) =>
  t(`venues.${Number(code)}`, STADIUM_NAMES[Number(code)] ?? String(code));

const CLASSES = ["A1", "A2", "B1", "B2"];

/**
 * 級別の構成 [A1, A2, B1, B2 の艇数] → 「A1が2艇・A2が1艇・B1が3艇」「6艇ともA1」
 * @returns {{text:string, uniform:boolean}}
 */
export function comboLabel(combo, t) {
  const six = combo.findIndex((n) => n === 6);
  if (six >= 0)
    return {
      text: t("aiPredictionTab.analogy.scopeNames.allSame", {
        cls: CLASSES[six],
      }),
      uniform: true,
    };
  return {
    text: combo
      .map((n, i) =>
        n > 0
          ? t("aiPredictionTab.analogy.scopeNames.classCount", {
              cls: CLASSES[i],
              n,
            })
          : null,
      )
      .filter(Boolean)
      .join(t("aiPredictionTab.analogy.listSeparator")),
    uniform: false,
  };
}

/**
 * 範囲キー → 画面の名前（spec「数えるレース」の表）
 * 例「若松・6艇ともA1」「全国・A1が2艇・A2が1艇・B1が3艇（1号艇はA1）の優勝戦」「若松の全レース」
 * short: true なら級別の組み合わせを「同じ級別の組み合わせ」と書く（例「桐生・同じ級別の組み合わせ」）
 */
export function scopeName(key, t, { short = false } = {}) {
  const s = parseScopeKey(key);
  const k = "aiPredictionTab.analogy.scopeNames";
  if (s.kind === "VA")
    return t(`${k}.venueAll`, { venue: venueLabel(s.venue, t) });
  if (s.kind === "VG")
    return t(`${k}.venueG1`, { venue: venueLabel(s.venue, t) });
  if (s.kind === "NA") return t(`${k}.nationalAll`);
  const c = comboLabel(s.combo, t);
  const where = s.kind === "VC" ? venueLabel(s.venue, t) : t(`${k}.national`);
  // 短い表記（範囲の札・凡例・大きい数字の見出し）は「同じ級別の組み合わせ」とだけ書き、中身は札の下の
  // 絵と1文で示す（承認モック sonar-tab v3）。6艇とも同じ級別のときは元から短いのでそのまま
  const sel =
    c.uniform || short ? "" : t(`${k}.selected`, { boat: s.boat, cls: s.cls });
  const combo = short && !c.uniform ? t(`${k}.sameCombo`) : c.text;
  const base = t(`${k}.combo`, { where, combo, selected: sel });
  return s.kind === "NCR"
    ? t(`${k}.withRound`, {
        base,
        round: t(`aiPredictionTab.analogy.rounds.${s.round}`),
      })
    : base;
}

/** 今日の値の表記（承認版モックの fmtV） */
export function fmtFactValue(key, v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (key === "recent_win30") return `${Math.round(v * 100)}%`;
  if (key === "motor_2" || key === "boat_2") return `${v.toFixed(1)}%`;
  return v.toFixed(2);
}

/**
 * 説明文を1文ずつに分ける（説明・注記・脚注を箇条書きにするため。2026-10-06 ユーザー決定）。
 * 「。」（日本語・中国語）と「. 」（英語・韓国語）の後で分け、括弧（（）・()・「」・『』）の中では分けない。
 * 文言は変えない（区切りの記号も残す）
 * @param {string} text
 * @returns {string[]}
 */
export function splitSentences(text) {
  if (!text) return [];
  const open = "（(「『";
  const close = "）)」』";
  const out = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    cur += ch;
    if (open.includes(ch)) depth += 1;
    else if (close.includes(ch)) depth = Math.max(0, depth - 1);
    else if (
      depth === 0 &&
      (ch === "。" || (ch === "." && text[i + 1] === " "))
    ) {
      out.push(cur.trim());
      cur = "";
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * 「6艇中5位」。記録の無い艇（当地勝率 0.00 など）がいるときは「記録のある5艇中5位（一番低い）」（BOA-802、
 * 2026-10-10 ユーザー決定）。七角形の点の位置・棒の枠は区分（一番低い＝6）のままなので、一番下には言葉を添える
 */
export function factRankText(t, r, bad) {
  if (r.of >= 6)
    return r.from === r.to
      ? t(`aiPredictionTab.analogy.facts.rankOf6`, { n: r.from })
      : t(`aiPredictionTab.analogy.facts.rankOf6Tie`, {
          from: r.from,
          to: r.to,
          same: r.same,
        });
  const base =
    r.from === r.to
      ? t(`aiPredictionTab.analogy.facts.rankOfRec`, { k: r.of, n: r.from })
      : t(`aiPredictionTab.analogy.facts.rankOfRecTie`, {
          k: r.of,
          from: r.from,
          to: r.to,
          same: r.same,
        });
  return r.to === r.of && r.of > 1
    ? base +
        t(`aiPredictionTab.analogy.facts.rankLast`, {
          w: t(`aiPredictionTab.analogy.facts.words.${bad}`),
        })
    : base;
}
