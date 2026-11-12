/**
 * PR の差分が「軽い道」か「重い道」かを判定する（試作・影。どこからも呼ばない）。
 * 設計: docs/proposal/dev-process-redesign-2026-11-05.md 1.2（#2277）。H の一覧は config/pr-path-rules.json。
 *
 * 使い方: node scripts/maintenance/pr-lane.js --base <sha> --head <sha> [--repo <git のディレクトリ>]
 *   標準出力: { "lane": "light"|"heavy", "hits": [{ "rule": "H1"〜"H9", "file", "reason" }],
 *     "human": [{ "kind", "file", "reason" }], "needs": [{ "kind", "file", "rule" }] }
 *   human・needs は出すだけで lane の判定には使わない（light なら空。heavy なら hits の全部のファイルがどちらかに入る。
 *   入らない物は human の unclassified）。当て方は config/pr-path-rules.json の human と各規則の needs
 *   終了コード: 0＝判定できた。0 以外＝判定できない（呼び手は heavy として扱う。標準出力には lane: heavy と error を出す）
 *   --repo: 差分と木を読む git の作業ディレクトリ（既定は今のディレクトリ）。規則はこのスクリプトの隣（../../config）から読む
 *
 * 差分は base と head の merge-base から head まで（three-dot と同じ）、--no-renames（名前を変えたファイルは元のパスでも判定する）。
 * import の閉包（H2・H6）は merge-base と head の両方のコミットの木を git から読んで辿る（手元のファイルは見ない。消したファイルも元の木で辿る）。
 * 語（H9）の risk-rules.json は、判定する repo の merge-base の木から読む（PR 自身が語を消して軽くできないように）。
 * 語を含む足した行が、同じ PR が語を見る別のファイルから消した行と前後の空白を除いて同じ（字のまま移しただけ）なら数えない（withoutMovedLines）。
 *
 * hq との約束（段L の影、2026-11-05）: Node の組み込みと git だけを使う（npm の部品・DB・ネットワークなし。hq の写しは
 * この script・config/pr-path-rules.json・scripts/lib/relativeImportGraph.js・移すだけの判定 prLaneMoveOnly*.js を同じ配置で持つ）。100秒（BUDGET_MS）で
 * 打ち切り、0 以外で終える（hq の上限は 120秒）。lane が light なら hits は必ず空。
 */
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CODE, reach } from "../lib/relativeImportGraph.js";
import { moveOnlyPaths } from "./prLaneMoveOnly.js";

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
  return JSON.parse(
    readFileSync(join(root, "config/pr-path-rules.json"), "utf8"),
  ).moveOnly;
}

/** config/pr-path-rules.json の human（人にしか判断できない理由の kind ごとの型） */
export function loadHuman(root = SELF_ROOT) {
  return JSON.parse(
    readFileSync(join(root, "config/pr-path-rules.json"), "utf8"),
  ).human;
}

const anyMatch = (patterns = [], path, flags = "") =>
  patterns.some((p) => new RegExp(p, flags).test(path));

/** 既存の行を変えた・消した行（配列の末尾に足したときの "}" → "}," は数えない） */
const changedRows = (patch) =>
  patch.removed.filter((line) => !patch.added.includes(`${line},`));

/** human のうち、足した行・消した行を読む必要があるファイル（CLI が patch を取る対象） */
export const weakenRowPatterns = (human) => [
  ...(human.weaken?.addedRows ?? []),
  ...(human.weaken?.registryRows ?? []),
  ...(human.weaken?.removedRows ?? []),
];

/** DB の書き手: 中身は base・head の木から読む。無い側（追加の base・削除の head）は見ない。読めなければ当てる（安全側） */
function writerReason({ spec, file, status, readBlob }) {
  if (!anyMatch(spec.writerFiles, file)) return null;
  const sides = [status !== "A" && "base", status !== "D" && "head"];
  const texts = sides.filter(Boolean).map((s) => readBlob(s, file));
  const hit = texts.some(
    (t) =>
      typeof t !== "string" ||
      spec.writerContent.some((p) => new RegExp(p).test(t)),
  );
  return hit
    ? `${spec.reason}（.from(…).upsert 等・SERVICE_ROLE を持つ、または中身を読めない）`
    : null;
}

/** weaken（守りを弱める変更）の当たりと理由 */
function weakenReason({ spec: w, file, status, patch }) {
  const del = status === "D";
  // 行を読めない（patch 無し）ときは当てる（安全側）
  const rows = (pick) => del || !patch || pick(patch).length > 0;
  const cases = [
    [del && anyMatch(w.deleted, file), "削除"],
    [
      status !== "A" && anyMatch(w.changedScripts, file),
      "既存の .mjs・.cjs・.sh の verify の変更",
    ],
    [
      !del && anyMatch(w.addedRows, file) && (!patch || patch.added.length > 0),
      "allowlist に行を足す",
    ],
    [
      anyMatch(w.registryRows, file) && rows(changedRows),
      "台帳の既存の行の変更・削除",
    ],
    [
      status !== "A" && anyMatch(w.removedRows, file) && rows((p) => p.removed),
      "行の削除・書き換え",
    ],
  ];
  const found = cases.find(([ok]) => ok);
  return found ? `${w.reason}（${found[1]}）` : null;
}

/** 1つの kind が1ファイルに当たる理由（当たらなければ null） */
function humanReason(kind, ctx) {
  const { spec, file, hits } = ctx;
  if (anyMatch(spec.paths, file, "i")) return spec.reason;
  if (spec.fromRule) {
    const h = hits.find((x) => x.rule === spec.fromRule && x.file === file);
    return h ? `${spec.reason}（${h.reason}）` : null;
  }
  if (spec.writerFiles) return writerReason(ctx);
  return kind === "weaken" ? weakenReason(ctx) : null;
}

/** 1ファイルが当たる human の kind と理由（heavy の hits のファイルだけに使う） */
function humanKinds({ human, file, status, patch, hits, readBlob }) {
  const found = [];
  for (const [kind, spec] of Object.entries(human)) {
    const ctx = { spec, file, status, patch, hits, readBlob };
    const reason = humanReason(kind, ctx);
    if (reason) found.push({ kind, file, reason });
  }
  return found;
}

/**
 * heavy の hits について、人にしか判断できない理由（human）と機械の確かめ（needs）を出す。lane の判定には使わない。
 * hits のファイルで、どちらにも入らない物は unclassified として human に入れる（黙って抜けないように）
 */
function explain({ hits, changes, patches, rules, human, readBlob }) {
  const status = new Map(changes.map((c) => [c.path, c.status]));
  const files = [...new Set(hits.map((h) => h.file))];
  const humans = [];
  const needs = [];
  for (const file of files) {
    const mine = humanKinds({
      human,
      file,
      status: status.get(file),
      patch: patches.get(file),
      hits,
      readBlob,
    });
    const own = [];
    for (const h of hits.filter((x) => x.file === file)) {
      const rule = rules.find((r) => r.id === h.rule);
      if (!rule?.needs) continue;
      if (
        (rule.needsUnlessHuman ?? []).some((k) =>
          mine.some((m) => m.kind === k),
        )
      )
        continue;
      const kinds =
        typeof rule.needs === "string"
          ? [rule.needs]
          : Object.keys(rule.needs).filter((k) =>
              anyMatch(rule.needs[k], file),
            );
      for (const kind of kinds)
        if (!own.some((n) => n.kind === kind))
          own.push({ kind, file, rule: h.rule });
    }
    humans.push(...mine);
    needs.push(...own);
    if (mine.length === 0 && own.length === 0)
      humans.push({
        kind: "unclassified",
        file,
        reason: hits
          .filter((x) => x.file === file)
          .map((x) => `${x.rule}: ${x.reason}`)
          .join(" / "),
      });
  }
  const order = (x, y) =>
    x.file.localeCompare(y.file) || x.kind.localeCompare(y.kind);
  return { human: humans.sort(order), needs: needs.sort(order) };
}

const count = (lines, word) =>
  lines.reduce((n, line) => n + line.split(word).length - 1, 0);

/**
 * 語（H9）の数えから、別のファイルへ字のまま移しただけの行を外す（部品の分割で既存の文言が新しいファイルへ動く形）。
 * 語を含む足した行のうち、同じ PR が paths の別のファイルから消した行と、前後の空白を除いて一字違わず同じ物を、
 * 消した行と1対1で対にし、足した側・消した側の両方の数えから外す。
 * - 同じファイルの中で足して消した同じ行は先にそのファイルの中で対にする（別のファイルの行と二重に使わない。複製は移動に数えない）
 * - 移し元は paths（語を見るファイル）だけ。語を見ないファイル（記事・docs 等）から持ち込んだ行は今どおり新しい語
 * - 1字でも変えた行・新しい行は残るので、今どおり「足した行の語の数 > 消した行の語の数」で当たる
 * @param {Map<string, { added: string[], removed: string[] }>} patches
 * @param {string[]} paths 語を見るファイル（順に対にする。git の差分の順）
 * @param {string[]} words
 * @returns {Map<string, { added: string[], removed: string[] }>} 移動を外した語を含む行（patches に無いパスは入れない）
 */
export function withoutMovedLines(patches, paths, words) {
  const hasWord = (line) => words.some((w) => line.includes(w));
  const bag = (lines) => {
    const m = new Map();
    for (const l of lines) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const files = paths
    .filter((p) => patches.has(p))
    .map((path) => {
      const p = patches.get(path);
      const added = p.added.filter(hasWord).map((l) => l.trim());
      const removed = p.removed.filter(hasWord).map((l) => l.trim());
      // 同じファイルの中の対を除いた残り（別のファイルと対にできる行）
      const freeAdded = bag(added);
      const freeRemoved = bag(removed);
      for (const [line, n] of freeAdded) {
        const k = Math.min(n, freeRemoved.get(line) ?? 0);
        freeAdded.set(line, n - k);
        freeRemoved.set(line, (freeRemoved.get(line) ?? 0) - k);
      }
      return { path, added, removed, freeAdded, freeRemoved };
    });
  const movedIn = new Map(files.map((f) => [f.path, new Map()]));
  const movedOut = new Map(files.map((f) => [f.path, new Map()]));
  const take = (m, line) => m.set(line, (m.get(line) ?? 0) + 1);
  for (const to of files) {
    for (const [line, n] of to.freeAdded) {
      for (let i = 0; i < n; i += 1) {
        const from = files.find(
          (f) => f !== to && (f.freeRemoved.get(line) ?? 0) > 0,
        );
        if (!from) break;
        from.freeRemoved.set(line, from.freeRemoved.get(line) - 1);
        take(movedIn.get(to.path), line);
        take(movedOut.get(from.path), line);
      }
    }
  }
  const drop = (lines, moved) => {
    const left = new Map(moved);
    return lines.filter((l) => {
      const k = left.get(l) ?? 0;
      if (k === 0) return true;
      left.set(l, k - 1);
      return false;
    });
  };
  return new Map(
    files.map((f) => [
      f.path,
      {
        added: drop(f.added, movedIn.get(f.path)),
        removed: drop(f.removed, movedOut.get(f.path)),
      },
    ]),
  );
}

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
 * @returns {{ lane: "light"|"heavy", hits: { rule: string, file: string, reason: string }[],
 *   human: { kind: string, file: string, reason: string }[], needs: { kind: string, file: string, rule: string }[] }}
 */
export function classify({
  changes,
  patches = new Map(),
  trees = [],
  rules = loadRules(),
  moved = new Set(),
  human = loadHuman(),
  readBlob = () => null,
}) {
  const changedSet = new Set(changes.map((c) => c.path));
  const hits = [];
  const hit = (rule, file, reason) => {
    if (!hits.some((h) => h.rule === rule.id && h.file === file))
      hits.push({ rule: rule.id, file, reason });
  };
  for (const rule of rules) {
    const termLines = rule.terms
      ? withoutMovedLines(
          patches,
          changes
            .map((c) => c.path)
            .filter(
              (p) =>
                anyMatch(rule.terms.scan, p) && !anyMatch(rule.terms.except, p),
            ),
          rule.terms.words,
        )
      : null;
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
          // 別のファイルから字のまま移した行は数えない（withoutMovedLines）。語の一覧は merge-base の木から読んだ物
          const lines = termLines.get(path);
          const fresh = rule.terms.words.filter(
            (w) => count(lines.added, w) > count(lines.removed, w),
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
  const lane = hits.length > 0 ? "heavy" : "light";
  const why =
    lane === "light"
      ? { human: [], needs: [] }
      : explain({ hits, changes, patches, rules, human, readBlob });
  return { lane, hits, ...why };
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
  const human = loadHuman();
  // 行を見る必要があるファイルだけ patch を取る（H5 の行の追加だけ・H7 の全体のセレクタ・H9 の語・human の weaken の行）
  const needLines = changes
    .filter(
      ({ status, path: p }) =>
        anyMatch(weakenRowPatterns(human), p) ||
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
  const result = classify({
    changes,
    patches,
    trees,
    rules,
    moved,
    human,
    readBlob: readText,
  });
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
      JSON.stringify(
        {
          lane: "heavy",
          hits: [],
          error: message,
          human: [{ kind: "error", file: "", reason: message }],
          needs: [],
        },
        null,
        2,
      ),
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
