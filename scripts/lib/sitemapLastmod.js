/**
 * sitemap.xml の lastmod を「実際に中身が変わった日」にするための部品（BOA-599）。
 *
 * 以前は全URLの lastmod を生成日（毎日）にしていた。Google は実際の更新と一致しない
 * lastmod を無視するため、再クロールの合図として働いていなかった。
 * 意味のある日付が無いURLは lastmod を出さない（出さないほうが、毎日変わる嘘の日付より良い）。
 */
import { execFileSync } from "child_process";

/**
 * ファイルの最終コミット日（YYYY-MM-DD）。git の履歴が無い（浅い checkout 等）・
 * 追跡されていないときは null
 */
export function gitLastCommitDate(filePath, { cwd } = {}) {
  try {
    const out = execFileSync(
      "git",
      ["log", "-1", "--format=%cs", "--", filePath],
      {
        cwd,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : null;
  } catch {
    return null;
  }
}

/** YYYY-MM-DD の新しいほう。どちらかが null ならもう一方 */
export function laterDate(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  return a > b ? a : b;
}

/** 1URL分の <url> 要素。lastmod が null なら <lastmod> を出さない */
export function renderUrlEntry(
  siteUrl,
  { loc, lastmod, changefreq, priority },
) {
  let xml = "  <url>\n";
  xml += `    <loc>${siteUrl}${loc}</loc>\n`;
  if (lastmod) xml += `    <lastmod>${lastmod}</lastmod>\n`;
  xml += `    <changefreq>${changefreq}</changefreq>\n`;
  xml += `    <priority>${priority}</priority>\n`;
  xml += "  </url>\n";
  return xml;
}
