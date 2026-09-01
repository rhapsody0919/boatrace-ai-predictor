/**
 * ユーザー向けコンテンツに廃止済み用語（docs/reference/deprecated-terms.json）が
 * 残っていないかgrepで機械的に検知する。ブログ記事の公開前品質チェック
 * （CLAUDE.md「現行仕様との整合性」）で既に確立している手法を、静的ページの
 * JSX・オンボーディングUI・note下書きにも横展開したもの。
 *
 * できないこと（重要）: 「この文章の内容が今の仕様と食い違っている」という
 * 意味理解による検知はできない。あくまで deprecated-terms.json に登録した
 * 具体的な文字列が存在するかどうかの機械的な一致検知に限定される。
 * 詳細: docs/design/content-ops-flow/spec.md フローC-7
 */

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "../../..");
const TERMS_PATH = path.join(REPO_ROOT, "docs/reference/deprecated-terms.json");

// ユーザーが実際に読む・見るコンテンツのみを対象にする。
// docs/reference配下の内部ドキュメント（用語集・DB設計等）は歴史的経緯の
// 記録として旧用語を含んでいてよいため、意図的に対象外
const TARGET_FILES = [
  "src/pages/About.jsx",
  "src/pages/FAQ.jsx",
  "src/pages/HowToUse.jsx",
  "src/pages/ContentHub.jsx",
  "src/pages/EnglishGuide.jsx",
  "src/pages/ZhTwGuide.jsx",
  "src/pages/KoGuide.jsx",
  "src/components/FirstVisitGuideCard.jsx",
];
const TARGET_DIRS = ["note-articles", "public/blog"];

async function listMarkdownFiles(dirRelPath) {
  const dirAbsPath = path.join(REPO_ROOT, dirRelPath);
  let entries;
  try {
    entries = await fs.readdir(dirAbsPath, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => path.join(dirRelPath, e.name));
}

async function collectTargetFiles() {
  const fromDirs = (
    await Promise.all(TARGET_DIRS.map(listMarkdownFiles))
  ).flat();
  const existing = [];
  for (const relPath of [...TARGET_FILES, ...fromDirs]) {
    try {
      await fs.access(path.join(REPO_ROOT, relPath));
      existing.push(relPath);
    } catch {
      // ファイルが無い（別セッションでの改名・未作成等）はスキップ
    }
  }
  return existing;
}

export async function checkDeprecatedTerms() {
  let termsData;
  try {
    termsData = JSON.parse(await fs.readFile(TERMS_PATH, "utf-8"));
  } catch (error) {
    return {
      hits: [],
      error: `deprecated-terms.json読み込み失敗: ${error.message}`,
    };
  }

  const files = await collectTargetFiles();
  const hits = [];

  for (const relPath of files) {
    const content = await fs.readFile(path.join(REPO_ROOT, relPath), "utf-8");
    const lines = content.split("\n");

    for (const termGroup of termsData.terms) {
      for (const pattern of termGroup.patterns) {
        lines.forEach((line, i) => {
          if (line.includes(pattern)) {
            hits.push({
              file: relPath,
              line: i + 1,
              termId: termGroup.id,
              pattern,
              note: termGroup.note,
            });
          }
        });
      }
    }
  }

  return { hits, checkedFileCount: files.length };
}
