/**
 * verify-data-health-job.js の変異検証の部品: 変異した版の本を、別名の一時ファイルとして読み込む。
 * 判定の部品を隣の本（evaluateParts.js・jobParts.js）へ分けた本では、変異の対象の字が部品の側にあるため、
 * 字が見つかった方の本を変異させ、本の import を一時の部品に付け替える。
 */
import fs from "node:fs";
import path from "node:path";

/** 本 → 隣へ分けた部品（無い部品は無視する） */
const PARTS = {
  "evaluate.js": ["evaluateParts.js"],
  "job.js": ["jobParts.js"],
};

/**
 * 変異ごとに別モジュールとして読み込むための通し番号。以前は import の URL を `?t=${Date.now()}` で区別していたが、
 * 同じファイルの変異が同じミリ秒に続くと URL が一致し、ESM のキャッシュから直前の変異が返る（BOA-648/BOA-671と同種）。
 * 時刻ではなく通し番号で区別する
 */
let mutantSeq = 0;

/** @param {string} lib scripts/lib/dataHealth の絶対パス */
export function makeWithMutant(lib) {
  const tmpName = (fileName, seq) =>
    `${fileName.replace(/\.js$/, "")}.mutant-${process.pid}-${seq}.tmp.mjs`;
  return async function withMutant(fileName, replacements, run) {
    const names = [
      fileName,
      ...(PARTS[fileName] ?? []).filter((p) =>
        fs.existsSync(path.join(lib, p)),
      ),
    ];
    const sources = new Map(
      names.map((n) => [n, fs.readFileSync(path.join(lib, n), "utf8")]),
    );
    const changed = new Set([fileName]);
    for (const [from, to] of replacements) {
      const target = names.find((n) => sources.get(n).includes(from));
      if (!target)
        throw new Error(
          `変異の対象が見つかりません（${fileName}）: ${from.slice(0, 70)}`,
        );
      sources.set(target, sources.get(target).replace(from, to));
      changed.add(target);
    }
    const tmpFiles = new Map(
      [...changed].map((n) => [n, path.join(lib, tmpName(n, ++mutantSeq))]),
    );
    let main = sources.get(fileName);
    for (const [n, tmp] of tmpFiles)
      if (n !== fileName)
        main = main.replace(`"./${n}"`, `"./${path.basename(tmp)}"`);
    sources.set(fileName, main);
    try {
      for (const [n, tmp] of tmpFiles) fs.writeFileSync(tmp, sources.get(n));
      return await run(await import(tmpFiles.get(fileName)));
    } finally {
      for (const tmp of tmpFiles.values()) fs.rmSync(tmp, { force: true });
    }
  };
}
