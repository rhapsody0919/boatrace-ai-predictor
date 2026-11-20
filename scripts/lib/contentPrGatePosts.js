/**
 * 記事の PR の関門のうち、.md と JSON の対応・slug・featured の検査（純粋関数。contentPrGateEvaluate.js から使う）。
 * 契約: docs/operation/content-pr-contract.md
 */
import {
  CHART_JSON_RE,
  JA_JSON_RE,
  MD_RE,
  TRANSLATION_SUFFIX_RE,
  articleIdOf,
  isPlainObject,
} from "./contentPrGateCommon.js";

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// .md と JSON の対応（図の JSON は記事の .md と対にならない）
export function pairErrors(textFiles, existsAnywhere) {
  const errors = [];
  for (const f of textFiles.filter((t) => !CHART_JSON_RE.test(t.path))) {
    const id = articleIdOf(f.path);
    const jaJson = `src/data/blog-posts/${id}.json`;
    const jaMd = `public/blog/${id}.md`;
    if (f.kind === "md") {
      const isTranslation = TRANSLATION_SUFFIX_RE.test(f.path.match(MD_RE)[1]);
      if (isTranslation && !existsAnywhere.has(jaJson))
        errors.push(`[pair] ${f.path} の日本語版 ${jaJson} が無い`);
      if (!isTranslation && f.status === "A" && !existsAnywhere.has(jaJson))
        errors.push(`[pair] ${f.path} に対応する ${jaJson} が無い`);
    } else if (JA_JSON_RE.test(f.path)) {
      if (f.status === "A" && !existsAnywhere.has(jaMd))
        errors.push(`[pair] ${f.path} に対応する ${jaMd} が無い`);
    } else {
      if (f.json?.id !== id)
        errors.push(
          `[slug] ${f.path} の id "${f.json?.id}" がファイル名と違う`,
        );
      if (!existsAnywhere.has(jaJson))
        errors.push(`[pair] ${f.path} の日本語版 ${jaJson} が無い`);
    }
  }
  return errors;
}

// 足した日本語版 JSON の slug と featured
function newPostErrors(f, basePathSet) {
  const errors = [];
  const fileId = f.path.match(JA_JSON_RE)[1];
  const id = f.json?.id;
  if (id !== fileId)
    errors.push(`[slug] ${f.path} の id "${id}" がファイル名と違う`);
  if (typeof id !== "string" || !SLUG_RE.test(id))
    errors.push(
      `[slug] ${f.path} の id "${id}" が小文字英数字とハイフンの形でない`,
    );
  else if (TRANSLATION_SUFFIX_RE.test(id))
    errors.push(`[slug] ${f.path} の id "${id}" が翻訳の接尾辞で終わる`);
  for (const p of [
    `src/data/blog-posts/${fileId}.json`,
    `public/blog/${fileId}.md`,
  ]) {
    if (basePathSet.has(p))
      errors.push(`[slug] ${f.path} の id が base の ${p} と衝突する`);
  }
  if (f.json?.featured !== false)
    errors.push(`[featured] ${f.path} は新規なので featured=false にする`);
  if (isPlainObject(f.json) && "featuredRank" in f.json)
    errors.push(`[featured] ${f.path} は新規なので featuredRank を置かない`);
  return errors;
}

// 変えた日本語版 JSON の featured・featuredRank は base から変えない
function revisedPostErrors(f, base) {
  const baseText = base[f.path];
  if (baseText === undefined)
    return [`[featured] ${f.path} の base の中身が無い`];
  let baseJson;
  try {
    baseJson = JSON.parse(baseText);
  } catch (err) {
    return [
      `[featured] ${f.path} の base を JSON として読めない: ${err.message}`,
    ];
  }
  const errors = [];
  for (const k of ["featured", "featuredRank"]) {
    if (JSON.stringify(f.json?.[k]) !== JSON.stringify(baseJson?.[k])) {
      errors.push(`[featured] ${f.path} の ${k} を base から変えている`);
    }
  }
  return errors;
}

// slug と featured（日本語版 JSON）
export function slugFeaturedErrors(textFiles, basePaths, base) {
  const errors = [];
  const basePathSet = new Set(basePaths);
  for (const f of textFiles.filter(
    (t) => t.kind === "json" && JA_JSON_RE.test(t.path),
  )) {
    errors.push(
      ...(f.status === "A"
        ? newPostErrors(f, basePathSet)
        : revisedPostErrors(f, base)),
    );
  }
  return errors;
}
