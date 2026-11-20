/**
 * ブログの図の契約の検査の部品（src/utils/blogChartContract.js の validateBlogChart が使う）。
 * 誤りは { path, message } を積んでいき、最初の1件で止めない。
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const isObj = (v) =>
  typeof v === "object" && v !== null && !Array.isArray(v);
export const show = (v) => (v === undefined ? "（無し）" : JSON.stringify(v));

/** 文字列か { ja, en, ... } を、その言語の文字にする。無ければ ja */
export function localize(text, lang = "ja") {
  if (typeof text === "string") return text;
  if (isObj(text)) return text[lang] ?? text.ja;
  return "";
}

/**
 * 検査の文脈。langs はこの JSON を参照する記事の言語、allLangs は契約の言語、bannedWords は図に書かない語
 * @returns {{ errors: { path: string, message: string }[], err: Function, keysOnly: Function, text: Function, key: Function, date: Function }}
 */
export function createChecker({ langs, allLangs, bannedWords }) {
  const errors = [];
  const c = { errors, langs, allLangs, bannedWords };
  c.err = (path, message) => errors.push({ path, message });
  c.keysOnly = (obj, path, allowed) => keysOnly(c, obj, path, allowed);
  c.text = (v, path, opts) => text(c, v, path, opts);
  c.key = (v, path) => {
    if (typeof v !== "string" || v === "")
      c.err(path, `文字列の key / 実際: ${show(v)}`);
  };
  c.date = (v, path) => date(c, v, path);
  return c;
}

function keysOnly(c, obj, path, allowed) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k))
      c.err(
        `${path}.${k}`.replace(/^\./, ""),
        `契約に無いキー（使えるのは ${allowed.join("・")}）`,
      );
  }
}

function text(c, v, path, { min = 1, max, required = true } = {}) {
  if (v === undefined && !required) return;
  const variants = typeof v === "string" ? { ja: v } : v;
  if (!isObj(variants) || typeof variants.ja !== "string") {
    c.err(path, `文字列か { "ja": "…" } / 実際: ${show(v)}`);
    return;
  }
  c.keysOnly(variants, path, c.allLangs);
  for (const [lang, value] of Object.entries(variants)) {
    if (typeof value !== "string")
      c.err(`${path}.${lang}`, `文字列 / 実際: ${show(value)}`);
  }
  textLangs(c, v, variants, path);
  for (const [lang, s] of Object.entries(variants)) {
    if (typeof s !== "string") continue;
    textLength(c, { v, path, lang, s, min, max });
  }
}

/** ja 以外の記事から参照されるなら、その言語の文字が要る */
function textLangs(c, v, variants, path) {
  const { langs } = c;
  if (typeof v !== "string") {
    for (const lang of langs.filter((l) => l !== "ja")) {
      if (typeof variants[lang] !== "string")
        c.err(
          `${path}.${lang}`,
          `${lang} の記事から参照されるので ${lang} の文字が要る`,
        );
    }
  } else if (langs.some((l) => l !== "ja")) {
    c.err(
      path,
      `${langs.filter((l) => l !== "ja").join("・")} の記事から参照されるので { "ja": …, "${langs.find((l) => l !== "ja")}": … } で書く`,
    );
  }
}

/** 字数と禁止語 */
function textLength(c, { v, path, lang, s, min, max }) {
  const len = [...s].length;
  if (len < min || (max && len > max))
    c.err(
      `${path}${typeof v === "string" ? "" : `.${lang}`}`,
      `${min}〜${max ?? "∞"}字 / 実際: ${len}字`,
    );
  for (const w of c.bannedWords)
    if (s.includes(w)) c.err(path, `「${w}」は図に書かない（画面に出る）`);
}

function date(c, v, path) {
  // 2026-02-30 のような無い日付は Date.parse が通すので、往復して同じ日付に戻るかで見る
  const ok =
    typeof v === "string" &&
    DATE_RE.test(v) &&
    !Number.isNaN(Date.parse(v)) &&
    new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
  if (!ok) c.err(path, `YYYY-MM-DD（ある日付） / 実際: ${show(v)}`);
}
