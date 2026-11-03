#!/usr/bin/env node
/**
 * e2e-scope.js（PR ゲートの e2e をどこまで流すか）の判定を固定の入力で検査する（BOA-929）。
 * 外部ネットワーク・実DBには触らない。
 *
 * 守るもの: 記事だけの PR は軽い組、docs と e2e が読まないパス（.claude 等、ADR-0100 追記）だけは0件、
 * src・scripts（verify・sns・analysis を除く）・e2e・.github・package*.json・設定を触る PR は必ず全部。
 * 0件の一覧のパスが e2e・src・設定から import・相対のパスで読まれていないこと（閉包）。PR の側で一覧を書き換えても、master の一覧で判定すれば全部に戻る。
 */

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyE2eScope,
  GATE_CONFIG_PATH,
  grandfatherRemovals,
} from "./e2e-scope.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const config = JSON.parse(
  readFileSync(
    path.join(repoRoot, "scripts/content/content-pr-gate.json"),
    "utf8",
  ),
);
const failures = [];
let checked = 0;
function check(label, actual, expected) {
  checked += 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    failures.push(
      `${label}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`,
    );
}
const scopeOf = (files, cfg = config, opts) =>
  classifyE2eScope(files, cfg, opts).scope;

// --- 軽い組（記事の中身だけ） ---
check(
  "記事の .md と JSON だけは軽い組",
  scopeOf([
    "public/blog/foo.md",
    "src/data/blog-posts/foo.json",
    "public/images/blog/foo.jpg",
  ]),
  "light",
);
check(
  "翻訳の記事 JSON も軽い組",
  scopeOf(["src/data/blog-posts/en/foo.json"]),
  "light",
);
check(
  "図の JSON・content-manifests も軽い組",
  scopeOf(["public/blog-charts/a.json", "docs/content-manifests/a.json"]),
  "light",
);
check(
  "記事と docs の混在は軽い組",
  scopeOf(["public/blog/foo.md", "docs/knowledge/x.md"]),
  "light",
);

// --- 0件（docs だけ） ---
check(
  "docs だけは0件",
  scopeOf(["docs/adr/0100-e2e-scope-by-diff.md", "docs/knowledge/a.md"]),
  "none",
);
check(
  "docs/content-manifests だけは0件にしない（記事の一部）",
  scopeOf(["docs/content-manifests/a.json"]),
  "light",
);

// --- 全部 ---
for (const file of [
  "src/App.jsx",
  "src/data/blogPosts.js",
  "src/data/blog-posts/sub/dir/x.json",
  "scripts/maintenance/e2e-scope.js",
  "scripts/content/content-pr-gate.json",
  "e2e/smoke.spec.js",
  ".github/workflows/e2e-smoke-test.yml",
  "package.json",
  "package-lock.json",
  "vite.config.js",
  "playwright.config.js",
  "public/blog/nested/x.md",
  "public/images/blog/x.png",
  "README.md",
]) {
  check(
    `${file} を触る PR は全部`,
    scopeOf(["public/blog/foo.md", "docs/a.md", file]),
    "full",
  );
}
check(
  "src から記事へ改名した PR は元のパスも見て全部",
  scopeOf(["src/components/Old.jsx", "public/blog/new.md"]),
  "full",
);
check("空の差分は全部に倒す", scopeOf([]), "full");
check(
  "一覧の外のパスを理由に出す",
  classifyE2eScope(["public/blog/a.md", "src/b.js"], config).outside,
  ["src/b.js"],
);

// --- 免除の一覧から外すだけの設定の変更（オーナー決定 2026-10-26、#1934→#1938） ---
{
  const list = config.internalLinkGrandfathered;
  const removed = { ...config, internalLinkGrandfathered: list.slice(1) };
  check(
    "一覧から1行を外すだけなら外した行を返す",
    grandfatherRemovals(config, removed),
    [list[0]],
  );
  check(
    "行を足すと null",
    grandfatherRemovals(config, {
      ...config,
      internalLinkGrandfathered: [...list, "public/blog/x.md"],
    }),
    null,
  );
  check(
    "外して足すと null",
    grandfatherRemovals(config, {
      ...config,
      internalLinkGrandfathered: [...list.slice(1), "public/blog/x.md"],
    }),
    null,
  );
  check(
    "残った行の並べ替えは null",
    grandfatherRemovals(config, {
      ...config,
      internalLinkGrandfathered: [...list.slice(2), list[1]],
    }),
    null,
  );
  check(
    "他のキーの変更が混ざると null",
    grandfatherRemovals(config, {
      ...removed,
      allowedPathPatterns: [...config.allowedPathPatterns, "^src/"],
    }),
    null,
  );
  check(
    "キーの順の変更は null",
    grandfatherRemovals(config, {
      internalLinkGrandfathered: removed.internalLinkGrandfathered,
      ...Object.fromEntries(
        Object.entries(config).filter(
          ([k]) => k !== "internalLinkGrandfathered",
        ),
      ),
    }),
    null,
  );
  check(
    "変更なし（整形だけ）は null",
    grandfatherRemovals(config, config),
    null,
  );
  const articlePr = [
    "public/blog/foo.md",
    "src/data/blog-posts/foo.json",
    "docs/content-manifests/foo.json",
    GATE_CONFIG_PATH,
  ];
  check(
    "記事の PR に一覧から外すだけの設定の変更が混ざっても軽い組",
    scopeOf(articlePr, config, { gateConfigRemovalOnly: true }),
    "light",
  );
  check(
    "削除だけと確かめていなければ全部（今までどおり）",
    scopeOf(articlePr),
    "full",
  );
  check(
    "削除だけでも src が混ざれば全部",
    scopeOf([...articlePr, "src/App.jsx"], config, {
      gateConfigRemovalOnly: true,
    }),
    "full",
  );
  check(
    "印は設定のパスにだけ効く（e2e-scope.js 自身は全部）",
    scopeOf([...articlePr, "scripts/maintenance/e2e-scope.js"], config, {
      gateConfigRemovalOnly: true,
    }),
    "full",
  );
}

// --- CLI の配線: CI のチェックアウト（HEAD）の設定を git show で読んで判定する ---
// 一時の git リポジトリに base の設定を置き、HEAD で一覧から外す（または足す）。CI と同じく --config に base を渡す
{
  const script = fileURLToPath(new URL("./e2e-scope.js", import.meta.url));
  const runCli = (headConfig) => {
    const dir = mkdtempSync(path.join(tmpdir(), "e2e-scope-"));
    try {
      const git = (...args) =>
        execFileSync(
          "git",
          ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args],
          { cwd: dir, stdio: "pipe" },
        );
      const gatePath = path.join(dir, GATE_CONFIG_PATH);
      mkdirSync(path.dirname(gatePath), { recursive: true });
      git("init", "-q");
      writeFileSync(gatePath, JSON.stringify(config, null, 2));
      git("add", ".");
      git("commit", "-q", "-m", "base");
      writeFileSync(gatePath, JSON.stringify(headConfig, null, 2));
      git("commit", "-q", "-am", "head");
      const basePath = path.join(dir, "base-config.json");
      writeFileSync(basePath, JSON.stringify(config));
      const filesPath = path.join(dir, "files.txt");
      writeFileSync(
        filesPath,
        ["public/blog/foo.md", GATE_CONFIG_PATH].join("\n"),
      );
      return execFileSync(
        process.execPath,
        [script, "--config", basePath, "--files", filesPath],
        { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ).trim();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const list = config.internalLinkGrandfathered;
  check(
    "CLI: HEAD が一覧から外すだけなら light",
    runCli({ ...config, internalLinkGrandfathered: list.slice(1) }),
    "scope=light",
  );
  check(
    "CLI: HEAD が一覧に足すなら full",
    runCli({
      ...config,
      internalLinkGrandfathered: [...list, "public/blog/x.md"],
    }),
    "scope=full",
  );
}

// --- 一覧の改ざん ---
// PR の側で一覧に src を足しても、master の一覧（ここでは今のファイル）で判定すれば全部に戻る
const tampered = {
  ...config,
  allowedPathPatterns: [...config.allowedPathPatterns, "^src/", "^scripts/"],
};
const tamperedDiff = [
  "scripts/content/content-pr-gate.json",
  "src/App.jsx",
  "public/blog/a.md",
];
check(
  "改ざんした一覧では軽い組に見える（前提の確認）",
  scopeOf(tamperedDiff, tampered),
  "light",
);
check("master の一覧で判定すれば全部", scopeOf(tamperedDiff, config), "full");

// --- e2e が読む docs/ のファイルは0件にしない（代替審査の P1） ---
// docs/ だけの PR を0件にすると、e2e が ../docs/ から読むファイルの変更が e2e を通らずにマージされる
{
  const e2eDir = path.join(repoRoot, "e2e");
  const reads = new Set();
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (/\.(js|mjs|cjs)$/.test(ent.name)) {
        for (const m of readFileSync(full, "utf8").matchAll(
          /\.\.\/(?:\.\.\/)*(docs\/[^"'`\s)]+)/g,
        ))
          reads.add(m[1]);
      }
    }
  };
  walk(e2eDir);
  check(
    "e2e が docs/ を読む箇所を1つ以上見つける（検査の前提）",
    reads.size > 0,
    true,
  );
  for (const file of reads) {
    check(
      `e2e が読む ${file} を変える PR は0件にしない`,
      scopeOf([file]) !== "none",
      true,
    );
  }
}

// --- docs 以外の0件（CI の分数の削減 段2b、ADR-0100 追記） ---
for (const files of [
  [".claude/rules/a.md", ".claude/hooks/x.sh"],
  ["sns-video-studio/remotion/src/A.jsx"],
  [
    "scripts/maintenance/verify-foo.js",
    "scripts/maintenance/verify-registry.json",
  ],
  ["scripts/sns/push-x.js", "scripts/analysis/a.mjs", "docs/a.md"],
]) {
  check(`${files.join("・")} だけは0件`, scopeOf(files), "none");
}
for (const file of [
  "scripts/maintenance/e2e-recording.js",
  "scripts/maintenance/e2e-shards.js",
  "scripts/maintenance/guard-pr-merge.js",
  "scripts/maintenance/verify/x.js",
  "scripts/lib/hitCalculator.js",
  "scripts/daily/scrape-odds.js",
  "scripts/maintenance/verify-e2e-scope.js",
  "api/a.js",
]) {
  check(
    `${file} を触る PR は全部（0件の一覧と混ぜても）`,
    scopeOf([".claude/a.md", file]),
    "full",
  );
}

// --- 0件にするパスは、e2e が読むファイルに入らない（段2b の守り、ADR-0100 追記） ---
// e2e の run が読むのは、e2e/・src/（画面の束）・playwright と vite の設定・index.html・e2e のワークフローが
// node で呼ぶ scripts と、そこから辿れるファイル。src は scripts/lib を直に import する（hitCalculator 等）ので、
// 一覧に scripts/lib を入れると画面の不具合を通す道になる。名前でなく辿れる先で確かめる。
// 辿り方: 相対・`/` 始まり（vite は root から解く）の import（静的・動的・require・new URL・括弧の中のコメント可）、
// CSS の @import・url()、"../..." の相対のパスの文字列（`${` の前まで。ディレクトリはその下の全部）、
// Node 側のファイル（src の外）では一覧の頭で始まるパスの文字列（cwd・ROOT から組み立てる読み）。

/** 一覧の正規表現の頭の文字列（`^` の後ろ、最初の正規表現の記号の前まで）。docs は別に扱う（純関数） */
export function skipPrefixes(cfg) {
  return cfg.e2eSkipPathPatterns
    .map((p) => {
      let out = "";
      for (let i = p.startsWith("^") ? 1 : 0; i < p.length; i += 1) {
        if (p[i] === "\\" && i + 1 < p.length) {
          out += p[i + 1];
          i += 1;
        } else if ("[](){}?*+|$.".includes(p[i])) break;
        else out += p[i];
      }
      return out;
    })
    .filter((x) => x && !x.startsWith("docs/"));
}

/** 読む先 p（ファイルか、`/` で終わるディレクトリか、`${` で切れた頭）が一覧に当たるか（純関数） */
export function readHitsSkip(p, prefixes, cfg) {
  if (!p) return false;
  if (p.startsWith("docs/"))
    return (
      classifyE2eScope([p.endsWith("/") ? `${p}x.json` : p], cfg).scope ===
      "none"
    );
  // 頭が一覧の中（p が一覧の下）か、一覧が p の下（ディレクトリ・切れた頭の読みが一覧のファイルを含みうる）
  return prefixes.some((x) => p.startsWith(x) || x.startsWith(p));
}

const SPEC = String.raw`(\.{1,2}\/[^"'\x60$]*|\/(?!\/)[^"'\x60$]*)`;
const IMPORT_RE = new RegExp(
  String.raw`(?:\bfrom\s*|\bimport\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)*|\bimport\s+|\brequire\s*\(\s*|new URL\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)*|\bsrc=|\bhref=)["'\x60]` +
    SPEC +
    String.raw`(?:\$\{|["'\x60])`,
  "g",
);
const CSS_RE = /(?:@import\s+(?:url\(\s*)?|url\(\s*)["']?([^"')\s;]+)/g;
const UP_RE = /["'`]((?:\.\.\/)+[^"'`\s]*?)(?:\$\{|["'`])/g;
const LITERAL_RE = /["'`](?:\.\/)?([^"'`\s$]+?)(?:\$\{|["'`])/g;
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * 1つのファイルの中身から、辿る先（specs: 指定の文字列）と、一覧の頭で始まる文字列（literals）を集める（純関数）。
 * nodeSide: src の外（Node で動くので cwd・ROOT から組み立てて読みうる）
 */
export function scanText(
  text,
  { css = false, nodeSide = false, prefixes = [] } = {},
) {
  const specs = [];
  for (const m of text.matchAll(css ? CSS_RE : IMPORT_RE)) specs.push(m[1]);
  if (!css) for (const m of text.matchAll(UP_RE)) specs.push(m[1]);
  const literals = [];
  if (nodeSide && !css)
    for (const m of stripComments(text).matchAll(LITERAL_RE))
      if (prefixes.some((x) => m[1].startsWith(x))) literals.push(m[1]);
  return { specs, literals };
}

// 固定の入力（scanText・readHitsSkip が穴を拾うこと）
{
  const prefixes = skipPrefixes(config);
  check(
    "一覧の頭",
    prefixes.includes("scripts/sns/") &&
      prefixes.includes(".claude/") &&
      prefixes.includes("scripts/maintenance/verify-"),
    true,
  );
  const s = scanText(
    [
      'import a from "../scripts/sns/a.js";',
      'const b = await import(/* @vite-ignore */ "/scripts/analysis/b.js");',
      "const c = readFileSync(`../scripts/maintenance/${name}`);",
      'const d = new URL("../scripts/sns", import.meta.url);',
      'const e = path.join(ROOT, "scripts/sns/e.json");',
      '// "scripts/sns/comment.json" はコメントなので数えない',
    ].join("\n"),
    { nodeSide: true, prefixes },
  );
  check(
    "相対・`/` 始まり・コメントつきの動的 import を拾う",
    s.specs.includes("../scripts/sns/a.js") &&
      s.specs.includes("/scripts/analysis/b.js"),
    true,
  );
  check("Node 側の ROOT からの文字列を拾い、コメントは数えない", s.literals, [
    "scripts/sns/e.json",
  ]);
  const hit = (p) => readHitsSkip(p, prefixes, config);
  check(
    "`${` で切れた頭の読み（scripts/maintenance/）は verify を含みうるので当たり",
    hit("scripts/maintenance/"),
    true,
  );
  check(
    "末尾の / が無いディレクトリの読み（scripts/sns）も当たり",
    hit("scripts/sns"),
    true,
  );
  check(
    "scripts/lib の読みは当たらない",
    hit("scripts/lib/__fixtures__/odds/"),
    false,
  );
  check(
    "e2e が読む docs の例の JSON は当たらない",
    hit("docs/design/blog-charts/a.json"),
    false,
  );
  check("docs の他は当たり", hit("docs/a.md"), true);
  check(
    "CSS の @import・url() を拾う",
    scanText(
      '@import "../../sns-video-studio/a.css"; .x{background:url(../img/a.png)}',
      { css: true },
    ).specs,
    ["../../sns-video-studio/a.css", "../img/a.png"],
  );
}

{
  const prefixes = skipPrefixes(config);
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
  const statOf = (p) => {
    try {
      return statSync(p);
    } catch {
      return null;
    }
  };
  const inRepo = (abs) =>
    abs === repoRoot || abs.startsWith(repoRoot + path.sep);
  const listFiles = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((ent) =>
      ent.isDirectory()
        ? listFiles(path.join(dir, ent.name))
        : [path.join(dir, ent.name)],
    );
  // e2e のワークフローが node で呼ぶ scripts（集約の検査・素通しの一覧・組の分け方）も根にする
  const workflowScripts = [
    "e2e-smoke-test.yml",
    "e2e-rerecord.yml",
    "e2e-live.yml",
  ].flatMap((f) =>
    [
      ...readFileSync(
        path.join(repoRoot, ".github/workflows", f),
        "utf8",
      ).matchAll(/\bnode (scripts\/[\w./-]+\.m?js)\b/g),
    ].map((m) => path.join(repoRoot, m[1])),
  );
  const roots = [
    ...listFiles(path.join(repoRoot, "e2e")),
    ...listFiles(path.join(repoRoot, "src")),
    ...["playwright.config.js", "vite.config.js", "index.html"].map((f) =>
      path.join(repoRoot, f),
    ),
    ...workflowScripts,
  ].filter((p) => statOf(p)?.isFile());
  check(
    "ワークフローが呼ぶ scripts を根に入れた（検査の前提）",
    workflowScripts.length > 0,
    true,
  );
  const reachable = new Set(roots);
  const queue = [...roots];
  const reads = new Set();
  const leakedLiterals = [];
  while (queue.length > 0) {
    const file = queue.pop();
    const css = /\.css$/.test(file);
    if (!css && !/\.(js|jsx|mjs|cjs|html)$/.test(file)) continue;
    const rel = path.relative(repoRoot, file);
    const { specs, literals } = scanText(readFileSync(file, "utf8"), {
      css,
      nodeSide: !rel.startsWith("src/"),
      prefixes,
    });
    for (const l of literals) leakedLiterals.push(`${rel}: ${l}`);
    for (const spec of specs) {
      const clean = spec.split("?")[0].split("#")[0];
      if (!clean || /^\/\//.test(clean)) continue;
      const base = clean.startsWith("/")
        ? path.join(repoRoot, clean)
        : path.resolve(path.dirname(file), clean);
      if (!inRepo(base)) continue;
      const cut = /\/$/.test(clean) || spec !== clean ? "/" : "";
      const target = exts.map((e) => base + e).find((p) => statOf(p)?.isFile());
      if (target) {
        reads.add(path.relative(repoRoot, target));
        if (!reachable.has(target)) {
          reachable.add(target);
          queue.push(target);
        }
      } else if (statOf(base)?.isDirectory() || cut) {
        // ディレクトリ・`${` で切れた頭の読み。その下の全部を読みうるものとして判定する
        reads.add(`${path.relative(repoRoot, base)}/`.replace(/\/+$/, "/"));
      } else {
        // 解けない指定（public/ の URL・書き出し先・拡張子の無い頭）も黙って捨てず、頭として一覧と照らす
        reads.add(path.relative(repoRoot, base));
      }
    }
  }
  const rels = [...reachable].map((f) => path.relative(repoRoot, f));
  check(
    "閉包が src から scripts/lib を辿る（検査の前提）",
    rels.includes("scripts/lib/hitCalculator.js"),
    true,
  );
  check(
    "閉包が e2e から scripts/maintenance を辿る（検査の前提）",
    rels.includes("scripts/maintenance/e2e-recording.js"),
    true,
  );
  check(
    "閉包が CSS を辿る（検査の前提）",
    rels.some((f) => f.endsWith(".css")),
    true,
  );
  check(
    "e2e が読むファイル・ディレクトリは0件の一覧に当たらない",
    [...reads, ...rels].filter((p) => readHitsSkip(p, prefixes, config)),
    [],
  );
  check("Node 側に一覧の頭で始まるパスの文字列が無い", leakedLiterals, []);
}

// --- 設定が無い・壊れているときは例外（CLI は full に倒す） ---
let threw = false;
try {
  classifyE2eScope(["public/blog/a.md"], { allowedPathPatterns: ["^x"] });
} catch {
  threw = true;
}
check("e2eSkipPathPatterns が無い設定は例外", threw, true);

if (failures.length > 0) {
  console.error("NG: e2e-scope の検査に失敗");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`OK: e2e-scope の判定${checked}件を検証`);
