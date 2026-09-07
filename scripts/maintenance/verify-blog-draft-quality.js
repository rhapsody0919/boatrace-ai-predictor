/**
 * ブログ下書き（Draft PR）が、人間の承認を経ずに自動マージしてよい品質かを
 * 機械的にチェックする。全項目合格の場合のみ finalize-blog-draft.js が
 * 自動マージを行う（2026-09-07、ユーザー要望: ブログの承認ステップを、
 * 自動チェック合格時のみ省略できるようにしたい）。
 *
 * できないこと（重要）: 数値・データ整合性、検索意図の網羅性、多言語間の
 * 内容一貫性など、意味理解が要る項目は検知できない。
 * `.claude/CLAUDE.md`「ブログ記事の公開前品質チェック」6項目のうち、
 * ここでは文字列・構造として機械的に判定できるものだけを扱う。
 */

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { checkDeprecatedTerms } from "./content-ops-checks/check-deprecated-terms.js";
import { extractFaqItems } from "../../src/utils/blogFaqSchema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "../..");

const WORD_COUNT_MIN = 1800;
const WORD_COUNT_MAX = 4000;
const META_DESCRIPTION_MIN = 120;
const META_DESCRIPTION_MAX = 160;
const TITLE_MIN = 30;
const TITLE_MAX = 60;

function countCharacters(markdown) {
  // 見出し記号・強調記号・表の罫線等はコンテンツではないため字数から除く
  const stripped = markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\|.*\|$/gm, "")
    .replace(/^-{3,}$/gm, "")
    .replace(/\s+/g, "");
  return stripped.length;
}

function checkWordCount(markdown) {
  const count = countCharacters(markdown);
  const passed = count >= WORD_COUNT_MIN && count <= WORD_COUNT_MAX;
  return {
    name: "文字数",
    passed,
    detail: `${count}字（目安${WORD_COUNT_MIN}〜${WORD_COUNT_MAX}字）`,
  };
}

function checkThumbnailPosition(markdown) {
  const lines = markdown.split("\n").map((l) => l.trim());
  const nonEmpty = lines.filter((l) => l.length > 0);
  let cursor = 0;
  if (nonEmpty[cursor]?.startsWith("# ")) cursor += 1;
  const candidate = nonEmpty[cursor];
  const passed = /^!\[[^\]]*\]\([^)]+\)$/.test(candidate || "");
  return {
    name: "サムネ画像の位置",
    passed,
    detail: passed
      ? "タイトル直後に配置済み"
      : "タイトル見出しの直後（本文の最初の段落より前）にカバー画像が無い",
  };
}

async function checkDeprecatedTermsForFile(relFilePath) {
  const { hits, error } = await checkDeprecatedTerms();
  if (error) {
    return {
      name: "旧モデル廃止済み機能への言及",
      passed: false,
      detail: error,
    };
  }
  const fileHits = hits.filter((h) => h.file === relFilePath);
  return {
    name: "旧モデル廃止済み機能への言及",
    passed: fileHits.length === 0,
    detail:
      fileHits.length === 0
        ? "該当なし"
        : fileHits.map((h) => `L${h.line}: "${h.pattern}"`).join(", "),
  };
}

function checkBannedTerms(markdown) {
  const hit = markdown.includes("競艇");
  return {
    name: "禁止用語（競艇）",
    passed: !hit,
    detail: hit ? "本文に「競艇」の表記あり" : "該当なし",
  };
}

function checkMetaDescription(description) {
  const len = (description || "").length;
  const passed = len >= META_DESCRIPTION_MIN && len <= META_DESCRIPTION_MAX;
  return {
    name: "メタディスクリプションの文字長",
    passed,
    detail: `${len}字（目安${META_DESCRIPTION_MIN}〜${META_DESCRIPTION_MAX}字）`,
  };
}

function checkTitleLength(title) {
  const len = (title || "").length;
  const passed = len >= TITLE_MIN && len <= TITLE_MAX;
  return {
    name: "タイトルの文字長",
    passed,
    detail: `${len}字（目安${TITLE_MIN}〜${TITLE_MAX}字）`,
  };
}

function checkImageAlt(markdown) {
  const images = [...markdown.matchAll(/!\[([^\]]*)\]\([^)]+\)/g)];
  const missingAlt = images.filter((m) => m[1].trim().length === 0);
  return {
    name: "画像alt属性の有無",
    passed: images.length > 0 && missingAlt.length === 0,
    detail:
      images.length === 0
        ? "画像が本文に無い"
        : missingAlt.length === 0
          ? `${images.length}件すべてalt設定済み`
          : `alt未設定の画像が${missingAlt.length}件`,
  };
}

function checkInternalLink(markdown) {
  const links = [...markdown.matchAll(/(?<!!)\[[^\]]+\]\(([^)]+)\)/g)];
  const internal = links.filter((m) => m[1].startsWith("/"));
  return {
    name: "内部リンクの有無",
    passed: internal.length >= 1,
    detail:
      internal.length >= 1
        ? `${internal.length}本`
        : "サイト内の別ページへのリンクが本文に無い",
  };
}

function checkFaqSection(markdown) {
  const items = extractFaqItems(markdown);
  return {
    name: "よくある質問セクション",
    passed: items.length >= 1,
    detail:
      items.length >= 1
        ? `${items.length}件のQ&A`
        : "「## よくある質問」セクションが無い、またはQ&Aを抽出できない形式",
  };
}

/**
 * @param {string} slug - public/blog/{slug}.md のslug
 * @param {{title: string, description: string}} meta - src/data/blogPosts.js の該当エントリ
 * @returns {Promise<{passed: boolean, checks: Array<{name: string, passed: boolean, detail: string}>}>}
 */
export async function verifyBlogDraftQuality(slug, meta) {
  const relFilePath = path.join("public/blog", `${slug}.md`);
  const absFilePath = path.join(REPO_ROOT, relFilePath);
  const markdown = await fs.readFile(absFilePath, "utf-8");

  const checks = [
    checkWordCount(markdown),
    checkThumbnailPosition(markdown),
    await checkDeprecatedTermsForFile(relFilePath),
    checkBannedTerms(markdown),
    checkMetaDescription(meta?.description),
    checkTitleLength(meta?.title),
    checkImageAlt(markdown),
    checkInternalLink(markdown),
    checkFaqSection(markdown),
  ];

  return { passed: checks.every((c) => c.passed), checks };
}
