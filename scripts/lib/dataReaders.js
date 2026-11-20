

export const LEDGER_JSON = "docs/reference/data-readers.json";
export const LEDGER_MD = "docs/reference/data-readers.md";
export const EXTRA_FILE = "docs/reference/data-readers.extra.json";

/** 読み手を拾うディレクトリ（git ls-files の結果をここで絞る） */
export const SOURCE_ROOTS = ["src/", "api/", "scripts/", "sns-video-studio/"];
const SOURCE_EXT = /\.(?:js|jsx|mjs|cjs|ts|tsx)$/;
const SKIP_PATH = /(?:^|\/)(?:node_modules|dist|build|out|coverage)\//;

export function isSourceFile(file) {
  return (
    SOURCE_ROOTS.some((r) => file.startsWith(r)) &&
    SOURCE_EXT.test(file) &&
    !SKIP_PATH.test(file) &&
    !file.endsWith(".d.ts")
  );
}

/**
 * 構文木で読まない言語（Python）のファイルの、写しにある名前の文字列（`"表?select=…"`・`"rpc/関数"`・`"表"`）。
 * 読み書きの別は分からないので「名前の文字列」として出す
 * @returns {Array<{ kind: "table" | "rpc", name: string, file: string, line: number }>}
 */
export function pythonMentions(source, file, known) {
  const out = [];
  source.split("\n").forEach((text, i) => {
    if (/^\s*#/.test(text)) return;
    for (const m of text.matchAll(
      /["'](?:\/rest\/v1\/)?(rpc\/)?([A-Za-z_][A-Za-z0-9_]*)(?:\?[^"']*)?["']/g,
    )) {
      const kind = m[1]
        ? "rpc"
        : known.knownTables.has(m[2])
          ? "table"
          : known.knownFunctions.has(m[2])
            ? "rpc"
            : null;
      if (!kind) continue;
      if (kind === "rpc" && !known.knownFunctions.has(m[2])) continue;
      out.push({ kind, name: m[2], file, line: i + 1 });
    }
  });
  return out;
}

export { literalString } from "./dataReadersAst.js";

export { parseSelect, parseRestPath } from "./dataReadersSelect.js";

export { isFixtureLike, extractAccesses } from "./dataReadersVisit.js";

export {
  stripSqlNoise,
  sqlTableRefs,
  relationAccess,
  functionAccess,
  resolveImport,
  scrapeJobWriters,
  resolveHelperAccesses,
  validateExtra,
} from "./dataReadersAccess.js";

export { FORMAT, buildLedger } from "./dataReadersLedger.js";

export { renderMarkdown } from "./dataReadersMarkdown.js";
