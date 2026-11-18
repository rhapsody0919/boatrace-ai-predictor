/**
 * verify-blog-charts.js の JSON 1本の検査（参照元の記事との突き合わせ）。verify ではない。
 * エラーは `{ファイル}: {JSONのパス}: {期待} / 実際: {値}` の形で全件を返す。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  validateBlogChart,
  localize,
} from "../../../src/utils/blogChartContract.js";
import { checkRiskRules } from "../../lib/riskRules.js";

const ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const deprecatedPatterns = JSON.parse(
  readFileSync(path.join(ROOT, "docs/reference/deprecated-terms.json"), "utf8"),
).terms.flatMap((t) => t.patterns.map((p) => ({ id: t.id, pattern: p })));

/** 文字の項目を全部集める（禁止語の検査用） */
function texts(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => texts(v, out));
  else if (value && typeof value === "object")
    Object.values(value).forEach((v) => texts(v, out));
  return out;
}

/** 契約の形と id（ファイル名と同じ） */
function shapeErrors(file, name, chart, referrers) {
  const errors = validateBlogChart(chart, {
    langs: [...new Set(referrers.map((r) => r.lang))],
  }).map((e) => `${file}: ${e.path || "(全体)"}: ${e.message}`);
  if (chart?.id !== name)
    errors.push(
      `${file}: id: ファイル名と同じ "${name}" / 実際: ${JSON.stringify(chart?.id)}`,
    );
  return errors;
}

/** article が参照元の記事で、src/data/blog-posts にある */
function articleErrors(file, chart, referrers, postExists) {
  const errors = [];
  const ids = [...new Set(referrers.map((r) => r.article))];
  if (ids.length > 0 && !ids.includes(chart?.article)) {
    errors.push(
      `${file}: article: 参照元の記事 ${ids.join("・")} / 実際: ${JSON.stringify(chart?.article)}`,
    );
  }
  if (typeof chart?.article === "string" && !postExists(chart.article)) {
    errors.push(
      `${file}: article: src/data/blog-posts/${chart.article}.json が無い`,
    );
  }
  return errors;
}

/** 参照元ごとの rows の数と、答えの割合が本文にもあるか */
function referrerErrors(chart, referrers, markdownOf) {
  const errors = [];
  const rowCount = Array.isArray(chart?.rows) ? chart.rows.length : null;
  for (const r of referrers) {
    if (rowCount !== null && r.rows !== rowCount)
      errors.push(
        `${r.at}: rows="${rowCount}"（JSON の rows の数） / 実際: rows="${r.rows}"`,
      );
    errors.push(...percentErrors(chart, r, markdownOf));
  }
  return errors;
}

/** 答えの割合は本文にも書く（検索・AI の根拠は本文） */
function percentErrors(chart, r, markdownOf) {
  const errors = [];
  const md = markdownOf(r.file);
  for (const m of localize(chart?.description, r.lang).matchAll(
    /(\d+(?:\.\d+)?)%/g,
  )) {
    if (!md.includes(`${m[1]}%`))
      errors.push(
        `${r.at}: description の「${m[1]}%」が記事の本文に無い（本文の1行と表にも書く）`,
      );
  }
  return errors;
}

/** 文字に risk-rules.json の語・廃止語が無い */
function wordErrors(file, chart) {
  const errors = [];
  for (const t of texts(chart)) {
    for (const v of checkRiskRules(t, "blog"))
      errors.push(
        `${file}: 書かない言い方「${v.matchedPattern}」（${v.id}）: ${t}`,
      );
    for (const d of deprecatedPatterns)
      if (t.includes(d.pattern))
        errors.push(`${file}: 廃止語「${d.pattern}」（${d.id}）: ${t}`);
  }
  return errors;
}

/** JSON 1本を、参照元の記事と突き合わせて検査する */
export function checkChart(name, chart, referrers, { postExists, markdownOf }) {
  const file = `public/blog-charts/${name}.json`;
  return [
    ...shapeErrors(file, name, chart, referrers),
    ...articleErrors(file, chart, referrers, postExists),
    ...referrerErrors(chart, referrers, markdownOf),
    ...wordErrors(file, chart),
  ];
}
