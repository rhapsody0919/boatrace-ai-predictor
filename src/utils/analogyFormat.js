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
 */
export function scopeName(key, t) {
  const s = parseScopeKey(key);
  const k = "aiPredictionTab.analogy.scopeNames";
  if (s.kind === "VA")
    return t(`${k}.venueAll`, { venue: venueLabel(s.venue, t) });
  if (s.kind === "VG")
    return t(`${k}.venueG1`, { venue: venueLabel(s.venue, t) });
  if (s.kind === "NA") return t(`${k}.nationalAll`);
  const c = comboLabel(s.combo, t);
  const sel = c.uniform ? "" : t(`${k}.selected`, { boat: s.boat, cls: s.cls });
  const where = s.kind === "VC" ? venueLabel(s.venue, t) : t(`${k}.national`);
  const base = t(`${k}.combo`, { where, combo: c.text, selected: sel });
  return s.kind === "NCR"
    ? t(`${k}.withRound`, {
        base,
        round: t(`aiPredictionTab.analogy.rounds.${s.round}`),
      })
    : base;
}
