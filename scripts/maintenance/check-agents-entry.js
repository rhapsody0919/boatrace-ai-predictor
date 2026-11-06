/**
 * check-agents-entry.js - 作り手が毎回読む入口（AGENTS.md・.claude/CLAUDE.md）を短く保ち、安全の6点が残っているかを見る。
 * ファイルを読むだけで、ネットワークにも DB にも接続しない。
 * 名前が check- なのは、verify-registry.json への登録を #2311（同じ台帳を変える）のマージの後にするため。
 * その後 verify-agents-entry.js へ改名し、tier ci で登録して CI に入れる。
 *
 * 守るもの:
 *   (a) AGENTS.md は200行未満（公式の目安 code.claude.com/docs/en/memory.md）、.claude/CLAUDE.md は30行未満（入口だけ）。
 *       1行足すなら1行削るを機械にする
 *   (b) .claude/CLAUDE.md が `@AGENTS.md` で AGENTS.md を取り込む（Claude は AGENTS.md を自動では読まない）
 *   (c) AGENTS.md に安全の6点の語が残っている（主語は「作り手」）
 *   (d) .claude/rules/*.md が全て frontmatter の paths を持つ（常時の rules を置かない）
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
const alwaysOnRules = fs
  .readdirSync(rulesDir)
  .filter((name) => name.endsWith(".md"))
  .filter((name) => {
    const text = fs.readFileSync(path.join(rulesDir, name), "utf8");
    const front = text.match(/^---\n([\s\S]*?)\n---/);
    return !(front && /^paths:/m.test(front[1]));
  });

const failures = [
  ...LIMITS.map(([rel, max]) => {
    const n = lineCount(read(rel));
    return n < max
      ? null
      : `${rel} が ${n} 行（${max} 行未満にする。1行足すなら1行削る）`;
  }),
  /^@AGENTS\.md$/m.test(entry)
    ? null
    : ".claude/CLAUDE.md に `@AGENTS.md` の取り込みの行が無い",
  ...SAFETY_TERMS.map(([label, term]) =>
    agents.includes(term)
      ? null
      : `AGENTS.md から安全の決まり「${label}」の語（${term}）が消えた`,
  ),
  ...alwaysOnRules.map(
    (name) =>
      `.claude/rules/${name} に frontmatter の paths が無い（常時の rules は置かない。AGENTS.md か skill へ）`,
  ),
].filter(Boolean);

if (failures.length > 0) {
  console.error("check-agents-entry: NG");
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log(
  `check-agents-entry: OK（AGENTS.md ${lineCount(agents)} 行・.claude/CLAUDE.md ${lineCount(entry)} 行・安全の語 ${SAFETY_TERMS.length} 件・rules は全て paths 付き）`,
);
