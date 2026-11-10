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
 * 語（H9）の risk-rules.json は、判定する repo の merge-base の木から読む（PR 自身が語を消して軽くできないように）。
 *
 * hq との約束（段L の影、2026-11-05）: Node の組み込みと git だけを使う（npm の部品・DB・ネットワークなし。hq の写しは
 * この script・config/pr-path-rules.json・scripts/lib/relativeImportGraph.js だけを同じ配置で持つ）。100秒（BUDGET_MS）で
 * 打ち切り、0 以外で終える（hq の上限は 120秒）。lane が light なら hits は必ず空。
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

/**
 * 規則を読む（risk-rules の platforms: all の語を H9 に足す）。
 * config/pr-path-rules.json はこのスクリプトの隣から読む（hq の写しは pr-lane.js・規則・relativeImportGraph.js だけを持つ）。
 * risk-rules.json は readRisk で読む。CLI は判定する repo の merge-base の木から読む（PR 自身が語を消して軽くできないように）
 */
export function loadRules(
  root = SELF_ROOT,
  readRisk = (p) => readFileSync(join(root, p), "utf8"),
) {
  const config = JSON.parse(
    readFileSync(join(root, "config/pr-path-rules.json"), "utf8"),
  );
  return config.rules.map((rule) => {
    if (!rule.terms) return rule;
    const risk = rule.terms.riskRules
      ? JSON.parse(readRisk(rule.terms.riskRules))
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

/** config/pr-path-rules.json の moveOnly（移すだけの判定の from・to。無ければ undefined） */
export function loadMoveOnly(root = SELF_ROOT) {
  return JSON.parse(readFileSync(join(root, "config/pr-path-rules.json"), "utf8"))
    .moveOnly;
}

const anyMatch = (patterns = [], path) =>
  patterns.some((p) => new RegExp(p).test(path));

const count = (lines, word) =>
  lines.reduce((n, line) => n + line.split(word).length - 1, 0);

/** 括弧（:not()・:is() の中・[...]）の外のカンマで割る */
const splitTop = (prelude) => {
  const out = [""];
  let depth = 0;
  for (const ch of prelude) {
    if (ch === "(" || ch === "[") depth += 1;
    if (ch === ")" || ch === "]") depth -= 1;
    if (ch === "," && depth === 0) out.push("");
    else out[out.length - 1] += ch;
  }
  return out.map((s) => s.trim()).filter(Boolean);
};

/**
 * 対象を絞るクラスが無いか。括弧の中（:not(.x)・:has(.x)）・属性・ID は絞りに数えない
 * （#root a・[data-theme="dark"] h1 も全体に効く）。:root・html・body・* で始まるものも全体
 */
const isGlobalSelector = (sel) =>
  /^(:root|html|body|\*)(?![\w-])/i.test(sel) ||
  !sel
    .replace(/\([^()]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/#[\w-]+/g, "")
    .includes(".");

/**
 * 新しい CSS のファイルの中身（足した行）から、全体に効くセレクタを返す。
 * 規則の中に入れ子にした規則（.card { & a {} }・.card { a {} }）は親で絞られるので数えない。
 * @media・@supports 等の中は見る。@keyframes・@font-face 等の中と、文字列・コメントの中は見ない
 * @param {string[]} lines
 * @returns {string[]}
 */
export function globalSelectors(lines) {
  const text = lines
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""');
  const found = [];
  // "rule"（規則の中）・"group"（@media 等、中にセレクタを持つ）・"other"（@keyframes 等）
  const stack = [];
  let prelude = "";
  for (const ch of text) {
    if (ch === "{") {
      const head = prelude.trim();
      prelude = "";
      if (head.startsWith("@")) {
        const group = /^@(media|supports|layer|container|document)\b/i;
        stack.push(group.test(head) ? "group" : "other");
      } else {
        if (stack.every((k) => k === "group"))
          found.push(...splitTop(head).filter(isGlobalSelector));
        stack.push("rule");
      }
    } else if (ch === "}") {
      stack.pop();
      prelude = "";
    } else if (ch === ";") {
      prelude = "";
    } else {
      prelude += ch;
    }
  }
  return found;
}

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
  moved = new Set(),
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
      // 移すだけ（moveOnlyPaths）と分かったデータ層のファイルは、H3（数字の定義）と H9（語が新しく入る）を外す
      if (rule.exceptMoveOnly && moved.has(path)) continue;
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
      // 既存の .css は changed で当てるので、全体のセレクタは新しいファイル（中身が全部足した行）だけで見る
      if (added && anyMatch(rule.globalSelectors, path)) {
        const patch = patches.get(path);
        const found = patch && globalSelectors(patch.added);
        if (!patch) hit(rule, path, "差分の行を読めない（安全側）");
        else if (found.length > 0)
          hit(rule, path, `全体に効くセレクタ: ${found.join("・")}`);
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

// ---- 移すだけ（BOA-1433 RA02b、hq の設計図 drafts/ryujin-target-architecture-20261110.md §5.3 RA02②） ----
// split-data-layer.mjs が supabaseDataService.js（from）から新しい core*.js・*Queries*.js（to）へ字のまま移した PR を見分ける。
// npm の部品を使わない約束（上の hq との約束）なので構文木でなく行で比べる。スクリプトは本体の字をそのまま写すので、
// 決まった正規化の後の行の多重集合が一致すれば、AST が同じより強い（字まで同じ）。比べ方:
//   from の base の行 ＝ from の head の行 ＋ to の行 − 殻に新しく足した `  getX,`（委ねるだけのメソッドは base から外す）
//   外す行: import・再 export の文（複数行も）・空行・to の頭の決まった2行の注釈
//   正規化: 頭の `export ` を外す・字下げ2のメソッドの頭 `  [async ]getX(` → `[async ]function getX(`・`  },` → `  }`・
//           `this.getX(` → `getX(`・注釈の行は前後の空白を外す（両側に同じく当てる）
// 加えて、モジュールの上で呼び出しを含む初期化の行は、to の各ファイルの中で base と同じ順であること
const MOVE_HEADER = [
  /^\/\/ src\/services\/supabaseDataService\.js から scripts\/maintenance\/split-data-layer\.mjs で字のまま移した（領域: [A-Za-z]+）。$/,
  /^\/\/ 本体の字下げは元のまま。手で直すときは普通の関数として直してよい$/,
];
const SHORTHAND = /^ {2}[A-Za-z_$][\w$]*,$/;
const INIT_CALL = /^(?:export )?(?:const|let|var) [^=]+=.*\(/;

const COMMENT = /^\s*(\/\*|\*|\/\/)/;
const STMT_END = /;\s*(\/\/.*)?$/;

/** 上の import・再 export の文（複数行も）とその直前の注釈の行（間の空行も）・空行を外した行（殻で使わなくなった import はスクリプトが注釈ごと外す） */
export function bodyLines(text) {
  const out = [];
  let pending = [];
  let inStmt = false;
  for (const line of text.split("\n")) {
    if (inStmt || /^(?:import\b|export \{)/.test(line)) {
      inStmt = !STMT_END.test(line);
      pending = [];
    } else if (line.trim() === "") {
      // 空行は数えない（注釈と次の文の間の空行の有無で結果を変えない）
    } else if (COMMENT.test(line)) {
      pending.push(line);
    } else {
      out.push(...pending, line);
      pending = [];
    }
  }
  return [...out, ...pending];
}

/** 移す前後で同じに数える正規化（両側に同じく当てる） */
export function canonLine(line) {
  const t = line
    .replace(/\s+$/, "")
    .replace(/^export /, "")
    .replace(/^ {2}(async )?([A-Za-z_$][\w$]*)\(/, "$1function $2(")
    .replace(/^ {2}\},/, "  }")
    .replace(/\bthis\.([A-Za-z_$][\w$]*)\(/g, "$1(");
  return COMMENT.test(t) ? t.trim() : t;
}

const tally = (lines) => {
  const m = new Map();
  for (const l of lines) m.set(l, (m.get(l) ?? 0) + 1);
  return m;
};
const minus = (a, b) => {
  const out = new Map(a);
  for (const [k, n] of b) {
    const left = (out.get(k) ?? 0) - n;
    if (left < 0) return null;
    if (left === 0) out.delete(k);
    else out.set(k, left);
  }
  return out;
};
const sameTally = (a, b) =>
  a.size === b.size && [...a].every(([k, n]) => b.get(k) === n);

// 委ねるだけのメソッド（`  getG(v) {` `    return getG(v);` `  },`）のうち、殻で短い形になった物を、直前の注釈ごと base から外す
function dropDelegations(lines, names) {
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^ {2}(?:async )?([A-Za-z_$][\w$]*)\(([^)]*)\) \{$/.exec(lines[i]);
    const isDelegation =
      m &&
      names.has(m[1]) &&
      lines[i + 1] === `    return ${m[1]}(${m[2]});` &&
      lines[i + 2] === "  },";
    if (!isDelegation) {
      out.push(lines[i]);
      continue;
    }
    while (out.length > 0 && /^ {2}\S/.test(out.at(-1)) && COMMENT.test(out.at(-1))) out.pop();
    while (out.length > 0 && /^ {3}\*/.test(out.at(-1))) out.pop();
    while (out.length > 0 && /^ {2}\/\*\*/.test(out.at(-1))) out.pop();
    i += 2;
  }
  return out;
}

// 呼び出しを含む上の初期化の行が、各 to の中で base と同じ順か
function sameInitOrder(baseLines, toTexts) {
  const order = baseLines.filter((l) => INIT_CALL.test(l)).map(canonLine);
  return toTexts.every((t) => {
    const seq = bodyLines(t)
      .filter((l) => INIT_CALL.test(l))
      .map(canonLine);
    const idx = seq.map((l) => order.indexOf(l));
    return idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1]));
  });
}

/**
 * 移すだけの PR なら、外してよいパスの集合（from と to の全部）。違えば空。
 * @param {{from: string, to: string[]}|undefined} moveOnly config/pr-path-rules.json の moveOnly
 * @param {{status: string, path: string}[]} changes
 * @param {(side: "base"|"head", path: string) => string|null} readText 読めなければ null（安全側で空を返す）
 */
export function moveOnlyPaths(moveOnly, changes, readText) {
  if (!moveOnly) return new Set();
  const from = changes.filter((c) => new RegExp(moveOnly.from).test(c.path));
  const to = changes.filter((c) => anyMatch(moveOnly.to, c.path));
  const ok =
    from.length === 1 &&
    from[0].status === "M" &&
    to.length > 0 &&
    to.every((c) => c.status === "A");
  if (!ok) return new Set();
  const texts = [readText("base", from[0].path), readText("head", from[0].path)];
  const toTexts = to.map((c) => readText("head", c.path));
  if ([...texts, ...toTexts].some((t) => typeof t !== "string")) return new Set();
  const [base, head] = texts.map(bodyLines);
  // 殻に新しく足した `  getX,`（base にもある同じ形の行は数から引く。上の単位の object の中の行も同じ形なので負は 0 に）
  const baseShort = tally(base.filter((l) => SHORTHAND.test(l)));
  const added = new Map(
    [...tally(head.filter((l) => SHORTHAND.test(l)))]
      .map(([k, n]) => [k, n - (baseShort.get(k) ?? 0)])
      .filter(([, n]) => n > 0),
  );
  if (added.size === 0) return new Set();
  const names = new Set([...added.keys()].map((l) => l.trim().slice(0, -1)));
  // 短い形の名前ごとに、base にそのメソッドの頭があり head に無い（殻に名前だけ足す PR を通さない）
  const headOf = (lines, n) =>
    lines.some((l) => new RegExp(`^ {2}(?:async )?${n.replace(/\$/g, "\\$")}\\(`).test(l));
  if ([...names].some((n) => !headOf(base, n) || headOf(head, n))) return new Set();
  const toLines = toTexts.flatMap((t) =>
    bodyLines(t).filter((l, i) => !(i < 2 && MOVE_HEADER[i].test(l))),
  );
  const right = minus(
    tally([...head, ...toLines].map(canonLine)),
    new Map([...added].map(([k, n]) => [canonLine(k), n])),
  );
  const left = tally(dropDelegations(base, names).map(canonLine));
  if (!right || !sameTally(left, right)) return new Set();
  if (!sameInitOrder(base, toTexts)) return new Set();
  return new Set([from[0].path, ...to.map((c) => c.path)]);
}

// ---- git から読む部分 ----

/** 1回の判定の時間の上限（hq は 120秒で打ち切る。超えたら判定できないとして 0 以外で終える） */
export const BUDGET_MS = 100_000;
let deadline = Number.POSITIVE_INFINITY;
const remaining = () => {
  const ms = deadline - Date.now();
  if (ms <= 0) throw new Error(`時間の上限（${BUDGET_MS / 1000}秒）を超えた`);
  return ms;
};

const git = (repo, args, opts = {}) =>
  execFileSync("git", ["-c", "core.quotepath=false", ...args], {
    cwd: repo,
    maxBuffer: MAX_BUFFER,
    stdio: ["pipe", "pipe", "pipe"],
    ...(Number.isFinite(deadline) ? { timeout: remaining() } : {}),
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
export function classifyCommits(repo, base, head, budgetMs = BUDGET_MS) {
  deadline = Date.now() + budgetMs;
  try {
    return classifyCommitsInner(repo, base, head);
  } finally {
    deadline = Number.POSITIVE_INFINITY;
  }
}

function classifyCommitsInner(repo, base, head) {
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
  const rules = loadRules(SELF_ROOT, (p) =>
    git(repo, ["show", `${mb}:${p}`], { encoding: "utf8" }),
  );
  // 行を見る必要があるファイルだけ patch を取る（H5 の行の追加だけ・H7 の全体のセレクタ・H9 の語）
  const needLines = changes
    .filter(({ status, path: p }) =>
      rules.some(
        (r) =>
          anyMatch(r.rowsOnlyAdded, p) ||
          (status === "A" && anyMatch(r.globalSelectors, p)) ||
          (r.terms &&
            anyMatch(r.terms.scan, p) &&
            !anyMatch(r.terms.except, p)),
      ),
    )
    .map((c) => c.path);
  const patches =
    needLines.length > 0
      ? readPatches(repo, mb, headSha, needLines)
      : new Map();
  const needTrees = rules.some((r) => r.reachFrom);
  const trees = needTrees ? [gitTree(repo, mb), gitTree(repo, headSha)] : [];
  const readText = (side, p) => {
    try {
      return git(repo, ["show", `${side === "base" ? mb : headSha}:${p}`], {
        encoding: "utf8",
      });
    } catch {
      return null; // 読めなければ移すだけと見なさない（安全側）
    }
  };
  const moved = moveOnlyPaths(loadMoveOnly(), changes, readText);
  const result = classify({ changes, patches, trees, rules, moved });
  remaining(); // 辿り終えた時点で上限を超えていたら判定に使わない
  // light なのに hits がある出力は出さない（hq は矛盾として heavy に扱う。classify は hits の有無で lane を決めるので起きない）
  if ((result.lane === "light") !== (result.hits.length === 0))
    throw new Error("lane と hits が食い違う");
  return result;
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
