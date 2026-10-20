/**
 * Vercel の Ignored Build Step（vercel.json の ignoreCommand）の判定（BOA-908）。
 *
 * 前回のデプロイから変わったファイルが、サイトの出力に関係ないものだけならビルドを飛ばす。
 * 本番・Preview とも同じ判定。1本あたりの費用が上がった（BOA-908）ので、docs・台帳・
 * 機械の再生成だけのコミット（1週間の本番ビルドの36%）でビルドしない。
 *
 * 除外はディレクトリと名前で書く。`*.md` を全体では除外しない（public/blog/*.md はビルドが配る）。
 * scripts/maintenance/run-heavy.sh は build の命令が通る（package.json の build）ので除外しない。
 * 一覧に無いパスは必ずビルドする（新しいパスは安全側に倒れる）。
 * 検証: scripts/maintenance/verify-vercel-ignore-build.js
 */

// ビルド（vite・generate-ai-snapshots）・api/・middleware.js から読まれないディレクトリ
export const IGNORED_DIRS = Object.freeze([
  "docs/",
  "data/analysis/",
  ".claude/",
  ".github/",
  "e2e/",
  "note-articles/",
  "scripts/analysis/",
  "scripts/maintenance/",
  "scripts/review/",
  "scripts/tests/",
  "scripts/watch/",
]);

// 除外のディレクトリの中でも、ビルドが使うもの
export const ALWAYS_BUILD = Object.freeze(["scripts/maintenance/run-heavy.sh"]);

/** サイトの出力に関係ないファイルか（リポジトリのルートからの相対パス） */
export function isSiteIrrelevant(file) {
  if (ALWAYS_BUILD.includes(file)) return false;
  // ルート直下の .md（README.md・AGENTS.md 等）。public/blog/*.md などの下の階層は対象外
  if (!file.includes("/") && file.endsWith(".md")) return true;
  return IGNORED_DIRS.some((dir) => file.startsWith(dir));
}

/**
 * ビルドを飛ばすか。変わったファイルが無い（同じコミットの作り直し・Deploy Hook）ときはビルドする。
 * @param {string[]} files 前回のデプロイから変わったファイル
 * @returns {boolean} true ならビルドしない
 */
export function shouldSkipBuild(files) {
  return files.length > 0 && files.every(isSiteIrrelevant);
}
