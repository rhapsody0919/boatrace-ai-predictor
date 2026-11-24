/**
 * PR の差分が「軽い道」か「重い道」かを判定する（試作・影。どこからも呼ばない）。
 * 設計: docs/proposal/dev-process-redesign-2026-11-05.md 1.2（#2277）。H の一覧は config/pr-path-rules.json。
 *
 * 使い方: node scripts/maintenance/pr-lane.js --base <sha> --head <sha> [--repo <git のディレクトリ>]
 *   標準出力: { "lane": "light"|"heavy", "hits": [{ "rule": "H1"〜"H10", "file", "reason" }],
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
 * この script・その部品 prLaneClassify.js・prLaneHuman.js・prLaneLines.js・config/pr-path-rules.json・scripts/lib/relativeImportGraph.js・
 * 移すだけの判定 prLaneMoveOnly*.js・大きさの数え prSize.js・prSizeGit.js を同じ配置で持つ）。大きさ（H10）が線を超えたときだけ
 * 記事の関門 scripts/content/check-content-pr.js（npm の部品を読む）を子の過程で起動する。起動できなければ大きさを数えられないとして H10 を当てる（安全側）。100秒（BUDGET_MS）で
 * 打ち切り、0 以外で終える（hq の上限は 120秒）。lane が light なら hits は必ず空。
 */
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { CODE } from "../lib/relativeImportGraph.js";
import { moveOnlyPaths } from "./prLaneMoveOnly.js";
import { parsePatch } from "./prLaneLines.js";
import { measureCommits } from "./prSizeGit.js";
import { anyMatch, weakenRowPatterns } from "./prLaneHuman.js";
import {
  SELF_ROOT,
  TREE_ROOT,
  loadRules,
  loadMoveOnly,
  loadHuman,
  classify,
} from "./prLaneClassify.js";

const MAX_BUFFER = 1024 * 1024 * 1024;

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

/**
 * 大きさ（H10）。時間の上限は残りを渡す。数えられなければ { error }（classify が安全側で当てる）。
 * 時間の上限を超えたことは判定そのものを止める（他の規則と同じく 0 以外で終える）
 */
function measureSize(repo, mb, headSha) {
  try {
    return measureCommits(repo, mb, headSha, { timeout: remaining });
  } catch (error) {
    remaining(); // 上限を超えていたら投げる
    return { error: String(error?.message ?? error).split("\n")[0] };
  }
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
    .filter(({ status, path: p }) =>
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
  const size = rules.some((r) => r.size) ? measureSize(repo, mb, headSha) : null;
  const result = classify({
    changes,
    patches,
    trees,
    rules,
    moved,
    human,
    readBlob: readText,
    size,
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

export {
  withoutMovedLines,
  globalSelectors,
  parsePatch,
  headerPath,
} from "./prLaneLines.js";

export { weakenRowPatterns } from "./prLaneHuman.js";

export {
  TREE_ROOT,
  loadRules,
  loadMoveOnly,
  loadHuman,
  classify,
} from "./prLaneClassify.js";
