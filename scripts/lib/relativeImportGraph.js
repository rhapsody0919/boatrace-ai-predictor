/**
 * 相対 import を辿って、入口から届くファイルを集める（node 標準だけを使う）。
 * 使う所: verify-remotion-src-imports.js（束が import.meta.glob に届かない）・sns-makers-scope.js（SNS の作り手の CI を走らせる差分か）・
 * pr-lane.js（軽い道／重い道の判定。git のコミットの木を読むので、読み方 io を差し替える）。
 *
 * 辿るのは静的な相対の指定（import・export from・文字列1つの import()）だけ。require・式の import()・別名は辿らない。
 * JSON 等のコードでない import と `new URL("<相対>", import.meta.url)` の行き先は、辿らない葉として「届く」に数える
 * （全貌の文は scene2-data.mjs が src/locales/ja/common.json を new URL で読む。system-architect 2026-11-05 P2）。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const CODE = /\.(m?js|jsx|cjs)$/;

// 行頭から始まるコメントだけを除く。文字列の中の "/*"（glob の "./x/*.json" 等）から次の "*/" までを消して
// import を見落とさないため、行の途中の /* や // は残す（残しても見落としにはならず、誤って拾う側に倒れる）
export const stripComments = (s) =>
  s.replace(/^\s*\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");

/** dir の下のコードのファイル（node_modules・out を除く） */
export function codeFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === "out") return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? codeFiles(p) : CODE.test(p) ? [p] : [];
  });
}

/**
 * そのファイルの相対の指定（import・export from・import()・new URL(…, import.meta.url)）。
 * optional: 見つからなくても辿れない import とはしないもの（new URL の行き先＝後で書く出力やディレクトリもある、
 * コードでない import＝CSS・画像等。以前の検査もこれらは解決せずに捨てていた）
 * @returns {{ spec: string, optional: boolean }[]}
 */
export function relativeSpecs(code) {
  const re =
    /(?:import|export)\s[^"';]*?from\s*["'](\.{1,2}\/[^"']+)["']|import\s*["'](\.{1,2}\/[^"']+)["']|import\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)|new\s+URL\(\s*["'](\.{1,2}\/[^"']+)["']\s*,\s*import\.meta\.url\s*\)/g;
  return [...code.matchAll(re)].map((m) => {
    const spec = m[1] ?? m[2] ?? m[3] ?? m[4];
    return {
      spec,
      optional:
        m[4] !== undefined || (/\.[a-z0-9]+$/i.test(spec) && !CODE.test(spec)),
    };
  });
}

/**
 * ファイルの読み方。既定は手元のファイル。pr-lane.js は git のコミットの木（仮の絶対パス）を読む io を渡す
 * @typedef {{ isFile: (p: string) => boolean, read: (p: string) => string }} GraphIo
 * @type {GraphIo}
 */
export const fsIo = {
  isFile: (p) => existsSync(p) && statSync(p).isFile(),
  read: (p) => readFileSync(p, "utf8"),
};

/** 相対の指定を実在のファイルに直す（拡張子の省略・index を補う）。無ければ null */
export function resolveSpec(from, spec, io = fsIo) {
  const base = resolve(dirname(from), spec);
  const tries = [
    base,
    ...[".js", ".jsx", ".mjs", ".cjs"].map((e) => base + e),
    ...["index.js", "index.jsx", "index.mjs"].map((n) => join(base, n)),
  ];
  return tries.find((p) => io.isFile(p)) ?? null;
}

/**
 * starts から辿れるファイル → 最初に辿り着いた経路。
 * 参照先が見つからない指定は missing に { from, spec } で返す（呼ぶ側が失敗か安全側の判定かを決める）
 * @param {string[]} starts 絶対パス
 * @param {GraphIo} [io]
 * @returns {{ via: Map<string, string[]>, missing: {from: string, spec: string}[] }}
 */
export function reach(starts, io = fsIo) {
  const cache = new Map();
  const source = (p) => {
    if (!cache.has(p)) cache.set(p, stripComments(io.read(p)));
    return cache.get(p);
  };
  const via = new Map(starts.map((s) => [s, [s]]));
  const missing = [];
  const queue = starts.filter((s) => CODE.test(s));
  while (queue.length > 0) {
    const file = queue.shift();
    for (const { spec, optional } of relativeSpecs(source(file))) {
      const next = resolveSpec(file, spec, io);
      if (!next) {
        if (!optional) missing.push({ from: file, spec });
        continue;
      }
      if (via.has(next)) continue;
      via.set(next, [...via.get(file), next]);
      // コードでないもの（JSON・画像・フォント等）は葉。中は辿らない
      if (CODE.test(next)) queue.push(next);
    }
  }
  return { via, missing, source };
}
