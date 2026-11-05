/**
 * SNS の作り手の CI（.github/workflows/sns-makers.yml、ADR-0105）を、この差分で走らせるかを決める。
 *
 * 使い方: node scripts/maintenance/sns-makers-scope.js --files <差分のパスの一覧のファイル> [--root <辿る木のディレクトリ>]
 *   標準出力: run=true か run=false（GITHUB_OUTPUT にそのまま足せる形）。理由は標準エラー
 *   --root: 辿る対象の木（既定はこのスクリプトの2つ上）。workflow は base 側のこのスクリプトを git archive で取り出して動かし、
 *           --root に checkout（PR の head とのマージ）を渡す
 *
 * run=true になるのは、差分のどれかのパスが次に当たるとき:
 *   - sns-video-studio/remotion/ の下（node_modules・out を除く）
 *   - 作り手と送る口（remotion/src・remotion/scripts・scripts/sns/push-*.js）から相対 import・new URL で辿れるファイル
 *     （#2236 の src/utils/raceSeriesText.js はここで当たる）
 *   - root の package.json・package-lock.json、workflow、検査のスクリプト（ALWAYS）
 *   - 辿る途中で参照先が見つからない（安全側に倒す）
 * 判定できないとき（一覧が読めない・空）も run=true。
 */
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { codeFiles, reach } from "../lib/relativeImportGraph.js";

/** 差分に含まれたら必ず走らせるパス（ルートからの相対） */
export const ALWAYS = [
  /^sns-video-studio\/remotion\/(?!node_modules\/|out\/)/,
  /^package(-lock)?\.json$/,
  /^\.github\/workflows\/sns-makers\.yml$/,
  /^scripts\/maintenance\/(verify-sns-makers|verify-sns-makers-scope|verify-remotion-compositions|sns-makers-scope)\.js$/,
  /^scripts\/lib\/relativeImportGraph\.js$/,
];

/** 辿る入口（ルートからの相対）。作り手（remotion の src・scripts）と送る口 */
export function entryFiles(root) {
  const remotion = join(root, "sns-video-studio/remotion");
  const push = join(root, "scripts/sns");
  return [
    ...codeFiles(join(remotion, "src")),
    ...codeFiles(join(remotion, "scripts")),
    ...(existsSync(push)
      ? readdirSync(push)
          .filter((n) => /^push-.*\.js$/.test(n))
          .map((n) => join(push, n))
      : []),
  ];
}

/**
 * 判定（files はルートからの相対パス）
 * @returns {{ run: boolean, reason: string }}
 */
export function decide(files, root) {
  const list = files.map((f) => f.trim()).filter(Boolean);
  if (list.length === 0)
    return { run: true, reason: "差分が空（判定できないので走らせる）" };
  const always = list.find((f) => ALWAYS.some((re) => re.test(f)));
  if (always) return { run: true, reason: `必ず走らせるパス: ${always}` };
  const { via, missing } = reach(entryFiles(root));
  const rel = (p) => relative(root, p).split("\\").join("/");
  if (missing.length > 0)
    return {
      run: true,
      reason: `参照先が見つからない import がある（安全側）: ${rel(missing[0].from)} → ${missing[0].spec}`,
    };
  const reached = new Map([...via].map(([file, path]) => [rel(file), path]));
  const hit = list.find((f) => reached.has(f));
  if (hit)
    return {
      run: true,
      reason: `作り手から届くファイル: ${reached.get(hit).map(rel).join(" → ")}`,
    };
  return {
    run: false,
    reason: `作り手から届くファイルが差分に無い（${list.length} ファイル）`,
  };
}

function main() {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };
  const filesPath = opt("--files");
  const root = resolve(
    opt("--root") ?? fileURLToPath(new URL("../../", import.meta.url)),
  );
  let result;
  try {
    if (!filesPath) throw new Error("--files が無い");
    result = decide(readFileSync(filesPath, "utf8").split("\n"), root);
  } catch (error) {
    result = {
      run: true,
      reason: `判定できない（走らせる）: ${error.message}`,
    };
  }
  console.error(`sns-makers-scope: ${result.reason}`);
  console.log(`run=${result.run}`);
}

// 直接起動されたときだけ動かす（tmp 等の symlink の下から起動されても判定できるよう実体のパスで比べる）
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main();
