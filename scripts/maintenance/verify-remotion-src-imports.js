/**
 * 動画（sns-video-studio/remotion）の束が、Vite 専用の import.meta.glob に届かないことの検査（2026-11-04）。
 *
 * Remotion は全部の composition を webpack の1つの束にする。webpack は import.meta.glob を変換しないので、
 * remotion/src から相対 import で辿れるファイルのどれかが import.meta.glob を呼ぶと、束の読み込み（Getting composition）で
 * `{}.glob is not a function` になり、全部の動画（節の機力・人気薄の1着・全貌 f01）が落ちる。
 * 実例: #2236 で upsetWin/model.js → src/utils/raceSeriesText.js → raceDetailHeading.js → src/config/languages.js →
 * src/data/blogPostsEn.js（import.meta.glob）が繋がり、11/4 21:28 から落ちた。日目のラベルを src/utils/seriesDayLabel.js に分けて切った。
 *
 * 1. remotion/src の全ファイルから相対 import（import・export from・動的 import）を辿り、届くファイルに
 *    src/config/languages.js・src/data/blogPosts*.js が無い
 * 2. 届くファイルのどれも import.meta.glob を呼ばない（コメントは除く）
 * 3. 検査自体の確かめ: raceDetailHeading.js から辿ると languages.js に届く（辿り方が壊れて素通りしていない）
 *
 * 辿るのは静的な相対 import（import・export from・文字列1つの import()）だけ。require・式の import()・別名の指定は辿らない
 * （remotion/src は ESM で、今は使っていない）。そこは束を作る検査で拾う。
 * 束を実際に作る検査（npx remotion compositions）は verify-remotion-compositions.js、描く検査は verify-sns-makers.js（どちらも sns-makers.yml、ADR-0105）。
 * 外部接続なし・同じコミットなら同じ結果（tier=ci）。
 */
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { CODE, codeFiles, reach as reachGraph } from "../lib/relativeImportGraph.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const REMOTION_SRC = join(ROOT, "sns-video-studio/remotion/src");
const FORBIDDEN = [
  /^src\/config\/languages\.js$/,
  /^src\/data\/blogPosts[^/]*\.js$/,
];
const rel = (p) => relative(ROOT, p).split("\\").join("/");
const failures = [];

/** start から辿れるファイル → 最初に辿り着いた経路（辿り方は scripts/lib/relativeImportGraph.js。参照先が無ければ failures） */
function reach(starts) {
  const r = reachGraph(starts);
  for (const m of r.missing)
    failures.push(
      `${rel(m.from)}: import "${m.spec}" の参照先が見つからない（辿れないので検査できない）`,
    );
  return r;
}

const chain = (path) => path.map(rel).join(" → ");

const { via: reached, source: readSource } = reach(codeFiles(REMOTION_SRC));
for (const [file, path] of reached) {
  if (!CODE.test(file)) continue;
  const r = rel(file);
  if (FORBIDDEN.some((re) => re.test(r)))
    failures.push(`禁止のファイルに届く: ${chain(path)}`);
  if (/import\.meta\.glob/.test(readSource(file)))
    failures.push(`import.meta.glob を呼ぶファイルに届く: ${chain(path)}`);
}

// 検査自体の確かめ（辿り方が壊れて何も拾わない状態を緑にしない）
const probe = reach([join(ROOT, "src/utils/raceDetailHeading.js")]).via;
if (![...probe.keys()].some((f) => rel(f) === "src/config/languages.js"))
  failures.push(
    "検査の確かめ: raceDetailHeading.js から languages.js に届かない（辿り方が壊れている）",
  );
const outside = [...reached.keys()].filter(
  (f) => !rel(f).startsWith("sns-video-studio/"),
);
if (outside.length === 0)
  failures.push(
    "検査の確かめ: remotion/src から remotion の外（src/・scripts/）に1つも届かない（辿り方が壊れている）",
  );

if (failures.length > 0) {
  console.error("verify-remotion-src-imports: 失敗");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  `verify-remotion-src-imports: OK（remotion/src から ${reached.size} ファイル、うち src/・scripts/ ${outside.length} ファイル。languages.js・blogPosts*.js・import.meta.glob に届かない）`,
);
