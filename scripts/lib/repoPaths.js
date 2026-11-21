/**
 * repoPaths.js - リポジトリのパスの一覧と、ある ref の版のファイルを git から読む（HR74）。読むだけで、書かない・ネットワークに触れない。
 * 読み手は scripts/maintenance/verify-doc-placement.js（置き場の表）と doc-placement-mutants.js（その変異検査）。
 * 一覧は追跡（作業ツリーで消した物を除く）＋ ignore の外の未追跡。fs を歩かないので node_modules・dist・.venv を数えない。名は -z で読む。
 */
import { execFileSync } from "node:child_process";

const run = (root, args) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
const zlist = (root, args) => run(root, [...args, "-z"]).split("\0").filter(Boolean);

export const listRepoPaths = (root) => {
  const deleted = new Set(zlist(root, ["ls-files", "--deleted"]));
  return [...new Set([...zlist(root, ["ls-files"]).filter((p) => !deleted.has(p)), ...zlist(root, ["ls-files", "--others", "--exclude-standard"])])].sort();
};

// ref の版の rel の本文。無い・読めないときは null
export const showAtRef = (root, ref, rel) => {
  try {
    return run(root, ["show", `${ref}:${rel}`]);
  } catch {
    return null;
  }
};
