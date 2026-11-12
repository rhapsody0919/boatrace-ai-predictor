/**
 * verify-agents-entry.js - 作り手が毎回読む入口（AGENTS.md・.claude/CLAUDE.md）を短く保ち、安全の6点が残っているかを見る。
 * ファイルを読むだけで、ネットワークにも DB にも接続しない。verify-registry.json の tier ci（PR ごとの Quality Gates）。
 *
 * 守るもの:
 *   (a) AGENTS.md は200行未満（公式の目安 code.claude.com/docs/en/memory.md）、.claude/CLAUDE.md は30行未満（入口だけ）。
 *       1行足すなら1行削るを機械にする
 *   (b) .claude/CLAUDE.md が `@../AGENTS.md` で AGENTS.md を取り込む（Claude は AGENTS.md を自動では読まない）。
 *       @ の先は書いたファイルの置き場からの相対で解かれる。`@AGENTS.md` は .claude/AGENTS.md を指し、黙って何も取り込まない
 *       （2026-11-08、claude 2.1.310 で確かめ。#2315〜の間 AGENTS.md が誰の文脈にも入っていなかった）
 *   (e) .claude/CLAUDE.md・AGENTS.md の行頭の `@パス` が、そのファイルの置き場からの相対で実在するファイルを指す
 *   (c) AGENTS.md に安全の6点の語が残っている（主語は「作り手」）
 *   (d) .claude/rules/ が無い（常時でも paths 付きでも rules は置かない。決まりは AGENTS.md か verify へ。ZB03③ 2026-11）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const lineCount = (text) =>
  text.split("\n").length - (text.endsWith("\n") ? 1 : 0);

const LIMITS = [
  ["AGENTS.md", 200],
  [".claude/CLAUDE.md", 30],
];

// 安全の6点（AGENTS.md「安全の6点」）。語が消えたら落とす
const SAFETY_TERMS = [
  ["主語", "作り手"],
  ["1 .env の無い複製", ".env` の無い複製で作業する"],
  ["2 本番 Supabase", "本番 Supabase に接続しない"],
  ["3 マイグレーション", "マイグレーションを作らない"],
  ["4 変えてはならない物: .claude", "`.claude/` の全部"],
  ["4 変えてはならない物: workflows", "`.github/workflows/` の全部"],
  [
    "4 変えてはならない物: package.json の scripts",
    "`package.json` の `scripts`",
  ],
  ["4 変えてはならない物: verify の期待値", "verify の期待値"],
  ["4 変えてはならない物: vercel.json", "`vercel.json`"],
  ["5 300行5ファイル", "300行・5ファイル以内"],
  ["6 マージしない", "マージしない"],
];

const agents = read("AGENTS.md");
const entry = read(".claude/CLAUDE.md");

const rulesDir = path.join(ROOT, ".claude/rules");
const rulesDirExists = fs.existsSync(rulesDir);

// 行頭の `@パス`（取り込み）を、書いたファイルの置き場からの相対で解く
const IMPORT_SOURCES = ["AGENTS.md", ".claude/CLAUDE.md"];
const brokenImports = IMPORT_SOURCES.flatMap((rel) =>
  read(rel)
    .split("\n")
    .map((line) => line.trim().match(/^@(\S+)$/))
    .filter(Boolean)
    .map((m) => m[1])
    .filter((target) => {
      const resolved = path.resolve(ROOT, path.dirname(rel), target);
      return !(fs.existsSync(resolved) && fs.statSync(resolved).isFile());
    })
    .map(
      (target) =>
        `${rel} の \`@${target}\` の先（${path.join(path.dirname(rel), target)}）が無い。@ の先は ${rel} の置き場からの相対で解かれ、無ければ黙って何も取り込まない`,
    ),
);

const failures = [
  ...LIMITS.map(([rel, max]) => {
    const n = lineCount(read(rel));
    return n < max
      ? null
      : `${rel} が ${n} 行（${max} 行未満にする。1行足すなら1行削る）`;
  }),
  /^@\.\.\/AGENTS\.md$/m.test(entry)
    ? null
    : ".claude/CLAUDE.md に `@../AGENTS.md` の取り込みの行が無い（`@AGENTS.md` は .claude/AGENTS.md を指す）",
  ...brokenImports,
  ...SAFETY_TERMS.map(([label, term]) =>
    agents.includes(term)
      ? null
      : `AGENTS.md から安全の決まり「${label}」の語（${term}）が消えた`,
  ),
  rulesDirExists
    ? ".claude/rules/ が在る（rules は常時でも paths 付きでも置かない。決まりは AGENTS.md か verify へ、対話の手順は skill へ）"
    : null,
].filter(Boolean);

if (failures.length > 0) {
  console.error("verify-agents-entry: NG");
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log(
  `verify-agents-entry: OK（AGENTS.md ${lineCount(agents)} 行・.claude/CLAUDE.md ${lineCount(entry)} 行・安全の語 ${SAFETY_TERMS.length} 件・@ の取り込み先は実在・.claude/rules/ は無い）`,
);
