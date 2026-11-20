/**
 * verify-e2e-scope.js の閉包（根から import・相対のパスで辿れる先）の辿り。verify ではない。
 * ファイルは io（read・stat）越しに読む。verify は本物の木と、メモリの上の偽の木の両方をこれで辿る。
 */
import path from "node:path";

const exts = [
  "",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  "/index.js",
  "/index.jsx",
];

/** 1つの指定の行き先。読み（read、一覧と照らす）と、ファイルに解けたら辿る先（target）。root の外・URL は null */
function resolveSpec(root, file, spec, io) {
  const clean = spec.split("?")[0].split("#")[0];
  if (!clean || /^\/\//.test(clean)) return null;
  const base = clean.startsWith("/")
    ? path.join(root, clean)
    : path.resolve(path.dirname(file), clean);
  if (base !== root && !base.startsWith(root + path.sep)) return null;
  const target = exts.map((e) => base + e).find((p) => io.stat(p)?.isFile());
  if (target) return { read: path.relative(root, target), target };
  // ディレクトリ・`${` で切れた頭の読み。その下の全部を読みうるものとして判定する
  if (io.stat(base)?.isDirectory() || /\/$/.test(clean) || spec !== clean)
    return { read: `${path.relative(root, base)}/`.replace(/\/+$/, "/") };
  // 解けない指定（public/ の URL・書き出し先・拡張子の無い頭）も黙って捨てず、頭として一覧と照らす
  return { read: path.relative(root, base) };
}

/** root の下で roots から辿れるファイル（rels）・読み（reads）・Node 側の一覧の頭の文字列（leakedLiterals） */
export function closureFrom({ root, roots, io, scan, prefixes }) {
  const reachable = new Set(roots);
  const queue = [...roots];
  const reads = new Set();
  const leakedLiterals = [];
  while (queue.length > 0) {
    const file = queue.pop();
    const css = /\.css$/.test(file);
    if (!css && !/\.(js|jsx|mjs|cjs|html)$/.test(file)) continue;
    const rel = path.relative(root, file);
    const { specs, literals } = scan(io.read(file), {
      css,
      nodeSide: !rel.startsWith("src/"),
      prefixes,
    });
    for (const l of literals) leakedLiterals.push(`${rel}: ${l}`);
    for (const spec of specs) {
      const to = resolveSpec(root, file, spec, io);
      if (!to) continue;
      reads.add(to.read);
      if (to.target && !reachable.has(to.target)) {
        reachable.add(to.target);
        queue.push(to.target);
      }
    }
  }
  return {
    rels: [...reachable].map((f) => path.relative(root, f)),
    reads,
    leakedLiterals,
  };
}
