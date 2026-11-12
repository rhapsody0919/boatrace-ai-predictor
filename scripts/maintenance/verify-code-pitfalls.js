/**
 * verify-code-pitfalls.js - 文で書かれていただけの落とし穴のうち、CSS の値で機械に見られる物を試験にする（ZB03 ①、BOA-1454）。
 * ファイルを読むだけで、ネットワークにも DB にも接続しない。読むのは src/ の *.css だけ（JS・JSX の本文は読まない）。
 *
 * 決まり（正本 .claude/rules/component-reuse.md「CSS」、ADR-0073 追記。BOA-460・527・528 で3回再発）:
 *   件数がデータで変わるグリッドに `repeat(auto-fill, ...)` や固定列数 `repeat(N, ...)` を使わない。
 *   件数が少ない日にだけ崩れ、本番のその日の件数しか見ない検査では見つからないため。
 *
 * 判定: src/ の *.css で `repeat(auto-fill,` か `repeat(<数>,` を含む行を、全体の件数で数える。
 *   - FROZEN（今ある行の数）より増えたら失敗。ファイル単位でなく全体の件数（置き場が変わっても赤にしない）
 *   - 減ったら成功のまま「FROZEN を下げる」と出す（直した分を戻させない）
 *   今ある行は件数が固定のグリッドも混ざり、機械では分けられないので数で凍結する。
 * 起動のたびに純関数の自己試験（文字列だけを与える）を先に回し、落ちたら失敗にする。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
// origin/master 5559fbe8c で数えた行の数（2026-11-12）。減らしたら下げる。増やさない
const FROZEN = 53;
const PATTERN = /repeat\(\s*(?:auto-fill|\d+)\s*,/;
const HOW_TO_FIX =
  "件数がデータで変わるグリッドは auto-fit にし、列数の上限は DigestCardGrid.css の calc() 方式にする。件数を差し替える再現テストを e2e/layout/ の *-layout.spec.js に足す（.claude/rules/component-reuse.md「CSS」）";

const walk = (dir, ext) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const child = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === "node_modules" ? [] : walk(child, ext);
    return d.name.endsWith(ext) ? [child] : [];
  });

// 純関数: [{file, text}] → 当たった行 [{file, lineNo, line}]
export const findHits = (sources) =>
  sources.flatMap(({ file, text }) =>
    text
      .split("\n")
      .map((line, i) => ({ file, lineNo: i + 1, line: line.trim() }))
      .filter(({ line }) => PATTERN.test(line)),
  );

// 純関数: 当たった行と凍結の数 → {ok, lines}
export const judge = (hits, frozen) => {
  if (hits.length > frozen) {
    return {
      ok: false,
      lines: [
        `verify-code-pitfalls: NG（固定列・auto-fill のグリッドが ${hits.length} 行。凍結 ${frozen} 行より ${hits.length - frozen} 行増えた）`,
        ...hits.map(({ file, lineNo, line }) => `  - ${file}:${lineNo}  ${line.slice(0, 120)}`),
        `  直し方: ${HOW_TO_FIX}`,
        "  件数が固定のグリッド（常に2列等）で増やすなら、その理由を PR 本文に書き、この verify の FROZEN を上げる",
      ],
    };
  }
  const lower = hits.length < frozen ? `。${frozen - hits.length} 行減ったので FROZEN を ${hits.length} に下げる` : "";
  return { ok: true, lines: [`verify-code-pitfalls: OK（固定列・auto-fill のグリッド ${hits.length} 行、凍結 ${frozen} 行${lower}）`] };
};

const selfTest = () => {
  const css = [
    ".a { grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); }",
    ".b { grid-template-columns: repeat( 3 , 1fr); }",
    ".c { grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); }",
    ".d { grid-template-columns: 1fr 1fr; }",
  ].join("\n");
  const hits = findHits([{ file: "x.css", text: css }]);
  const checks = [
    ["auto-fill と固定列を数え、auto-fit は数えない", hits.length === 2 && hits[0].lineNo === 1 && hits[1].lineNo === 2],
    ["凍結より多いと失敗", judge(hits, 1).ok === false],
    ["凍結と同じなら成功", judge(hits, 2).ok === true],
    ["凍結より少ないと成功で下げるよう出す", judge(hits, 3).ok === true && judge(hits, 3).lines[0].includes("下げる")],
  ];
  return checks.filter(([, pass]) => !pass).map(([name]) => name);
};

const main = () => {
  const broken = selfTest();
  if (broken.length > 0) {
    console.error(`verify-code-pitfalls: 自己試験が落ちた（${broken.join("・")}）`);
    process.exit(1);
  }
  const sources = walk(path.join(ROOT, "src"), ".css").map((abs) => ({
    file: path.relative(ROOT, abs),
    text: fs.readFileSync(abs, "utf8"),
  }));
  const { ok, lines } = judge(findHits(sources), FROZEN);
  (ok ? console.log : console.error)(lines.join("\n"));
  if (!ok) process.exit(1);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
