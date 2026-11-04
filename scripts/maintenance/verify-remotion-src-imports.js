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
 * 束を実際に作る検査（npx remotion compositions）は verify-remotion-compositions.js（manual。CI に remotion の依存が無い）。
 * 外部接続なし・同じコミットなら同じ結果（tier=ci）。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const REMOTION_SRC = join(ROOT, "sns-video-studio/remotion/src");
const CODE = /\.(m?js|jsx)$/;
const FORBIDDEN = [
  /^src\/config\/languages\.js$/,
  /^src\/data\/blogPosts[^/]*\.js$/,
];
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");
const rel = (p) => relative(ROOT, p).split("\\").join("/");

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === "out") return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : CODE.test(p) ? [p] : [];
  });
}

/** 相対の指定を実在のファイルに直す（拡張子の省略・index を補う）。見つからなければ投げる */
function resolveSpec(from, spec) {
  const base = resolve(dirname(from), spec);
  const tries = [
    base,
    ...[".js", ".jsx", ".mjs"].map((e) => base + e),
    ...["index.js", "index.jsx"].map((n) => join(base, n)),
  ];
  const hit = tries.find((p) => existsSync(p) && statSync(p).isFile());
  if (!hit) throw new Error(`${rel(from)}: import "${spec}" の参照先が無い`);
  return hit;
}

/** そのファイルの相対 import の指定（JSON・CSS 等のコードでないものは辿らない） */
function relativeSpecs(code) {
  const re =
    /(?:import|export)\s[^"';]*?from\s*["'](\.{1,2}\/[^"']+)["']|import\s*["'](\.{1,2}\/[^"']+)["']|import\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;
  return [...code.matchAll(re)]
    .map((m) => m[1] ?? m[2] ?? m[3])
    .filter((s) => !/\.(json|css|woff2?|png|jpe?g|svg|mp3|wav|mp4)$/.test(s));
}

/** start から辿れるファイル → 最初に辿り着いた経路 */
function reach(starts) {
  const via = new Map(starts.map((s) => [s, [s]]));
  const queue = [...starts];
  while (queue.length > 0) {
    const file = queue.shift();
    const code = stripComments(readFileSync(file, "utf8"));
    for (const spec of relativeSpecs(code)) {
      const next = resolveSpec(file, spec);
      if (!CODE.test(next) || via.has(next)) continue;
      via.set(next, [...via.get(file), next]);
      queue.push(next);
    }
  }
  return via;
}

const failures = [];
const chain = (path) => path.map(rel).join(" → ");

const reached = reach(files(REMOTION_SRC));
for (const [file, path] of reached) {
  const r = rel(file);
  if (FORBIDDEN.some((re) => re.test(r)))
    failures.push(`禁止のファイルに届く: ${chain(path)}`);
  if (/import\.meta\.glob/.test(stripComments(readFileSync(file, "utf8"))))
    failures.push(`import.meta.glob を呼ぶファイルに届く: ${chain(path)}`);
}

// 検査自体の確かめ（辿り方が壊れて何も拾わない状態を緑にしない）
const probe = reach([join(ROOT, "src/utils/raceDetailHeading.js")]);
if (![...probe.keys()].some((f) => rel(f) === "src/config/languages.js"))
  failures.push(
    "検査の確かめ: raceDetailHeading.js から languages.js に届かない（辿り方が壊れている）",
  );
const outside = [...reached.keys()].filter(
  (f) => !rel(f).startsWith("sns-video-studio/"),
);
if (!outside.some((f) => rel(f) === "src/utils/raceSeriesText.js"))
  failures.push(
    "検査の確かめ: remotion/src から src/utils/raceSeriesText.js に届かない（辿り方が壊れているか、import が変わった。検査を見直す）",
  );

if (failures.length > 0) {
  console.error("verify-remotion-src-imports: 失敗");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  `verify-remotion-src-imports: OK（remotion/src から ${reached.size} ファイル、うち src/・scripts/ ${outside.length} ファイル。languages.js・blogPosts*.js・import.meta.glob に届かない）`,
);
