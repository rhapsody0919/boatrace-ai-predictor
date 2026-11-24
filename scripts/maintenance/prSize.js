/**
 * prSize.js - PR の大きさ（AGENTS.md の安全の6点の5「300行・5ファイル」）を数える（BOA-1718）。
 *
 * 作り手が自分で数えるのをやめ、機械で数える。数えない物は少なく決め、ほかは全部数える（知らない置き場は数える側）:
 *   1. 新しく足した e2e の spec（e2e 以下の *.spec.js）と verify（scripts/maintenance/verify-*.js）。
 *      ただし差分のほかのファイルが足した行で import・require・new URL するなら数える（試験のファイルに本体を置く抜け道）
 *   2. verify-registry.json の行の追加だけ（既存の行を変えた・消したら全部数える。pr-lane の H5 の rowsOnlyAdded と同じ見方）
 *   3. ja 以外の locale（src/locales/<言語>/<名>.json）の行の追加だけで、足したキーの集合が同じ PR の ja の同じ名の
 *      ファイルで足したキーの集合と同じとき（ja は数える。訳の揃いは verify-i18n-consistency が CI で見る）
 *   4. 空行と、コードのファイル（.js・.jsx・.mjs・.cjs・.ts・.tsx・.css）の注釈だけの行（行頭が // ・* ・/* ・{/*）
 *   5. 消しただけの行（数えるのは足した行だけ。死んだコードを消す PR を罰さない。目安、根拠なし）
 * ファイルの数は、数える行が1つ以上あるファイルと、行の無い差分（バイナリ・改名だけ・mode だけ）の数。消したファイルは数えない。
 * 線の外（全部を数えない）の PR: 移すだけ（pr-lane の moveOnlyPaths が差分の全部のファイルを移すだけと判定）と、
 * 記事の PR（scripts/content/check-content-pr.js が通す）。判定は呼び手がその物を呼んで渡す。
 *
 * Node の組み込みと相対の import だけ（pr-lane.js から使うため）。数える本体 measurePrSize は git に触れない。
 * git から読んで数える入口は measureCommits（verify-pr-size.js と pr-lane.js が呼ぶ）。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { moveOnlyPaths } from "./prLaneMoveOnly.js";
import { loadMoveOnly } from "./prLaneClassify.js";
import { parsePatch } from "./pr-lane.js";

const CHECK_CONTENT_PR = fileURLToPath(
  new URL("../content/check-content-pr.js", import.meta.url),
);

/** 線（数字の根拠は無いが動かさない。オーナー 2026-11-24、BOA-1718） */
export const SIZE_LIMIT = Object.freeze({ lines: 300, files: 5 });

const NEW_TEST = [
  /^e2e\/.*\.spec\.js$/,
  /^scripts\/maintenance\/verify-[^/]+\.(js|mjs|cjs|sh)$/,
];
const REGISTRY = /^scripts\/maintenance\/verify-registry\.json$/;
const LOCALE = /^src\/locales\/([^/]+)\/(.+\.json)$/;
const CODE = /\.(js|jsx|mjs|cjs|ts|tsx|css)$/;
const NOTE = /^\s*(\/\/|\*|\/\*|\{\/\*)/;

/** 数えない行（空行・コードのファイルの注釈だけの行） */
export function isNoteLine(path, line) {
  if (line.trim() === "") return true;
  return CODE.test(path) && NOTE.test(line);
}

/** 行の追加だけか（配列の末尾に足して前の行の "}" が "}," に変わった物は書き換えに数えない） */
function onlyAdded(patch) {
  return patch.removed.every((line) => patch.added.includes(`${line},`));
}

/** JSON の葉のキー（"a.b.c"）の集合。ファイルが無ければ空、読めなければ null */
function leafKeys(text) {
  if (text === null || text === undefined) return new Set();
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null; // 読めない JSON は数える側に倒す（呼び手が null を見て数える）
  }
  const keys = new Set();
  const walk = (v, prefix) => {
    if (v && typeof v === "object" && !Array.isArray(v))
      for (const [k, child] of Object.entries(v))
        walk(child, prefix ? `${prefix}.${k}` : k);
    else keys.add(prefix);
  };
  walk(value, "");
  return keys;
}

/** base と head の JSON の間で足したキー（並べた配列。読めなければ null） */
function addedKeys(readText, path) {
  const before = leafKeys(readText("base", path));
  const after = leafKeys(readText("head", path));
  if (before === null || after === null) return null;
  return [...after].filter((k) => !before.has(k)).sort();
}

const sameList = (a, b) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** 数えない locale のファイル（ja 以外で、ja の同じ名と足したキーが同じ、行の追加だけ） */
function exemptLocales(changes, patches, readText) {
  const exempt = new Map();
  for (const { status, path } of changes) {
    const m = LOCALE.exec(path);
    if (!m || m[1] === "ja" || status === "D") continue;
    const jaPath = `src/locales/ja/${m[2]}`;
    const patch = patches.get(path);
    if (!patch || !onlyAdded(patch)) continue;
    if (!changes.some((c) => c.path === jaPath && c.status !== "D")) continue;
    const mine = addedKeys(readText, path);
    const ja = addedKeys(readText, jaPath);
    if (mine && ja && mine.length > 0 && sameList(mine, ja))
      exempt.set(path, `ja（${jaPath}）と同じキー ${mine.length} 件の追加`);
  }
  return exempt;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 足した行が、この試験のファイルを import・require・new URL するか（拡張子は省いてもよい） */
function importsFile(lines, testPath) {
  const name = escapeRe(
    testPath
      .split("/")
      .pop()
      .replace(/\.(js|mjs|cjs|sh)$/, ""),
  );
  const re = new RegExp(
    `(\\bimport\\b|\\brequire\\s*\\(|\\bnew\\s+URL\\s*\\(|\\bfrom\\s)[^\\n]*[/"'\`]${name}(\\.(js|mjs|cjs|sh))?["'\`]`,
  );
  return lines.some((line) => re.test(line));
}

/** 数えない新しい試験のファイル（試験でないほかの変更ファイルから読まれる物は数える） */
function exemptTests(changes, patches) {
  const candidates = changes.filter(
    (c) => c.status === "A" && NEW_TEST.some((re) => re.test(c.path)),
  );
  const isCandidate = (p) => candidates.some((x) => x.path === p);
  const exempt = new Map();
  for (const t of candidates) {
    const read = changes.some(
      (c) =>
        !isCandidate(c.path) &&
        !REGISTRY.test(c.path) &&
        importsFile(patches.get(c.path)?.added ?? [], t.path),
    );
    if (!read) exempt.set(t.path, "新しい試験のファイル");
  }
  return exempt;
}

/** 数えないファイル → 理由（新しい試験・ja と同じキーの locale・台帳の行の追加だけ） */
function skipList(changes, live, patches, readText) {
  const skip = new Map([
    ...exemptTests(changes, patches),
    ...exemptLocales(changes, patches, readText),
  ]);
  const reg = live.find((c) => REGISTRY.test(c.path));
  if (reg && patches.get(reg.path) && onlyAdded(patches.get(reg.path)))
    skip.set(reg.path, "台帳の行の追加だけ");
  return skip;
}

/** ファイルごとに数える（数えない物は skipped に理由つきで） */
function countFiles(live, patches, skip) {
  const counted = [];
  const skipped = [];
  for (const { path } of live) {
    const patch = patches.get(path);
    if (skip.has(path)) skipped.push({ path, why: skip.get(path) });
    else if (!patch || patch.added.length + patch.removed.length === 0)
      counted.push({ path, lines: 0 }); // 行の無い差分（バイナリ・改名だけ・mode だけ）はファイルに数える
    else {
      const lines = patch.added.filter((l) => !isNoteLine(path, l)).length;
      if (lines > 0) counted.push({ path, lines });
      else skipped.push({ path, why: "注釈・空行・消した行だけ" });
    }
  }
  return { counted, skipped };
}

/**
 * PR の大きさを数える（git に触れない）
 * @param {{
 *   changes: { status: string, path: string }[],
 *   patches: Map<string, { added: string[], removed: string[] }>,
 *   readText?: (side: "base"|"head", path: string) => string|null,
 *   moved?: Set<string>,
 *   contentPr?: boolean,
 * }} input
 * @returns {{ lines: number, files: number, over: boolean, exempt: string|null,
 *   counted: { path: string, lines: number }[], skipped: { path: string, why: string }[] }}
 */
export function measurePrSize({
  changes,
  patches,
  readText = () => null,
  moved = new Set(),
  contentPr = false,
}) {
  const live = changes.filter((c) => c.status !== "D");
  const whole = (why) => ({
    lines: 0,
    files: 0,
    over: false,
    exempt: why,
    counted: [],
    skipped: live.map((c) => ({ path: c.path, why })),
  });
  if (contentPr) return whole("記事の PR（check-content-pr.js が通す）");
  if (changes.length > 0 && changes.every((c) => moved.has(c.path)))
    return whole("移すだけ（pr-lane の moveOnly）");

  const { counted, skipped } = countFiles(
    live,
    patches,
    skipList(changes, live, patches, readText),
  );
  const lines = counted.reduce((n, c) => n + c.lines, 0);
  return {
    lines,
    files: counted.length,
    over: lines > SIZE_LIMIT.lines || counted.length > SIZE_LIMIT.files,
    exempt: null,
    counted,
    skipped,
  };
}

/**
 * git の出力から measurePrSize の入力を作る（git は呼び手が渡す: 引数の配列 → 標準出力の文字列）。
 * 差分は merge-base から head まで、改名を見る（-M。verify-pr-shape.js と同じ）。
 * patch は pr-lane.js の parsePatch（改名の元のパスにも空の行が入るが、changes に無いので数えない）
 */
export function collectSizeInput(git, mergeBase, head) {
  const tokens = git(["diff", "--name-status", "-M", "-z", mergeBase, head])
    .split("\0")
    .filter((t) => t !== "");
  const changes = [];
  for (let i = 0; i < tokens.length;) {
    const status = tokens[i][0];
    const twoPaths = status === "R" || status === "C";
    changes.push({ status, path: tokens[i + (twoPaths ? 2 : 1)] });
    i += twoPaths ? 3 : 2;
  }
  const patches = parsePatch(
    git(["diff", "-M", "-U0", "--no-color", "--no-ext-diff", mergeBase, head]),
  );
  const readText = (side, path) => {
    try {
      return git(["show", `${side === "base" ? mergeBase : head}:${path}`]);
    } catch {
      return null; // 無いファイル（足した・消した側）は null。locale の判定は無い側を空として扱う
    }
  };
  return { changes, patches, readText };
}

/** check-content-pr.js を dir（HEAD が PR の head の作業ツリー）で起動し、終了コード0なら記事の PR */
function runContentGate(dir, baseSha) {
  try {
    execFileSync(process.execPath, [CHECK_CONTENT_PR, "--base", baseSha], {
      cwd: dir,
      stdio: ["ignore", "ignore", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
    return true;
  } catch (err) {
    // 1＝記事の PR でない、2＝判定できない（どちらも数える側）。起動できない等の失敗は投げる
    if (typeof err.status === "number") return false;
    throw err;
  }
}

/**
 * 記事の PR か（scripts/content/check-content-pr.js をそのまま当てる）。関門は作業ツリーの HEAD を見るので、
 * head が repo の HEAD でなければ一時の作業ツリー（detach）に head を出して当てる（auto-merge-content-prs.js の contract と同じ）
 */
export function isContentPr(repo, baseSha, headSha) {
  const git = (args) =>
    execFileSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  if (git(["rev-parse", "HEAD"]) === headSha)
    return runContentGate(repo, baseSha);
  const dir = mkdtempSync(join(tmpdir(), "pr-size-content-"));
  try {
    git(["worktree", "add", "-q", "--detach", dir, headSha]);
    return runContentGate(dir, baseSha);
  } finally {
    try {
      git(["worktree", "remove", "--force", dir]);
    } catch {
      rmSync(dir, { recursive: true, force: true }); // worktree add の前に落ちた等で git が知らない場所は消すだけ
      git(["worktree", "prune"]);
    }
  }
}

/**
 * git から差分を読んで数える（repo の base と head の merge-base から head まで）。
 * 記事の PR の判定（作業ツリーを出すので重い）は、数えて線を超えたときだけ回す
 */
export function measureCommits(repo, base, head) {
  const git = (args) =>
    execFileSync("git", ["-c", "core.quotepath=false", ...args], {
      cwd: repo,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  const sha = (ref) => git(["rev-parse", "--verify", `${ref}^{commit}`]).trim();
  const headSha = sha(head);
  const baseSha = sha(base);
  const mergeBase = git(["merge-base", baseSha, headSha]).trim();
  const input = collectSizeInput(git, mergeBase, headSha);
  const moved = moveOnlyPaths(loadMoveOnly(), input.changes, input.readText);
  const counted = measurePrSize({ ...input, moved });
  if (!counted.over) return counted;
  return isContentPr(repo, baseSha, headSha)
    ? measurePrSize({ ...input, moved, contentPr: true })
    : counted;
}
