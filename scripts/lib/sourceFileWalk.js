import fs from "node:fs";
import path from "node:path";

// 並列の変異テストが作って消すファイルは検査しない。
const isTransient = (name) => /\.tmp\.m?js$|\.__mutant|\.mutant-/.test(name);

function skipMissing(operation, missing) {
  try {
    return operation();
  } catch (error) {
    if (error.code === "ENOENT") return missing;
    throw error;
  }
}

/** 拡張子・除外ディレクトリ名を指定して再帰する。fsは競合の再現テスト用。 */
export function walkSourceFiles(dir, {
  extensions = [".js", ".jsx"], excludedDirs = [], fs: io = fs,
} = {}) {
  const files = [];
  const visit = (directory) => {
    for (const name of skipMissing(() => io.readdirSync(directory), [])) {
      if (isTransient(name)) continue;
      const full = path.join(directory, name);
      const stat = skipMissing(() => io.statSync(full), null);
      if (!stat) continue;
      if (stat.isDirectory()) {
        if (!excludedDirs.includes(name)) visit(full);
      } else if (extensions.some((ext) => name.endsWith(ext))) {
        files.push(full);
      }
    }
  };
  visit(dir);
  return files;
}

/** 一覧の後に消えたファイルはnull。空のファイル（空文字）とは区別する。 */
export function readSourceFile(file, io = fs) {
  return skipMissing(() => io.readFileSync(file, "utf8"), null);
}
