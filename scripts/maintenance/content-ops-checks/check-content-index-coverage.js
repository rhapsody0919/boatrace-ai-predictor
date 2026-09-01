/**
 * docs/design/{slug}/content-index.json のフォーマットを検証する。
 * 「本来必要なのに存在しない」の全自動検出はしない（機能の一覧を機械的に
 * 列挙する手段がsitemapのルートほど自明ではないため）。実装完了チェック
 * リスト（新機能PRのたびに content-index.json を作る／not_applicable を
 * 明記する）の運用と組み合わせて使う。詳細: docs/design/content-ops-flow/plan.md
 */

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESIGN_DIR = path.join(__dirname, "../../../docs/design");
const REQUIRED_KEYS = ["feature", "released", "content", "not_applicable"];
const CONTENT_ARRAY_KEYS = [
  "static_pages",
  "note_articles",
  "blog_posts",
  "youtube_videos",
  "x_posts",
];
const EXCLUDED_DIR_NAMES = new Set(["_template"]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

async function findContentIndexFiles() {
  const entries = await fs.readdir(DESIGN_DIR, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || EXCLUDED_DIR_NAMES.has(entry.name)) continue;
    const candidate = path.join(DESIGN_DIR, entry.name, "content-index.json");
    try {
      await fs.access(candidate);
      files.push(candidate);
    } catch {
      // このディレクトリには content-index.json がない（未対応 or 対象外の機能）。
      // 全自動検出はしない方針のため、ここではエラーにしない。
    }
  }
  return files;
}

function validateContentIndex(filePath, data) {
  const errors = [];
  const relPath = path.relative(process.cwd(), filePath);

  for (const key of REQUIRED_KEYS) {
    if (!(key in data)) errors.push(`${relPath}: 必須キー "${key}" が無い`);
  }
  if (typeof data.feature !== "string" || data.feature.trim() === "") {
    errors.push(`${relPath}: "feature" は空でない文字列である必要がある`);
  }
  if (typeof data.released !== "string" || !DATE_PATTERN.test(data.released)) {
    errors.push(
      `${relPath}: "released" は YYYY-MM-DD 形式の文字列である必要がある`,
    );
  }
  if (typeof data.not_applicable !== "boolean") {
    errors.push(`${relPath}: "not_applicable" は真偽値である必要がある`);
  }
  if (typeof data.content !== "object" || data.content === null) {
    errors.push(`${relPath}: "content" はオブジェクトである必要がある`);
  } else {
    for (const key of CONTENT_ARRAY_KEYS) {
      if (!Array.isArray(data.content[key])) {
        errors.push(`${relPath}: "content.${key}" は配列である必要がある`);
      }
    }
    const hasAnyContent = CONTENT_ARRAY_KEYS.some(
      (key) => Array.isArray(data.content[key]) && data.content[key].length > 0,
    );
    if (!data.not_applicable && !hasAnyContent) {
      errors.push(
        `${relPath}: content が全て空配列だが not_applicable も false。対象チャネルが本当に無いなら not_applicable を true にする`,
      );
    }
  }
  return errors;
}

export async function checkContentIndexCoverage() {
  const files = await findContentIndexFiles();
  const invalidFiles = [];

  for (const filePath of files) {
    let data;
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      data = JSON.parse(raw);
    } catch (error) {
      invalidFiles.push({
        file: path.relative(process.cwd(), filePath),
        errors: [`JSONとして読み込めない: ${error.message}`],
      });
      continue;
    }
    const errors = validateContentIndex(filePath, data);
    if (errors.length > 0) {
      invalidFiles.push({
        file: path.relative(process.cwd(), filePath),
        errors,
      });
    }
  }

  return { checkedCount: files.length, invalidFiles };
}
