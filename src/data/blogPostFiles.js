// ブログ記事のメタデータ（1記事1つの JSON）を Node のスクリプトから読む共通部分（BOA-247・BOA-908）。
// 画面（Vite）では各ファイルが import.meta.glob で読むので、ここは通らない。
// process.getBuiltinModule（同期）を使い、画面のバンドルに fs やトップレベル await を持ち込まない

/**
 * @param {URL} dir JSON を置いたディレクトリ（末尾の / を付ける）
 * @returns {Record<string, unknown>} ファイル名 → 中身
 */
export function readJsonDirInNode(dir) {
  const getBuiltin = globalThis.process?.getBuiltinModule;
  if (!getBuiltin) {
    throw new Error(
      "blogPostFiles.js: Node で読むには process.getBuiltinModule（Node 20.16+ / 22.3+）が必要です",
    );
  }
  const fs = getBuiltin("node:fs");
  return Object.fromEntries(
    fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => [
        name,
        JSON.parse(fs.readFileSync(new URL(name, dir), "utf8")),
      ]),
  );
}

// 翻訳版の並び。ファイルの並びに依存させない（id 順）
export const byId = (a, b) => a.id.localeCompare(b.id);
