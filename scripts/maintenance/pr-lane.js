/**
 * PR の差分が「軽い道」か「重い道」かを判定する（試作・影。どこからも呼ばない）。
 * 設計: docs/proposal/dev-process-redesign-2026-11-05.md 1.2（#2277）。H の一覧は config/pr-path-rules.json。
 *
 * 使い方: node scripts/maintenance/pr-lane.js --base <sha> --head <sha> [--repo <git のディレクトリ>]
 *   標準出力: { "lane": "light"|"heavy", "hits": [{ "rule": "H1"〜"H9", "file", "reason" }] }
 *   終了コード: 0＝判定できた。0 以外＝判定できない（呼び手は heavy として扱う。標準出力には lane: heavy と error を出す）
 *   --repo: 差分と木を読む git の作業ディレクトリ（既定は今のディレクトリ）。規則はこのスクリプトの隣（../../config）から読む
 *
 * 差分は base と head の merge-base から head まで（three-dot と同じ）、--no-renames（名前を変えたファイルは元のパスでも判定する）。
 * import の閉包（H2・H6）は merge-base と head の両方のコミットの木を git から読んで辿る（手元のファイルは見ない。消したファイルも元の木で辿る）。
 * DB・ネットワークには触れない。
 */
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CODE, reach } from "../lib/relativeImportGraph.js";

const SELF_ROOT = fileURLToPath(new URL("../../", import.meta.url));
/** コミットの木を辿るときの仮の絶対パスの根（手元のファイルと混ざらないよう実在しない名前にする） */
export const TREE_ROOT = "/__pr_lane_tree__";
const MAX_BUFFER = 1024 * 1024 * 1024;

/** 規則を読む（risk-rules の platforms: all の語を H9 に足す） */
export function loadRules(root = SELF_ROOT) {
  const config = JSON.parse(
    readFileSync(join(root, "config/pr-path-rules.json"), "utf8"),
  );
  return config.rules.map((rule) => {
    if (!rule.terms) return rule;
    const risk = rule.terms.riskRules
      ? JSON.parse(readFileSync(join(root, rule.terms.riskRules), "utf8"))
      : { rules: [] };
    const fromRisk = risk.rules
      .filter((r) => r.platforms === "all")
      .flatMap((r) => r.patterns);
    return {
      ...rule,
      terms: {
        ...rule.terms,
        words: [...new Set([...rule.terms.words, ...fromRisk])],
      },
    };
  });
}

const anyMatch = (patterns = [], path) =>
  patterns.some((p) => new RegExp(p).test(path));

const count = (lines, word) =>
  lines.reduce((n, line) => n + line.split(word).length - 1, 0);

/**
 * import の閉包: reachFrom の入口から届く差分のファイル → 経路
 * @param {{ files: string[], io: import("../lib/relativeImportGraph.js").GraphIo }[]} trees
 * @returns {Map<string, string>} 差分のファイル → 理由
 */
function reachedFiles(entryPatterns, trees, changedSet) {
  const found = new Map();
  for (const tree of trees) {
    const starts = tree.files
      .filter(
        (f) =>
          CODE.test(f) &&
          !/(^|\/)node_modules\//.test(f) &&
          anyMatch(entryPatterns, f),
      )
      .map((f) => `${TREE_ROOT}/${f}`);
    const { via, missing } = reach(starts, tree.io);
    const rel = (p) => p.slice(TREE_ROOT.length + 1);
    for (const [abs, path] of via) {
      const file = rel(abs);
      if (changedSet.has(file) && !found.has(file))
        found.set(file, `入口から届く: ${path.map(rel).join(" → ")}`);
    }
    // 差分のファイル自身の import の行き先が見つからないときは、届く先を確かめられないので当てる（安全側）
    for (const m of missing) {
      const file = rel(m.from);
      if (changedSet.has(file) && via.has(m.from) && !found.has(file))
        found.set(file, `参照先が見つからない import（安全側）: ${m.spec}`);
    }
  }
  return found;
}

/**
 * 判定の本体（git に触れない）
 * @param {{
 *   changes: { status: string, path: string }[],
 *   patches?: Map<string, { added: string[], removed: string[] }>,
 *   trees?: { files: string[], io: import("../lib/relativeImportGraph.js").GraphIo }[],
 *   rules?: object[],
 * }} input
 * @returns {{ lane: "light"|"heavy", hits: { rule: string, file: string, reason: string }[] }}
 */
export function classify({
  changes,
  patches = new Map(),
  trees = [],
  rules = loadRules(),
}) {
  const changedSet = new Set(changes.map((c) => c.path));
  const hits = [];
  const hit = (rule, file, reason) => {
    if (!hits.some((h) => h.rule === rule.id && h.file === file))
      hits.push({ rule: rule.id, file, reason });
  };
  for (const rule of rules) {
    for (const { status, path } of changes) {
      const added = status === "A";
      if (anyMatch(rule.except, path)) continue;
      if (added && anyMatch(rule.exceptAdded, path)) continue;
      const p = (rule.paths ?? []).find((re) => new RegExp(re).test(path));
      if (p) hit(rule, path, `パス ${p}`);
      const a =
        added && (rule.added ?? []).find((re) => new RegExp(re).test(path));
      if (a) hit(rule, path, `新しいファイル ${a}`);
      const c =
        !added && (rule.changed ?? []).find((re) => new RegExp(re).test(path));
      if (c) hit(rule, path, `既存のファイルの変更・削除 ${c}`);
      if (anyMatch(rule.rowsOnlyAdded, path)) {
        const patch = patches.get(path);
        // 配列の末尾に足すと前の行の "}" が "}," に変わる。この形の消した行は書き換えに数えない
        const removed = patch?.removed.filter(
          (line) => !patch.added.includes(`${line},`),
        );
        if (status === "D" || removed === undefined || removed.length > 0)
          hit(rule, path, "既存の行を変えた・消した（行の追加だけではない）");
      }
      if (
        rule.terms &&
        anyMatch(rule.terms.scan, path) &&
        !anyMatch(rule.terms.except, path)
      ) {
        const patch = patches.get(path);
        if (!patch) {
          // 行を読めないときは語を確かめられないので当てる（安全側。rowsOnlyAdded と同じ）
          hit(rule, path, "差分の行を読めない（安全側）");
        } else {
          const fresh = rule.terms.words.filter(
            (w) => count(patch.added, w) > count(patch.removed, w),
          );
          if (fresh.length > 0)
            hit(rule, path, `足した行に新しく入った語: ${fresh.join("・")}`);
        }
      }
    }
    if (rule.reachFrom && trees.length > 0) {
      for (const [file, reason] of reachedFiles(
        rule.reachFrom,
        trees,
        changedSet,
      ))
        hit(rule, file, reason);
    }
  }
  const order = (h) => Number(h.rule.slice(1));
  hits.sort((x, y) => order(x) - order(y) || x.file.localeCompare(y.file));
  return { lane: hits.length > 0 ? "heavy" : "light", hits };
}

// ---- git から読む部分 ----

const git = (repo, args, opts = {}) =>
  execFileSync("git", ["-c", "core.quotepath=false", ...args], {
    cwd: repo,
    maxBuffer: MAX_BUFFER,
    stdio: ["pipe", "pipe", "pipe"],
    ...opts,
  });

/** コミットの木（blob のパスの一覧と、コードのファイルを読む io）。コードのファイルは cat-file --batch で一度に読む */
export function gitTree(repo, sha) {
  const entries = git(repo, ["ls-tree", "-r", "-z", sha], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf("\t");
      const [, type, oid] = line.slice(0, tab).split(" ");
      return { type, oid, path: line.slice(tab + 1) };
    })
    .filter((e) => e.type === "blob");
  const files = entries.map((e) => e.path);
  const fileSet = new Set(files);
  const code = entries.filter(
    (e) => CODE.test(e.path) && !/(^|\/)node_modules\//.test(e.path),
  );
  const contents = new Map();
  if (code.length > 0) {
    const buf = git(repo, ["cat-file", "--batch"], {
      input: `${code.map((e) => e.oid).join("\n")}\n`,
    });
    let at = 0;
    for (const e of code) {
      const nl = buf.indexOf(0x0a, at);
      const header = buf.toString("utf8", at, nl).split(" ");
      if (header[1] !== "blob")
        throw new Error(`git cat-file が読めない: ${e.path}`);
      const size = Number(header[2]);
      contents.set(e.path, buf.toString("utf8", nl + 1, nl + 1 + size));
      at = nl + 1 + size + 1;
    }
  }
  const rel = (p) =>
    p.startsWith(`${TREE_ROOT}/`) ? p.slice(TREE_ROOT.length + 1) : null;
  return {
    files,
    io: {
      isFile: (p) => fileSet.has(rel(p)),
      read: (p) => {
        const text = contents.get(rel(p));
        if (text === undefined)
          throw new Error(`木に無いコードのファイル: ${p}`);
        return text;
      },
    },
  };
}

/** 差分の状態（--no-renames）。状態の頭の1文字（A・M・D・T 等） */
export function gitChanges(repo, from, to) {
  const tokens = git(
    repo,
    ["diff", "--name-status", "--no-renames", "-z", from, to],
    {
      encoding: "utf8",
    },
  )
    .split("\0")
    .filter((t) => t !== "");
  const changes = [];
  for (let i = 0; i + 1 < tokens.length; i += 2)
    changes.push({ status: tokens[i][0], path: tokens[i + 1] });
  return changes;
}

/**
 * ---・+++ の行のパス（"a/"・"b/" を外す）。空白を含むパスは末尾にタブが付き、
 * 引用符・バックスラッシュ・制御文字を含むパスは C の形で引用される（core.quotepath=false でも）
 */
export function headerPath(rest) {
  const raw = rest.replace(/\t$/, "");
  if (raw === "/dev/null") return null;
  const unquoted = raw.startsWith('"') ? unquoteC(raw.slice(1, -1)) : raw;
  return unquoted.replace(/^[ab]\//, "");
}

const C_ESCAPES = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11 };

/** git の C の形の引用を外す（\ooo はバイト、\n 等は制御文字、\" \\ はその文字） */
function unquoteC(text) {
  const body = Array.from(text); // コードポイントごと（サロゲートを割らない）
  const bytes = [];
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch !== "\\") {
      bytes.push(...Buffer.from(ch, "utf8"));
      continue;
    }
    const octal = body.slice(i + 1, i + 4).join("");
    if (/^[0-7]{3}$/.test(octal)) {
      bytes.push(Number.parseInt(octal, 8));
      i += 3;
    } else {
      const e = body[i + 1];
      bytes.push(C_ESCAPES[e] ?? e.charCodeAt(0));
      i += 1;
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

/** unified diff（-U0）を、ファイルごとの足した行・消した行に分ける */
export function parsePatch(text) {
  const patches = new Map();
  let cur = null;
  let inHunk = false;
  const take = (p) => {
    if (p === null) return;
    if (!patches.has(p)) patches.set(p, { added: [], removed: [] });
    cur = patches.get(p);
  };
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      cur = null;
      inHunk = false;
    } else if (!inHunk && line.startsWith("--- ")) {
      take(headerPath(line.slice(4)));
    } else if (!inHunk && line.startsWith("+++ ")) {
      take(headerPath(line.slice(4)));
    } else if (line.startsWith("@@")) {
      inHunk = true;
    } else if (inHunk && cur && line.startsWith("+")) {
      cur.added.push(line.slice(1));
    } else if (inHunk && cur && line.startsWith("-")) {
      cur.removed.push(line.slice(1));
    }
  }
  return patches;
}

/**
 * paths の足した行・消した行。バイナリと行の変わらない変更（空のファイルの追加・mode だけ）は
 * patch に ---・+++ が出ないので、numstat（-z）で見て空の行として入れる。それ以外で読めなかったファイルは
 * Map に入らず、classify が安全側で当てる
 */
function readPatches(repo, from, to, paths) {
  const diff = (extra, opts = {}) =>
    git(
      repo,
      [
        "--literal-pathspecs",
        "diff",
        "--no-renames",
        "--no-color",
        ...extra,
        from,
        to,
        "--",
        ...paths,
      ],
      { encoding: "utf8", ...opts },
    );
  const patches = new Map();
  for (const entry of diff(["--numstat", "-z"]).split("\0").filter(Boolean)) {
    const [added, removed, ...rest] = entry.split("\t");
    const path = rest.join("\t");
    if (
      (added === "-" && removed === "-") ||
      (added === "0" && removed === "0")
    )
      patches.set(path, { added: [], removed: [] });
  }
  for (const [path, patch] of parsePatch(diff(["-U0"])))
    patches.set(path, patch);
  return patches;
}

/** git から差分と木を読んで判定する */
export function classifyCommits(repo, base, head, rules = loadRules()) {
  const resolveSha = (ref) =>
    git(repo, ["rev-parse", "--verify", `${ref}^{commit}`], {
      encoding: "utf8",
    }).trim();
  const headSha = resolveSha(head);
  const mb = git(repo, ["merge-base", resolveSha(base), headSha], {
    encoding: "utf8",
  }).trim();
  const changes = gitChanges(repo, mb, headSha);
  if (changes.length === 0)
    throw new Error("差分が空（base と head を確かめる）");
  // 行を見る必要があるファイルだけ patch を取る（H5 の行の追加だけ・H9 の語）
  const needLines = changes
    .map((c) => c.path)
    .filter((p) =>
      rules.some(
        (r) =>
          anyMatch(r.rowsOnlyAdded, p) ||
          (r.terms &&
            anyMatch(r.terms.scan, p) &&
            !anyMatch(r.terms.except, p)),
      ),
    );
  const patches =
    needLines.length > 0
      ? readPatches(repo, mb, headSha, needLines)
      : new Map();
  const needTrees = rules.some((r) => r.reachFrom);
  const trees = needTrees ? [gitTree(repo, mb), gitTree(repo, headSha)] : [];
  return classify({ changes, patches, trees, rules });
}

function main() {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    const value = i >= 0 ? args[i + 1] : undefined;
    return value?.startsWith("--") ? undefined : value;
  };
  try {
    const base = opt("--base");
    const head = opt("--head");
    if (!base || !head) throw new Error("--base と --head が要る");
    const result = classifyCommits(opt("--repo") ?? process.cwd(), base, head);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    // execFileSync の stderr は Buffer のこともあり、空の Buffer でも真になるので文字にしてから選ぶ
    const message =
      String(error?.stderr ?? "").trim() ||
      String(error?.message ?? error).trim();
    console.error(`pr-lane: 判定できない（重い道として扱う）: ${message}`);
    console.log(
      JSON.stringify({ lane: "heavy", hits: [], error: message }, null, 2),
    );
    process.exitCode = 1;
  }
}

// 直接起動されたときだけ動かす（symlink の下から起動されても判定できるよう実体のパスで比べる）
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
)
  main();
