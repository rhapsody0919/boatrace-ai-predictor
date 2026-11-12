/**
 * verify-doc-placement.js - 文書の置き場の決まりを試験にする（ZB03 ②、BOA-1455）。
 * ネットワークにも DB にも接続しない。見るのはファイルの名前だけで、中身を読むのは根の .gitignore だけ。
 *
 * 決まり（正本 .claude/rules/documentation.md「新規ドキュメント作成フロー」「ファイル命名規則」）:
 *   (a) ルートディレクトリには置かない → 根のファイル・ディレクトリの一覧を ROOT_FROZEN で凍結し、無い名前が増えたら失敗
 *       （.git・node_modules と、根の .gitignore の1段の型に当たる物＝手元の生成物 dist・test-results 等は除く）
 *   (b) ファイル名は kebab-case（例外 README.md・TODO.md・AGENTS.md）→ docs/ の下（docs/db-migration/ を除く）の
 *       kebab-case でないファイルの件数を DOCS_FROZEN で凍結し、増えたら失敗
 *   どちらも減ったら成功のまま「凍結を下げる・一覧から消す」と出す。
 * 起動のたびに純関数の自己試験（文字列だけを与える）を先に回し、落ちたら失敗にする。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
// origin/master 5559fbe8c の根（2026-11-12、33 個）。根に足すときは理由を PR 本文に書いてここに足す。消したらここからも消す
const ROOT_FROZEN = [
  ".claude",
  ".env.example",
  ".github",
  ".gitignore",
  ".mcp.json",
  ".npmrc",
  ".worktreeinclude",
  "AGENTS.md",
  "README.md",
  "analysis",
  "api",
  "config",
  "convert_to_note_markdown.py",
  "data",
  "docs",
  "e2e",
  "eslint.config.js",
  "index.html",
  "middleware.js",
  "note-articles",
  "package-lock.json",
  "package.json",
  "playwright.acceptance.config.js",
  "playwright.config.js",
  "playwright.deadline-queue.config.js",
  "playwright.existing-fixes.config.js",
  "playwright.x-send.config.js",
  "public",
  "scripts",
  "sns-video-studio",
  "src",
  "vercel.json",
  "vite.config.js",
];
// origin/master 5559fbe8c で数えた docs/ の kebab-case でないファイルの数（2026-11-12）。減らしたら下げる
const DOCS_FROZEN = 188;
const ROOT_SKIP = [".git", "node_modules"];
const DOCS_SKIP = "docs/db-migration";
const NAME_EXCEPTIONS = ["README.md", "TODO.md", "AGENTS.md"];
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HOW_TO_FIX = {
  root: "根には置かない。docs/ の置き場の表（.claude/rules/documentation.md）から選んで移すか消す。手元だけの生成物なら .gitignore に足す",
  docs: "docs/ のファイル名は kebab-case にする（例外 README.md・TODO.md・AGENTS.md。.claude/rules/documentation.md「ファイル命名規則」）",
};

// 純関数: .gitignore の本文 → 根の名前に当てる正規表現の一覧（/ を中に含まない型だけ。否定 ! は扱わず、除く側に倒さない）
export const rootIgnoreRules = (text) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("!"))
    .map((l) => l.replace(/^\//, "").replace(/\/$/, ""))
    .filter((l) => l && !l.includes("/"))
    .map((l) => new RegExp(`^${l.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]")}$`));

// 純関数: 名前 → kebab-case か（拡張子は最初の . から後を外す。. で始まる名前は名前全体）
export const isKebab = (name) =>
  NAME_EXCEPTIONS.includes(name) || KEBAB.test(name.startsWith(".") ? name : name.split(".")[0]);

// 純関数: 根の名前・docs の相対パス・凍結 → {ok, lines}
export const judge = ({ rootNames, docFiles }, { rootFrozen, docsFrozen }) => {
  const added = rootNames.filter((n) => !rootFrozen.includes(n)).sort();
  const gone = rootFrozen.filter((n) => !rootNames.includes(n));
  const bad = docFiles.filter((f) => !isKebab(path.posix.basename(f))).sort();
  const ng = [
    ...(added.length > 0
      ? [`  - (a) 根に新しい物 ${added.length} 個: ${added.join("・")}`, `    直し方: ${HOW_TO_FIX.root}`]
      : []),
    ...(bad.length > docsFrozen
      ? [
          `  - (b) docs/ の kebab-case でないファイル ${bad.length} 件（凍結 ${docsFrozen} 件より ${bad.length - docsFrozen} 件増えた）。全件:`,
          ...bad.map((f) => `      ${f}`),
          `    直し方: ${HOW_TO_FIX.docs}`,
        ]
      : []),
  ];
  if (ng.length > 0) return { ok: false, lines: ["verify-doc-placement: NG", ...ng] };
  const notes = [
    ...(gone.length > 0 ? [`根から無くなった ${gone.join("・")} を ROOT_FROZEN から消す`] : []),
    ...(bad.length < docsFrozen ? [`docs の件数が減ったので DOCS_FROZEN を ${bad.length} に下げる`] : []),
  ];
  return {
    ok: true,
    lines: [
      `verify-doc-placement: OK（根 ${rootNames.length} 個は全て一覧の内、docs の kebab-case でない ${bad.length}/${docsFrozen} 件${notes.length ? `。${notes.join("・")}` : ""}）`,
    ],
  };
};

const selfTest = () => {
  const rules = rootIgnoreRules("# c\ndist\n/test-results/\n*.log\n!keep.log\ndata/ml/\n");
  const ignored = (n) => rules.some((r) => r.test(n));
  const frozen = { rootFrozen: ["src", "docs"], docsFrozen: 1 };
  const base = { rootNames: ["src", "docs"], docFiles: ["docs/a/good-name.md", "docs/a/Bad_Name.md", "docs/README.md"] };
  const checks = [
    [".gitignore の1段の型（dist・/test-results/・*.log）だけを除き、data/ml/ は根に当てない",
      ignored("dist") && ignored("test-results") && ignored("x.log") && !ignored("data") && !ignored("ml")],
    ["kebab-case の判定（拡張子は外す・例外の名前は通す）",
      isKebab("good-name.dc.html") && !isKebab("Main.dc.html") && !isKebab("a_b.md") && isKebab("AGENTS.md")],
    ["凍結と同じなら成功", judge(base, frozen).ok === true],
    ["根に新しい物があると失敗", judge({ ...base, rootNames: [...base.rootNames, "plan.md"] }, frozen).ok === false],
    ["docs の kebab でない物が増えると失敗",
      judge({ ...base, docFiles: [...base.docFiles, "docs/x/New_File.md"] }, frozen).ok === false],
    ["根から消えた・docs が減ったら成功で消す・下げるよう出す",
      judge({ rootNames: ["src"], docFiles: ["docs/a/good-name.md"] }, frozen).lines[0].includes("下げる")],
  ];
  return checks.filter(([, pass]) => !pass).map(([name]) => name);
};

// 根からの相対パス（/ 区切り）で辿る。名前だけを集め、中身は開かない
const listFiles = (rel) =>
  fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true }).flatMap((d) => {
    const child = `${rel}/${d.name}`;
    if (d.isDirectory()) return child === DOCS_SKIP ? [] : listFiles(child);
    return [child];
  });

const main = () => {
  const broken = selfTest();
  if (broken.length > 0) {
    console.error(`verify-doc-placement: 自己試験が落ちた（${broken.join("・")}）`);
    process.exit(1);
  }
  const ignorePath = path.join(ROOT, ".gitignore");
  const rules = fs.existsSync(ignorePath) ? rootIgnoreRules(fs.readFileSync(ignorePath, "utf8")) : [];
  const rootNames = fs
    .readdirSync(ROOT)
    .filter((n) => !ROOT_SKIP.includes(n) && !rules.some((r) => r.test(n)));
  const docFiles = listFiles("docs");
  const { ok, lines } = judge({ rootNames, docFiles }, { rootFrozen: ROOT_FROZEN, docsFrozen: DOCS_FROZEN });
  (ok ? console.log : console.error)(lines.join("\n"));
  if (!ok) process.exit(1);
};

// /tmp 等の symlink の下から起動しても main が走るよう、両方を realpath で比べる（走らないと無出力の偽の緑）
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) main();
